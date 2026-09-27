// extension/esbuild.js
// Builds two bundles:
//   out/extension.js  — VS Code extension host entry point
//   out/worker.js     — Analysis child-process entry point
//
// Both are CommonJS. vscode is marked external (provided by VS Code at runtime).
// @interlens/core is inlined into both bundles so vsce package works without
// needing to resolve workspace symlinks.

const esbuild = require('esbuild');
const path = require('path');

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  // Resolve @interlens/core from the workspace
  alias: {
    '@interlens/core': path.resolve(__dirname, '../packages/core/src/index.ts'),
  },
  // esbuild resolves TypeScript natively
  loader: { '.ts': 'ts' },
};

async function build() {
  await Promise.all([
    esbuild.build({
      ...sharedConfig,
      entryPoints: [path.resolve(__dirname, 'src/extension.ts')],
      outfile: path.resolve(__dirname, 'out/extension.js'),
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: [path.resolve(__dirname, '../packages/core/src/worker-entry.ts')],
      outfile: path.resolve(__dirname, 'out/worker.js'),
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: [path.resolve(__dirname, '../packages/core/src/cli.ts')],
      outfile: path.resolve(__dirname, 'out/cli.js'),
    }),
  ]);
  console.log('esbuild: built out/extension.js, out/worker.js, out/cli.js');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
