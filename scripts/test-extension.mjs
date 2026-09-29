// Run test/extension/index.cjs inside a real VS Code, isolated from the user's profile.
// SPICE_EXTENSION_PATH points at the extension to load (default: this repo);
// VSCODE_EXECUTABLE uses a local VS Code instead of downloading one.
import { runTests } from '@vscode/test-electron';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'spice-host-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
try {
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE
      ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE }
      : { version: process.env.VSCODE_VERSION ?? 'stable' }),
    extensionDevelopmentPath: resolve(process.env.SPICE_EXTENSION_PATH ?? '.'),
    extensionTestsPath: resolve('test/extension/index.cjs'),
    extensionTestsEnv: { SPICE_TEST_WORKSPACE: workspace },
    launchArgs: [workspace, `--user-data-dir=${join(root, 'user')}`, `--extensions-dir=${join(root, 'extensions')}`,
      '--skip-welcome', '--skip-release-notes', '--disable-updates']
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
