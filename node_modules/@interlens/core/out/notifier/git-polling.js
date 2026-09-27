"use strict";
/**
 * git-polling.ts — GitPollingNotifier
 *
 * Implements SnapshotNotifier by polling the Git remote for refs/interlens/*.
 * No vscode imports. No execSync.
 *
 * Focus events are injected by the extension via the `onFocus` option so that
 * this module remains IDE-agnostic.
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
exports.GitPollingNotifier = void 0;
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const snapshot_1 = require("../snapshot");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function git(repoRoot, args) {
    const { stdout } = await execFile('git', args, {
        cwd: repoRoot,
        maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
}
/**
 * Parse `git ls-remote` output into a map of ref → SHA.
 * Output format: "<SHA>\t<ref>\n..."
 */
function parseLsRemote(output) {
    const map = new Map();
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const tab = trimmed.indexOf('\t');
        if (tab === -1)
            continue;
        const sha = trimmed.slice(0, tab).trim();
        const ref = trimmed.slice(tab + 1).trim();
        if (sha && ref)
            map.set(ref, sha);
    }
    return map;
}
// ---------------------------------------------------------------------------
// GitPollingNotifier
// ---------------------------------------------------------------------------
class GitPollingNotifier {
    constructor(options) {
        this.onChange = null;
        this.timer = null;
        this.focusCleanup = null;
        this.tickRunning = false;
        this.consecutiveFailures = 0;
        this.inBackoff = false;
        /** Last known SHA per ref (including remote/interlens refs). */
        this.lastKnown = new Map();
        this.opts = {
            repoRoot: options.repoRoot,
            ownEmail: options.ownEmail,
            fetchIntervalSec: Math.max(2, options.fetchIntervalSec ?? 5),
            failureThreshold: options.failureThreshold ?? 3,
            backoffSec: options.backoffSec ?? 30,
            onFocus: options.onFocus,
            onSyncError: options.onSyncError,
        };
    }
    // -------------------------------------------------------------------------
    // SnapshotNotifier.start
    // -------------------------------------------------------------------------
    start(onChange) {
        this.onChange = onChange;
        this.scheduleTimer();
        if (this.opts.onFocus) {
            this.focusCleanup = this.opts.onFocus(() => {
                void this.poll();
            });
        }
    }
    // -------------------------------------------------------------------------
    // SnapshotNotifier.stop
    // -------------------------------------------------------------------------
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.focusCleanup) {
            this.focusCleanup();
            this.focusCleanup = null;
        }
        this.onChange = null;
    }
    // -------------------------------------------------------------------------
    // SnapshotNotifier.announce
    // -------------------------------------------------------------------------
    /**
     * announce() is a no-op here — the extension calls announceSnapshot()
     * directly from snapshot-producer.ts. This implementation is provided to
     * satisfy the SnapshotNotifier interface and can be wired in the future.
     */
    async announce(_own) {
        // The real work is done by announceSnapshot() in snapshot.ts.
        // GitPollingNotifier only handles the polling side.
    }
    // -------------------------------------------------------------------------
    // Internal: timer management
    // -------------------------------------------------------------------------
    scheduleTimer() {
        if (this.timer !== null)
            clearInterval(this.timer);
        const intervalMs = this.inBackoff
            ? this.opts.backoffSec * 1000
            : this.opts.fetchIntervalSec * 1000;
        this.timer = setInterval(() => {
            void this.poll();
        }, intervalMs);
    }
    // -------------------------------------------------------------------------
    // Internal: poll
    // -------------------------------------------------------------------------
    /** Exposed as public for testing. */
    async poll() {
        // Tick-skip guard: do not run concurrent polls
        if (this.tickRunning)
            return;
        if (!this.onChange)
            return;
        this.tickRunning = true;
        try {
            await this.doPoll();
            // Success: reset failure counter and backoff
            if (this.consecutiveFailures > 0 || this.inBackoff) {
                this.consecutiveFailures = 0;
                const wasInBackoff = this.inBackoff;
                this.inBackoff = false;
                if (wasInBackoff) {
                    this.scheduleTimer();
                    this.opts.onSyncError?.(false);
                }
            }
        }
        catch {
            this.consecutiveFailures++;
            if (!this.inBackoff &&
                this.consecutiveFailures >= this.opts.failureThreshold) {
                this.inBackoff = true;
                this.scheduleTimer();
                this.opts.onSyncError?.(true);
            }
        }
        finally {
            this.tickRunning = false;
        }
    }
    async doPoll() {
        const ownSlug = (0, snapshot_1.emailToSlug)(this.opts.ownEmail);
        const ownRef = `refs/interlens/${ownSlug}`;
        // Query all interlens refs on origin
        let lsOutput;
        try {
            lsOutput = await git(this.opts.repoRoot, [
                'ls-remote', 'origin', 'refs/interlens/*',
            ]);
        }
        catch (err) {
            throw err; // propagate to poll() for failure counting
        }
        const remoteRefs = parseLsRemote(lsOutput);
        const changes = [];
        for (const [ref, newHash] of remoteRefs) {
            // Skip own ref
            if (ref === ownRef)
                continue;
            const oldHash = this.lastKnown.get(ref) ?? null;
            if (oldHash === newHash)
                continue; // no change
            // Something changed: fetch only this ref
            // Local namespace: refs/interlens/remote/<slug>
            const slug = ref.replace(/^refs\/interlens\//, '');
            const localRef = `refs/interlens/remote/${slug}`;
            // Use '+' prefix on the refspec to force-update the local tracking ref.
            // Snapshot commits are siblings (same parent HEAD), so they are never
            // fast-forwards of each other and would otherwise be rejected.
            await git(this.opts.repoRoot, [
                'fetch', 'origin',
                `+${ref}:${localRef}`,
            ]);
            this.lastKnown.set(ref, newHash);
            changes.push({ userEmail: '', ref, oldHash, newHash });
        }
        if (changes.length > 0 && this.onChange) {
            // Enrich with userEmail from the fetched snapshot
            for (const change of changes) {
                const slug = change.ref.replace(/^refs\/interlens\//, '');
                const localRef = `refs/interlens/remote/${slug}`;
                const snap = await (0, snapshot_1.fetchTeammateSnapshot)(this.opts.repoRoot, localRef);
                if (snap) {
                    change.userEmail = snap.userEmail;
                }
                else {
                    // If the commit message isn't valid JSON, derive email from slug
                    change.userEmail = slug.replace(/-at-/g, '@').replace(/-/g, '.');
                }
            }
            this.onChange(changes);
        }
    }
    // -------------------------------------------------------------------------
    // Test helpers (not part of SnapshotNotifier interface)
    // -------------------------------------------------------------------------
    /** For tests: reset state without stopping the timer. */
    _resetLastKnown() {
        this.lastKnown.clear();
    }
    get _isInBackoff() {
        return this.inBackoff;
    }
    get _consecutiveFailures() {
        return this.consecutiveFailures;
    }
    get _tickRunning() {
        return this.tickRunning;
    }
}
exports.GitPollingNotifier = GitPollingNotifier;
//# sourceMappingURL=git-polling.js.map