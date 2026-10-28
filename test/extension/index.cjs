// Runs inside a real VS Code (scripts/test-extension.mjs). Renders through the Markdown preview's
// own markdown-it via `markdown.api.render`, so every assertion sees what the preview would show.
//
// Every fence is prepared asynchronously (its netlist read, its included files loaded) before it
// is drawn, and a string rendered without a document shows the loading placeholder until then, so
// renders here wait until the output settles.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNP_ARROW = /<path d="m14,9 6,-1 -3,-5 z" class="detail"/;
const NPN_ARROW = /<path d="m23,29 -6,-1 3,-5 z" class="detail"/;
const SCHEMATIC = /<svg class="spice" width="\d+(?:\.\d+)?px" viewBox="/;
const LOADING = /<div class="spice-loading" role="status">Reading the netlist…<\/div>/;

const fence = (info, source) => '```' + info + '\n' + source + '\n```\n';
const mesh = Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('ReoX86.spice-schematic-preview');
  assert(extension, 'extension ReoX86.spice-schematic-preview is installed');
  assert.deepEqual(extension.packageJSON.contributes['markdown.previewStyles'], ['media/preview.css']);
  assert.deepEqual(extension.packageJSON.contributes['markdown.previewScripts'], ['media/preview.js']);
  await extension.activate();
  await vscode.extensions.getExtension('vscode.markdown-language-features').activate();
  const render = (markdown) => vscode.commands.executeCommand('markdown.api.render', markdown);
  const draw = (markdown, pattern = SCHEMATIC) => settled(render, markdown, pattern);

  // A string has no slot: it shows the placeholder until it is prepared, then draws.
  const first = fence('spice', 'V9 in 0 5\nR9 in out 10k');
  const loading = await render(first);
  assert.match(loading, LOADING);
  assert.match(loading, /<div class="spice-rendering"><div class="spice-loading" [\s\S]*?<\/div><pre><code class="language-spice" dir="auto">V9 in 0 5\nR9 in out 10k\n<\/code><\/pre>\n<\/div>/, 'the placeholder is wrapped and has its source view');
  await draw(first);

  // Schematics, and fences this extension must leave alone.
  const mixed = await settled(render, [
    fence('spice', 'V1 in 0 5\nR1 in out 10k\nC1 out 0 100n'),
    fence('spice', 'M1 out in vdd vdd pch\nM2 out in 0 0 nch\n.model nch NMOS\n.model pch PMOS'),
    fence('cir', 'R1 left alone 1k'),
    fence('graphviz', 'digraph { a -> b }'),
    fence('swift', 'let x = 42')
  ].join('\n'), /^(?![\s\S]*spice-loading)/);
  assert.equal((mixed.match(new RegExp(SCHEMATIC.source, 'g')) ?? []).length, 2);
  assert.match(mixed, />10k<\/text>/);
  assert.match(mixed, />pch<\/text>/);
  assert.match(mixed, /class="[^"]*\blanguage-cir"/);
  assert.match(mixed, /class="[^"]*\blanguage-graphviz"/);
  assert.match(mixed, /class="[^"]*\blanguage-swift"/);
  // The drawing paints itself; the stylesheet only adds the card.
  assert.match(mixed, /<svg class="spice" [^>]*fill="none" stroke="#000"/);

  // The view toggle's wrapper, and its source view delegated to VS Code's own fence rule: the
  // `<pre>` carries VS Code's shell (`dir="auto"`, not the plugin's hand-built fallback) minus
  // the scroll-sync class and line, which only the wrapper carries.
  assert.match(mixed, /<div class="spice-fence code-line" data-line="0" data-fence-key="[0-9a-f]{8}"><button type="button" class="spice-toggle" aria-pressed="false" aria-label="Source view" title="Source view"><svg class="spice-icon-code"/);
  assert.match(mixed, /<\/button><div class="spice-rendering"><svg class="spice" width="/);
  assert.match(mixed, /<\/div><pre><code class="language-spice" dir="auto">V1 in 0 5\nR1 in out 10k\nC1 out 0 100n\n<\/code><\/pre>\n<\/div>/);
  assert.match(mixed, /<\/div><pre><code class="language-spice" dir="auto">M1 out in vdd vdd pch\nM2 out in 0 0 nch\n\.model nch NMOS\n\.model pch PMOS\n<\/code><\/pre>\n<\/div>/);
  assert.equal((mixed.match(/<div class="spice-fence /g) ?? []).length, 2, 'one wrapper per claimed fence, none for delegated ones');
  assert.equal((mixed.match(/<pre><code class="language-spice" dir="auto">/g) ?? []).length, 2, 'no sync attributes on the source <code>');
  for (const line of ['0', '6']) assert.equal((mixed.match(new RegExp(`data-line="${line}"`, 'g')) ?? []).length, 1, `one scroll-sync element for the fence at line ${line}`);

  // Attributes, escaping and a tolerated typo; netlist text is escaped too.
  const attributed = await draw(fence('spice {alt="A divider" caption="Figure 1: <divider>" align="center" algin="x" class="wide"}', 'R1 in out <b>1k</b>\nR2 out 0 1k'), /<svg class="spice wide" width="/);
  assert.match(attributed, /<figure class="spice-figure spice-align-center"><div role="img" aria-label="A divider"><svg class="spice wide" width="/);
  assert.match(attributed, /<figcaption>Figure 1: &lt;divider&gt;<\/figcaption>/);
  assert.match(attributed, />&lt;b&gt;1k&lt;\/b&gt;<\/text>/);
  assert.doesNotMatch(attributed, /<b>/);

  // A netlist error quotes the line with a caret under its 1-based column; the rest of the document survives.
  const broken = await draw('Before\n\n' + fence('spice', 'R1 a b 1k\nQ1 a') + '\nAfter', /spice-error/);
  assert.match(broken, /<div class="spice-error" role="alert"><pre>Q1 needs 3 nodes; found 1\.\n\n2 │ Q1 a\n         \^<\/pre><\/div>/);
  assert.match(broken, /<p\b[^>]*>After<\/p>/);
  assert.match(broken, /<div class="spice-rendering"><div class="spice-error" role="alert">[\s\S]*?<\/div>\n<\/div><pre><code class="language-spice" dir="auto">R1 a b 1k\nQ1 a\n<\/code><\/pre>\n<\/div>/, 'the error card is wrapped and keeps its source view');

  // A circuit too dense to lay out times out promptly, and the next schematic still renders.
  const dense = fence('spice', mesh);
  assert.match(await render(dense), LOADING);
  await delay(500);
  const started = Date.now();
  assert.match(await draw(dense, /spice-error/), /Layout took longer than 3 s \(spice\.layoutTimeout\)/);
  assert.ok(Date.now() - started < 6000, 'timeout returns promptly');
  await draw(fence('spice', 'R1 a 0 1k'));

  // Raising the budget restarts the layout worker and retries the cached timeout.
  const configuration = vscode.workspace.getConfiguration('spice');
  assert.equal(configuration.get('layoutTimeout'), 3);
  await configuration.update('layoutTimeout', 60, vscode.ConfigurationTarget.Global);
  try {
    await settled(render, dense, SCHEMATIC, 300);
  } finally {
    await configuration.update('layoutTimeout', undefined, vscode.ConfigurationTarget.Global);
  }

  await includedFiles(render);
  await dialects(render);
};

/** The `dialect` attribute and the `spice.dialect` setting reach the renderer. */
async function dialects(render) {
  const draw = (markdown, pattern = SCHEMATIC) => settled(render, markdown, pattern);
  const configuration = vscode.workspace.getConfiguration('spice');
  assert.equal(configuration.get('dialect'), 'ngspice');
  assert.deepEqual(vscode.extensions.getExtension('ReoX86.spice-schematic-preview').packageJSON.contributes.configuration.properties['spice.dialect'].enum,
    ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre']);
  // Any case; an unknown name fails the fence, naming the six.
  await draw(fence('spice {dialect="NGspice"}', 'R1 a 0 1k'));
  assert.match(await draw(fence('spice {dialect="nope"}', 'R2 a 0 1k'), /spice-error/),
    /<pre>&quot;nope&quot; is not a SPICE dialect; use one of ngspice, ltspice, pspice, hspice, xyce, spectre<\/pre>/);
  // Each dialect is read by its own rules: in LTspice `$` is not a comment, so the `$G_VDD` node is
  // drawn and the resistor's second pin is connected rather than reported missing.
  const dollar = 'R1 $G_VDD out 1k\nR2 out 0 1k';
  await draw(fence('spice {dialect="ltspice"}', dollar));
  assert.match(await draw(fence('spice {dialect="ngspice"}', dollar), /spice-error/), /R1 needs 2 nodes; found 0/, 'in ngspice the $ starts a comment');
  // PSpice likewise keeps `$G_DPWR`, and reads a two-input NAND primitive with its supply pins.
  await draw(fence('spice {dialect="pspice"}', 'U1 NAND(2) $G_DPWR $G_DGND a b y D_00 IO_STD\nR1 a y 1k\nR2 b 0 1k'));
  // HSPICE: `GND!` is ground, a `$` after a number ends the value, and a three-node MOSFET draws.
  await draw(fence('spice {dialect="hspice"}', 'M1 out in GND! nch W=1u L=1u$no bulk\nR1 out vdd! 1k\nV1 vdd! 0 1.8\n.MODEL nch.1 NMOS'));
  // Xyce: an indented line is a comment, `gnd` is ground only under REPLACEGROUND, and a `Y<type> name` device draws as a block.
  await draw(fence('spice {dialect="xyce"}', '.PREPROCESS REPLACEGROUND TRUE\n   R9 a b 1k\nYMEMRISTOR mr1 in gnd mrm\nR1 $GVDD in 1k\nV1 $GVDD 0 1\n.MODEL mrm memristor'));
  // Spectre: `name (nodes) master param=value`, a model's `type=` deciding PNP, and a switch to SPICE mode and back.
  const spectre = await draw(fence('spice {dialect="spectre"}', 'Q1 (c b e) pnpm\nR1 (c vdd!) resistor r=1k\nsimulator lang=spice\nV1 vdd! 0 5\nsimulator lang=spectre\nmodel pnpm bjt type=pnp'));
  assert.match(spectre, PNP_ARROW, 'the model statement\'s type=pnp is read');
  assert.match(spectre, />pnpm<\/text>/);

  // The setting applies to every fence without an attribute; the attribute wins; a bad value reads as ngspice.
  const bare = fence('spice', 'R3 $G_VDD out 1k\nR4 out 0 1k');
  assert.match(await draw(bare, /spice-error/), /R3 needs 2 nodes; found 0/);
  await configuration.update('dialect', 'ltspice', vscode.ConfigurationTarget.Global);
  try {
    await draw(bare);
    assert.match(await draw(fence('spice {dialect="ngspice"}', 'R3 $G_VDD out 1k\nR4 out 0 1k'), /spice-error/), /R3 needs 2 nodes/, 'the attribute wins');
    await configuration.update('dialect', 'bogus', vscode.ConfigurationTarget.Global);
    assert.match(await draw(bare, /spice-error/), /R3 needs 2 nodes; found 0/);
  } finally {
    await configuration.update('dialect', undefined, vscode.ConfigurationTarget.Global);
  }
}

/** Render until what loads asynchronously has, and the output matches. */
async function settled(render, document, pattern, attempts = 100) {
  let html = '';
  for (let i = 0; i < attempts; i++) {
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
  assert.match(await render(good), LOADING, 'a new slot shows the placeholder');
  const html = await ready(good, PNP_ARROW);
  assert.match(html, />R7<\/text>/);
  assert.match(html, />4k7<\/text>/);

  // Editing the fence updates the drawing; until it is prepared, the slot keeps the old one rather
  // than flashing the placeholder.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(good.uri, new vscode.Range(0, 0, good.lineCount, 0), '```spice\n.include "models/q.lib"\n.inc stage.cir\nQ1 c b e Q\nR1 b 0 22k\n```\n');
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.doesNotMatch(await render(good), LOADING, 'the slot keeps its last drawing');
  await ready(good, />22k<\/text>/);
  assert.match(await render(good), />22k<\/text>/);
  await good.save();

  // A changed file is read again and the schematic follows it.
  await fs.writeFile(path.join(docs, 'models', 'q.lib'), '.model Q NPN\n');
  await ready(good, NPN_ARROW);

  // Missing, outside the workspace, and through a symlink: errors at the include, never a path.
  const missing = await ready(await write('missing.md', 'R1 a 0 1\n.include nowhere.lib'), /spice-error/);
  assert.match(missing, /nowhere\.lib could not be read: file not found\n\n2 │ \.include nowhere\.lib/);
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
    assert.match(symlink, /could not be read: symbolic links are not followed/);
  }

  // No document to resolve paths against: the include is an error, and says what to do.
  const unsaved = /models\/q\.lib could not be read: save the Markdown document in a workspace folder first\n\n1 │ \.include models\/q\.lib/;
  assert.match(await ready('```spice\n.include models/q.lib\nQ1 c b e Q\nR1 c 0 1\n```', /spice-error/), unsaved);
  const untitled = await vscode.workspace.openTextDocument({ language: 'markdown', content: '```spice\n.include models/q.lib\nQ1 c b e Q\nR1 c 0 1\n```' });
  assert.match(await ready(untitled, /spice-error/), unsaved);

  // The refresh command is contributed and runs.
  await vscode.commands.executeCommand('spice.refreshIncludes');
  await ready(good, NPN_ARROW);
}
