/**
 * engines/endpoints.ts
 *
 * Endpoint consistency checker.
 *
 * extractRoutes(dir)  — scans all .ts/.tsx files in a materialized tree for
 *   Express-style router method calls. Returns Route[].
 *
 * extractCalls(dir)   — scans for fetch() and axios.* calls. Returns ApiCall[].
 *
 * compareEndpoints(mergedDir, snapADir, snapBDir, mySnapshot, theirSnapshot)
 *   — applies the comparison rule from the plan:
 *     "For each frontend call in merged:
 *       if no matching route exists in merged
 *       but a matching route existed in both snapA and snapB:
 *         emit endpoint-mismatch finding (severity error)"
 *
 * Path normalization:
 *   - Replace :param segments with {param}
 *   - Strip trailing slashes
 *   - Strip query strings
 *
 * Skipped items (non-literal URLs, dynamic paths) are counted and returned
 * so callers can log them to the InterLens output channel.
 *
 * No execSync. No vscode imports.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Project, Node, SyntaxKind, StringLiteral, NoSubstitutionTemplateLiteral } from 'ts-morph';
import type { OwnSnapshot, TeammateSnapshot, Finding } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Route {
  /** HTTP method, upper-cased: GET, POST, PUT, DELETE, PATCH */
  method: string;
  /** Normalized path, e.g. /api/auth/{id} */
  path: string;
  /** Source file (relative to the scanned dir, forward slashes) */
  file: string;
  /** 1-based line number of the route declaration */
  line: number;
}

export interface ApiCall {
  /** HTTP method, upper-cased: GET, POST, PUT, DELETE, PATCH */
  method: string;
  /** Normalized URL path component, e.g. /api/auth/login */
  path: string;
  /** Source file (relative to the scanned dir, forward slashes) */
  file: string;
  /** 1-based line number */
  line: number;
}

export interface ExtractResult<T> {
  items: T[];
  /** Number of calls/routes that were skipped because the URL was non-literal */
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an Express/fetch path string:
 *   1. Strip query string (everything from ? onward)
 *   2. Replace :param segments with {param}
 *   3. Strip trailing slash (except bare "/")
 */
export function normalizePath(raw: string): string {
  // Strip query string
  const withoutQuery = raw.split('?')[0];
  // Replace :param with {param}
  const withParams = withoutQuery.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  // Strip trailing slash (but keep bare "/")
  const stripped = withParams.length > 1 ? withParams.replace(/\/+$/, '') : withParams;
  return stripped;
}

/**
 * Normalize a URL that may be a full URL (https://…) or a path.
 * Extracts only the pathname component.
 */
export function normalizeUrl(raw: string): string {
  // If it looks like an absolute URL, extract the path
  const absoluteUrlPattern = /^https?:\/\/[^/]+(\/[^?#]*)/;
  const m = absoluteUrlPattern.exec(raw);
  if (m) return normalizePath(m[1]);
  // Treat as a path
  return normalizePath(raw);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk a directory recursively and return all .ts/.tsx files. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

/** Make a path relative to a base dir, using forward slashes. */
function relPath(baseDir: string, absPath: string): string {
  return path.relative(baseDir, absPath).replace(/\\/g, '/');
}

/**
 * Extract the string value from a StringLiteral or
 * NoSubstitutionTemplateLiteral node.
 * Returns null for template literals with substitutions or other expressions.
 */
function extractStringLiteral(node: Node): string | null {
  if (Node.isStringLiteral(node)) {
    return (node as StringLiteral).getLiteralValue();
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return (node as NoSubstitutionTemplateLiteral).getLiteralValue();
  }
  // TemplateExpression (has ${...}) — skip
  return null;
}

// ---------------------------------------------------------------------------
// app.use prefix resolution
// ---------------------------------------------------------------------------

/**
 * Scan a source file for `app.use(prefixLiteral, routerIdent)` calls and
 * return a map from router-variable-name → prefix string.
 *
 * Also handles `app.use(prefixLiteral, require('...'))` patterns (skipped —
 * only identifier references are resolved).
 */
function resolveRouterPrefixes(project: Project, file: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  let sf;
  try {
    sf = project.addSourceFileAtPath(file);
  } catch {
    return prefixes;
  }

  // Walk all call expressions in the file
  sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();
    // Match: <something>.use(arg0, arg1)
    if (!Node.isPropertyAccessExpression(expr)) return;
    if (expr.getName() !== 'use') return;

    const args = call.getArguments();
    if (args.length < 2) return;

    const prefixNode = args[0];
    const routerNode = args[1];

    const prefixStr = extractStringLiteral(prefixNode);
    if (!prefixStr) return;

    // Router argument must be an identifier
    if (!Node.isIdentifier(routerNode)) return;
    const routerName = routerNode.getText();

    prefixes.set(routerName, prefixStr);
  });

  return prefixes;
}

// ---------------------------------------------------------------------------
// extractRoutes
// ---------------------------------------------------------------------------

const ROUTER_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/**
 * Scan all TypeScript files in `dir` for Express router method calls and
 * return the list of discovered routes.
 *
 * Recognizes:
 *   router.get('/path', handler)
 *   router.post('/path', handler)
 *   router.put('/path', handler)
 *   router.delete('/path', handler)
 *   router.patch('/path', handler)
 *
 * Resolves `app.use('/prefix', router)` prefix if found in the same file.
 *
 * Dynamic paths (non-string-literal first argument) are skipped and counted.
 */
export function extractRoutes(dir: string): ExtractResult<Route> {
  const tsFiles = collectTsFiles(dir);
  const routes: Route[] = [];
  let skippedCount = 0;

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  for (const file of tsFiles) {
    let sf;
    try {
      sf = project.addSourceFileAtPath(file);
    } catch {
      continue;
    }

    // Resolve any app.use prefixes defined in this file
    const prefixes = resolveRouterPrefixes(project, file);
    const rel = relPath(dir, file);

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const methodName = expr.getName().toLowerCase();
      if (!ROUTER_METHODS.has(methodName)) return;

      const args = call.getArguments();
      if (args.length < 1) return;

      const pathArg = args[0];
      const pathStr = extractStringLiteral(pathArg);

      if (pathStr === null) {
        skippedCount++;
        return;
      }

      // Determine the caller (the object the method is called on)
      const callerExpr = expr.getExpression();
      const callerName = callerExpr.getText().trim();

      // Look up app.use prefix for this router variable
      const prefix = prefixes.get(callerName) ?? '';
      const combined = prefix ? prefix.replace(/\/+$/, '') + '/' + pathStr.replace(/^\/+/, '') : pathStr;

      routes.push({
        method: methodName.toUpperCase(),
        path: normalizeUrl(combined),
        file: rel,
        line: call.getStartLineNumber(),
      });
    });
  }

