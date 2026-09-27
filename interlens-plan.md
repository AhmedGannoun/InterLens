# InterLens — 48-Hour Hackathon Plan

## Product Summary

InterLens is a VS Code extension (packaged as a VSIX) that detects semantic inconsistencies between two developers' uncommitted changes before either of them commits, runs a test, or opens a pull request.

There is no hosted backend. The team's existing Git remote is the only sync channel. Each developer's extension pushes a working-tree snapshot — stored as a commit object — to a per-user ref (`refs/interlens/<user-email-slug>`), fetches teammates' refs, and runs all analysis locally in a child process. IBM Bob's LLM is invoked only on-demand for the "InterLens: Explain" command; detection never depends on it.

**Tagline:** "Git catches what conflicts. InterLens catches what breaks."

---

## IBM Bob Inference API — Confirmed Unknowns

**What IBM Bob documentation confirms:**
- Two API key types exist: **Inference** (scoped to a specific instance + team, no extra headers needed) and **General** (requires an additional team ID header for inference requests).
- Keys are created at `bob.ibm.com` under the user's subscription instance.
- Keys authenticate Bob Shell (`BOBSHELL_API_KEY`) and inference requests.
- The "Inference" key type is recommended for scripted/non-interactive use.

**What IBM Bob documentation does NOT confirm:**
- The inference base URL (e.g. `https://api.bob.ibm.com/v1/...`).
- Whether the inference API is OpenAI Chat Completions-compatible.
- The required request body format, headers beyond the key, and any instance-specific URL prefix.
- Available model identifiers.

**Assumption and design consequence:** The `ibm-bob` provider is designed with `interlens.llm.baseUrl` and `interlens.llm.model` as required overrideable settings. The provider sends `Authorization: Bearer <key>` and, when `interlens.llm.bobTeamId` is set, `X-Bob-Team-Id: <teamId>` (header name is assumed — must be verified). The request body format is assumed to be OpenAI Chat Completions-compatible (`POST /chat/completions` with `{ model, messages, stream }`). This must be verified manually before the demo. If wrong, only the `ibm-bob` provider needs to change; `openai` and the template fallback work regardless.

**Items to verify manually before the demo:**
1. The inference base URL.
2. Whether it is OpenAI Chat Completions-compatible.
3. The exact header name for the team ID (if General key is used).
4. Available model identifiers.

---

## Architecture

### Single-Extension, Git-as-Bus Design

```
Developer A's machine                    Developer B's machine
┌──────────────────────────┐             ┌──────────────────────────┐
│  VS Code + InterLens     │             │  VS Code + InterLens     │
│                          │             │                          │
│  Snapshot producer       │             │  Snapshot producer       │
│  (on save, debounced)    │             │  (on save, debounced)    │
│        │                 │             │        │                 │
│        ▼                 │             │        ▼                 │
│  git read-tree HEAD      │             │  git read-tree HEAD      │
│  git add -A (temp index) │             │  git add -A (temp index) │
│  git write-tree → TREE   │             │  git write-tree → TREE   │
│  git commit-tree → SNAP  │             │  git commit-tree → SNAP  │
│  (JSON in commit message)│             │  (JSON in commit message)│
│        │                 │             │        │                 │
│        ▼                 │             │        ▼                 │
│  git push --force        │             │  git push --force        │
│  refs/interlens/alice    │             │  refs/interlens/bob      │
└──────────┬───────────────┘             └──────────┬───────────────┘
           │                                        │
           └──────────────┬─────────────────────────┘
                          ▼
                   Shared Git remote
                (team's existing remote)
                refs/interlens/alice   ← commit SHA
                refs/interlens/bob     ← commit SHA
                          │
           ┌──────────────┴─────────────────────────┐
           ▼                                        ▼
Developer A polls ls-remote             Developer B polls ls-remote
(every interlens.sync.fetchIntervalSec)
When hash changed → fetch that ref → run pair analysis locally
           │
           ▼
   @interlens/core (no vscode imports)  [out/worker.js]
   ├── snapshot.ts      (commit announce / fetch)
   ├── notifier/        (GitPollingNotifier)
   └── engines/
       ├── merge.ts     (git merge-tree → merged tree OID or conflict)
       ├── tsc.ts        (tsc --noEmit on merged/snapA/snapB trees)
       ├── collision.ts  (file-overlap, symbol-overlap)
       └── endpoints.ts  (Express routes vs fetch/axios calls)
           │
           ▼
   VS Code DiagnosticCollection  (InterLens)
   VS Code status bar
   VS Code tree view  (interlens.teammates)
           │
      on "Explain" command
           ▼
   LLM provider (ibm-bob / openai / anthropic / openai-compatible / none)
           │
           ▼
   VS Code Webview panel (streaming markdown)
```

### End-to-End Timing (demo settings: `fetchIntervalSec = 3`, `snapshotDebounceMs = 5000`)

```
t=0       Developer A saves a file
t=5s      Debounce fires → snapshot commit produced → git push completes
t=5–8s    Developer B's next poll fires → ls-remote detects hash change
t=8s      Developer B's extension fetches the changed ref (~0.5s local bare repo)
t=8.5s    worker.js runs pair analysis (merge-tree + tsc comparison)
t=9–10s   Diagnostic appears in Developer B's Problems panel and status bar
```

Target: **under 10 seconds** from Developer A's save to Developer B's diagnostic, using demo settings.

---

## Repository Layout

