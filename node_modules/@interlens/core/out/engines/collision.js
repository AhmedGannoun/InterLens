"use strict";
/**
 * engines/collision.ts
 *
 * Detects file-overlap and symbol-overlap between two developers' snapshot
 * working trees, comparing against each developer's real HEAD commit.
 *
 * file-overlap (severity info): both developers modified the same file.
 * symbol-overlap (severity warning): both modified the same top-level
 *   TypeScript declaration (determined by comparing declaration text, not
 *   hunk line ranges — hunk ranges are unreliable for adjacent single-line
 *   declarations).
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
exports.detectCollisions = detectCollisions;
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const crypto = __importStar(require("crypto"));
const ts_morph_1 = require("ts-morph");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function git(repoRoot, args) {
    const { stdout } = await execFile('git', args, {
        cwd: repoRoot,
        maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
}
/**
 * Get the file content from a tree object.
 */
async function getFileContent(repoRoot, treeSha, filePath) {
    try {
        const content = await git(repoRoot, [
            'cat-file', 'blob', `${treeSha}:${filePath}`,
        ]);
        return content;
    }
    catch {
        return null;
    }
}
/**
 * Get the file content at a commit's tree.
 */
async function getFileContentAtCommit(repoRoot, commitSha, filePath) {
    try {
        const content = await git(repoRoot, [
            'cat-file', 'blob', `${commitSha}:${filePath}`,
        ]);
        return content;
    }
    catch {
        return null;
    }
}
/**
 * Extract top-level declaration names and their full text from a TypeScript
 * source file (in-memory). We compare text (not line numbers) to determine
 * whether a developer actually changed a declaration.
 */
function extractTopLevelDeclTexts(content) {
    const project = new ts_morph_1.Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('virtual.ts', content, { overwrite: true });
    const result = new Map();
    const namedKinds = [
        ts_morph_1.SyntaxKind.FunctionDeclaration,
        ts_morph_1.SyntaxKind.ClassDeclaration,
        ts_morph_1.SyntaxKind.InterfaceDeclaration,
        ts_morph_1.SyntaxKind.TypeAliasDeclaration,
        ts_morph_1.SyntaxKind.EnumDeclaration,
    ];
    for (const kind of namedKinds) {
        for (const child of sf.getChildrenOfKind(kind)) {
            const named = child;
            const name = typeof named.getName === 'function' ? named.getName() : undefined;
            if (!name)
                continue;
            result.set(name, child.getText());
        }
    }
    for (const vs of sf.getVariableStatements()) {
        for (const decl of vs.getDeclarations()) {
            const name = decl.getName();
            if (!name)
                continue;
            result.set(name, vs.getText());
        }
    }
    return result;
}
// ---------------------------------------------------------------------------
// findingId: stable hash for deduplication
// ---------------------------------------------------------------------------
function findingId(type, fileA, fileB, extra) {
    const raw = `${type}:${fileA}:${fileB}:${extra ?? ''}`;
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}
// ---------------------------------------------------------------------------
// detectCollisions
// ---------------------------------------------------------------------------
/**
 * Detect file-overlap and symbol-overlap between two snapshots.
 *
 * @param repoRoot      Git repo that contains both snapshot trees.
 * @param mySnapshot    This developer's snapshot.
 * @param theirSnapshot The teammate's snapshot.
 * @returns             Array of Finding objects (file-overlap and symbol-overlap).
 */
async function detectCollisions(repoRoot, mySnapshot, theirSnapshot) {
    const findings = [];
    const myPaths = new Set(mySnapshot.changedPaths);
    const theirPaths = new Set(theirSnapshot.changedPaths);
    // Intersection of changed paths
    const overlapping = [...myPaths].filter((p) => theirPaths.has(p));
    for (const filePath of overlapping) {
        // -----------------------------------------------------------------------
        // file-overlap finding (severity: info)
        // -----------------------------------------------------------------------
        findings.push({
            id: findingId('file-overlap', filePath, filePath),
            type: 'file-overlap',
            severity: 'info',
            myFile: filePath,
            theirFile: filePath,
            teammateEmail: theirSnapshot.userEmail,
            teammateName: theirSnapshot.displayName,
            description: `Both you and ${theirSnapshot.displayName} are editing ${filePath}.`,
            detail: [
                `File-level overlap detected in ${filePath}.`,
                `You and ${theirSnapshot.displayName} are both modifying this file.`,
                `No textual conflict has been detected yet, but your changes may become inconsistent.`,
            ].join('\n'),
            mySnapshotHash: mySnapshot.treeSha,
            theirSnapshotHash: theirSnapshot.treeSha,
        });
        // -----------------------------------------------------------------------
        // symbol-overlap — only for TypeScript files
        // -----------------------------------------------------------------------
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx'))
            continue;
        // Get file content from base (HEAD commit) and both snapshot trees.
        // We compare declaration text between base and each snapshot to determine
        // which declarations each developer actually changed — text comparison is
        // more accurate than hunk-line-range overlap for adjacent declarations.
        const [baseContent, myContent, theirContent] = await Promise.all([
            getFileContentAtCommit(repoRoot, mySnapshot.headCommitSha, filePath),
            getFileContent(repoRoot, mySnapshot.treeSha, filePath),
            getFileContent(repoRoot, theirSnapshot.treeSha, filePath),
        ]);
        if (!baseContent || !myContent || !theirContent)
            continue;
        let baseDecls;
        let myDecls;
        let theirDecls;
        try {
            baseDecls = extractTopLevelDeclTexts(baseContent);
            myDecls = extractTopLevelDeclTexts(myContent);
            theirDecls = extractTopLevelDeclTexts(theirContent);
        }
        catch {
            continue;
        }
        // A declaration is "modified" by a developer if its text differs from the base.
        for (const [declName, baseText] of baseDecls) {
            const myText = myDecls.get(declName);
            const theirText = theirDecls.get(declName);
            const myModified = myText !== undefined && myText !== baseText;
            const theirModified = theirText !== undefined && theirText !== baseText;
            if (myModified && theirModified) {
                findings.push({
                    id: findingId('symbol-overlap', filePath, filePath, declName),
                    type: 'symbol-overlap',
                    severity: 'warning',
                    myFile: filePath,
                    theirFile: filePath,
                    teammateEmail: theirSnapshot.userEmail,
                    teammateName: theirSnapshot.displayName,
                    symbolName: declName,
                    description: `Both you and ${theirSnapshot.displayName} are modifying ${declName} in ${filePath}.`,
                    detail: [
                        `Symbol-level overlap detected: ${declName} in ${filePath}.`,
                        `Both you and ${theirSnapshot.displayName} have modified this declaration.`,
                        `This is not a textual conflict yet, but may become one at merge time.`,
                    ].join('\n'),
                    mySnapshotHash: mySnapshot.treeSha,
                    theirSnapshotHash: theirSnapshot.treeSha,
                });
            }
        }
    }
    return findings;
}
//# sourceMappingURL=collision.js.map