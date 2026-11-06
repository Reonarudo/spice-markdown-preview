import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { markdownPlugin } from '../src/markdown';
import type { BomRow, RenderResult } from '@reonarudo/spice-renderer';
import { bom, rendering } from './helpers';

const schematic = (output = '<svg class="spice" viewBox="4 4 48 101"></svg>', rows: BomRow[] = []): RenderResult => ({ status: 'success', output, bom: rows, notes: [] });
const SIZED = '<svg class="spice" width="48px" viewBox="4 4 48 101"></svg>';

const ICON_CODE = '<svg class="spice-icon-code" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
  '<path d="M5.7 3.3 1 8l4.7 4.7.9-.9L2.8 8l3.8-3.8zM10.3 3.3l-.9.9L13.2 8l-3.8 3.8.9.9L15 8z"/></svg>';
const ICON_GRAPH = '<svg class="spice-icon-graph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">' +
  '<rect x="1.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="5.5" y="11" width="5" height="3.5" rx=".5"/>' +
  '<path d="M4 5v3h8V5M8 8v3"/></svg>';
const TOGGLE = `<button type="button" class="spice-toggle" aria-pressed="false" aria-label="Source view" title="Source view">${ICON_CODE}${ICON_GRAPH}</button>`;
const ICON_LIST = '<svg class="spice-icon-list" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">' +
  '<circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none"/>' +
  '<path d="M5.5 4h9M5.5 8h9M5.5 12h9"/></svg>';
const BOM_BUTTON = `<button type="button" class="spice-bom-button" aria-pressed="false" aria-label="BOM view" title="BOM view">${ICON_LIST}${ICON_GRAPH}</button>`;
const BUTTONS = BOM_BUTTON + TOGGLE;
const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>\n';
const empty = (text: string) => `<div class="spice-bom-empty">${text}</div>`;
const BOM_LOADING = '<div class="spice-bom-empty" role="status">Reading the netlist…</div>';
const NO_PARTS = empty('No parts.');
const NOT_READ = empty('The netlist did not read, so there are no parts.');
const NOT_RUNNING = empty('The schematic renderer is not running, so there are no parts.');
const slot = (content: string, style = 'plain') => `<div class="spice-bom spice-bom-${style}">${content}</div>`;

test('claims exactly spice fences and passes the netlist through', () => {
  let seen = '';
  const md = markdownPlugin(new MarkdownIt(), (source) => { seen = source; return schematic(); });
  assert.match(md.render('```spice\nR1 a 0 1k\n```'), /<svg class="spice"/);
  assert.equal(seen, 'R1 a 0 1k\n');
});

test('the fence rule hands the checked attributes to the renderer, dialect included', () => {
  const given: unknown[] = [];
  const md = markdownPlugin(new MarkdownIt(), (_source, env, attributes) => { given.push(env, attributes); return schematic(); });
  md.render('```spice {dialect="XYCE" alt="x"}\nR1 a 0 1k\n```', { document: 'demo.md' });
  md.render('```spice {dialect="nope"}\nR1 a 0 1k\n```');
  assert.deepEqual(given, [{ document: 'demo.md' }, { dialect: 'XYCE', alt: 'x' }, {}, { dialect: 'nope' }]);
});

test('preserves unrelated fences byte for byte including highlighting', () => {
  for (const language of ['cir', 'SPICE', 'spice extra', 'ngspice', 'netlist', 'graphviz', 'smiles', 'swift', '']) {
    const input = '```' + language + '\nR1 a 0 1k\n```';
    const options = { highlight: () => '<b>highlight</b>' };
    const delegated = markdownPlugin(new MarkdownIt(options), () => { throw new Error('wrong fence'); });
    assert.equal(delegated.render(input), new MarkdownIt(options).render(input), language);
  }
});

