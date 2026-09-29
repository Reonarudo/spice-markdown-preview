// Package the VSIX, unpack it, and run the real-host test against the unpacked artifact, so what
// is verified is exactly what ships.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

execFileSync('npm', ['run', 'package'], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const vsix = `${manifest.name}-${manifest.version}.vsix`;
const unpacked = await mkdtemp(join(tmpdir(), 'spice-vsix-'));
try {
  execFileSync('unzip', ['-q', vsix, '-d', unpacked]);
  execFileSync('node', ['scripts/test-extension.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, SPICE_EXTENSION_PATH: join(unpacked, 'extension') }
  });
} finally {
  await rm(unpacked, { recursive: true, force: true });
}