```
InterLens/
├── packages/
│   └── core/                          ← @interlens/core (no vscode imports)
│       ├── src/
│       │   ├── types.ts               ← all shared TypeScript interfaces
│       │   ├── snapshot.ts            ← OwnSnapshot, announce(), fetchTeammate()
│       │   ├── notifier/
│       │   │   └── git-polling.ts     ← GitPollingNotifier
│       │   ├── engines/
│       │   │   ├── merge.ts           ← git merge-tree, archive to temp dir
│       │   │   ├── tsc.ts             ← tsc --noEmit runner + error set diff
│       │   │   ├── collision.ts       ← file-overlap, symbol-overlap (ts-morph)
│       │   │   └── endpoints.ts       ← Express route vs fetch/axios matching
│       │   ├── analysis.ts            ← orchestrates engines, returns Finding[]
│       │   ├── cli.ts                 ← node out/cli.js <repoA> <repoB> (fallback demo)
│       │   ├── worker-entry.ts        ← stdin→analysis→stdout IPC for child process
│       │   ├── llm/
│       │   │   ├── provider.ts        ← ExplanationProvider interface
│       │   │   ├── ibm-bob.ts
│       │   │   ├── openai.ts
│       │   │   ├── anthropic.ts
│       │   │   ├── openai-compat.ts
│       │   │   ├── template.ts
│       │   │   └── cache.ts
│       │   └── index.ts               ← public barrel export
│       ├── package.json               ← name: @interlens/core
│       └── tsconfig.json
├── extension/                         ← VS Code extension (thin host)
│   ├── src/
│   │   ├── extension.ts               ← activate / deactivate
│   │   ├── config.ts                  ← reads interlens.* settings + .interlens.yml
│   │   ├── secrets.ts                 ← VS Code SecretStorage wrapper + redaction
│   │   ├── snapshot-producer.ts       ← onDidSaveTextDocument → announce()
│   │   ├── analysis-runner.ts         ← child-process queue spawning out/worker.js
│   │   ├── diagnostics.ts             ← Finding[] → DiagnosticCollection
│   │   ├── status-bar.ts              ← sync + finding count status bar items
│   │   ├── tree-view.ts               ← interlens.teammates TreeDataProvider
│   │   ├── commands/
│   │   │   ├── explain.ts             ← interlens.explain + webview panel
│   │   │   ├── set-api-key.ts         ← interlens.setApiKey
│   │   │   ├── clear-api-key.ts       ← interlens.clearApiKey
│   │   │   └── test-connection.ts     ← interlens.testConnection
│   │   └── webview/
│   │       └── explain-panel.ts       ← Webview panel, streaming markdown
│   ├── esbuild.js                     ← builds extension.js and worker.js
│   ├── package.json                   ← publisher: interlens, name: interlens
│   └── tsconfig.json
├── demo/
│   ├── shared/
│   │   └── types.ts                   ← AuthResponse { userId: string; token: string }
│   ├── backend/
│   │   └── auth.ts                    ← Express router + AuthResponse usage
│   ├── frontend/
│   │   └── login.ts                   ← fetch + response.userId, response.token
│   ├── tsconfig.json
│   └── README.md                      ← step-by-step demo script
├── package.json                       ← npm workspaces root
└── README.md
```

---

## Core Interfaces (`@interlens/core/src/types.ts`)

```typescript
// Snapshot produced by the extension, stored as a Git commit object.
// The OwnSnapshot JSON is the commit message of the snapshot commit.
interface OwnSnapshot {
  userEmail: string;
  displayName: string;
  branch: string;
  headCommitSha: string;   // the real HEAD at snapshot time (parent of snapshot commit)
  treeSha: string;         // tree SHA produced by git write-tree on the temp index
  changedPaths: string[];  // files differing from HEAD
  timestamp: number;       // unix ms
}

// A teammate's snapshot, read from their commit message
interface TeammateSnapshot extends OwnSnapshot {}

// Emitted when a teammate's ref hash changes
interface TeammateSnapshotChange {
  userEmail: string;
  ref: string;
  oldHash: string | null;  // null on first observation
  newHash: string;         // commit SHA of the snapshot commit
}

// SnapshotNotifier — GitPollingNotifier in MVP; real-time notifier in future
interface SnapshotNotifier {
  start(onChange: (changes: TeammateSnapshotChange[]) => void): void;
  stop(): void;
  announce(own: OwnSnapshot): Promise<void>;
}

// Finding produced by the analysis engines
interface Finding {
  id: string;              // stable hash of (type, myFile, theirFile, extra keys)
  type: 'file-overlap' | 'symbol-overlap' | 'merge-conflict' | 'semantic-conflict' | 'endpoint-mismatch';
  severity: 'info' | 'warning' | 'error';
  myFile: string;
  theirFile: string;
  teammateEmail: string;
  teammateName: string;
  description: string;     // one-line template description
  detail: string;          // multi-line template explanation
  // symbol-overlap only:
  symbolName?: string;
  // merge-conflict only: (no extra fields; file paths are sufficient)
  // semantic-conflict only:
  tscError?: string;       // the TypeScript error message
  renamedFields?: Array<{ from: string; to: string }>;  // ts-morph enrichment, optional
  // endpoint-mismatch only:
  method?: string;
  path?: string;
  // location for diagnostic
  affectedLine?: number;
  affectedColumn?: number;
  // snapshot hashes at time of finding (for cache key)
  mySnapshotHash: string;
  theirSnapshotHash: string;
}

// Input to the analysis worker
interface AnalysisJobRequest {
  repoRoot: string;
  mySnapshot: OwnSnapshot;
  theirSnapshot: TeammateSnapshot;
  checkCommand: string;    // from .interlens.yml, default: 'npx tsc --noEmit -p .'
  sharedTypePaths: string[];
}
```

