/** @type {import('jest').Config} */
const config = {
  // Run against compiled JS — tsc compiles src (including __tests__) to out/
  // This avoids ts-jest dependency issues in npm workspaces on Windows.
  testEnvironment: 'node',
  roots: ['<rootDir>/out/__tests__'],
  testMatch: ['**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
  // Explicitly provide absolute paths for Jest internals to avoid the
  // jest-resolve absolute-path-resolution bug on Windows in npm workspaces.
  testRunner: require.resolve('jest-circus/runner'),
  testEnvironment: require.resolve('jest-environment-node'),
};

module.exports = config;
