// The view toggle's live run (docs/source-toggle-spec.md section 9.4): a real VS Code, launched
// through Playwright with this repo as the extension under development and a throwaway profile,
// opens examples/view-toggle.md beside its preview, and the assertions below reach into the
// preview iframe. Covers what the unit tests cannot: the script's DOM wiring, the patch updater,
// refresh, reopen and localStorage.
//
// Usage: npm run test:preview
// Requires .vscode-test/vscode-darwin-arm64-<version>/ from a previous `npm run test:extension`
// (or set VSCODE_EXECUTABLE to a VS Code Electron binary). This file is identical in every
// sibling repo apart from BASE and the fence positions in FIXTURE.
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = 'spice';
const FIXTURE = {
  file: 'examples/view-toggle.md',
  /** Claimed fences in the sample, in document order. */
  fences: 10,
  /** Positions of the two fences with identical bodies. */
  twins: [5, 6],
  /** A fence whose body the run edits, and a line inside that body (its text, searched for in the file). */
  edited: { position: 0, line: 'R1 in out 10k' }
};
const WIDTH = 1357;
const HEIGHT = 768;

// The Electron binary is `Code` from VS Code 1.10x on and `Electron` in older builds.
const electron = process.env.VSCODE_EXECUTABLE ?? await (async () => {
  // Newest build first, by version number: a 1.95.0 left by an older run sorts after 1.143.1 by name.
  const version = (name) => name.replace(/^.*-(\d+\.\d+\.\d+)$/, '$1').split('.').map(Number);
  const builds = (await readdir('.vscode-test').catch(() => [])).filter((name) => name.startsWith('vscode-'))
    .sort((a, b) => version(b).map((n, i) => n - version(a)[i]).find((d) => d !== 0) ?? 0);
  for (const build of builds) {
    const bin = join('.vscode-test', build, 'Visual Studio Code.app/Contents/MacOS');
    const name = (await readdir(bin).catch(() => [])).find((file) => file === 'Code' || file === 'Electron');
    if (name) return join(bin, name);
  }
  return undefined;
})();
if (!electron) throw new Error('No VS Code found under .vscode-test; run `npm run test:extension` once, or set VSCODE_EXECUTABLE.');