---

## SnapshotNotifier — GitPollingNotifier Behaviour

### `announce(own: OwnSnapshot)`

All git commands use `async execFile`. Steps in sequence:

```
GIT_INDEX_FILE=.git/interlens-index  git read-tree HEAD
GIT_INDEX_FILE=.git/interlens-index  git add -A
TREE=$(GIT_INDEX_FILE=.git/interlens-index  git write-tree)
SNAP=$(git commit-tree $TREE -p HEAD -m '<OwnSnapshot JSON>')
git push origin $SNAP:refs/interlens/<slug> --force
```

- Metadata lives in the commit message as JSON. No separate meta file, blob, or meta ref.
- `.git/interlens-index` is inside `.git/` and is not tracked by Git; no `.gitignore` entry is needed.
- `<slug>` is the user email with `@` replaced by `-at-` and `.` replaced by `-`.

### Polling loop

- `git ls-remote origin "refs/interlens/*"` every `interlens.sync.fetchIntervalSec` seconds and on VS Code window focus (via `vscode.window.onDidChangeWindowState`).
- Skip a tick if the previous one has not completed.
- On 3 consecutive network failures: increase interval to 30 seconds, show status bar warning `$(warning) InterLens: sync error`. Reset on first success.
- For each ref returned:
  - Skip own ref (`refs/interlens/<own-slug>`).
  - Compare SHA against last known SHA.
  - Only if changed: `git fetch origin refs/interlens/<slug>:refs/interlens/remote/<slug>` (fetch only that single ref).
  - Read commit message from fetched commit: `git log -1 --format=%B refs/interlens/remote/<slug>` → parse JSON → `TeammateSnapshot`.
  - Emit `TeammateSnapshotChange`.

### Future replacement

A `RealtimeNotifier` could accept a WebSocket or SSE stream carrying only `{ userEmail, ref, newHash, changedPaths }` metadata — no code content. It would call `git fetch` only for refs whose hash changed, exactly as `GitPollingNotifier` does. Replacing the implementation requires changing one file: `packages/core/src/notifier/git-polling.ts`.

---

## Pair Analysis Pipeline

When a `TeammateSnapshotChange` arrives, the extension spawns `out/worker.js` with an `AnalysisJobRequest`. The worker runs the following pipeline in order.

### Step 1 — Merge attempt (`engines/merge.ts`)

```
git merge-tree --write-tree --name-only <snapA.treeSha> <snapB.treeSha>
```

- Exit code 1 → textual conflict. Emit one `merge-conflict` finding per conflicted file (severity `warning`). **Stop. Do not proceed to Steps 2–4.**
- Exit code 0 → first output line is the merged tree OID (`mergedTreeSha`). Continue.

### Step 2 — Materialize trees (`engines/merge.ts`)

For each of the three tree SHAs (`mergedTreeSha`, `snapA.treeSha`, `snapB.treeSha`), if not already cached by tree OID:

```
mkdir -p <tmpDir>/<treeOid>
git archive <treeOid> | tar -x -C <tmpDir>/<treeOid>
ln -s <repoRoot>/node_modules <tmpDir>/<treeOid>/node_modules   (if exists)
```

Cache key: tree OID. Temp dirs are cleaned up when the worker process exits.

### Step 3 — Type-check comparison (`engines/tsc.ts`)

For each of the three materialized trees, run the check command from `.interlens.yml` (default: `npx tsc --noEmit -p .`). Cache results by tree OID so repeated checks are free.

Parse TypeScript error output: `<file>(<line>,<col>): error TS<code>: <message>`

Build an error set per tree keyed by `(normalizedFile, errorCode, message)` — **ignoring line numbers** because lines shift between snapshot versions.

```
newErrors = errors(merged) minus errors(snapA) minus errors(snapB)
```

Each entry in `newErrors` is a `semantic-conflict` finding (severity `error`).

**Optional ts-morph enrichment:** When a `semantic-conflict` is reported and a file in `sharedTypePaths` changed between `snapA` and `snapB`, parse that file with `ts-morph` in both snapshots. If exactly one field was removed and exactly one field of the same type was added (unambiguous rename), attach `renamedFields` to the finding message. This is enrichment only — it never drives detection.

### Step 4 — Endpoint consistency (`engines/endpoints.ts`)

Run on the same three materialized trees.

**Backend — Express route extraction (ts-morph):**
- Find `router.get/post/put/delete/patch(<string-literal>, ...)` calls.
- Resolve router prefix by tracing `app.use(<string-literal>, router)` in the same file or import chain.
- Normalize path: replace `:param` segments with `{param}`, strip trailing slashes and query strings.
- Skip dynamic paths (non-literal first argument). Log skipped count to the InterLens output channel.

**Frontend — call extraction (ts-morph):**
- Find `fetch(<url>)` calls (default method: GET; read `method` from the options object literal if present).
- Find `axios.get/post/put/delete/patch(<url>)` calls.
- Normalize `${...}` interpolations to `{param}`, strip trailing slashes and query strings.
- Skip non-literal or complex template expressions. Log skipped count.

**Comparison:**
```
For each frontend call in merged:
  if no matching route exists in merged
  but a matching route existed in both snapA and snapB:
    emit endpoint-mismatch finding (severity error)
```

### Step 5 — Collision detection (`engines/collision.ts`)

Uses git diffs against each snapshot's `headCommitSha` (the real HEAD parent), not against each other.

**File-overlap (severity `info`):** intersection of `snapA.changedPaths` and `snapB.changedPaths`.