test('a previously registered fence renderer still receives its fences, and supplies the source view of ours', () => {
  const md = new MarkdownIt();
  md.renderer.rules.fence = () => '<div class="other-extension"></div>';
  markdownPlugin(md, () => schematic());
  assert.equal(md.render('```smiles\nCCO\n```'), '<div class="other-extension"></div>');
  const html = md.render('```spice\nR1 a 0 1\n```');
  assert.match(html, /<svg class="spice"/);
  assert.match(html, /<\/div><div class="other-extension"><\/div><\/div>\n$/);
});

// The DOM contract (docs/source-toggle-spec.md in onnx-markdown-preview, section 2): asserted
// exactly once, here.
// Amended for SPICE by docs/bom-view-spec.md section 5: five children.
test('every claimed fence is wrapped: BOM button, toggle, rendering slot, BOM slot, then the delegated source <pre>', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.equal(md.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${BUTTONS}` +
    `<div class="spice-rendering">${SIZED}</div>${slot(NO_PARTS)}` +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
});

test('the wrapper carries code-line and data-line from the token map, and neither without a map', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  const tokens = md.parse('# Title\n\n```spice\nR1 a 0 1\n```', {});
  assert.match(md.renderer.render(tokens, md.options, {}), /<div class="spice-fence code-line" data-line="2" data-fence-key="997d4f82">/);
  for (const token of tokens) token.map = null;
  const bare = md.renderer.render(tokens, md.options, {});
  assert.match(bare, /<div class="spice-fence" data-fence-key="997d4f82">/);
  assert.doesNotMatch(bare, /data-line/);
});

test('the fence key is FNV-1a of the exact body', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.match(md.render('```spice\nR1 a 0 1\n```'), /data-fence-key="997d4f82"/);
  assert.match(md.render('```spice\n```'), /data-fence-key="811c9dc5"/);
  // The info string and attributes play no part: same body, same key.
  assert.match(md.render('```spice {caption="c" dialect="xyce"}\nR1 a 0 1\n```'), /data-fence-key="997d4f82"/);
  assert.match(md.render('```spice\nR1 a 0 1 \n```'), /data-fence-key="5003caba"/);
});

test('the source <pre> is the delegated fence rule output, with VS Code-style highlighting kept verbatim', () => {
  const highlighted = markdownPlugin(new MarkdownIt({ highlight: (code, lang) => `<i class="${lang}">${code.trim()}</i>` }), () => schematic());
  assert.match(highlighted.render('```spice {alt="x"}\nR1 a 0 1\n```'), /<\/div><pre><code class="language-spice"><i class="spice">R1 a 0 1<\/i><\/code><\/pre>\n<\/div>\n$/);
  // VS Code's shell keeps its highlighting and `dir`, but not the scroll-sync class and line,
  // which the wrapper carries for the whole fence.
  const vscode = new MarkdownIt();
  vscode.renderer.rules.fence = (tokens, index) =>
    `<pre><code data-line="${tokens[index]!.map![0]}" class="code-line language-spice" dir="auto">${tokens[index]!.content}</code></pre>\n`;
  markdownPlugin(vscode, () => schematic());
  assert.match(vscode.render('```spice\nR1 a 0 1\n```'), /<\/div><pre><code class="language-spice" dir="auto">R1 a 0 1\n<\/code><\/pre>\n<\/div>\n$/);
  // Bare markdown-it with no fence rule at all: a hand-built, escaped fallback.
  const md = new MarkdownIt();
  delete md.renderer.rules.fence;
  markdownPlugin(md, () => schematic());
  assert.match(md.render('```spice\nR1 a <b>0</b> 1\n```'), /<\/div><pre><code class="language-spice">R1 a &lt;b&gt;0&lt;\/b&gt; 1\n<\/code><\/pre>\n<\/div>\n$/);
});

test('the source view shows the fence as written: an include stays an include line', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.match(md.render('```spice\n.include models.lib\nQ1 c b e Q\n```'), /<\/div><pre><code class="language-spice">\.include models\.lib\nQ1 c b e Q\n<\/code><\/pre>\n<\/div>\n$/);
});

test('an error card, a throwing renderer and the loading placeholder are wrapped like a schematic', () => {
  const failed = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'bad' }));
  assert.equal(failed.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${BUTTONS}` +
    '<div class="spice-rendering"><div class="spice-error" role="alert"><pre>bad</pre></div>\n</div>' + slot(NOT_READ) +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
  const threw = markdownPlugin(new MarkdownIt(), () => { throw new Error('boom'); });
  assert.equal(threw.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${BUTTONS}` +
    '<div class="spice-rendering"><div class="spice-error" role="alert"><pre>The schematic renderer failed: boom</pre></div>\n</div>' + slot(NOT_RUNNING) +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
  const loading = markdownPlugin(new MarkdownIt(), () => undefined);
  assert.equal(loading.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${BUTTONS}` +
    `<div class="spice-rendering">${LOADING}</div>${slot(BOM_LOADING)}` +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
});

test('a slot caches the rendering and the BOM: an edited fence keeps the old drawing and table but shows its new body in source view', () => {
  let next: RenderResult | undefined = schematic('<svg class="spice"><text>old</text></svg>', [{ type: 'resistor', name: 'resistor', value: '1', references: [{ ref: 'R1', line: 1 }] }]);
  const md = markdownPlugin(new MarkdownIt(), () => next);
  const env = { currentDocument: { toString: () => 'a.md' } };
  md.render('```spice\nR1 a 0 1\n```', env);
  next = undefined;
  const html = md.render('```spice\nR1 a 0 1k\n```', env);
  assert.equal(html,
    `<div class="spice-fence code-line" data-line="0" data-fence-key="129600ed">${BUTTONS}` +
    '<div class="spice-rendering"><svg class="spice"><text>old</text></svg></div>' +
    slot('<p class="spice-bom-summary" dir="auto">1 part in 1 row</p><table class="spice-bom-table"><thead><tr>' +
      '<th scope="col" class="spice-bom-qty">Qty</th><th scope="col">References</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead><tbody>' +
      '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">R1</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">1</td></tr>' +
      '</tbody></table>') +
    '<pre><code class="language-spice">R1 a 0 1k\n</code></pre>\n</div>\n');
});

test('missing fence renderer falls back without throwing', () => {
  const md = new MarkdownIt();
  delete md.renderer.rules.fence;
  const expected = md.render('```swift\n42\n```');
  markdownPlugin(md, () => schematic());
  assert.equal(md.render('```swift\n42\n```'), expected);
});

test('a bare fence emits the schematic unwrapped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.equal(rendering(md.render('```spice\nR1 a 0 1\n```')), SIZED);
});

