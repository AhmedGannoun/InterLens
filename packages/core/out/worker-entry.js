"use strict";
/**
 * worker-entry.ts — Analysis child process entry point
 *
 * Reads an AnalysisJobRequest from stdin as JSON, runs the full pair analysis
 * pipeline, and writes a Finding[] to stdout as JSON.
 *
 * Errors are written to stderr and the process exits with code 1.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const analysis_1 = require("./analysis");
async function main() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
        process.stdout.write(JSON.stringify([]) + '\n');
        return;
    }
    const req = JSON.parse(raw);
    const findings = await (0, analysis_1.runAnalysis)(req);
    process.stdout.write(JSON.stringify(findings) + '\n');
}
main().catch((err) => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
});
//# sourceMappingURL=worker-entry.js.map