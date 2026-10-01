// Runs inside a real VS Code (scripts/test-extension.mjs). Renders through the Markdown preview's
// own markdown-it via `markdown.api.render`, so every assertion sees what the preview would show.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNP_ARROW = /<path d="m14,9 6,-1 -3,-5 z" class="detail"\/>/;
const NPN_ARROW = /<path d="m23,29 -6,-1 3,-5 z" class="detail"\/>/;

const fence = (info, source) => '```' + info + '\n' + source + '\n```\n';
const mesh = Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('ReoX86.spice-schematic-preview');
  assert(extension, 'extension ReoX86.spice-schematic-preview is installed');
  assert.deepEqual(extension.packageJSON.contributes['markdown.previewStyles'], ['media/preview.css']);
  await extension.activate();
  await vscode.extensions.getExtension('vscode.markdown-language-features').activate();
  const render = (markdown) => vscode.commands.executeCommand('markdown.api.render', markdown);

  // Schematics, and fences this extension must leave alone.
  const mixed = await render([
    fence('spice', 'V1 in 0 5\nR1 in out 10k\nC1 out 0 100n'),
    fence('spice', 'M1 out in vdd vdd pch\nM2 out in 0 0 nch\n.model nch NMOS\n.model pch PMOS'),
    fence('cir', 'R1 left alone 1k'),
    fence('graphviz', 'digraph { a -> b }'),
    fence('swift', 'let x = 42')
  ].join('\n'));
  assert.equal((mixed.match(/<svg class="spice"/g) ?? []).length, 2);
  assert.match(mixed, />10k<\/text>/);
  assert.match(mixed, />pch<\/text>/);
  assert.match(mixed, /class="[^"]*\blanguage-cir"/);
  assert.match(mixed, /class="[^"]*\blanguage-graphviz"/);
  assert.match(mixed, /class="[^"]*\blanguage-swift"/);

  // Attributes, escaping and a tolerated typo; netlist text is escaped too.
  const attributed = await render(fence('spice {alt="A divider" caption="Figure 1: <divider>" align="center" algin="x"}', 'R1 in out <b>1k</b>\nR2 out 0 1k'));
  assert.match(attributed, /<figure class="spice-figure spice-align-center"><div role="img" aria-label="A divider"><svg class="spice"/);
  assert.match(attributed, /<figcaption>Figure 1: &lt;divider&gt;<\/figcaption>/);
  assert.match(attributed, />&lt;b&gt;1k&lt;\/b&gt;<\/text>/);
  assert.doesNotMatch(attributed, /<b>/);

  // A netlist error quotes the line with a caret; the rest of the document survives.
  const broken = await render('Before\n\n' + fence('spice', 'R1 a b 1k\nQ1 a') + '\nAfter');
  assert.match(broken, /<div class="spice-error" role="alert"><pre>Q1 needs 3 nodes; found 1\.\n\n2 │ Q1 a\n         \^<\/pre><\/div>/);
  assert.match(broken, /<p\b[^>]*>After<\/p>/);

  // A circuit too dense to lay out times out promptly, and the next schematic still renders.
  const started = Date.now();
  assert.match(await render(fence('spice', mesh)), /Layout took longer than 3 s \(spice\.layoutTimeout\)/);
  assert.ok(Date.now() - started < 6000, 'timeout returns promptly');
  assert.match(await render(fence('spice', 'R1 a 0 1k')), /<svg class="spice"/);

  // The budget follows the setting live, and changing it retries a cached timeout.
  const configuration = vscode.workspace.getConfiguration('spice');
  assert.equal(configuration.get('layoutTimeout'), 3);
  await configuration.update('layoutTimeout', 60, vscode.ConfigurationTarget.Global);
  try {
    assert.match(await render(fence('spice', mesh)), /<svg class="spice"/);
  } finally {
    await configuration.update('layoutTimeout', undefined, vscode.ConfigurationTarget.Global);
  }

  await includedFiles(render);
  await dialects(render);
};