test('alt becomes an accessible name, caption a figure, align a class', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  const html = md.render('```spice {alt="A divider" caption="Figure 1" align="center"}\nR1 a 0 1\n```');
  assert.equal(rendering(html), '<figure class="spice-figure spice-align-center"><div role="img" aria-label="A divider">' + SIZED + '</div><figcaption>Figure 1</figcaption></figure>');
});

test('class lands on the root svg beside the base class, escaped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.equal(rendering(md.render('```spice {class="wide &quot;x\\" onload=\\"y"}\nR1 a 0 1\n```')),
    '<svg class="spice wide &amp;quot;x&quot; onload=&quot;y" width="48px" viewBox="4 4 48 101"></svg>');
});

test('attribute text is escaped, including quotes, markup and Markdown', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  const html = md.render('```spice {alt="<img src=x onerror=alert(1)>" caption="**bold** & \\"quoted\\""}\nR1 a 0 1\n```');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /aria-label="&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /<figcaption>\*\*bold\*\* &amp; &quot;quoted&quot;<\/figcaption>/);
});

test('malformed attributes are reported, never shown, and the schematic still renders', () => {
  const reported: string[] = [];
  const md = markdownPlugin(new MarkdownIt(), () => schematic(), (m) => reported.push(m));
  assert.equal(rendering(md.render('```spice {alt="unterminated}\nR1 a 0 1\n```')), SIZED);
  assert.equal(reported.length, 1);
});

