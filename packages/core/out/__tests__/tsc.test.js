"use strict";
/**
 * tsc.test.ts — Sub-Task 3
 *
 * Tests parseTscOutput, diffErrors, and detectUnambiguousRename.
 * runCheck is tested indirectly through analysis.test.ts (requires a full
 * materialised tree with a real tsconfig + TypeScript installation).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const tsc_1 = require("../engines/tsc");
// ---------------------------------------------------------------------------
// parseTscOutput
// ---------------------------------------------------------------------------
describe('parseTscOutput', () => {
    const baseDir = '/project';
    it('parses a typical tsc error line', () => {
        const output = 'src/login.ts(12,5): error TS2339: Property \'userId\' does not exist on type \'AuthResponse\'.\n';
        const errors = (0, tsc_1.parseTscOutput)(output, baseDir);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/login.ts');
        expect(errors[0].errorCode).toBe('TS2339');
        expect(errors[0].message).toBe("Property 'userId' does not exist on type 'AuthResponse'.");
        expect(errors[0].line).toBe(12);
        expect(errors[0].column).toBe(5);
    });
    it('parses multiple errors', () => {
        const output = [
            'src/a.ts(1,1): error TS2304: Cannot find name \'foo\'.',
            'src/b.ts(5,3): error TS2339: Property \'bar\' does not exist on type \'X\'.',
        ].join('\n');
        const errors = (0, tsc_1.parseTscOutput)(output, baseDir);
        expect(errors).toHaveLength(2);
        expect(errors[0].file).toBe('src/a.ts');
        expect(errors[1].file).toBe('src/b.ts');
    });
    it('ignores non-error lines (warnings, info, blank)', () => {
        const output = [
            '',
            'Starting compilation in watch mode...',
            'src/a.ts(1,1): error TS2304: Cannot find name \'x\'.',
            'Found 1 error.',
        ].join('\n');
        const errors = (0, tsc_1.parseTscOutput)(output, baseDir);
        expect(errors).toHaveLength(1);
    });
    it('normalises the file path relative to baseDir', () => {
        const output = `/project/src/login.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`;
        const errors = (0, tsc_1.parseTscOutput)(output, '/project');
        expect(errors[0].file).toBe('src/login.ts');
    });
    it('handles Windows-style absolute paths', () => {
        const output = `C:\\project\\src\\login.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`;
        // Pass a Windows-style baseDir
        const errors = (0, tsc_1.parseTscOutput)(output, 'C:\\project');
        // On non-Windows the path won't be relativised cleanly, but it should parse
        expect(errors).toHaveLength(1);
        expect(errors[0].errorCode).toBe('TS2322');
    });
});
// ---------------------------------------------------------------------------
// diffErrors
// ---------------------------------------------------------------------------
describe('diffErrors', () => {
    function err(file, code, msg, line = 1) {
        return { file, errorCode: code, message: msg, line, column: 1 };
    }
    it('returns errors in merged that are absent from both snapA and snapB', () => {
        const merged = [err('a.ts', 'TS2339', "Property 'userId' does not exist")];
        const snapA = [];
        const snapB = [];
        const result = (0, tsc_1.diffErrors)(merged, snapA, snapB);
        expect(result).toHaveLength(1);
        expect(result[0].errorCode).toBe('TS2339');
    });
    it('excludes errors already present in snapA', () => {
        const e = err('a.ts', 'TS2339', "Property 'userId' does not exist");
        const result = (0, tsc_1.diffErrors)([e], [e], []);
        expect(result).toHaveLength(0);
    });
    it('excludes errors already present in snapB', () => {
        const e = err('a.ts', 'TS2339', "Property 'userId' does not exist");
        const result = (0, tsc_1.diffErrors)([e], [], [e]);
        expect(result).toHaveLength(0);
    });
    it('ignores line number differences when deduplicating', () => {
        const inMerged = err('a.ts', 'TS2339', 'msg', 10);
        const inSnapA = err('a.ts', 'TS2339', 'msg', 5); // different line
        const result = (0, tsc_1.diffErrors)([inMerged], [inSnapA], []);
        expect(result).toHaveLength(0);
    });
    it('keeps errors that differ only in file, code, or message', () => {
        const merged = [
            err('a.ts', 'TS2339', 'msg-new'), // new error
            err('b.ts', 'TS2339', 'msg-old'), // already in snapA
        ];
        const snapA = [err('b.ts', 'TS2339', 'msg-old')];
        const result = (0, tsc_1.diffErrors)(merged, snapA, []);
        expect(result).toHaveLength(1);
        expect(result[0].file).toBe('a.ts');
    });
    it('returns empty array when merged has no errors', () => {
        const result = (0, tsc_1.diffErrors)([], [err('a.ts', 'TS100', 'old')], []);
        expect(result).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// detectUnambiguousRename
// ---------------------------------------------------------------------------
describe('detectUnambiguousRename', () => {
    const contentWithX = `
    export interface AuthResponse {
      userId: string;
      token: string;
    }
  `;
    const contentWithId = `
    export interface AuthResponse {
      id: string;
      token: string;
    }
  `;
    const contentWithBothGone = `
    export interface AuthResponse {
      id: string;
      accessToken: string;
    }
  `;
    it('detects an unambiguous single-field rename (userId → id)', () => {
        const result = (0, tsc_1.detectUnambiguousRename)('AuthResponse', contentWithX, contentWithId);
        expect(result).not.toBeNull();
        expect(result.from).toBe('userId');
        expect(result.to).toBe('id');
    });
    it('returns null when multiple fields changed (ambiguous)', () => {
        // userId→id AND token→accessToken (two renames — ambiguous)
        const result = (0, tsc_1.detectUnambiguousRename)('AuthResponse', contentWithX, contentWithBothGone);
        expect(result).toBeNull();
    });
    it('returns null when a field is added without a matching removal', () => {
        const onlyAdded = `
      export interface AuthResponse {
        userId: string;
        token: string;
        extra: string;
      }
    `;
        const result = (0, tsc_1.detectUnambiguousRename)('AuthResponse', contentWithX, onlyAdded);
        expect(result).toBeNull();
    });
    it('returns null when no field changed', () => {
        const result = (0, tsc_1.detectUnambiguousRename)('AuthResponse', contentWithX, contentWithX);
        expect(result).toBeNull();
    });
    it('returns null when the interface does not exist', () => {
        const result = (0, tsc_1.detectUnambiguousRename)('NonExistent', contentWithX, contentWithId);
        expect(result).toBeNull();
    });
    it('returns null when types differ (not the same type → ambiguous rename)', () => {
        const differentType = `
      export interface AuthResponse {
        id: number;
        token: string;
      }
    `;
        // userId:string removed, id:number added — different types → ambiguous
        const result = (0, tsc_1.detectUnambiguousRename)('AuthResponse', contentWithX, differentType);
        expect(result).toBeNull();
    });
});
//# sourceMappingURL=tsc.test.js.map