  return { items: routes, skippedCount };
}

// ---------------------------------------------------------------------------
// extractCalls
// ---------------------------------------------------------------------------

const AXIOS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'request']);

/**
 * Scan all TypeScript files in `dir` for fetch() and axios.* API calls.
 *
 * fetch(url)                 → method = GET (unless options.method is a literal)
 * fetch(url, { method: 'POST' }) → method = POST
 * axios.get(url)             → method = GET
 * axios.post(url)            → method = POST
 *
 * Non-literal URLs are skipped and counted.
 */
export function extractCalls(dir: string): ExtractResult<ApiCall> {
  const tsFiles = collectTsFiles(dir);
  const calls: ApiCall[] = [];
  let skippedCount = 0;

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  for (const file of tsFiles) {
    let sf;
    try {
      sf = project.addSourceFileAtPath(file);
    } catch {
      continue;
    }

    const rel = relPath(dir, file);

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression();
      const args = call.getArguments();

      // -----------------------------------------------------------------------
      // fetch(url[, options])
      // -----------------------------------------------------------------------
      if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
        if (args.length < 1) return;
        const urlNode = args[0];
        const urlStr = extractStringLiteral(urlNode);
        if (urlStr === null) { skippedCount++; return; }

        // Determine method from options object literal
        let method = 'GET';
        if (args.length >= 2 && Node.isObjectLiteralExpression(args[1])) {
          const methodProp = args[1].getProperty('method');
          if (methodProp && Node.isPropertyAssignment(methodProp)) {
            const valStr = extractStringLiteral(methodProp.getInitializer()!);
            if (valStr) method = valStr.toUpperCase();
          }
        }

        calls.push({
          method,
          path: normalizeUrl(urlStr),
          file: rel,
          line: call.getStartLineNumber(),
        });
        return;
      }

      // -----------------------------------------------------------------------
      // axios.METHOD(url) or axios(url, opts)
      // -----------------------------------------------------------------------
      if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression().getText().trim();
        if (obj !== 'axios') return;

        const methodName = expr.getName().toLowerCase();
        if (!AXIOS_METHODS.has(methodName)) return;

        if (args.length < 1) return;
        const urlNode = args[0];
        const urlStr = extractStringLiteral(urlNode);
        if (urlStr === null) { skippedCount++; return; }

        // For axios.request(config), the URL is in config.url — skip (complex)
        if (methodName === 'request') { skippedCount++; return; }

        calls.push({
          method: methodName.toUpperCase(),
          path: normalizeUrl(urlStr),
          file: rel,
          line: call.getStartLineNumber(),
        });
      }
    });
  }

  return { items: calls, skippedCount };
}