const fence = (source: string) => '# Before\n```spice\n' + source + '\n```\nAfter';

test('a netlist error quotes its line with a caret under the column, and the document continues', () => {
  const md = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'Q1 needs 3 nodes; found 1.', line: 2, column: 6 }));
  const html = md.render(fence('R1 a b 1k\nQ1 a'));
  assert.match(html, /<div class="spice-error" role="alert"><pre>Q1 needs 3 nodes; found 1\.\n\n2 │ Q1 a\n         \^<\/pre><\/div>/);
  assert.match(html, /<p>After<\/p>/);
});

test('an error with no line, or a line outside the fence, shows the message only; text is escaped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'bad <b>thing</b>', line: 9, column: 1 }));
  assert.match(md.render(fence('R1 a 0 1')), /<pre>bad &lt;b&gt;thing&lt;\/b&gt;<\/pre>/);
  const noLine = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'The netlist exceeds the 64 KB limit.' }));
  assert.match(noLine.render(fence('R1 a 0 1')), /<pre>The netlist exceeds the 64 KB limit\.<\/pre>/);
});

test('a timeout and an unavailable renderer have fixed wording', () => {
  const timeout = markdownPlugin(new MarkdownIt(), () => ({ status: 'timeout', budget: 3000 }));
  assert.match(timeout.render(fence('R1 a 0 1')),
    /<pre>Layout took longer than 3 s \(spice\.layoutTimeout\)\. Split the circuit into several fences, or raise the limit\.<\/pre>/);
  const unavailable = markdownPlugin(new MarkdownIt(), () => ({ status: 'unavailable', reason: 'out of <memory>' }));
  assert.match(unavailable.render(fence('R1 a 0 1')),
    /<pre>The schematic renderer could not start: out of &lt;memory&gt;\. It will retry on the next render\.<\/pre>/);
});

test('a caret sits under the 1-based column', () => {
  const md = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'bad', line: 1, column: 4 }));
  assert.match(md.render(fence('R1 a 0 1')), /<pre>bad\n\n1 │ R1 a 0 1\n {7}\^<\/pre>/);
});

test('a schematic without a viewBox is left unsized', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic('<svg class="spice"></svg>'));
  assert.equal(rendering(md.render('```spice\nR1 a 0 1\n```')), '<svg class="spice"></svg>');
});

test('a throwing renderer degrades its fence alone, and is reported', () => {
  const reported: string[] = [];
  const md = markdownPlugin(new MarkdownIt(), () => { throw new TypeError('not prepared'); }, (m) => reported.push(m));
  const html = md.render(fence('R1 a 0 1'));
  assert.match(html, /<div class="spice-error" role="alert"><pre>The schematic renderer failed: not prepared<\/pre><\/div>/);
  assert.match(html, /<p>After<\/p>/);
  assert.deepEqual(reported, ['SPICE render failed: not prepared']);
});

