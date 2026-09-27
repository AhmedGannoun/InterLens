/**
 * types.test.ts — Sub-Task 1
 *
 * Strategy: TypeScript interfaces cannot be tested at runtime with typeof checks,
 * but we can:
 *  1. Construct concrete objects that satisfy each interface and let the compiler
 *     enforce completeness (any missing required field is a compile-time error).
 *  2. Use expect().toMatchObject / deep-equality to verify the shapes are stable
 *     at runtime (guards against accidental structural changes).
 *  3. Test the union literal types to confirm only allowed string values compile.
 */

import type {
  OwnSnapshot,
  TeammateSnapshot,
  TeammateSnapshotChange,
  SnapshotNotifier,
  Finding,
  AnalysisJobRequest,
  ExplainInput,
  ExplainResult,
  ExplanationProvider,
} from '../types';

// ---------------------------------------------------------------------------
// OwnSnapshot
// ---------------------------------------------------------------------------

describe('OwnSnapshot', () => {
  const snapshot: OwnSnapshot = {
    userEmail: 'alice@demo.dev',
    displayName: 'Alice',
    branch: 'main',
    headCommitSha: 'abc123',
    treeSha: 'def456',
    changedPaths: ['frontend/login.ts'],
    timestamp: 1_700_000_000_000,
  };

  it('has all required fields', () => {
    expect(snapshot).toMatchObject({
      userEmail: expect.any(String),
      displayName: expect.any(String),
      branch: expect.any(String),
      headCommitSha: expect.any(String),
      treeSha: expect.any(String),
      changedPaths: expect.any(Array),
      timestamp: expect.any(Number),
    });
  });

  it('changedPaths is an array of strings', () => {
    expect(Array.isArray(snapshot.changedPaths)).toBe(true);
    snapshot.changedPaths.forEach((p) => expect(typeof p).toBe('string'));
  });

  it('timestamp is a positive integer', () => {
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(Number.isInteger(snapshot.timestamp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TeammateSnapshot (structural alias of OwnSnapshot)
// ---------------------------------------------------------------------------

describe('TeammateSnapshot', () => {
  const ts: TeammateSnapshot = {
    userEmail: 'bob@demo.dev',
    displayName: 'Bob',
    branch: 'feature/auth',
    headCommitSha: '111aaa',
    treeSha: '222bbb',
    changedPaths: ['shared/types.ts'],
    timestamp: 1_700_000_001_000,
  };

  it('is structurally identical to OwnSnapshot', () => {
    const own: OwnSnapshot = ts; // TypeScript will error if incompatible
    expect(own.userEmail).toBe(ts.userEmail);
  });
});

// ---------------------------------------------------------------------------
// TeammateSnapshotChange
// ---------------------------------------------------------------------------

describe('TeammateSnapshotChange', () => {
  it('accepts null for oldHash on first observation', () => {
    const change: TeammateSnapshotChange = {
      userEmail: 'bob@demo.dev',
      ref: 'refs/interlens/bob-at-demo-dev',
      oldHash: null,
      newHash: 'deadbeef',
    };
    expect(change.oldHash).toBeNull();
    expect(typeof change.newHash).toBe('string');
  });

  it('accepts a string for oldHash on subsequent observations', () => {
    const change: TeammateSnapshotChange = {
      userEmail: 'bob@demo.dev',
      ref: 'refs/interlens/bob-at-demo-dev',
      oldHash: 'prevhash',
      newHash: 'nexthash',
    };
    expect(typeof change.oldHash).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// SnapshotNotifier (interface — verified via a mock implementation)
// ---------------------------------------------------------------------------

describe('SnapshotNotifier', () => {
  it('can be implemented with start/stop/announce', () => {
    const announced: OwnSnapshot[] = [];
    let started = false;
    let stopped = false;

    const notifier: SnapshotNotifier = {
      start(_onChange) {
        started = true;
      },
      stop() {
        stopped = true;
      },
      async announce(own) {
        announced.push(own);
      },
    };

    const snap: OwnSnapshot = {
      userEmail: 'alice@demo.dev',
      displayName: 'Alice',
      branch: 'main',
      headCommitSha: 'head1',
      treeSha: 'tree1',
      changedPaths: [],
      timestamp: Date.now(),
    };

    notifier.start(() => {});
    expect(started).toBe(true);

    notifier.stop();
    expect(stopped).toBe(true);

    void notifier.announce(snap).then(() => {
      expect(announced).toHaveLength(1);
      expect(announced[0].userEmail).toBe('alice@demo.dev');
    });
  });
});

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

describe('Finding', () => {
  it('accepts all required fields for a semantic-conflict finding', () => {
    const finding: Finding = {
      id: 'hash-abc',
      type: 'semantic-conflict',
      severity: 'error',
      myFile: 'frontend/login.ts',
      theirFile: 'shared/types.ts',
      teammateEmail: 'bob@demo.dev',
      teammateName: 'Bob',
      description: 'AuthResponse.userId no longer exists.',
      detail: 'Bob renamed userId to id. Your code still references response.userId.',
      tscError: "Property 'userId' does not exist on type 'AuthResponse'.",
      renamedFields: [{ from: 'userId', to: 'id' }],
      mySnapshotHash: 'snap-a',
      theirSnapshotHash: 'snap-b',
    };
    expect(finding.type).toBe('semantic-conflict');
    expect(finding.severity).toBe('error');
    expect(finding.renamedFields?.[0]).toEqual({ from: 'userId', to: 'id' });
  });

  it('accepts all required fields for a merge-conflict finding', () => {
    const finding: Finding = {
      id: 'hash-def',
      type: 'merge-conflict',
      severity: 'warning',
      myFile: 'backend/auth.ts',
      theirFile: 'backend/auth.ts',
      teammateEmail: 'bob@demo.dev',
      teammateName: 'Bob',
      description: 'Textual conflict in backend/auth.ts.',
      detail: 'Both you and Bob modified the same lines in backend/auth.ts.',
      mySnapshotHash: 'snap-a',
      theirSnapshotHash: 'snap-b',
    };
    expect(finding.type).toBe('merge-conflict');
    expect(finding.severity).toBe('warning');
  });

  it('accepts all required fields for an endpoint-mismatch finding', () => {
    const finding: Finding = {
      id: 'hash-ghi',
      type: 'endpoint-mismatch',
      severity: 'error',
      myFile: 'frontend/login.ts',
      theirFile: 'backend/auth.ts',
      teammateEmail: 'bob@demo.dev',
      teammateName: 'Bob',
      description: 'POST /api/auth/login no longer exists.',
      detail: 'Bob renamed the route. Your fetch call targets the old path.',
      method: 'POST',
      path: '/api/auth/login',
      affectedLine: 12,
      affectedColumn: 4,
      mySnapshotHash: 'snap-a',
      theirSnapshotHash: 'snap-b',
    };
    expect(finding.method).toBe('POST');
    expect(finding.path).toBe('/api/auth/login');
    expect(finding.affectedLine).toBe(12);
  });

  it('accepts all required fields for a file-overlap finding', () => {
    const finding: Finding = {
      id: 'hash-jkl',
      type: 'file-overlap',
      severity: 'info',
      myFile: 'backend/auth.ts',
      theirFile: 'backend/auth.ts',
      teammateEmail: 'bob@demo.dev',
      teammateName: 'Bob',
      description: 'Both you and Bob are editing backend/auth.ts.',
      detail: 'File-level overlap detected.',
      mySnapshotHash: 'snap-a',
      theirSnapshotHash: 'snap-b',
    };
    expect(finding.type).toBe('file-overlap');
    expect(finding.severity).toBe('info');
  });

  it('accepts all required fields for a symbol-overlap finding', () => {
    const finding: Finding = {
      id: 'hash-mno',
      type: 'symbol-overlap',
      severity: 'warning',
      myFile: 'backend/auth.ts',
      theirFile: 'backend/auth.ts',
      teammateEmail: 'bob@demo.dev',
      teammateName: 'Bob',
      description: 'Both you and Bob are modifying handleLogin.',
      detail: 'Symbol-level overlap detected.',
      symbolName: 'handleLogin',
      mySnapshotHash: 'snap-a',
      theirSnapshotHash: 'snap-b',
    };
    expect(finding.symbolName).toBe('handleLogin');
  });

  it('enforces the type union at the type level', () => {
    // This is a compile-time check only; the valid values are captured below.
    const validTypes: Finding['type'][] = [
      'file-overlap',
      'symbol-overlap',
      'merge-conflict',
      'semantic-conflict',
      'endpoint-mismatch',
    ];
    expect(validTypes).toHaveLength(5);
  });

  it('enforces the severity union at the type level', () => {
    const validSeverities: Finding['severity'][] = ['info', 'warning', 'error'];
    expect(validSeverities).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// AnalysisJobRequest
// ---------------------------------------------------------------------------

describe('AnalysisJobRequest', () => {
  it('is fully serialisable to JSON and back', () => {
    const req: AnalysisJobRequest = {
      repoRoot: '/tmp/dev-alice',
      mySnapshot: {
        userEmail: 'alice@demo.dev',
        displayName: 'Alice',
        branch: 'main',
        headCommitSha: 'head1',
        treeSha: 'tree1',
        changedPaths: ['frontend/login.ts'],
        timestamp: Date.now(),
      },
      theirSnapshot: {
        userEmail: 'bob@demo.dev',
        displayName: 'Bob',
        branch: 'main',
        headCommitSha: 'head2',
        treeSha: 'tree2',
        changedPaths: ['shared/types.ts'],
        timestamp: Date.now(),
      },
      checkCommand: 'npx tsc --noEmit -p .',
      sharedTypePaths: ['shared/', 'types/'],
    };

    const serialised = JSON.stringify(req);
    const deserialised: AnalysisJobRequest = JSON.parse(serialised);
    expect(deserialised.repoRoot).toBe(req.repoRoot);
    expect(deserialised.checkCommand).toBe(req.checkCommand);
    expect(deserialised.sharedTypePaths).toEqual(req.sharedTypePaths);
    expect(deserialised.mySnapshot.userEmail).toBe('alice@demo.dev');
    expect(deserialised.theirSnapshot.userEmail).toBe('bob@demo.dev');
  });
});

// ---------------------------------------------------------------------------
// ExplainInput / ExplainResult / ExplanationProvider
// ---------------------------------------------------------------------------

describe('ExplainInput', () => {
  it('holds a finding and two diff hunks', () => {
    const finding: Finding = {
      id: 'x',
      type: 'semantic-conflict',
      severity: 'error',
      myFile: 'f.ts',
      theirFile: 'g.ts',
      teammateEmail: 'b@b.com',
      teammateName: 'B',
      description: 'd',
      detail: 'dt',
      mySnapshotHash: 'h1',
      theirSnapshotHash: 'h2',
    };
    const input: ExplainInput = {
      finding,
      myDiffHunk: '+  const x = response.userId;',
      theirDiffHunk: '-  userId: string;\n+  id: string;',
    };
    expect(input.finding.type).toBe('semantic-conflict');
    expect(input.myDiffHunk).toContain('userId');
  });
});

describe('ExplainResult', () => {
  it('has markdown and fromCache fields', () => {
    const result: ExplainResult = {
      markdown: '**Bob** renamed `userId` to `id`.',
      fromCache: false,
    };
    expect(result.fromCache).toBe(false);
    expect(result.markdown.length).toBeGreaterThan(0);
  });
});

describe('ExplanationProvider', () => {
  it('can be implemented as a mock', async () => {
    const finding: Finding = {
      id: 'y',
      type: 'semantic-conflict',
      severity: 'error',
      myFile: 'f.ts',
      theirFile: 'g.ts',
      teammateEmail: 'b@b.com',
      teammateName: 'B',
      description: 'd',
      detail: 'dt',
      mySnapshotHash: 'h1',
      theirSnapshotHash: 'h2',
    };

    const provider: ExplanationProvider = {
      id: 'mock',
      async explain(_input, _signal) {
        return { markdown: 'mock explanation', fromCache: false };
      },
      async testConnection() {
        return { ok: true };
      },
    };

    const result = await provider.explain(
      {
        finding,
        myDiffHunk: '',
        theirDiffHunk: '',
      },
      new AbortController().signal,
    );
    expect(result.markdown).toBe('mock explanation');

    const conn = await provider.testConnection();
    expect(conn.ok).toBe(true);
    expect(conn.error).toBeUndefined();
  });
});