// ---------------------------------------------------------------------------
// compareEndpoints
// ---------------------------------------------------------------------------

/**
 * Route matching: two routes match if their method AND normalized path are equal.
 */
function routeKey(method: string, p: string): string {
  return `${method.toUpperCase()}:${p}`;
}

function callKey(call: ApiCall): string {
  return routeKey(call.method, call.path);
}

function findingId(...parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Compare endpoint consistency across three materialized trees.
 *
 * Comparison rule (from the plan):
 *   For each frontend API call in the merged tree:
 *     if no matching route exists in the merged tree
 *     but a matching route existed in BOTH snapA and snapB trees:
 *       emit an endpoint-mismatch finding (severity error)
 *
 * This catches: Bob removes or renames a route that Alice is calling.
 *
 * @param mergedDir   Path to the materialized merged tree directory.
 * @param snapADir    Path to the materialized snapshot-A (own) tree directory.
 * @param snapBDir    Path to the materialized snapshot-B (theirs) tree directory.
 * @param mySnapshot  Own snapshot metadata (for Finding fields).
 * @param theirSnapshot Teammate snapshot metadata.
 * @param log         Optional function to report skipped-count messages.
 */
export function compareEndpoints(
  mergedDir: string,
  snapADir: string,
  snapBDir: string,
  mySnapshot: OwnSnapshot,
  theirSnapshot: TeammateSnapshot,
  log?: (msg: string) => void,
): Finding[] {
  // Extract from all three trees
  const mergedRoutes  = extractRoutes(mergedDir);
  const snapARoutes   = extractRoutes(snapADir);
  const snapBRoutes   = extractRoutes(snapBDir);
  const mergedCalls   = extractCalls(mergedDir);
  const snapACalls    = extractCalls(snapADir);
  const snapBCalls    = extractCalls(snapBDir);

  // Log skipped counts if a logger is provided
  if (log) {
    const rs = mergedRoutes.skippedCount + snapARoutes.skippedCount + snapBRoutes.skippedCount;
    const cs = mergedCalls.skippedCount  + snapACalls.skippedCount  + snapBCalls.skippedCount;
    if (rs > 0) log(`[InterLens] endpoints: skipped ${rs} dynamic route(s) across 3 trees.`);
    if (cs > 0) log(`[InterLens] endpoints: skipped ${cs} non-literal API call(s) across 3 trees.`);
  }

  // Build route key sets per tree
  const mergedRouteKeys = new Set(mergedRoutes.items.map((r) => routeKey(r.method, r.path)));
  const snapARouteKeys  = new Set(snapARoutes.items.map((r) => routeKey(r.method, r.path)));
  const snapBRouteKeys  = new Set(snapBRoutes.items.map((r) => routeKey(r.method, r.path)));

  const findings: Finding[] = [];

  for (const call of mergedCalls.items) {
    const key = callKey(call);
    // Call exists in merged but no route matches in merged
    if (mergedRouteKeys.has(key)) continue;
    // But the route DID exist in both snapA and snapB → it was removed by the merge
    if (!snapARouteKeys.has(key) || !snapBRouteKeys.has(key)) continue;

    findings.push({
      id: findingId('endpoint-mismatch', call.method, call.path, theirSnapshot.userEmail),
      type: 'endpoint-mismatch',
      severity: 'error',
      myFile: call.file,
      theirFile: call.file,
      teammateEmail: theirSnapshot.userEmail,
      teammateName: theirSnapshot.displayName,
      method: call.method,
      path: call.path,
      description: `${call.method} ${call.path} no longer exists after ${theirSnapshot.displayName}'s changes.`,
      detail: [
        `Endpoint mismatch detected:`,
        `  Your code calls ${call.method} ${call.path} (in ${call.file}:${call.line})`,
        `  but that route no longer exists after combining with ${theirSnapshot.displayName}'s changes.`,
        `  Coordinate with ${theirSnapshot.displayName} to agree on the new route path.`,
      ].join('\n'),
      affectedLine: call.line - 1,   // VS Code uses 0-based lines
      affectedColumn: 0,
      mySnapshotHash: mySnapshot.treeSha,
      theirSnapshotHash: theirSnapshot.treeSha,
    });
  }

  return findings;
}
