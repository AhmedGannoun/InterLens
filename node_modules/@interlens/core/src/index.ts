// @interlens/core — public barrel export

export * from './types';
export * from './snapshot';
export { GitPollingNotifier } from './notifier/git-polling';
export type { GitPollingNotifierOptions } from './notifier/git-polling';
export { runAnalysis } from './analysis';
export { tryMerge, materializeTree, clearMaterialisedCache } from './engines/merge';
export { runCheck, diffErrors, parseTscOutput, detectUnambiguousRename, clearCheckCache } from './engines/tsc';
export { detectCollisions } from './engines/collision';
