/**
 * cli.test.ts — Sub-Task 4: CLI Harness Verification
 *
 * Tests readLatestSnapshot (unit) and the full CLI main() path
 * (integration: spawns node out/cli.js with two real temp repos).
 *
 * Scenario: demo repo with the AuthResponse.userId → id rename.
 *   - Alice:    reads response.userId (old field name).
 *   - Bob:      renames userId → id in shared/types.ts.
 *   - Expected: CLI prints at least one semantic-conflict finding.
 *   - Expected: detail contains rename info OR tscError mentions userId.
 *
 * Each test uses actual temp git repos and real git commands.
 * No mocking.
 */
export {};
//# sourceMappingURL=cli.test.d.ts.map