**Symbol-overlap (severity `warning`):** for each overlapping `.ts` / `.tsx` file:
- `git diff <snapA.headCommitSha> <snapA.treeSha> -- <file>` → changed line ranges for A.
- `git diff <snapB.headCommitSha> <snapB.treeSha> -- <file>` → changed line ranges for B.
- Parse both versions of the file with `ts-morph`. Extract top-level declarations.
- A declaration counts as modified by a developer only if its source range **overlaps** that developer's changed line ranges in both diffs.
- Declarations modified by both A and B → `symbol-overlap` finding.

---

## Extension Host: Off-Thread Execution (`extension/src/analysis-runner.ts`)

- Spawns `out/worker.js` (the esbuild-bundled worker entry point) as a Node.js child process per analysis job.
- IPC: `AnalysisJobRequest` JSON written to `stdin`; `Finding[]` JSON read from `stdout`; errors on `stderr` logged to the InterLens output channel.
- Queue: at most one worker process running per teammate email at a time.
- When a new snapshot arrives for a teammate while a worker is running for that teammate: kill the in-flight process and start a new one.
- Hard timeout: 30 seconds. Kill the worker if exceeded. Log to output channel.

---

## Build System (esbuild)

`extension/esbuild.js` builds two entry points:

| Entry point | Output | Purpose |
|---|---|---|
| `extension/src/extension.ts` | `out/extension.js` | VS Code extension host |
| `packages/core/src/worker-entry.ts` | `out/worker.js` | Analysis child process |

Both are bundled as CommonJS. `vscode` is marked as external. `@interlens/core` is inlined into both outputs. No symlink resolution issues with `vsce package`.

---

## CLI Harness (`packages/core/src/cli.ts`)

```
node out/cli.js <repoA> <repoB>
```

- Reads the latest snapshot commit from `refs/interlens/<slug>` in each repo.
- Runs the full pair analysis pipeline.
- Prints findings as JSON to stdout (one finding per line).

**Purpose:** Fallback demo if the VS Code UI is broken. Judges can see findings in a terminal without installing the extension. Also useful for manual testing during development.

---

## LLM Integration

### ExplanationProvider Interface

```typescript
interface ExplainInput {
  finding: Finding;
  myDiffHunk: string;      // max 60 lines from git diff of affected file
  theirDiffHunk: string;   // max 60 lines
}

interface ExplainResult {
  markdown: string;
  fromCache: boolean;
}

interface ExplanationProvider {
  id: string;
  explain(input: ExplainInput, signal: AbortSignal): Promise<ExplainResult>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
```

### System Prompt (shared across all providers)

```
You are a developer coordination assistant. A teammate has made a change that affects code another developer is working on.
Explain the situation clearly and concisely.

Structure your response in exactly three sections:
1. What changed and who changed it (one sentence).
2. Which line breaks and why (one or two sentences).
3. Recommended fix and who should act (one sentence).

Maximum 120 words total. Use plain language, no bullet points, no headings.
```

### Provider: `ibm-bob`

**Assumed implementation (must be verified — see unknowns above):**
- Base URL: `interlens.llm.baseUrl` (no default — user must supply; setup UI links to `bob.ibm.com`).
- Endpoint: `POST <baseUrl>/chat/completions` (OpenAI Chat Completions-compatible, assumed).
- Headers: `Authorization: Bearer <key>`, optionally `X-Bob-Team-Id: <teamId>` (header name assumed — must verify).
- Body: `{ model: interlens.llm.model || "<unconfirmed>", messages: [...], stream: true }`.
- Streaming: parsed as OpenAI-compatible SSE.
- If base URL is empty: return template explanation + "IBM Bob base URL not configured. [Fix settings]".

### Provider: `openai`
- Base URL: `https://api.openai.com/v1`.
- Endpoint: `POST /chat/completions`.
- Header: `Authorization: Bearer <key>`.
- Default model: `gpt-4o-mini` *(verify availability before demo)*.
- Streaming: OpenAI SSE format.

### Provider: `anthropic`
- Base URL: `https://api.anthropic.com`.
- Endpoint: `POST /v1/messages`.
- Headers: `x-api-key: <key>`, `anthropic-version: 2023-06-01`.
- Default model: `claude-haiku-4-5`.
- Streaming: Anthropic SSE format (`event: content_block_delta`).

### Provider: `openai-compatible`
- Base URL: `interlens.llm.baseUrl` (required).
- Endpoint: `POST /chat/completions`.
- Header: `Authorization: Bearer <key>` (omit if no key set).
- Model: `interlens.llm.model` (required).

### Provider: `none`
- Returns `finding.detail` formatted as markdown. No network call.

### Key Handling

- Keys stored: `context.secrets.store('interlens.apiKey.<provider>', key)`.
- Keys read: `context.secrets.get('interlens.apiKey.<provider>')`.
- Never written to: `settings.json`, `.interlens.yml`, workspace files, Git refs, output channel, or any log.
- Redaction: before surfacing any error string from an LLM call, replace any stored key value with `[REDACTED]`.

### First-run flow (provider = `ibm-bob`, no key stored)
1. Notification: "InterLens: Add your IBM Bob API key to enable explanations." Buttons: **Add IBM Bob key** | **Use another provider**.
2. "Add IBM Bob key" → runs `interlens.setApiKey` for `ibm-bob`.
3. "Use another provider" → opens Settings UI filtered to `interlens.llm`.
4. All detection features (diagnostics, status bar, tree view) are unaffected.

### Caching
- Cache key: `SHA256(finding.id + mySnapshotHash + theirSnapshotHash)`.
- Cache store: in-memory `Map<cacheKey, ExplainResult>` (cleared on extension reload).
- Cache hit: return stored result with no network call.

