"use strict";
/**
 * endpoints.test.ts — Sub-Task 6
 *
 * Tests normalizePath, normalizeUrl, extractRoutes, extractCalls,
 * and compareEndpoints using real temp filesystem directories containing
 * TypeScript fixture files.
 *
 * compareEndpoints also uses real temp git repos with materialized trees
 * to mirror how analysis.ts uses it in production.
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const endpoints_1 = require("../engines/endpoints");
const merge_1 = require("../engines/merge");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Create a fresh temp directory, write the given files into it, return its path. */
function makeFixtureDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-ep-'));
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    }
    return dir;
}
async function git(cwd, args, env) {
    const { stdout } = await execFile('git', args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
}
/**
 * Set up a git repo with the given files, commit them, and return a
 * materialized tree directory for that commit.
 */
async function makeRepo(files) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-ep-repo-'));
    await git(repoRoot, ['init']);
    await git(repoRoot, ['config', 'user.email', 'test@test.com']);
    await git(repoRoot, ['config', 'user.name', 'Test']);
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(repoRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    }
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'fixture']);
    const headCommit = await git(repoRoot, ['rev-parse', 'HEAD']);
    const treeSha = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
    const treeDir = await (0, merge_1.materializeTree)(repoRoot, treeSha);
    return { repoRoot, treeDir, headCommit, treeSha };
}
// ---------------------------------------------------------------------------
// Fixture TypeScript content strings
// ---------------------------------------------------------------------------
/** Express router with two routes, no app.use prefix */
const BACKEND_BASE = `
import express from 'express';
const router = express.Router();
router.get('/api/auth/login', (req, res) => { res.send('ok'); });
router.post('/api/auth/register', (req, res) => { res.send('ok'); });
export default router;
`;
/** Backend with the route renamed to /api/auth/signin */
const BACKEND_RENAMED = `
import express from 'express';
const router = express.Router();
router.get('/api/auth/signin', (req, res) => { res.send('ok'); });
router.post('/api/auth/register', (req, res) => { res.send('ok'); });
export default router;
`;
/** Express router with an app.use prefix */
const BACKEND_WITH_PREFIX = `
import express from 'express';
const app = express();
const authRouter = express.Router();
authRouter.get('/login', (req, res) => { res.send('ok'); });
authRouter.post('/register', (req, res) => { res.send('ok'); });
app.use('/api/auth', authRouter);
export default app;
`;
/** Frontend with a fetch to /api/auth/login */
const FRONTEND_BASE = `
async function login(): Promise<void> {
  const res = await fetch('/api/auth/login', { method: 'GET' });
  console.log(res);
}
`;
/** Frontend with an axios call */
const FRONTEND_AXIOS = `
import axios from 'axios';
async function login(): Promise<void> {
  await axios.get('/api/auth/login');
  await axios.post('/api/auth/register', { username: 'a' });
}
`;
/** Frontend with a dynamic URL (should be skipped) */
const FRONTEND_DYNAMIC = `
const endpoint = '/api/auth/login';
async function login(path: string): Promise<void> {
  await fetch(endpoint);          // identifier, not a string literal
  await fetch(\`/api/\${path}\`); // template expression with substitution
  await fetch('/api/static');    // this one is fine
}
`;
// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------
describe('normalizePath', () => {
    it('leaves simple paths unchanged', () => {
        expect((0, endpoints_1.normalizePath)('/api/auth/login')).toBe('/api/auth/login');
    });
    it('replaces :param with {param}', () => {
        expect((0, endpoints_1.normalizePath)('/users/:id')).toBe('/users/{id}');
        expect((0, endpoints_1.normalizePath)('/api/:version/users/:id')).toBe('/api/{version}/users/{id}');
    });
    it('strips trailing slashes', () => {
        expect((0, endpoints_1.normalizePath)('/api/auth/login/')).toBe('/api/auth/login');
        expect((0, endpoints_1.normalizePath)('/api/')).toBe('/api');
    });
    it('preserves bare "/"', () => {
        expect((0, endpoints_1.normalizePath)('/')).toBe('/');
    });
    it('strips query strings', () => {
        expect((0, endpoints_1.normalizePath)('/api/auth/login?redirect=/')).toBe('/api/auth/login');
    });
    it('handles combined :param + trailing slash', () => {
        expect((0, endpoints_1.normalizePath)('/users/:id/')).toBe('/users/{id}');
    });
});
// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------
describe('normalizeUrl', () => {
    it('handles relative paths', () => {
        expect((0, endpoints_1.normalizeUrl)('/api/auth/login')).toBe('/api/auth/login');
    });
    it('extracts path from absolute URL', () => {
        expect((0, endpoints_1.normalizeUrl)('https://example.com/api/auth/login')).toBe('/api/auth/login');
    });
    it('extracts path from absolute URL with query string', () => {
        expect((0, endpoints_1.normalizeUrl)('https://example.com/api/auth/login?foo=bar')).toBe('/api/auth/login');
    });
    it('normalizes :param in absolute URLs', () => {
        expect((0, endpoints_1.normalizeUrl)('https://example.com/users/:id')).toBe('/users/{id}');
    });
});
// ---------------------------------------------------------------------------
// extractRoutes
// ---------------------------------------------------------------------------
describe('extractRoutes', () => {
    it('extracts GET and POST routes from a basic router file', () => {
        const dir = makeFixtureDir({ 'backend/routes.ts': BACKEND_BASE });
        const { items, skippedCount } = (0, endpoints_1.extractRoutes)(dir);
        expect(skippedCount).toBe(0);
        expect(items).toHaveLength(2);
        const login = items.find((r) => r.path === '/api/auth/login');
        expect(login).toBeDefined();
        expect(login.method).toBe('GET');
        const register = items.find((r) => r.path === '/api/auth/register');
        expect(register).toBeDefined();
        expect(register.method).toBe('POST');
    });
    it('resolves app.use prefix and combines with route paths', () => {
        const dir = makeFixtureDir({ 'backend/app.ts': BACKEND_WITH_PREFIX });
        const { items } = (0, endpoints_1.extractRoutes)(dir);
        const login = items.find((r) => r.path === '/api/auth/login');
        expect(login).toBeDefined();
        expect(login.method).toBe('GET');
        const register = items.find((r) => r.path === '/api/auth/register');
        expect(register).toBeDefined();
        expect(register.method).toBe('POST');
    });
    it('returns the renamed route after rename', () => {
        const dir = makeFixtureDir({ 'backend/routes.ts': BACKEND_RENAMED });
        const { items } = (0, endpoints_1.extractRoutes)(dir);
        const signin = items.find((r) => r.path === '/api/auth/signin');
        expect(signin).toBeDefined();
        const login = items.find((r) => r.path === '/api/auth/login');
        expect(login).toBeUndefined();
    });
    it('scans multiple files in a directory', () => {
        const dir = makeFixtureDir({
            'backend/auth.ts': BACKEND_BASE,
            'backend/other.ts': `
        const r = require('express').Router();
        r.delete('/api/items/:id', (req: any, res: any) => {});
      `,
        });
        const { items } = (0, endpoints_1.extractRoutes)(dir);
        expect(items.some((r) => r.path === '/api/auth/login')).toBe(true);
        expect(items.some((r) => r.path === '/api/items/{id}')).toBe(true);
    });
    it('skips non-literal path arguments and counts them', () => {
        const dir = makeFixtureDir({
            'backend/dynamic.ts': `
        const p = '/api/dynamic';
        const router = { get: (path: any, h: any) => {} };
        router.get(p, () => {});     // variable — skip
        router.get('/api/static', () => {}); // literal — keep
      `,
        });
        const { items, skippedCount } = (0, endpoints_1.extractRoutes)(dir);
        expect(skippedCount).toBe(1);
        expect(items).toHaveLength(1);
        expect(items[0].path).toBe('/api/static');
    });
    it('returns empty array and zero skipped for a dir with no TypeScript', () => {
        const dir = makeFixtureDir({ 'README.md': '# hello' });
        const { items, skippedCount } = (0, endpoints_1.extractRoutes)(dir);
        expect(items).toHaveLength(0);
        expect(skippedCount).toBe(0);
    });
    it('skips the node_modules directory', () => {
        const dir = makeFixtureDir({
            'backend/routes.ts': BACKEND_BASE,
            'node_modules/express/index.ts': `
        // This should never be scanned
        const router = { get: () => {} };
        router.get('/should/not/appear', () => {});
      `,
        });
        const { items } = (0, endpoints_1.extractRoutes)(dir);
        expect(items.every((r) => !r.path.includes('should/not/appear'))).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// extractCalls
// ---------------------------------------------------------------------------
describe('extractCalls', () => {
    it('extracts a GET fetch call (default method)', () => {
        const dir = makeFixtureDir({ 'frontend/login.ts': FRONTEND_BASE });
        const { items, skippedCount } = (0, endpoints_1.extractCalls)(dir);
        expect(skippedCount).toBe(0);
        expect(items).toHaveLength(1);
        expect(items[0].method).toBe('GET');
        expect(items[0].path).toBe('/api/auth/login');
    });
    it('reads method from fetch options object', () => {
        const dir = makeFixtureDir({
            'frontend/post.ts': `
        fetch('/api/auth/login', { method: 'POST' });
      `,
        });
        const { items } = (0, endpoints_1.extractCalls)(dir);
        expect(items[0].method).toBe('POST');
        expect(items[0].path).toBe('/api/auth/login');
    });
    it('extracts axios GET and POST calls', () => {
        const dir = makeFixtureDir({ 'frontend/api.ts': FRONTEND_AXIOS });
        const { items } = (0, endpoints_1.extractCalls)(dir);
        const loginCall = items.find((c) => c.path === '/api/auth/login' && c.method === 'GET');
        expect(loginCall).toBeDefined();
        const registerCall = items.find((c) => c.path === '/api/auth/register' && c.method === 'POST');
        expect(registerCall).toBeDefined();
    });
    it('skips non-literal URLs and counts them', () => {
        const dir = makeFixtureDir({ 'frontend/dynamic.ts': FRONTEND_DYNAMIC });
        const { items, skippedCount } = (0, endpoints_1.extractCalls)(dir);
        // identifier and template expression with substitution → skipped
        expect(skippedCount).toBeGreaterThanOrEqual(2);
        // '/api/static' string literal → kept
        expect(items.some((c) => c.path === '/api/static')).toBe(true);
    });
    it('returns empty for a directory with no TypeScript files', () => {
        const dir = makeFixtureDir({ 'README.md': '# hi' });
        const { items, skippedCount } = (0, endpoints_1.extractCalls)(dir);
        expect(items).toHaveLength(0);
        expect(skippedCount).toBe(0);
    });
    it('skips node_modules', () => {
        const dir = makeFixtureDir({
            'frontend/login.ts': FRONTEND_BASE,
            'node_modules/axios/index.ts': `fetch('/should/not/appear');`,
        });
        const { items } = (0, endpoints_1.extractCalls)(dir);
        expect(items.every((c) => c.path !== '/should/not/appear')).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// compareEndpoints — uses real temp git repos + materialized trees
// ---------------------------------------------------------------------------
describe('compareEndpoints', () => {
    const TEST_TIMEOUT = 60000;
    // Shared snapshot metadata stubs
    function makeSnap(email, name, treeSha, head) {
        return {
            userEmail: email,
            displayName: name,
            branch: 'main',
            headCommitSha: head,
            treeSha,
            changedPaths: [],
            timestamp: Date.now(),
        };
    }
    afterEach(() => {
        (0, merge_1.clearMaterialisedCache)();
    });
    it('returns no findings when all routes still exist in merged tree', async () => {
        // Merged: has the route; both snaps: has the route; call: exists
        // → no mismatch
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }),
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }),
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }),
        ]);
        const snapA = makeSnap('alice@demo.dev', 'Alice', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('bob@demo.dev', 'Bob', snapBRepo.treeSha, snapBRepo.headCommit);
        const findings = (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB);
        expect(findings.filter((f) => f.type === 'endpoint-mismatch')).toHaveLength(0);
    }, TEST_TIMEOUT);
    it('detects endpoint-mismatch when merged tree loses a route both snapshots had', async () => {
        // Plan rule: "call in merged, no route in merged, but route existed in BOTH snapA AND snapB"
        //
        // Scenario: both Alice and Bob had the /api/auth/login route in their individual trees.
        // Their merge produced a backend that only has /api/auth/signin (conflict resolution),
        // but Alice's frontend still calls /api/auth/login.
        //
        //   - mergedDir: route renamed (/signin) + fetch to old /login  → mismatch
        //   - snapADir:  original route (/login) + fetch to /login      → route existed
        //   - snapBDir:  original route (/login)                        → route existed
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            // merged: route is now /signin but call still targets /login
            makeRepo({ 'backend/routes.ts': BACKEND_RENAMED, 'frontend/app.ts': FRONTEND_BASE }),
            // snapA: old route /login + call to /login
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }),
            // snapB: also has old route /login (rule requires BOTH to have it)
            makeRepo({ 'backend/routes.ts': BACKEND_BASE }),
        ]);
        const snapA = makeSnap('alice@demo.dev', 'Alice', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('bob@demo.dev', 'Bob', snapBRepo.treeSha, snapBRepo.headCommit);
        const findings = (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB);
        const mismatches = findings.filter((f) => f.type === 'endpoint-mismatch');
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].method).toBe('GET');
        expect(mismatches[0].path).toBe('/api/auth/login');
        expect(mismatches[0].severity).toBe('error');
        expect(mismatches[0].teammateEmail).toBe('bob@demo.dev');
        expect(mismatches[0].description).toContain('/api/auth/login');
    }, TEST_TIMEOUT);
    it('does NOT report mismatch when the route never existed in either snapshot', async () => {
        // Call exists in merged but wasn't in snapA or snapB either → new call with no backend yet
        // Rule: only fire if route existed in BOTH snapA AND snapB
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            // merged: has a call to /api/new/endpoint but no route
            makeRepo({ 'frontend/app.ts': `fetch('/api/new/endpoint');` }),
            // snapA: no route, no call
            makeRepo({ 'README.md': 'nothing' }),
            // snapB: no route
            makeRepo({ 'README.md': 'nothing' }),
        ]);
        const snapA = makeSnap('alice@demo.dev', 'Alice', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('bob@demo.dev', 'Bob', snapBRepo.treeSha, snapBRepo.headCommit);
        const findings = (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB);
        expect(findings.filter((f) => f.type === 'endpoint-mismatch')).toHaveLength(0);
    }, TEST_TIMEOUT);
    it('reports mismatch for call present in snapA but route removed in snapB', async () => {
        // Specifically: the call existed in snapA, route existed in snapB,
        // but merged has no route and call is still there
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            makeRepo({ 'frontend/app.ts': FRONTEND_BASE }), // call but no route
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }), // both
            makeRepo({ 'backend/routes.ts': BACKEND_BASE }), // route only
        ]);
        const snapA = makeSnap('alice@demo.dev', 'Alice', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('bob@demo.dev', 'Bob', snapBRepo.treeSha, snapBRepo.headCommit);
        const findings = (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB);
        const mismatches = findings.filter((f) => f.type === 'endpoint-mismatch');
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0].path).toBe('/api/auth/login');
    }, TEST_TIMEOUT);
    it('calls the log function with skipped-count messages when non-literal URLs are present', async () => {
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            makeRepo({ 'frontend/app.ts': FRONTEND_DYNAMIC }),
            makeRepo({ 'frontend/app.ts': FRONTEND_DYNAMIC }),
            makeRepo({ 'frontend/app.ts': FRONTEND_DYNAMIC }),
        ]);
        const snapA = makeSnap('a@a.com', 'A', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('b@b.com', 'B', snapBRepo.treeSha, snapBRepo.headCommit);
        const logMessages = [];
        (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB, (msg) => logMessages.push(msg));
        // Should have logged skipped counts (non-literal fetch calls in FRONTEND_DYNAMIC)
        const skipMsg = logMessages.find((m) => m.includes('skipped'));
        expect(skipMsg).toBeDefined();
    }, TEST_TIMEOUT);
    it('builds a finding with all required Finding fields', async () => {
        // Both snaps have the old route; merged loses it → mismatch
        const [mergedRepo, snapARepo, snapBRepo] = await Promise.all([
            makeRepo({ 'backend/routes.ts': BACKEND_RENAMED, 'frontend/app.ts': FRONTEND_BASE }),
            makeRepo({ 'backend/routes.ts': BACKEND_BASE, 'frontend/app.ts': FRONTEND_BASE }),
            makeRepo({ 'backend/routes.ts': BACKEND_BASE }), // snapB also has old route
        ]);
        const snapA = makeSnap('alice@demo.dev', 'Alice', snapARepo.treeSha, snapARepo.headCommit);
        const snapB = makeSnap('bob@demo.dev', 'Bob', snapBRepo.treeSha, snapBRepo.headCommit);
        const findings = (0, endpoints_1.compareEndpoints)(mergedRepo.treeDir, snapARepo.treeDir, snapBRepo.treeDir, snapA, snapB);
        const f = findings.find((x) => x.type === 'endpoint-mismatch');
        expect(f).toBeDefined();
        // All required Finding fields
        expect(typeof f.id).toBe('string');
        expect(f.id.length).toBeGreaterThan(0);
        expect(f.type).toBe('endpoint-mismatch');
        expect(f.severity).toBe('error');
        expect(typeof f.myFile).toBe('string');
        expect(typeof f.theirFile).toBe('string');
        expect(f.teammateEmail).toBe('bob@demo.dev');
        expect(f.teammateName).toBe('Bob');
        expect(typeof f.description).toBe('string');
        expect(typeof f.detail).toBe('string');
        expect(f.method).toBe('GET');
        expect(f.path).toBe('/api/auth/login');
        expect(f.mySnapshotHash).toBe(snapA.treeSha);
        expect(f.theirSnapshotHash).toBe(snapB.treeSha);
        expect(typeof f.affectedLine).toBe('number');
    }, TEST_TIMEOUT);
});
//# sourceMappingURL=endpoints.test.js.map