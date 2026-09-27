/**
 * backend/auth.ts — demo Express auth router
 *
 * In Scenario A, Bob renames fields in AuthResponse and updates this file.
 * In Scenario B, Bob renames the route path from /api/auth/login to
 * /api/auth/signin, which InterLens detects as an endpoint mismatch.
 */

import type { AuthResponse } from '../shared/types';

// Minimal Express-style type stubs (no runtime dependency on express)
interface Request {
  body: { username: string; password: string };
}
interface Response {
  json(data: unknown): void;
  status(code: number): this;
}
interface Router {
  post(path: string, handler: (req: Request, res: Response) => void): void;
}
declare const router: Router;

router.post('/api/auth/login', (req: Request, res: Response) => {
  const response: AuthResponse = {
    userId: req.body.username,
    token: 'demo-jwt-token',
  };
  res.json(response);
});