### Streaming into Webview
- Open a `vscode.WebviewPanel`.
- Stream tokens via `panel.webview.postMessage({ type: 'token', text })`.
- Webview renders incrementally using `marked` (bundled single file).
- On stream end: `panel.webview.postMessage({ type: 'done' })`.
- On error: `panel.webview.postMessage({ type: 'error', text: redactedMessage })`.

---

## VS Code Extension Configuration (`contributes.configuration`)

```json
{
  "interlens.llm.provider": {
    "type": "string",
    "enum": ["ibm-bob", "openai", "anthropic", "openai-compatible", "none"],
    "default": "ibm-bob"
  },
  "interlens.llm.model": {
    "type": "string",
    "default": "",
    "description": "Model identifier. Leave empty to use the provider default."
  },
  "interlens.llm.baseUrl": {
    "type": "string",
    "default": "",
    "description": "Base URL for ibm-bob (required) or openai-compatible."
  },
  "interlens.llm.bobTeamId": {
    "type": "string",
    "default": "",
    "description": "IBM Bob team ID. Required only with a General API key."
  },
  "interlens.llm.timeoutMs": {
    "type": "number",
    "default": 20000
  },
  "interlens.sync.fetchIntervalSec": {
    "type": "number",
    "default": 5,
    "minimum": 2,
    "description": "Poll interval for teammate snapshots. Demo: set to 3."
  },
  "interlens.sync.snapshotDebounceMs": {
    "type": "number",
    "default": 5000
  },
  "interlens.user.displayName": {
    "type": "string",
    "default": "",
    "description": "Your display name shown to teammates. Falls back to git user.name."
  }
}
```

---

## VS Code Extension Commands

| ID | Title |
|---|---|
| `interlens.explain` | InterLens: Explain |
| `interlens.setApiKey` | InterLens: Set API Key |
| `interlens.clearApiKey` | InterLens: Clear API Key |
| `interlens.testConnection` | InterLens: Test LLM Connection |

---

## VS Code Extension Views

- View container ID: `interlens` (activity bar).
- Tree view ID: `interlens.teammates`.
- Tree items: one per teammate → name, branch, last sync time, finding count.
- Finding sub-nodes: type + one-line description. Click → open file at affected line.

---

## VS Code Diagnostics and Output Channel

- `DiagnosticCollection` name: `InterLens`.
- `OutputChannel` name: `InterLens`.
- Severity mapping: `error` → `DiagnosticSeverity.Error`, `warning` → `DiagnosticSeverity.Warning`, `info` → `DiagnosticSeverity.Information`.
- `source`: `"InterLens"`. `code`: finding `id` (used by the Explain command to look up the finding).
- Range: `affectedLine`/`affectedColumn` when available; otherwise line 0 (whole-file).

---

## Project Config File (`.interlens.yml`)

Optional. Lives in the workspace root. Extension works without it.

```yaml
# .interlens.yml — optional InterLens project configuration
checkCommand: "npx tsc --noEmit -p ."   # command run on each materialized tree

sharedTypePaths:
  - shared/
  - types/
  - contracts/
  - interfaces/

team:
  - email: alice@demo.dev
    displayName: Alice
    area: frontend
  - email: bob@demo.dev
    displayName: Bob
    area: backend
```

If absent, defaults apply: `checkCommand` = `npx tsc --noEmit -p .`; `sharedTypePaths` = `[shared/, types/, contracts/, interfaces/]`.

---

## Sub-Tasks and Hour Estimates

**Total budget: 40 hours. Buffer: 8 hours.**

**Critical path:** Sub-tasks 1 → 2 → 3 must be complete by hour 16. Sub-task 3 is the riskiest and the most technically novel; all other sub-tasks depend on it being correct.

### Sub-Task 1: Scaffolding + esbuild (2h)
**Status:** [x] done

**Intent:** Create the npm workspaces monorepo, establish the esbuild pipeline producing `out/extension.js` and `out/worker.js`, and verify both compile cleanly.

**Expected Outcomes:**
- `packages/core/package.json` with `name: "@interlens/core"`, dependencies: `ts-morph`, `typescript`, `js-yaml`.
- `packages/core/tsconfig.json`: `module: CommonJS`, `target: ES2020`, `strict: true`.
- `packages/core/src/types.ts` with all shared interfaces (exact types from the Core Interfaces section above).
- `packages/core/src/index.ts` barrel export (stubs).
- `extension/package.json` with all VS Code metadata, command contributions, view contributions, and `interlens.*` settings declared.
- `extension/tsconfig.json`.
- `extension/esbuild.js` with two entry points: `extension/src/extension.ts` → `out/extension.js`; `packages/core/src/worker-entry.ts` → `out/worker.js`. Both CommonJS. `vscode` external. `@interlens/core` inlined.
- Root `package.json` with `"workspaces": ["packages/core", "extension"]` and a `build` script.
- `npm run build` succeeds. No TypeScript errors.

**Todo List:**
1. Create root `package.json` (workspaces, build scripts).
2. Create `packages/core/package.json` and `packages/core/tsconfig.json`.
3. Create `packages/core/src/types.ts` with all interfaces from the Core Interfaces section.
4. Create `packages/core/src/index.ts` barrel export.
5. Create `extension/package.json` (publisher, name, engine, commands, views, settings, main).
6. Create `extension/tsconfig.json`.
7. Create `extension/src/extension.ts` with `activate`/`deactivate` stubs.
8. Create `packages/core/src/worker-entry.ts` stub (reads stdin, writes `[]` to stdout).
9. Create `extension/esbuild.js`.
10. Run `npm install` and `npm run build`. Fix any errors.