/** The `dialect` attribute and the `spice.dialect` setting reach the worker and the include reader. */
async function dialects(render) {
  const configuration = vscode.workspace.getConfiguration('spice');
  assert.equal(configuration.get('dialect'), 'ngspice');
  assert.deepEqual(vscode.extensions.getExtension('ReoX86.spice-schematic-preview').packageJSON.contributes.configuration.properties['spice.dialect'].enum,
    ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre']);
  // Any case; an unknown value is dropped and the fence still draws.
  assert.match(await render(fence('spice {dialect="NGspice"}', 'R1 a 0 1k')), /<svg class="spice"/);
  assert.match(await render(fence('spice {dialect="nope"}', 'R2 a 0 1k')), /<svg class="spice"/);
  // A dialect whose parser is not vendored yet proves the name travels: the worker reports it.
  // The host loads a dialect's parser at its first fence, so the first render may still be loading.
  const vendored = await fs.readdir(path.join(vscode.extensions.getExtension('ReoX86.spice-schematic-preview').extensionPath, 'vendor', 'parsers'));
  const missing = ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre'].find((dialect) => !vendored.includes(`${dialect}.cjs`));
  if (!missing) return;
  const failed = new RegExp(`<pre>The ${missing} parser could not be loaded: `);
  await settled(render, fence(`spice {dialect="${missing}"}`, 'R3 a 0 1k'), failed);
  // The setting applies to every fence without an attribute, and changing it redraws cached fences.
  assert.match(await render(fence('spice', 'R3 a 0 1k')), /<svg class="spice"/);
  await configuration.update('dialect', missing, vscode.ConfigurationTarget.Global);
  try {
    assert.match(await render(fence('spice', 'R3 a 0 1k')), failed);
    assert.match(await render(fence('spice {dialect="ngspice"}', 'R3 a 0 1k')), /<svg class="spice"/, 'the attribute wins');
  } finally {
    await configuration.update('dialect', undefined, vscode.ConfigurationTarget.Global);
  }
  assert.match(await render(fence('spice', 'R3 a 0 1k')), /<svg class="spice"/);
}

/** Render until what loads asynchronously — included files, a dialect's parser — has, and the output matches. */
async function settled(render, document, pattern) {
  let html = '';
  for (let i = 0; i < 100; i++) {
    html = await render(document);
    if (pattern.test(html)) return html;
    await delay(100);
  }
  assert.fail(`timed out waiting for ${pattern} in ${html.slice(0, 400)}`);
}

/** `.include` and `.lib` against real files in the trusted test workspace. */
async function includedFiles(render) {
  const root = process.env.SPICE_TEST_WORKSPACE;
  assert(root, 'the test workspace is set');
  assert(vscode.workspace.isTrusted, 'the test workspace is trusted');
  const docs = path.join(root, 'docs');
  const write = async (name, body) => {
    const file = path.join(docs, name);
    await fs.writeFile(file, '```spice\n' + body + '\n```\n');
    return vscode.workspace.openTextDocument(file);
  };
  const ready = (document, pattern) => settled(render, document, pattern);

  // An included model decides the transistor type; an included circuit's elements are drawn.
  const good = await write('good.md', '.include "models/q.lib"\n.inc stage.cir\nQ1 c b e Q\nR1 b 0 10k');
  assert.match(await render(good), /Reading included files…|<svg class="spice"/);
  const html = await ready(good, PNP_ARROW);
  assert.match(html, />R7<\/text>/);
  assert.match(html, />4k7<\/text>/);

  // Editing the fence updates the drawing. Initial file-create notifications can still
  // invalidate includes asynchronously, so wait for them before checking cache reuse.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(good.uri, new vscode.Range(0, 0, good.lineCount, 0), '```spice\n.include "models/q.lib"\n.inc stage.cir\nQ1 c b e Q\nR1 b 0 22k\n```\n');
  assert.ok(await vscode.workspace.applyEdit(edit));
  await ready(good, />22k<\/text>/);
  assert.match(await render(good), />22k<\/text>/);
  await good.save();

  // A changed file is read again and the schematic follows it.
  await fs.writeFile(path.join(docs, 'models', 'q.lib'), '.model Q NPN\n');
  await ready(good, NPN_ARROW);

  // Missing, outside the workspace, and through a symlink: errors at the include, never a path.
  const missing = await ready(await write('missing.md', 'R1 a 0 1\n.include nowhere.lib'), /spice-error/);
  assert.match(missing, /nowhere\.lib could not be read: the file does not exist\n\n2 │ \.include nowhere\.lib/);
  const outside = await ready(await write('outside.md', '.include ../../outside.lib\nR1 a 0 1'), /spice-error/);
  assert.match(outside, /could not be read: it is outside the Markdown document’s workspace folder/);
  assert.doesNotMatch(outside + missing, new RegExp(root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  let linked = false;
  try {
    await fs.symlink(path.join(docs, 'models', 'q.lib'), path.join(docs, 'link.lib'));
    linked = true;
  } catch {
    // Creating symlinks needs privileges on Windows; the check is covered on the other systems.
  }
  if (linked) {
    const symlink = await ready(await write('symlink.md', '.include link.lib\nR1 a 0 1'), /spice-error/);
    assert.match(symlink, /could not be read: symlinked paths are not followed/);
  }

  // No document to resolve paths against: the schematic draws without the file.
  assert.match(await render('```spice\n.include models/q.lib\nQ1 c b e Q\nR1 c 0 1\n```'), NPN_ARROW);
  const untitled = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```spice\n.include models/q.lib\nQ1 c b e Q\nR1 c 0 1\n```' });
  assert.match(await render(untitled), /<svg class="spice"/);

  // The refresh command is contributed and runs.
  await vscode.commands.executeCommand('spice.refreshIncludes');
  await ready(good, NPN_ARROW);
}
