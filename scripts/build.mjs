import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

// A clean `dist/`, so a VSIX never carries a file an older build left behind.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/extension.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // `vscode` is provided by the host. The renderer library is not bundled: it ships installed in
  // the VSIX's `node_modules`, where its worker, parsers and symbols sit where it expects them
  // (ADR 0010).
  external: ['vscode', '@reonarudo/spice-renderer'],
  sourcemap: false
});