test('a fence not ready yet keeps its slot\'s last drawing; a new slot or a document-less render shows the placeholder', () => {
  let next: RenderResult | undefined = schematic();
  const md = markdownPlugin(new MarkdownIt(), () => next);
  const env = (name: string) => ({ currentDocument: { toString: () => name } });
  const two = '```spice\nR1 a 0 1\n```\n\n```spice\nR2 a 0 1\n```';
  // Counted on the schematic's own class: the buttons ship SVG glyphs too.
  assert.equal((md.render(two, env('a.md')).match(/<svg class="spice"/g) ?? []).length, 2);
  next = undefined;
  assert.equal((md.render(two, env('a.md')).match(/<svg class="spice"/g) ?? []).length, 2, 'both slots keep their drawing');
  assert.match(md.render(two, env('b.md')), /^<div class="spice-fence [^>]*><button [\s\S]*?<\/button><button [\s\S]*?<\/button><div class="spice-rendering"><div class="spice-loading" role="status">Reading the netlist…<\/div>/, 'another document has its own slots');
  assert.match(md.render(two), /spice-loading/, 'no document, no slot');
  next = { status: 'failure', message: 'bad' };
  md.render(two, env('a.md'));
  next = undefined;
  assert.match(md.render(two, env('a.md')), /spice-error/, 'an error is remembered like a drawing');
});

// The BOM view (docs/bom-view-spec.md sections 3.5, 4 and 8).

const reference = (ref: string, line: number, file?: string) => (file ? { ref, line, file } : { ref, line });
const BRIDGE: BomRow[] = [
  { type: 'vsource', name: 'voltage source', value: 'SIN(0 12 50)', references: [reference('VAC', 1)] },
  { type: 'diode', name: 'diode', value: '1N4007', references: [reference('D1', 2), reference('D2', 3), reference('D3', 4), reference('D4', 5)] },
  { type: 'capacitor', name: 'capacitor', value: '1000u', references: [reference('C1', 6)] },
  { type: 'resistor', name: 'resistor', value: '1k', references: [reference('RL', 7)] }
];
const INCLUDES: BomRow[] = [
  { type: 'resistor', name: 'resistor', value: '4k7', references: [reference('R7', 1, 'included/stage.cir')] },
  { type: 'subcircuit', name: 'subcircuit', title: 'LM358', value: '', references: [reference('X1', 2)] },
  { type: 'resistor', name: 'resistor', value: '1k m=2', references: [reference('R1', 3)] },
  { type: 'resistor', name: 'resistor', value: '1k', references: [reference('R2', 4)] }
];
const HEAD = '<th scope="col" class="spice-bom-qty">Qty</th><th scope="col">References</th><th scope="col">Type</th><th scope="col">Value</th>';

test('the BOM button: list and graph glyphs, a constant label, before the toggle', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.ok(md.render('```spice\nR1 a 0 1\n```').includes(`data-fence-key="997d4f82">${BOM_BUTTON}${TOGGLE}<div class="spice-rendering">`));
});

test('the BOM table: a summary, one row per BOM row, quantity right-aligned, no File column without files', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic(undefined, BRIDGE));
  assert.equal(bom(md.render('```spice\nVAC ac1 ac2 SIN(0 12 50)\n```')),
    '<p class="spice-bom-summary" dir="auto">7 parts in 4 rows</p>' +
    `<table class="spice-bom-table"><thead><tr>${HEAD}</tr></thead><tbody>` +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">VAC</td><td class="spice-bom-type">voltage source</td><td class="spice-bom-value">SIN(0 12 50)</td></tr>' +
    '<tr><td class="spice-bom-qty">4</td><td class="spice-bom-refs">D1, D2, D3, D4</td><td class="spice-bom-type">diode</td><td class="spice-bom-value">1N4007</td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">C1</td><td class="spice-bom-type">capacitor</td><td class="spice-bom-value">1000u</td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">RL</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">1k</td></tr>' +
    '</tbody></table>');
});

test('the File column appears when a row names a file; a title leads the Value; an empty tail with a title is the title alone', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic(undefined, INCLUDES));
  assert.equal(bom(md.render('```spice\nX1 a b LM358\n```')),
    '<p class="spice-bom-summary" dir="auto">4 parts in 4 rows</p>' +
    `<table class="spice-bom-table"><thead><tr>${HEAD}<th scope="col">File</th></tr></thead><tbody>` +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">R7</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">4k7</td><td class="spice-bom-file">included/stage.cir</td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">X1</td><td class="spice-bom-type">subcircuit</td><td class="spice-bom-value">LM358</td><td class="spice-bom-file"></td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">R1</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">1k m=2</td><td class="spice-bom-file"></td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">R2</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">1k</td><td class="spice-bom-file"></td></tr>' +
    '</tbody></table>');
  const titled = markdownPlugin(new MarkdownIt(), () => schematic(undefined, [
    { type: 'vcvs', name: 'voltage-controlled voltage source', title: 'VCVS', value: '100k', references: [reference('E1', 1)] },
    { type: 'resistor', name: 'resistor', value: '', references: [reference('R1', 2, 'a.cir'), reference('R2', 3), reference('R3', 4, 'b.cir'), reference('R4', 5, 'a.cir')] }
  ]));
  const html = bom(titled.render('```spice\nE1 a 0 b 0 100k\n```'));
  assert.match(html, /<td class="spice-bom-value">VCVS 100k<\/td>/);
  assert.match(html, /<td class="spice-bom-refs">R1, R2, R3, R4<\/td><td class="spice-bom-type">resistor<\/td><td class="spice-bom-value"><\/td><td class="spice-bom-file">a\.cir, b\.cir<\/td>/);
  assert.match(html, /<p class="spice-bom-summary" dir="auto">5 parts in 2 rows<\/p>/);
});