const root = await mkdtemp(join(tmpdir(), `${BASE}-preview-`));
const userData = join(root, 'user');
const extensions = join(root, 'extensions');
const workspace = join(root, 'workspace');
const document = join(workspace, 'view-toggle.md');
await mkdir(join(userData, 'User'), { recursive: true });
await mkdir(extensions);
await mkdir(workspace);
await cp(FIXTURE.file, document);
await writeFile(join(userData, 'User', 'settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.tips.enabled': false,
  'breadcrumbs.enabled': false,
  'editor.minimap.enabled': false,
  'editor.quickSuggestions': false,
  'editor.acceptSuggestionOnEnter': 'off',
  'files.autoSave': 'off',
  'git.openRepositoryInParentFolders': 'never',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({
  executablePath: resolve(electron),
  env,
  args: [`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, `--extensionDevelopmentPath=${resolve('.')}`,
    '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', workspace, document]
});
let passed = 0;
try {
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

  const command = async (name) => {
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget');
    await page.keyboard.type(name);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
  };
  const focusEditor = async () => {
    await page.keyboard.press('Meta+1');
    await page.waitForTimeout(300);
  };
  /** The preview's document, inside VS Code's webview iframes. Resolved afresh on every use, so a reopened preview is found. */
  const preview = () => page.frameLocator('iframe.webview.ready >> nth=-1').frameLocator('#active-frame');
  const fences = () => preview().locator(`.${BASE}-fence`);
  const toggles = () => preview().locator(`.${BASE}-toggle`);
  const state = () => fences().evaluateAll((all, base) => all.map((fence) => ({
    key: fence.dataset.fenceKey,
    view: fence.getAttribute('data-view'),
    pressed: fence.querySelector(`.${base}-toggle`).getAttribute('aria-pressed'),
    rendering: getComputedStyle(fence.querySelector(`:scope > .${base}-rendering`)).display,
    source: getComputedStyle(fence.querySelector(':scope > pre')).display
  })), BASE);
  const flippedPositions = async () => (await state()).map((fence, index) => (fence.view === 'source' ? index : -1)).filter((index) => index >= 0);
  const storageEntry = () => preview().locator('body').evaluate((_, base) => {
    const meta = document.getElementById('vscode-markdown-preview-data');
    const uri = JSON.parse(meta.dataset.settings).source;
    return window.localStorage.getItem(`${base}-markdown-preview.view-toggle:${uri}`);
  }, BASE);
  const waitForFences = async () => {
    await fences().nth(FIXTURE.fences - 1).waitFor({ timeout: 60000 });
    assert.equal(await fences().count(), FIXTURE.fences, 'claimed fences in the preview');
  };
  let sentinels = 0;
  /** Type a paragraph at the end of the editor and wait for the preview to patch it in. */
  const editElsewhere = async () => {
    const sentinel = `Edited ${++sentinels}.`;
    await focusEditor();
    // Go to Line clamps to the last line; Meta+End proved unreliable right after a preview click.
    await page.keyboard.press('Control+G');
    await page.waitForSelector('.quick-input-widget');
    await page.keyboard.type('999999');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type(sentinel);
    await preview().getByText(sentinel).waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
  };
  const check = (name) => {
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  };

  await focusEditor();
  await command('Markdown: Open Preview to the Side');
  await waitForFences();

  // 1. Every claimed fence carries the wrapper, the button and a hidden <pre>; the json fence has no button.
  for (const [index, fence] of (await state()).entries()) {
    assert.match(fence.key, /^[0-9a-f]{8}$/, `fence ${index} key`);
    assert.equal(fence.view, null, `fence ${index} starts in rendering view`);
    assert.equal(fence.pressed, 'false', `fence ${index} button not pressed`);
    assert.equal(fence.rendering, 'block', `fence ${index} rendering shown`);
    assert.equal(fence.source, 'none', `fence ${index} source hidden`);
  }
  assert.equal(await toggles().count(), FIXTURE.fences, 'one toggle per claimed fence');
  assert.equal(await preview().locator(`pre:has(> code.language-json) .${BASE}-toggle`).count(), 0, 'no toggle on the json fence');
  assert.equal(await preview().locator(`.${BASE}-fence pre > code.language-json`).count(), 0, 'json fence not wrapped');
  check('wrapper, button and hidden <pre> on every claimed fence; none on the json fence');

  // 2. A click flips; a second click reverts.
  await toggles().nth(0).click();
  let fence = (await state())[0];
  assert.deepEqual([fence.view, fence.pressed, fence.rendering, fence.source], ['source', 'true', 'none', 'block'], 'flipped');
  await toggles().nth(0).click();
  fence = (await state())[0];
  assert.deepEqual([fence.view, fence.pressed, fence.rendering, fence.source], [null, 'false', 'block', 'none'], 'reverted');
  check('a click flips the fence and a second click reverts it');

  // 3. The flip survives a patch update.
  await toggles().nth(1).click();
  await editElsewhere();
  assert.deepEqual(await flippedPositions(), [1]);
  check('a flip survives a patch update, and no other fence flips');

  // 4. Two identical bodies: the flipped one stays the flipped one.
  const [first, second] = FIXTURE.twins;
  assert.equal((await state())[first].key, (await state())[second].key, 'the twins share a key');
  await toggles().nth(second).click();
  await editElsewhere();
  assert.deepEqual(await flippedPositions(), [1, second]);
  check('of two identical bodies, the flipped one stays flipped');

  // 5. Editing the flipped body keeps the flip at the same position (index fallback).
  const { position, line } = FIXTURE.edited;
  const keyBefore = (await state())[position].key;
  await toggles().nth(position).click();
  const lines = (await readFile(FIXTURE.file, 'utf8')).split('\n');
  const lineNumber = lines.indexOf(line) + 1;
  assert.ok(lineNumber > 0, `fixture line ${JSON.stringify(line)}`);
  await focusEditor();
  await page.keyboard.press('Control+G');
  await page.waitForSelector('.quick-input-widget');
  await page.keyboard.type(String(lineNumber));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const until = async (condition, what) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await page.waitForTimeout(250);
    }
    assert.fail(what);
  };
  await until(async () => (await state())[position].key !== keyBefore, 'the preview re-rendered the edited fence');
  const keyAfter = (await state())[position].key;
  assert.notEqual(keyAfter, keyBefore, 'the edited body has a new key');
  assert.deepEqual(await flippedPositions(), [position, 1, second].sort((a, b) => a - b));
  check('editing a flipped body keeps the flip on the fence at the same position');

  // 6. Markdown: Refresh Preview reloads the whole preview; the flips come back from storage.
  const expected = [position, 1, second].sort((a, b) => a - b);
  await preview().locator('body').evaluate(() => { window.__probe = true; });
  await command('Markdown: Refresh Preview');
  await until(() => preview().locator('body').evaluate(() => !window.__probe).catch(() => false), 'the preview reloaded');
  await waitForFences();
  assert.deepEqual(await flippedPositions(), expected);
  check('flips survive Markdown: Refresh Preview');

  // 7. Close the preview and open it again.
  await page.keyboard.press('Meta+2');
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+W');
  await page.locator('iframe.webview.ready').last().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await focusEditor();
  await command('Markdown: Open Preview to the Side');
  await waitForFences();
  assert.deepEqual(await flippedPositions(), expected);
  check('flips survive closing and reopening the preview');

  // 8. Flipping everything back clears the document's storage entry.
  assert.ok(await storageEntry(), 'storage holds the flipped fences');
  for (const index of expected) await toggles().nth(index).click();
  assert.deepEqual(await flippedPositions(), []);
  assert.equal(await storageEntry(), null, 'storage entry removed');
  check('flipping everything back removes the localStorage entry');

  console.log(`\n${passed} live checks passed`);
} catch (error) {
  await app.firstWindow().then((page) => page.screenshot({ path: join(process.cwd(), 'test-preview-failure.png') })).catch(() => {});
  console.error(`\nFailed after ${passed} live checks; see test-preview-failure.png`);
  throw error;
} finally {
  await app.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