---

### Sub-Task 2: Snapshot Producer + GitPollingNotifier (5h)
**Status:** [x] done

**Intent:** Implement snapshot creation (commit object with JSON metadata in commit message) and the full polling loop. This is the sync backbone everything else depends on.

**Expected Outcomes:**
- `packages/core/src/snapshot.ts`: `createSnapshot(repoRoot, userEmail, displayName)` → `OwnSnapshot`; `announceSnapshot(repoRoot, snapshot)` executes the five git commands asynchronously.
- `packages/core/src/notifier/git-polling.ts`: `GitPollingNotifier` with `start`, `stop`, `announce`. Correct tick-skip, backoff, and focus-event behaviour.
- `extension/src/snapshot-producer.ts`: registers `onDidSaveTextDocument`, debounces, calls `announceSnapshot`.
- Manual verification: two terminal windows, two clones of a local bare repo. After saving a file in clone A, `git log refs/interlens/<slug>` in the bare repo shows the snapshot commit within 6 seconds. Commit message is valid JSON.

**Todo List:**
1. Implement `createSnapshot` using `async execFile`. Read `git config user.email`, `git config user.name`, `git rev-parse HEAD`, `git diff --name-only HEAD`.
2. Implement `announceSnapshot`: five sequential `execFile` calls as specified. Use `GIT_INDEX_FILE` env var override.
3. Implement `emailToSlug` utility.
4. Implement `GitPollingNotifier`:
   a. Poll function: `git ls-remote origin "refs/interlens/*"`, parse, diff, fetch changed, read commit message, emit.
   b. `setInterval` + `vscode.window.onDidChangeWindowState` registration (passed in via callback from extension).
   c. Tick-skip guard, error counter, backoff.
   d. `stop()`: clear interval, remove focus listener.
5. Implement `extension/src/snapshot-producer.ts`.
6. Wire into `extension.ts` activate.
7. Manual test as described above.

---

### Sub-Task 3: Merge + TSC Semantic Engine with Tests (8h) ← CRITICAL PATH
**Status:** [ ] pending

**Intent:** Implement the core pair analysis pipeline: merge attempt, tree materialization, tsc comparison, and error-set diff. This is the most technically novel part. Must pass unit tests before any UI work begins.

**Expected Outcomes:**
- `engines/merge.ts`: `tryMerge(repoRoot, treeA, treeB)` returns `{ mergedTreeSha: string } | { conflicts: string[] }`.
- `engines/merge.ts`: `materializeTree(repoRoot, treeSha)` → temp dir path. Cached by tree OID.
- `engines/tsc.ts`: `runCheck(dir, command)` → `TscError[]`. Cached by tree OID.
- `engines/tsc.ts`: `diffErrors(merged, snapA, snapB)` → `TscError[]` (new errors only).
- `packages/core/src/analysis.ts`: full pipeline returning `Finding[]` for a given `AnalysisJobRequest`.
- Unit tests (using actual temp git repos with fixture files) for:
  - The demo scenario: `AuthResponse.userId → id` in shared types; consumer uses `response.userId` → one `semantic-conflict` finding.
  - A change with no semantic conflict → zero `semantic-conflict` findings.
  - A textual conflict → one `merge-conflict` finding, no `semantic-conflict` findings.
- `packages/core/src/worker-entry.ts` updated to run `analysis.ts` and return results.
- CLI harness `packages/core/src/cli.ts` functional: `node out/cli.js <repoA> <repoB>` prints findings.

**Todo List:**
1. Implement `engines/merge.ts`: `tryMerge` (async `execFile git merge-tree --write-tree --name-only`), `materializeTree` (async `execFile git archive | tar -x`), symlink `node_modules`.
2. Implement `engines/tsc.ts`: `runCheck` (async `execFile <command>` in the materialized dir), parse output with regex, return `TscError[]`. `diffErrors` set subtraction.
3. Implement ts-morph enrichment in `engines/tsc.ts` (optional `renamedFields`) — only when unambiguous.
4. Implement `packages/core/src/analysis.ts` orchestrator calling merge, tsc, collision, endpoint engines.
5. Write unit tests for the three scenarios listed above.
6. Update `worker-entry.ts` to read `AnalysisJobRequest` from stdin, call `analysis.ts`, write `Finding[]` to stdout.
7. Implement `packages/core/src/cli.ts`.
8. Run `node out/cli.js` against the demo repo clones. Verify correct output.

---

### Sub-Task 4: CLI Harness Verification (1h)
**Status:** [ ] pending

**Intent:** Confirm the CLI harness works end-to-end as a fallback demo path. This is insurance: if the VS Code UI breaks during the demo, a judge can see findings in a terminal.

**Expected Outcomes:**
- `node out/cli.js /tmp/dev-alice /tmp/dev-bob` prints at least one `semantic-conflict` finding as JSON after the demo scenario is set up.
- Output is human-readable enough to explain live.

**Todo List:**
1. Set up the demo repos per the Demo Script section.
2. Run `node out/cli.js`. Verify finding appears.
3. Check that the `detail` field contains the renamed field information.

---

### Sub-Task 5: Worker, Diagnostics, Tree View, Status Bar (6h)
**Status:** [ ] pending

**Intent:** Wire the analysis pipeline into VS Code: spawn the worker from the extension host, map findings to diagnostics, and build the status bar and tree view.

