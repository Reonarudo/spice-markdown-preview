// Capture README screenshots from a real VS Code: the packaged VSIX is installed into a throwaway
// profile, examples/demo.md is opened beside its preview, and each frame is grabbed through
// Chromium's compositor via Playwright, so no OS screen-recording permission is needed.
//
// Usage: npm run package && node scripts/screenshots.mjs
// Requires .vscode-test/vscode-darwin-arm64-<version>/ from a previous `npm run test:extension`
// (or set VSCODE_EXECUTABLE to a VS Code Electron binary).
import { _electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** [file name, preview scroll offset in CSS pixels]. */
const FRAMES = [
  ['schematics', 0],
  ['caption-and-error', 560]
];
const WIDTH = 1357;
const HEIGHT = 768;

const vsix = (await readdir('.')).find((name) => name.endsWith('.vsix'));
if (!vsix) throw new Error('Run `npm run package` first.');
const electron = process.env.VSCODE_EXECUTABLE
  ?? (await readdir('.vscode-test')).filter((name) => name.startsWith('vscode-'))
    .map((name) => join('.vscode-test', name, 'Visual Studio Code.app/Contents/MacOS/Electron')).at(-1);
if (!electron) throw new Error('No VS Code found under .vscode-test; run `npm run test:extension` once.');
const cli = join(dirname(electron), '../Resources/app/bin/code');

const root = await mkdtemp(join(tmpdir(), 'screenshots-'));
const userData = join(root, 'user');
const extensions = join(root, 'extensions');
const workspace = join(root, 'workspace');
await mkdir(join(userData, 'User'), { recursive: true });
await mkdir(extensions);
await mkdir(workspace);
await cp('examples/demo.md', join(workspace, 'demo.md'));
await writeFile(join(userData, 'User', 'settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.tips.enabled': false,
  'breadcrumbs.enabled': false,
  'editor.minimap.enabled': false,
  'git.openRepositoryInParentFolders': 'never',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  execFileSync(cli, [`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--install-extension', resolve(vsix)],
    { env, stdio: 'inherit' });
  const app = await _electron.launch({
    executablePath: resolve(electron),
    env,
    args: [`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--skip-welcome', '--skip-release-notes',
      '--disable-updates', '--disable-workspace-trust', workspace, join(workspace, 'demo.md')]
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, size) => {
    const [window] = BrowserWindow.getAllWindows();
    window.setSize(size.width, size.height);
    window.center();
  }, { width: WIDTH, height: HEIGHT });
  await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
  await page.waitForTimeout(3000);
  // Hide the side bar so the editor and the preview share the window.
  await page.keyboard.press('Meta+B');
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget');
  await page.keyboard.type('Markdown: Open Preview to the Side');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  // Take the caret out of the editor, so nothing in the frame is highlighted.
  await page.keyboard.press('Meta+1');
  await page.keyboard.press('Meta+Home');
  await page.waitForTimeout(500);
  await mkdir('media/screenshots', { recursive: true });
  let scrolled = 0;
  for (const [file, offset] of FRAMES) {
    // Scroll the preview with the wheel, over its right-hand half of the window.
    await page.mouse.move(WIDTH * 0.75, HEIGHT / 2);
    await page.mouse.wheel(0, offset - scrolled);
    scrolled = offset;
    await page.waitForTimeout(1500);
    const png = join(root, `${file}.png`);
    await page.screenshot({ path: png });
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', String(WIDTH), png,
      '--out', join('media/screenshots', `${file}.jpg`)], { stdio: 'ignore' });
    console.log(`media/screenshots/${file}.jpg`);
  }
  await app.close();
} finally {
  await rm(root, { recursive: true, force: true });
}
