"use strict";
/**
 * engines/tsc.ts
 *
 * runCheck: runs the configured check command (default: npx tsc --noEmit -p .)
 * in a materialised tree directory and returns the list of TypeScript errors.
 *
 * diffErrors: subtracts the errors present in snapA and snapB from those found
 * in the merged tree. What remains are errors that neither developer had
 * individually — i.e. errors introduced by the combination of their changes.
 *
 * Optional ts-morph enrichment: if a shared-type file changed between the two
 * snapshots and contains exactly one unambiguous field rename, attach
 * `renamedFields` to the finding.
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
exports.parseTscOutput = parseTscOutput;
exports.runCheck = runCheck;
exports.diffErrors = diffErrors;
exports.detectUnambiguousRename = detectUnambiguousRename;
exports.clearCheckCache = clearCheckCache;
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const path = __importStar(require("path"));
const ts_morph_1 = require("ts-morph");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Module-level result cache (per worker process lifetime)
// ---------------------------------------------------------------------------
/** tree OID → TscError[] */
const checkCache = new Map();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Normalise a file path for use as a dedup key. */
function normalisePath(filePath, baseDir) {
    // Only relativise absolute paths; leave already-relative paths as-is.
    const resolved = path.isAbsolute(filePath) ? path.relative(baseDir, filePath) : filePath;
    // Forward slashes, lower-case on Windows
    const normalised = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    return normalised.replace(/\\/g, '/');
}
/**
 * Parse tsc --noEmit error output into TscError objects.
 *
 * tsc output format:
 *   <file>(<line>,<col>): error TS<code>: <message>
 *
 * We also accept the Windows absolute path format where the file starts with
 * a drive letter.
 */
function parseTscOutput(output, baseDir) {
    const errors = [];
    // Pattern: file(line,col): error TScode: message
    const pattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
    for (const rawLine of output.split('\n')) {
        const line = rawLine.trim();
        const m = pattern.exec(line);
        if (!m)
            continue;
        const [, rawFile, lineStr, colStr, code, msg] = m;
        errors.push({
            file: normalisePath(rawFile, baseDir),
            errorCode: code,
            message: msg.trim(),
            line: parseInt(lineStr, 10),
            column: parseInt(colStr, 10),
        });
    }
    return errors;
}
// ---------------------------------------------------------------------------
// runCheck
// ---------------------------------------------------------------------------
/**
 * Run the configured check command in a materialised tree directory.
 * Results are cached by tree OID (the last 8 chars of the directory name,
 * plus the full dir path, are used as cache key).
 *
 * @param dir       The materialised tree directory (output of materializeTree).
 * @param command   Shell command string, e.g. "npx tsc --noEmit -p ."
 * @param cacheKey  Optional tree OID for dedup. If omitted, no caching.
 */
async function runCheck(dir, command, cacheKey) {
    if (cacheKey) {
        const cached = checkCache.get(cacheKey);
        if (cached)
            return cached;
    }
    const [cmd, ...args] = command.split(/\s+/);
    // On Windows, .cmd/.bat files require shell:true to be invocable via execFile.
    const useShell = process.platform === 'win32' &&
        (cmd.toLowerCase().endsWith('.cmd') || cmd.toLowerCase().endsWith('.bat'));
    let output = '';
    try {
        const result = await execFile(cmd, args, {
            cwd: dir,
            maxBuffer: 16 * 1024 * 1024,
            shell: useShell,
            // tsc exits with code 1 even for type errors — we treat all output as relevant
        });
        output = result.stdout + result.stderr;
    }
    catch (err) {
        // tsc exits non-zero when there are errors — extract output from the error
        const execErr = err;
        output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
    }
    const errors = parseTscOutput(output, dir);
    if (cacheKey)
        checkCache.set(cacheKey, errors);
    return errors;
}
// ---------------------------------------------------------------------------
// diffErrors
// ---------------------------------------------------------------------------
/**
 * Compute the set of errors that appear in `merged` but in neither `snapA`
 * nor `snapB`. These are errors introduced by combining the two developers'
 * changes — semantic conflicts.
 *
 * Dedup key: (file, errorCode, message) — line numbers are intentionally
 * excluded because lines shift between snapshot versions.
 */
function diffErrors(merged, snapA, snapB) {
    function key(e) {
        return `${e.file}|${e.errorCode}|${e.message}`;
    }
    const knownA = new Set(snapA.map(key));
    const knownB = new Set(snapB.map(key));
    return merged.filter((e) => {
        const k = key(e);
        return !knownA.has(k) && !knownB.has(k);
    });
}
function extractInterfaceFields(content, interfaceName) {
    const project = new ts_morph_1.Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('virtual.ts', content, { overwrite: true });
    const iface = sf.getInterface(interfaceName);
    if (!iface)
        return null;
    const fields = new Map();
    for (const prop of iface.getProperties()) {
        const typeName = prop.getTypeNode()?.getText() ?? 'unknown';
        fields.set(prop.getName(), typeName);
    }
    return fields;
}
/**
 * Given the content of a shared-type file in two versions (snapA and snapB),
 * detect if exactly one field was removed and one field of the same type was
 * added for any interface — an unambiguous rename.
 *
 * Returns the rename pair or null if the rename is ambiguous or not detected.
 *
 * This is enrichment only: it does NOT drive detection.
 */
function detectUnambiguousRename(interfaceName, contentA, contentB) {
    const fieldsA = extractInterfaceFields(contentA, interfaceName);
    const fieldsB = extractInterfaceFields(contentB, interfaceName);
    if (!fieldsA || !fieldsB)
        return null;
    const removed = [];
    const added = [];
    for (const [name, type] of fieldsA) {
        if (!fieldsB.has(name))
            removed.push([name, type]);
    }
    for (const [name, type] of fieldsB) {
        if (!fieldsA.has(name))
            added.push([name, type]);
    }
    // Unambiguous rename: exactly one removed and one added, same type
    if (removed.length === 1 && added.length === 1 && removed[0][1] === added[0][1]) {
        return { from: removed[0][0], to: added[0][0] };
    }
    return null;
}
// ---------------------------------------------------------------------------
// clearCheckCache (for tests)
// ---------------------------------------------------------------------------
function clearCheckCache() {
    checkCache.clear();
}
//# sourceMappingURL=tsc.js.map