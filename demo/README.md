# InterLens Demo Repository

This is the demo codebase used during the InterLens hackathon presentation.
It contains a minimal TypeScript monorepo (no build step needed for the demo)
with three files that trigger each of the three demo scenarios.

---

## File Structure

```
demo/
├── shared/types.ts       ← AuthResponse { userId: string; token: string }
├── backend/auth.ts       ← Express POST /api/auth/login handler
├── frontend/login.ts     ← fetch('/api/auth/login') + response.token
├── tsconfig.json         ← strict TypeScript, noEmit, skipLibCheck
└── .interlens.yml        ← checkCommand + sharedTypePaths + team config
```

---

## Demo Setup

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
git add -A && git commit -m "initial" && git push

# 4. Clone as Bob
git clone /tmp/interlens-demo-remote.git /tmp/dev-bob
cd /tmp/dev-bob
git config user.email bob@demo.dev
git config user.name "Bob"
git pull
```

---

## Scenario A — Semantic Conflict

**Bob** opens `shared/types.ts`. Renames:
- `userId` → `id`
- `token` → `accessToken`

Updates `backend/auth.ts` to match. Bob's `tsc` passes. Bob saves.

**Alice** opens `frontend/login.ts`. Adds code reading `response.userId`
(the old name). Alice's local `tsc` passes (she hasn't pulled Bob's change).
Alice saves.

**Expected:** Alice sees a red squiggle on `response.userId` in her Problems
panel within ~10 seconds. InterLens reports:

```
semantic-conflict — Property 'userId' does not exist on type 'AuthResponse'
```

The `detail` field includes `Detected rename: userId → id` when ts-morph
confirms the rename is unambiguous.

---

## Scenario B — Endpoint Mismatch

**Bob** renames the Express route from `/api/auth/login` to `/api/auth/signin`
in `backend/auth.ts`. Saves.

**Alice** adds a `fetch('/api/auth/login', ...)` call in `frontend/login.ts`.
Saves.

**Expected:** Alice sees:

```
endpoint-mismatch — /api/auth/login no longer exists after Bob's changes
```

---

## Scenario C — Merge Conflict (Textual)

Both Alice and Bob edit the same lines in `backend/auth.ts`. Both save.

**Expected:** Both see:

```
merge-conflict in backend/auth.ts — changes overlap with Bob's / Alice's edits
```

---

## CLI Fallback

If the VS Code UI is unavailable, run the CLI harness directly:

```bash
node out/cli.js /tmp/dev-alice /tmp/dev-bob
```

Expected output (one JSON finding per line):

```json
{"id":"...","type":"semantic-conflict","severity":"error",...}
```
