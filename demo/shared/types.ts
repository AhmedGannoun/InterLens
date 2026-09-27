/**
 * shared/types.ts — demo shared type definitions
 *
 * This file is intentionally modified by Bob in Scenario A to rename
 * `userId` → `id` and `token` → `accessToken`, which is the breaking
 * change InterLens detects as a semantic conflict.
 */

export interface AuthResponse {
  userId: string;
  token: string;
}
