/** @type {import('jest').Config} */
const config = {
  // Jest runs from the workspace root.
  // Tests are compiled TypeScript in packages/core/out/__tests__/
  testEnvironment: 'node',
  roots: ['<rootDir>/packages/core/out/__tests__'],
  testMatch: ['**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
};

module.exports = config;
