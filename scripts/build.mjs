import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/extension.ts', 'src/worker.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // `vscode` is provided by the host. ELK, xmldom and the symbol file are bundled into
  // `worker.js`, so the packaged extension ships no node_modules (see THIRD_PARTY_NOTICES.md).
  external: ['vscode'],
  loader: { '.svg': 'text' },
  // esbuild reprints the already-minified ELK in expanded form, doubling it to 3.6 MB. Removing
  // whitespace alone brings it back to 1.8 MB and keeps identifiers readable in stack traces.
  minifyWhitespace: true,
  sourcemap: false
});