test('the opamp example: a subcircuit\'s title alone is its Value, and the supplies merge', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic(undefined, [
    { type: 'vsource', name: 'voltage source', value: 'SIN(0 1 1k)', references: [reference('V1', 1)] },
    { type: 'subcircuit', name: 'subcircuit', title: 'opamp', value: '', references: [reference('X1', 2), reference('X2', 5)] },
    { type: 'resistor', name: 'resistor', value: '10k', references: [reference('R1', 3), reference('RL', 6)] },
    { type: 'resistor', name: 'resistor', value: '47k', references: [reference('R2', 4)] },
    { type: 'vsource', name: 'voltage source', value: '15', references: [reference('VCC', 7), reference('VEE', 8)] }
  ]));
  const html = bom(md.render('```spice\nX1 in mid vcc vee mid opamp\n```'));
  assert.match(html, /<p class="spice-bom-summary" dir="auto">8 parts in 5 rows<\/p>/);
  assert.match(html, /<tr><td class="spice-bom-qty">2<\/td><td class="spice-bom-refs">X1, X2<\/td><td class="spice-bom-type">subcircuit<\/td><td class="spice-bom-value">opamp<\/td><\/tr>/);
  assert.match(html, /<tr><td class="spice-bom-qty">2<\/td><td class="spice-bom-refs">VCC, VEE<\/td><td class="spice-bom-type">voltage source<\/td><td class="spice-bom-value">15<\/td><\/tr>/);
  assert.doesNotMatch(html, /File/);
});

test('the summary uses singulars at one', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic(undefined, [BRIDGE[1]!]));
  assert.match(bom(md.render('```spice\nD1 a 0 D\n```')), /^<p class="spice-bom-summary" dir="auto">4 parts in 1 row<\/p>/);
});

test('every cell is text: markup in references, values, types and files is escaped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic(undefined, [
    { type: 'x', name: '<i>t</i>', title: '<u>', value: '<b>1k</b>', references: [reference('<R1>', 1, '<f>.cir')] }
  ]));
  const html = bom(md.render('```spice\nR1 a 0 1\n```'));
  assert.doesNotMatch(html, /<b>|<i>|<u>|<R1>|<f>/);
  assert.match(html, /&lt;R1&gt;.*&lt;i&gt;t&lt;\/i&gt;.*&lt;u&gt; &lt;b&gt;1k&lt;\/b&gt;.*&lt;f&gt;\.cir/);
});

test('empty states are chosen by rule: zero rows, no rows, renderer not running, loading', () => {
  const sentence = (result: RenderResult | undefined) => bom(markdownPlugin(new MarkdownIt(), () => result).render('```spice\nR1 a 0 1\n```'));
  assert.equal(sentence(schematic()), NO_PARTS);
  assert.equal(sentence({ status: 'failure', message: 'bad', line: 1 }), NOT_READ);
  assert.equal(sentence({ status: 'timeout', budget: 3000 }), NOT_READ);
  assert.equal(sentence({ status: 'timeout', budget: 3000, bom: [], notes: [] }), NO_PARTS);
  assert.equal(sentence({ status: 'unavailable', reason: 'gone' }), NOT_RUNNING);
  assert.equal(sentence(undefined), BOM_LOADING);
  assert.equal(bom(markdownPlugin(new MarkdownIt(), () => { throw new Error('boom'); }).render('```spice\nR1 a 0 1\n```')), NOT_RUNNING);
});

