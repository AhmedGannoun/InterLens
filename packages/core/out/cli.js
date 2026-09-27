"use strict";
/**
 * cli.ts — Fallback demo CLI
 *
 * Usage: node out/cli.js <repoA> <repoB>
 *
 * Reads the latest snapshot from refs/interlens/<slug> in each repo,
 * runs the full pair analysis pipeline, and prints findings as JSON
 * (one per line) to stdout.
 *
 * This is the fallback demo path if the VS Code UI is broken.
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
exports.readLatestSnapshot = readLatestSnapshot;
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const analysis_1 = require("./analysis");
const snapshot_1 = require("./snapshot");
const execFile = util.promisify(child_process_1.execFile);
async function git(cwd, args) {
    const { stdout } = await execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
}
async function readLatestSnapshot(repoRoot) {
    // List all refs/interlens/* in this repo
    let lsOutput;
    try {
        lsOutput = await git(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/interlens/']);
    }
    catch {
        return null;
    }
    const refs = lsOutput.split('\n').map((l) => l.trim()).filter(Boolean)
        // Exclude remote tracking refs (refs/interlens/remote/*)
        .filter((r) => !r.startsWith('refs/interlens/remote/'));
    if (refs.length === 0)
        return null;
    // Take the first (there should be one per developer)
    const ref = refs[0];
    return (0, snapshot_1.fetchTeammateSnapshot)(repoRoot, ref);
}
async function main() {
    const [repoA, repoB] = process.argv.slice(2);
    if (!repoA || !repoB) {
        process.stderr.write('Usage: node out/cli.js <repoA> <repoB>\n');
        process.exit(1);
    }
    const snapA = await readLatestSnapshot(repoA);
    if (!snapA) {
        process.stderr.write(`No snapshot found in ${repoA}. Run InterLens extension first.\n`);
        process.exit(1);
    }
    const snapB = await readLatestSnapshot(repoB);
    if (!snapB) {
        process.stderr.write(`No snapshot found in ${repoB}. Run InterLens extension first.\n`);
        process.exit(1);
    }
    // Fetch snapB's objects into repoA's object database
    try {
        const bareUrl = await git(repoA, ['remote', 'get-url', 'origin']).catch(() => '');
        if (bareUrl) {
            // Fetch from origin to ensure all objects are available in repoA
            await git(repoA, ['fetch', 'origin']).catch(() => { });
        }
    }
    catch {
        // Non-fatal — repoA might already have all objects
    }
    // Allow tests (and CI) to override the check command via environment variable
    // rather than requiring `npx` to be available or doing a full npm install.
    const checkCommand = process.env['INTERLENS_CHECK_COMMAND'] ?? 'npx tsc --noEmit -p .';
    const req = {
        repoRoot: repoA,
        mySnapshot: snapA,
        theirSnapshot: snapB,
        checkCommand,
        sharedTypePaths: ['shared/', 'types/', 'contracts/', 'interfaces/'],
    };
    const findings = await (0, analysis_1.runAnalysis)(req);
    if (findings.length === 0) {
        process.stdout.write('[]\n');
        return;
    }
    for (const finding of findings) {
        process.stdout.write(JSON.stringify(finding) + '\n');
    }
}
// Only run main() when this file is the entry point, not when it is imported
// by tests or other modules.
if (require.main === module) {
    main().catch((err) => {
        process.stderr.write(String(err) + '\n');
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map