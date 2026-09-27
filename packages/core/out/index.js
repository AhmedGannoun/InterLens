"use strict";
// @interlens/core — public barrel export
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCollisions = exports.clearCheckCache = exports.detectUnambiguousRename = exports.parseTscOutput = exports.diffErrors = exports.runCheck = exports.clearMaterialisedCache = exports.materializeTree = exports.tryMerge = exports.runAnalysis = exports.GitPollingNotifier = void 0;
__exportStar(require("./types"), exports);
__exportStar(require("./snapshot"), exports);
var git_polling_1 = require("./notifier/git-polling");
Object.defineProperty(exports, "GitPollingNotifier", { enumerable: true, get: function () { return git_polling_1.GitPollingNotifier; } });
var analysis_1 = require("./analysis");
Object.defineProperty(exports, "runAnalysis", { enumerable: true, get: function () { return analysis_1.runAnalysis; } });
var merge_1 = require("./engines/merge");
Object.defineProperty(exports, "tryMerge", { enumerable: true, get: function () { return merge_1.tryMerge; } });
Object.defineProperty(exports, "materializeTree", { enumerable: true, get: function () { return merge_1.materializeTree; } });
Object.defineProperty(exports, "clearMaterialisedCache", { enumerable: true, get: function () { return merge_1.clearMaterialisedCache; } });
var tsc_1 = require("./engines/tsc");
Object.defineProperty(exports, "runCheck", { enumerable: true, get: function () { return tsc_1.runCheck; } });
Object.defineProperty(exports, "diffErrors", { enumerable: true, get: function () { return tsc_1.diffErrors; } });
Object.defineProperty(exports, "parseTscOutput", { enumerable: true, get: function () { return tsc_1.parseTscOutput; } });
Object.defineProperty(exports, "detectUnambiguousRename", { enumerable: true, get: function () { return tsc_1.detectUnambiguousRename; } });
Object.defineProperty(exports, "clearCheckCache", { enumerable: true, get: function () { return tsc_1.clearCheckCache; } });
var collision_1 = require("./engines/collision");
Object.defineProperty(exports, "detectCollisions", { enumerable: true, get: function () { return collision_1.detectCollisions; } });
//# sourceMappingURL=index.js.map