test('a timeout or layout failure that carries rows shows the table beside its error card', () => {
  for (const result of [
    { status: 'timeout', budget: 3000, bom: BRIDGE, notes: [] },
    { status: 'failure', message: 'ELK failed', bom: BRIDGE, notes: [] }
  ] as RenderResult[]) {
    const html = markdownPlugin(new MarkdownIt(), () => result).render('```spice\nR1 a 0 1\n```');
    assert.match(rendering(html), /spice-error/, result.status);
    assert.match(bom(html), /<td class="spice-bom-refs">D1, D2, D3, D4<\/td>/, result.status);
  }
});

test('the BOM style is a class on the BOM slot, read per render; absent or invalid is plain, reported once per value', () => {
  const reported: string[] = [];
  let style: unknown = 'compact';
  const seen: unknown[] = [];
  const md = markdownPlugin(new MarkdownIt(), () => schematic(), (m) => reported.push(m), (env) => { seen.push(env); return style; });
  const env = { currentDocument: { toString: () => 'a.md' } };
  assert.match(md.render('```spice\nR1 a 0 1\n```', env), /<div class="spice-bom spice-bom-compact">/);
  assert.equal(seen[0], env);
  style = 'card';
  assert.match(md.render('```spice\nR1 a 0 1\n```', env), /<div class="spice-bom spice-bom-card">/);
  style = undefined;
  assert.match(md.render('```spice\nR1 a 0 1\n```', env), /<div class="spice-bom spice-bom-plain">/);
  style = 3;
  md.render('```spice\nR1 a 0 1\n```', env);
  style = 'fancy';
  assert.match(md.render('```spice\nR1 a 0 1\n```\n\n```spice\nR2 a 0 1\n```', env), /<div class="spice-bom spice-bom-plain">/);
  md.render('```spice\nR1 a 0 1\n```', env);
  assert.deepEqual(reported, ['spice.bomStyle "3" is not a BOM style; using plain', 'spice.bomStyle "fancy" is not a BOM style; using plain']);
  assert.match(markdownPlugin(new MarkdownIt(), () => schematic()).render('```spice\nR1 a 0 1\n```'), /<div class="spice-bom spice-bom-plain">/);
});

test('a cached table takes a changed style on the next render', () => {
  let next: RenderResult | undefined = schematic(undefined, BRIDGE);
  let style = 'plain';
  const md = markdownPlugin(new MarkdownIt(), () => next, undefined, () => style);
  const env = { currentDocument: { toString: () => 'a.md' } };
  md.render('```spice\nR1 a 0 1\n```', env);
  next = undefined;
  style = 'card';
  const html = md.render('```spice\nR1 a 0 1k\n```', env);
  assert.match(html, /<div class="spice-bom spice-bom-card"><p class="spice-bom-summary" dir="auto">7 parts in 4 rows<\/p>/);
});

test('the slot cache counts the rendering and the table toward its bound', () => {
  // Two slots whose tables alone exceed the 16 M-character bound: the first is evicted.
  const huge = 'x'.repeat(9 * 1024 * 1024);
  let next: RenderResult | undefined = schematic('<svg class="spice"></svg>', [{ type: 'resistor', name: 'resistor', value: huge, references: [reference('R1', 1)] }]);
  const md = markdownPlugin(new MarkdownIt(), () => next);
  const env = { currentDocument: { toString: () => 'a.md' } };
  const two = '```spice\nR1 a 0 1\n```\n\n```spice\nR2 a 0 1\n```';
  md.render(two, env);
  next = undefined;
  const html = md.render(two, env);
  assert.equal((html.match(/spice-loading/g) ?? []).length, 1, 'the older slot was evicted');
});
