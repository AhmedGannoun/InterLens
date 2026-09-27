"use strict";
/**
 * template.ts — "none" ExplanationProvider
 *
 * Returns finding.detail formatted as markdown with no network call.
 * Used when the provider setting is "none" or as a fallback.
 * No vscode imports allowed in this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateProvider = void 0;
class TemplateProvider {
    constructor() {
        this.id = 'none';
    }
    async explain(input, _signal) {
        const { finding } = input;
        const markdown = [
            `**${finding.description}**`,
            '',
            finding.detail,
            '',
            `*Teammate: ${finding.teammateName} (${finding.teammateEmail})*`,
            `*Files: \`${finding.myFile}\` ↔ \`${finding.theirFile}\`*`,
        ].join('\n');
        return { markdown, fromCache: false };
    }
    async testConnection() {
        // No network — always succeeds.
        return { ok: true };
    }
}
exports.TemplateProvider = TemplateProvider;
//# sourceMappingURL=template.js.map