// Unpack the VSIX and run the real-host test against what is inside it, so what is verified is
// exactly what ships, and a file the `.vscodeignore` trims by mistake fails here rather than for
// users. Takes a VSIX path (e.g. a downloaded release asset); without one, the VSIX that
// `npm run package` wrote for this version.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const local = JSON.parse(await readFile('package.json', 'utf8'));
const file = resolve(process.argv[2] || `${local.name}-${local.version}.vsix`);
const unpacked = await mkdtemp(join(tmpdir(), 'spice-vsix-'));
try {
  execFileSync('unzip', ['-q', file, '-d', unpacked]);
  const root = join(unpacked, 'extension');
  const library = 'node_modules/@reonarudo/spice-renderer';
  for (const path of [
    'dist/extension.js', 'media/preview.css', 'media/icon.png', 'readme.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md',
    `${library}/package.json`, `${library}/dist/index.js`, `${library}/dist/worker.js`, `${library}/dist/skin/symbols.svg`,
    ...['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre', 'spectre-spice'].map((dialect) => `${library}/vendor/parsers/${dialect}.cjs`),
    `${library}/licenses/ELKJS-EPL-2.0.md`, `${library}/THIRD_PARTY_NOTICES.md`,
    'node_modules/elkjs/lib/elk.bundled.js', 'node_modules/elkjs/LICENSE.md',
    'node_modules/@xmldom/xmldom/lib/index.js', 'node_modules/@xmldom/xmldom/LICENSE'
  ]) assert.ok((await stat(join(root, path))).size > 0, path);
  assert.equal(execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').some(
    (name) => /^extension\/(src\/|test\/|scripts\/|examples\/|vendor\/|grammar\/|licenses\/)|\.d\.ts$|\.map$|elkjs\/lib\/(elk-worker|main)/.test(name)), false,
  'no sources, tests, top-level vendor, declarations, maps or unused elkjs builds');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.publisher, 'ReoX86');
  assert.equal(manifest.version, local.version);
  execFileSync(process.execPath, ['scripts/test-extension.mjs'], {
    stdio: 'inherit', env: { ...process.env, SPICE_EXTENSION_PATH: root }
  });
  console.log(`Packaged extension layout and real extension-host rendering: PASS (${(await stat(file)).size} bytes)`);
} finally {
  await rm(unpacked, { recursive: true, force: true });
}