**Expected Outcomes:**
- `extension/src/analysis-runner.ts`: child-process queue spawning `out/worker.js`. One job per teammate. Cancel stale. 30s timeout.
- `extension/src/diagnostics.ts`: `updateDiagnostics(findings, workspaceRoot)` → `DiagnosticCollection` named `InterLens`.
- `extension/src/status-bar.ts`: left item shows `$(sync-spin) InterLens` while syncing, `$(check) InterLens` idle, `$(warning) InterLens: sync error` on backoff.
- `extension/src/tree-view.ts`: `interlens.teammates` tree; teammate nodes; finding sub-nodes with click-to-navigate.
- End-to-end: teammate snapshot change → worker spawned → findings → diagnostics updated → tree view refreshed.

**Todo List:**
1. Implement `analysis-runner.ts` with the queue, kill-on-new-snapshot, and timeout.
2. Implement `diagnostics.ts`.
3. Implement `status-bar.ts` with three states.
4. Implement `tree-view.ts` with `TreeDataProvider`, teammate nodes, finding nodes, navigation on click.
5. Wire all of the above in `extension.ts`.
6. End-to-end test: open two VS Code windows on the demo repos, save a file in Alice's window, verify a diagnostic appears in Bob's window within 10 seconds.

---

### Sub-Task 6: Endpoint Engine (6h)
**Status:** [ ] pending

**Intent:** Implement the Express route vs fetch/axios consistency checker. Cut to fetch-only string literals if running behind schedule.

**Expected Outcomes:**
- `engines/endpoints.ts`: `extractRoutes(dir)` using ts-morph → `Route[]`; `extractCalls(dir)` using ts-morph → `ApiCall[]`; `compareEndpoints(merged, snapA, snapB)` → `Finding[]`.
- The demo scenario: Bob renames `/api/auth/login` to `/api/auth/signin`; Alice adds a fetch to `/api/auth/login`; Alice sees an `endpoint-mismatch` finding.
- Dynamic paths and non-literal URLs are silently skipped (count logged to output channel).

**Time-cut rule:** If this sub-task exceeds its budget, implement `extractCalls` for `fetch()` string literals only (no axios, no template literals). Label this limitation clearly in the README.

**Todo List:**
1. Implement `extractRoutes` with ts-morph: find `router.get/post/put/delete/patch` calls, resolve `app.use` prefixes, normalize paths.
2. Implement `extractCalls` with ts-morph: find `fetch` and `axios.*` calls, extract method and URL, normalize.
3. Implement `compareEndpoints`: run on merged + snapA + snapB materialized trees, apply the comparison rule.
4. Wire into `analysis.ts`.
5. Unit test with fixture files matching the demo scenario.
6. Verify the demo scenario works end-to-end.

---

### Sub-Task 7: LLM Providers + Explain Command (5h)
**Status:** [ ] pending

**Intent:** Implement all five providers, the SecretStorage wrapper, and the Explain command with streaming Webview.

**Expected Outcomes:**
- All five providers (`ibm-bob`, `openai`, `anthropic`, `openai-compatible`, `none`) implemented.
- `extension/src/secrets.ts` with `get/store/delete` and key redaction in error strings.
- `interlens.explain`: retrieves finding from diagnostic code, builds `ExplainInput`, calls provider, opens streaming Webview panel.
- `interlens.setApiKey` / `interlens.clearApiKey` / `interlens.testConnection` working.
- First-run notification for `ibm-bob` with no key stored.
- Cache hit returns instantly on re-open.
- Demo: trigger Explain, see streaming response; switch provider in settings live, trigger again.

**Todo List:**
1. Implement `template.ts` provider (pure template, no network).
2. Implement `openai.ts` (streaming SSE with `fetch` + `ReadableStream`).
3. Implement `anthropic.ts` (Anthropic SSE format).
4. Implement `openai-compat.ts` (same as openai, configurable base URL).
5. Implement `ibm-bob.ts` (OpenAI-compatible assumed; base URL from settings; team ID header; graceful fallback to template if base URL empty).
6. Implement `cache.ts`.
7. Implement `secrets.ts` with redaction utility.
8. Implement `commands/explain.ts` and `webview/explain-panel.ts` (streaming webview with `marked`).
9. Implement `commands/set-api-key.ts`, `clear-api-key.ts`, `test-connection.ts`.
10. Wire all commands in `extension.ts`.

---

### Sub-Task 8: Config, Polish, Demo Repo, VSIX, Rehearsals (7h)
**Status:** [ ] pending

**Intent:** Read `.interlens.yml`, polish the UI, build the demo repository, package the VSIX, and run two full rehearsals of the demo script.

**Expected Outcomes:**
- `extension/src/config.ts`: merges VS Code settings and `.interlens.yml` into `InterLensConfig`. Watches `.interlens.yml` for changes.
- `sharedTypePaths` and `checkCommand` from config flow through to the analysis worker.
- Status bar and tree view polished per the specs above.
- Demo repos set up per the Demo Script section. All five scenario steps verified.
- `vsce package` produces a `.vsix` that installs cleanly in VS Code and IBM Bob.
- Two full rehearsals completed. All five demo steps execute within their expected timing.

**Todo List:**
1. Implement `config.ts` with `.interlens.yml` reader (`js-yaml`), VS Code settings merge, and file watcher.
2. Update `analysis-runner.ts` to pass `checkCommand` and `sharedTypePaths` from config to the worker.
3. Polish status bar (three states with correct icons).
4. Polish tree view (finding sub-nodes, click navigation).
5. Create `demo/` codebase with `shared/types.ts`, `backend/auth.ts`, `frontend/login.ts`, `tsconfig.json`, `.interlens.yml`.
6. Write `demo/README.md` (demo script).
7. Write root `README.md` (setup, architecture, feature list, known limitations).
8. Add `vsce` dev dependency to `extension/package.json`. Create `.vscodeignore`.
9. Run `vsce package`. Test VSIX install.
10. Run full rehearsal 1. Fix any issues. Run full rehearsal 2.

