/**
 * types.test.ts — Sub-Task 1
 *
 * Strategy: TypeScript interfaces cannot be tested at runtime with typeof checks,
 * but we can:
 *  1. Construct concrete objects that satisfy each interface and let the compiler
 *     enforce completeness (any missing required field is a compile-time error).
 *  2. Use expect().toMatchObject / deep-equality to verify the shapes are stable
 *     at runtime (guards against accidental structural changes).
 *  3. Test the union literal types to confirm only allowed string values compile.
 */
export {};
//# sourceMappingURL=types.test.d.ts.map