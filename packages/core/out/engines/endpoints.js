"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePath = normalizePath;
exports.normalizeUrl = normalizeUrl;
exports.extractRoutes = extractRoutes;
exports.extractCalls = extractCalls;
exports.compareEndpoints = compareEndpoints;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const ts_morph_1 = require("ts-morph");
// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------
/**
 * Normalize an Express/fetch path string:
 *   1. Strip query string (everything from ? onward)
 *   2. Replace :param segments with {param}
 *   3. Strip trailing slash (except bare "/")
 */
function normalizePath(raw) {
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
function normalizeUrl(raw) {
    // If it looks like an absolute URL, extract the path
    const absoluteUrlPattern = /^https?:\/\/[^/]+(\/[^?#]*)/;
    const m = absoluteUrlPattern.exec(raw);
    if (m)
        return normalizePath(m[1]);
    // Treat as a path
    return normalizePath(raw);
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Walk a directory recursively and return all .ts/.tsx files. */
function collectTsFiles(dir) {
    const results = [];
    function walk(current) {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules')
                continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
                results.push(full);
            }
        }
    }
    walk(dir);
    return results;
}
/** Make a path relative to a base dir, using forward slashes. */
function relPath(baseDir, absPath) {
    return path.relative(baseDir, absPath).replace(/\\/g, '/');
}
/**
 * Extract the string value from a StringLiteral or
 * NoSubstitutionTemplateLiteral node.
 * Returns null for template literals with substitutions or other expressions.
 */
function extractStringLiteral(node) {
    if (ts_morph_1.Node.isStringLiteral(node)) {
        return node.getLiteralValue();
    }
    if (ts_morph_1.Node.isNoSubstitutionTemplateLiteral(node)) {
        return node.getLiteralValue();
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
function resolveRouterPrefixes(project, file) {
    const prefixes = new Map();
    let sf;
    try {
        sf = project.addSourceFileAtPath(file);
    }
    catch {
        return prefixes;
    }
    // Walk all call expressions in the file
    sf.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression).forEach((call) => {
        const expr = call.getExpression();
        // Match: <something>.use(arg0, arg1)
        if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
            return;
        if (expr.getName() !== 'use')
            return;
        const args = call.getArguments();
        if (args.length < 2)
            return;
        const prefixNode = args[0];
        const routerNode = args[1];
        const prefixStr = extractStringLiteral(prefixNode);
        if (!prefixStr)
            return;
        // Router argument must be an identifier
        if (!ts_morph_1.Node.isIdentifier(routerNode))
            return;
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
function extractRoutes(dir) {
    const tsFiles = collectTsFiles(dir);
    const routes = [];
    let skippedCount = 0;
    const project = new ts_morph_1.Project({
        useInMemoryFileSystem: false,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: false },
    });
    for (const file of tsFiles) {
        let sf;
        try {
            sf = project.addSourceFileAtPath(file);
        }
        catch {
            continue;
        }
        // Resolve any app.use prefixes defined in this file
        const prefixes = resolveRouterPrefixes(project, file);
        const rel = relPath(dir, file);
        sf.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression).forEach((call) => {
            const expr = call.getExpression();
            if (!ts_morph_1.Node.isPropertyAccessExpression(expr))
                return;
            const methodName = expr.getName().toLowerCase();
            if (!ROUTER_METHODS.has(methodName))
                return;
            const args = call.getArguments();
            if (args.length < 1)
                return;
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
function extractCalls(dir) {
    const tsFiles = collectTsFiles(dir);
    const calls = [];
    let skippedCount = 0;
    const project = new ts_morph_1.Project({
        useInMemoryFileSystem: false,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: false },
    });
    for (const file of tsFiles) {
        let sf;
        try {
            sf = project.addSourceFileAtPath(file);
        }
        catch {
            continue;
        }
        const rel = relPath(dir, file);
        sf.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression).forEach((call) => {
            const expr = call.getExpression();
            const args = call.getArguments();
            // -----------------------------------------------------------------------
            // fetch(url[, options])
            // -----------------------------------------------------------------------
            if (ts_morph_1.Node.isIdentifier(expr) && expr.getText() === 'fetch') {
                if (args.length < 1)
                    return;
                const urlNode = args[0];
                const urlStr = extractStringLiteral(urlNode);
                if (urlStr === null) {
                    skippedCount++;
                    return;
                }
                // Determine method from options object literal
                let method = 'GET';
                if (args.length >= 2 && ts_morph_1.Node.isObjectLiteralExpression(args[1])) {
                    const methodProp = args[1].getProperty('method');
                    if (methodProp && ts_morph_1.Node.isPropertyAssignment(methodProp)) {
                        const valStr = extractStringLiteral(methodProp.getInitializer());
                        if (valStr)
                            method = valStr.toUpperCase();
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
            if (ts_morph_1.Node.isPropertyAccessExpression(expr)) {
                const obj = expr.getExpression().getText().trim();
                if (obj !== 'axios')
                    return;
                const methodName = expr.getName().toLowerCase();
                if (!AXIOS_METHODS.has(methodName))
                    return;
                if (args.length < 1)
                    return;
                const urlNode = args[0];
                const urlStr = extractStringLiteral(urlNode);
                if (urlStr === null) {
                    skippedCount++;
                    return;
                }
                // For axios.request(config), the URL is in config.url — skip (complex)
                if (methodName === 'request') {
                    skippedCount++;
                    return;
                }
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
function routeKey(method, p) {
    return `${method.toUpperCase()}:${p}`;
}
function callKey(call) {
    return routeKey(call.method, call.path);
}
function findingId(...parts) {
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
function compareEndpoints(mergedDir, snapADir, snapBDir, mySnapshot, theirSnapshot, log) {
    // Extract from all three trees
    const mergedRoutes = extractRoutes(mergedDir);
    const snapARoutes = extractRoutes(snapADir);
    const snapBRoutes = extractRoutes(snapBDir);
    const mergedCalls = extractCalls(mergedDir);
    const snapACalls = extractCalls(snapADir);
    const snapBCalls = extractCalls(snapBDir);
    // Log skipped counts if a logger is provided
    if (log) {
        const rs = mergedRoutes.skippedCount + snapARoutes.skippedCount + snapBRoutes.skippedCount;
        const cs = mergedCalls.skippedCount + snapACalls.skippedCount + snapBCalls.skippedCount;
        if (rs > 0)
            log(`[InterLens] endpoints: skipped ${rs} dynamic route(s) across 3 trees.`);
        if (cs > 0)
            log(`[InterLens] endpoints: skipped ${cs} non-literal API call(s) across 3 trees.`);
    }
    // Build route key sets per tree
    const mergedRouteKeys = new Set(mergedRoutes.items.map((r) => routeKey(r.method, r.path)));
    const snapARouteKeys = new Set(snapARoutes.items.map((r) => routeKey(r.method, r.path)));
    const snapBRouteKeys = new Set(snapBRoutes.items.map((r) => routeKey(r.method, r.path)));
    const findings = [];
    for (const call of mergedCalls.items) {
        const key = callKey(call);
        // Call exists in merged but no route matches in merged
        if (mergedRouteKeys.has(key))
            continue;
        // But the route DID exist in both snapA and snapB → it was removed by the merge
        if (!snapARouteKeys.has(key) || !snapBRouteKeys.has(key))
            continue;
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
            affectedLine: call.line - 1, // VS Code uses 0-based lines
            affectedColumn: 0,
            mySnapshotHash: mySnapshot.treeSha,
            theirSnapshotHash: theirSnapshot.treeSha,
        });
    }
    return findings;
}
//# sourceMappingURL=endpoints.js.map