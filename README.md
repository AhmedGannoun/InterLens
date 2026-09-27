# InterLens

**Git catches what conflicts. InterLens catches what breaks.**

InterLens is a VS Code extension that detects semantic inconsistencies between
two developers' *uncommitted* changes — before either of them commits, opens a
PR, or breaks the other's build. There is no hosted backend: the team's
existing Git remote is the only sync channel.

Each developer's extension pushes a small snapshot of their working tree to a
per-user Git ref (`refs/interlens/<email-slug>`), fetches teammates' refs, and
runs all analysis locally in a child process. An LLM (optional) is only ever
invoked on-demand for the `InterLens: Explain` command — detection itself
never depends on it.

---

## Project layout

```
packages/core/     Shared logic: snapshotting, git polling, analysis engines, LLM providers
extension/          The VS Code extension itself (commands, views, diagnostics)
demo/               A minimal repo used to demo the three detection scenarios
```

### How it works

1. **Snapshot on save** — [extension/src/snapshot-producer.ts](extension/src/snapshot-producer.ts)
   debounces your saves and pushes your working-tree snapshot to a hidden Git ref.
2. **Poll for teammates** — [packages/core/src/notifier/git-polling.ts](packages/core/src/notifier/git-polling.ts)
   periodically fetches teammates' hidden refs and detects changes.
3. **Analyze** — [extension/src/analysis-runner.ts](extension/src/analysis-runner.ts)
   runs three engines in a worker process
   ([packages/core/src/engines/](packages/core/src/engines/)):
   - `collision.ts` — renamed shared types / semantic conflicts
   - `endpoints.ts` — API route mismatches between frontend calls and backend routes
   - `merge.ts` — overlapping line edits
4. **Surface findings** — as VS Code Diagnostics (Problems panel), a Teammates
   tree view, and a status bar indicator.
5. **Explain** — the `InterLens: Explain` command sends a finding to an LLM
   (IBM Bob, OpenAI, Anthropic, or an OpenAI-compatible endpoint — configurable)
   for a plain-English explanation in a webview panel.

---

## Setup

```bash
npm install
```

Installs dependencies for both npm workspaces (`packages/core` and `extension`).

## Build

```bash
npm run build
```

Compiles `packages/core`, then bundles the extension into `extension/out/`:
`extension.js` (extension host entry point), `worker.js` (analysis child
process), `cli.js` (headless CLI fallback).

## Test

```bash
npm test
```

Builds `packages/core` and runs the full Jest suite (171 tests across both
packages).

---

## Running the extension

**1. Open the `extension/` folder as its own workspace** in VS Code (not the
   repo root) — `extension/package.json` and
   [extension/.vscode/launch.json](extension/.vscode/launch.json) are what
   VS Code needs to launch it.

**2. Press F5** (or use the Run and Debug panel → "Run InterLens Extension").
   This builds the extension and opens a second window titled
   `[Extension Development Host]` with InterLens active.

**3. In that new window, open a git repo folder** (e.g. `demo/`). InterLens
   activates on startup and shows a sync icon in the Activity Bar (Teammates
   tree view).

**4. Check the Output panel** → select the **"InterLens"** channel → confirms
   `InterLens activating…` / `InterLens activated.`

Equivalent one-liner instead of F5, from the repo root:

```bash
code --extensionDevelopmentPath="$(pwd)/extension" "$(pwd)/demo"
```

---

## Configuration

All settings live under `interlens.*` (see `extension/package.json` for the
full list), notably:

| Setting | Purpose |
|---|---|
| `interlens.llm.provider` | `ibm-bob` \| `openai` \| `anthropic` \| `openai-compatible` \| `none` |
| `interlens.llm.baseUrl` | Required for `ibm-bob` / `openai-compatible` |
| `interlens.sync.fetchIntervalSec` | How often to poll the Git remote (default 5s) |
| `interlens.sync.snapshotDebounceMs` | Debounce after save before pushing a snapshot (default 5000ms) |

Set an API key via the `InterLens: Set API Key` command; clear it with
`InterLens: Clear API Key`; verify it with `InterLens: Test LLM Connection`.

---

## Demo — seeing a real conflict detected

The `demo/` folder contains a minimal two-file TypeScript setup that
reproduces all three detection scenarios (semantic conflict, endpoint
mismatch, textual merge conflict) using two separate git clones acting as two
teammates. Full step-by-step instructions: [demo/README.md](demo/README.md).

If the VS Code UI isn't available, run the same analysis headlessly:

```bash
node extension/out/cli.js /path/to/clone-a /path/to/clone-b
```
