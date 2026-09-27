/**
 * frontend/login.ts — demo frontend login handler
 *
 * In Scenario A, Alice adds code that reads `response.userId` and
 * `response.token`. After Bob renames these fields, Alice's tsc passes
 * locally (she hasn't seen Bob's shared/types.ts change) but fails in
 * the merged tree — InterLens reports a semantic-conflict.
 *
 * In Scenario B, Alice adds a fetch to /api/auth/login while Bob renames
 * the route to /api/auth/signin — InterLens reports an endpoint-mismatch.
 */

import type { AuthResponse } from '../shared/types';

async function handleLogin(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: { 'Content-Type': 'application/json' },
  });
  const response: AuthResponse = await res.json() as AuthResponse;
  console.log('Logged in as', response.token);
}
