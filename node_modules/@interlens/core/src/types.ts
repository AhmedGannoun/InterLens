// ============================================================
// InterLens — @interlens/core shared type definitions
// No vscode imports allowed in this file or any file in this package.
// ============================================================

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

/**
 * Snapshot produced by the extension, stored as a Git commit object.
 * The OwnSnapshot JSON is the commit message of the snapshot commit.
 */
export interface OwnSnapshot {
  userEmail: string;
  displayName: string;
  branch: string;
  /** The real HEAD SHA at snapshot time — this is the parent of the snapshot commit. */
  headCommitSha: string;
  /** Tree SHA produced by git write-tree on the temp index. */
  treeSha: string;
  /** Files differing from HEAD at snapshot time. */
  changedPaths: string[];
  /** Unix timestamp (ms) when the snapshot was created. */
  timestamp: number;
}

/**
 * A teammate's snapshot, read from their commit message.
 * Structurally identical to OwnSnapshot; the separate type makes
 * callsite intent clear and allows divergence in future versions.
 */
export interface TeammateSnapshot extends OwnSnapshot {}

/**
 * Emitted by SnapshotNotifier when a teammate's ref hash changes.
 */
export interface TeammateSnapshotChange {
  userEmail: string;
  ref: string;
  /** null on the first observation of a ref. */
  oldHash: string | null;
  /** Commit SHA of the new snapshot commit. */
  newHash: string;
}

/**
 * Abstraction over the sync transport.
 * MVP implementation: GitPollingNotifier.
 * Future: RealtimeNotifier (WebSocket/SSE metadata-only).
 */
export interface SnapshotNotifier {
  start(onChange: (changes: TeammateSnapshotChange[]) => void): void;
  stop(): void;
  announce(own: OwnSnapshot): Promise<void>;
}

// ---------------------------------------------------------------------------
// Analysis types
// ---------------------------------------------------------------------------

/**
 * A finding produced by the analysis engines.
 * All fields are serialisable (no functions, no class instances) so the
 * worker process can send them over stdout as JSON.
 */
export interface Finding {
  /** Stable hash of (type, myFile, theirFile, extra discriminating keys). */
  id: string;
  type:
    | 'file-overlap'
    | 'symbol-overlap'
    | 'merge-conflict'
    | 'semantic-conflict'
    | 'endpoint-mismatch';
  severity: 'info' | 'warning' | 'error';
  myFile: string;
  theirFile: string;
  teammateEmail: string;
  teammateName: string;
  /** One-line template description suitable for VS Code diagnostic message. */
  description: string;
  /** Multi-line template explanation for the Explain panel fallback. */
  detail: string;

  // symbol-overlap only
  symbolName?: string;

  // merge-conflict only — file paths are sufficient; no extra fields needed

  // semantic-conflict only
  /** The TypeScript error message that triggered this finding. */
  tscError?: string;
  /** Optional ts-morph enrichment: unambiguous rename detected. Never drives detection. */
  renamedFields?: Array<{ from: string; to: string }>;

  // endpoint-mismatch only
  method?: string;
  path?: string;

  // Location for VS Code diagnostic positioning
  affectedLine?: number;
  affectedColumn?: number;

  /** Snapshot commit SHAs at the time of the finding. Used as the LLM cache key. */
  mySnapshotHash: string;
  theirSnapshotHash: string;
}

/**
 * Input sent to the analysis worker over stdin as JSON.
 */
export interface AnalysisJobRequest {
  repoRoot: string;
  mySnapshot: OwnSnapshot;
  theirSnapshot: TeammateSnapshot;
  /** Command run on each materialised tree. Default: 'npx tsc --noEmit -p .' */
  checkCommand: string;
  sharedTypePaths: string[];
}

// ---------------------------------------------------------------------------
// LLM provider types
// ---------------------------------------------------------------------------

/**
 * Input to an ExplanationProvider.
 * Only finding metadata and short diff hunks are sent — nothing else from the codebase.
 */
export interface ExplainInput {
  finding: Finding;
  /** Up to 60 lines of the relevant diff for the local developer. */
  myDiffHunk: string;
  /** Up to 60 lines of the relevant diff for the teammate. */
  theirDiffHunk: string;
}

export interface ExplainResult {
  markdown: string;
  fromCache: boolean;
}

/**
 * All LLM integrations implement this interface.
 * The 'none' provider returns a template explanation without network calls.
 */
export interface ExplanationProvider {
  id: string;
  explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