---

## Demo Script

### Setup

```bash
# 1. Create a local bare repo as the Git remote
git init --bare /tmp/interlens-demo-remote.git

# 2. Clone as Alice
git clone /tmp/interlens-demo-remote.git /tmp/dev-alice
cd /tmp/dev-alice
git config user.email alice@demo.dev
git config user.name "Alice"

# 3. Copy demo codebase into Alice's clone
cp -r <workspace>/demo/* /tmp/dev-alice/
cd /tmp/dev-alice
npm install
git add -A && git commit -m "initial" && git push

# 4. Clone as Bob
git clone /tmp/interlens-demo-remote.git /tmp/dev-bob
cd /tmp/dev-bob
git config user.email bob@demo.dev
git config user.name "Bob"
git pull
npm install
```

### VS Code Windows

- **Window 1** (Alice): open `/tmp/dev-alice`. Settings: `interlens.user.displayName: "Alice"`, `interlens.sync.fetchIntervalSec: 3`.
- **Window 2** (Bob): open `/tmp/dev-bob`. Settings: `interlens.user.displayName: "Bob"`, `interlens.sync.fetchIntervalSec: 3`.

Both windows show `$(check) InterLens` in the status bar.

### Scenario A — Semantic conflict (Git merges cleanly; InterLens catches it)

1. **Bob** opens `shared/types.ts`. Renames `userId` to `id` and `token` to `accessToken`. Updates all existing usages in `backend/auth.ts`. Bob's `tsc` passes. Bob saves.
2. **Alice** opens `frontend/login.ts`. Adds new code reading `response.userId` and `response.token`. Alice's `tsc` passes. Alice saves.
3. Wait up to 10 seconds.
4. **Alice** sees a red squiggle on `response.userId` and `response.token` in her Problems panel:
   - `"InterLens: semantic-conflict — AuthResponse.userId no longer exists after Bob's changes. Your code at login.ts will break at runtime."`
5. Alice runs **InterLens: Explain**. IBM Bob streams an explanation and recommends updating `response.userId` → `response.id`.

### Scenario B — Endpoint mismatch

1. **Bob** renames the Express route from `/api/auth/login` to `/api/auth/signin` in `backend/auth.ts`. Saves.
2. **Alice** adds a `fetch('/api/auth/login', ...)` call in `frontend/login.ts`. Saves.
3. **Alice** sees an `endpoint-mismatch` finding: `"InterLens: /api/auth/login no longer exists after Bob's changes."`

### Scenario C — Merge conflict (textual)

1. Both Alice and Bob edit the same lines in `backend/auth.ts`. Both save.
2. **Both** see a `merge-conflict` finding: `"InterLens: merge-conflict in backend/auth.ts — changes overlap with Bob's / Alice's edits."`

### Live provider switch (during Explain demo)

1. Change `interlens.llm.provider` to `openai` in Settings (or `none` for template).
2. Run **InterLens: Explain** again on the same finding.
3. Response arrives from the new provider. Cache is keyed by snapshot hashes, so a cache miss occurs and a new call is made.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| IBM Bob inference API details unconfirmed | High | `ibm-bob` provider base URL is a required user setting; `openai` + template fallback fully functional for demo |
| `git merge-tree --write-tree` not available (requires Git 2.38+) | Medium | Check git version in activate; show error and disable analysis if too old |
| `tsc` not on PATH in materialized tree | Medium | `npx tsc` resolves local `node_modules/.bin/tsc`; symlink `node_modules` from real clone |
| `git archive \| tar` slow for large repos | Low | Demo repo is tiny; add file size guard (skip trees over 50MB) for real-world use |
| Extension host main thread blocked by ts-morph | Medium | ts-morph runs in `out/worker.js` child process; never in extension host |
| Push/fetch race on `refs/interlens/` | Medium | `--force` push; polling detects winning hash; analysis re-runs on next change event |
| Polling load on hosted Git remote (GitHub rate limits) | Medium | Default interval 5s; document GitHub rate limit risk; use local bare repo for demo |
| Two VS Code windows on same machine share git identity | Medium | `interlens.user.displayName` setting overrides display name; email slug from per-repo `git config` |
| `vsce` VSIX packaging fails with workspace symlinks | Low | esbuild inlines `@interlens/core`; no symlinks in `out/`; test package before final rehearsal |
| `gpt-4o-mini` availability changes | Low | Marked "verify availability"; `openai-compatible` with local Ollama as backup |
| Endpoint engine over budget | Medium | Time-cut rule: `fetch()` string literals only; documented in README as known limitation |

---

## Roadmap (not to build now)

**Real-time metadata notifier:** Replace `GitPollingNotifier` with a WebSocket or SSE service carrying only `{ userEmail, ref, newHash, changedPaths }`. No code content. Reduces latency from ~10s to ~1s. One file change in `packages/core/src/notifier/`.

**CLI daemon:** `npx @interlens/cli --watch` runs the analysis loop headlessly for CI pre-commit hooks or editors without a VS Code extension API.

**GitHub App:** Listens to `push` webhooks on `refs/interlens/*`, runs analysis server-side, posts findings as PR comments. No IDE required.

**JetBrains plugin:** Thin adapter calling `out/worker.js` over stdio. Same `@interlens/core`, different IDE host.

**OpenAPI / REST contract validation:** Extend `engines/endpoints.ts` to parse OpenAPI YAML/JSON diffs in addition to Express/fetch static analysis.
