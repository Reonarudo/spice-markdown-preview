import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { markdownPlugin } from '../src/markdown';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { rendering } from './helpers';

const schematic = (output = '<svg class="spice" viewBox="4 4 48 101"></svg>'): RenderResult => ({ status: 'success', output, notes: [] });
const SIZED = '<svg class="spice" width="48px" viewBox="4 4 48 101"></svg>';

const ICON_CODE = '<svg class="spice-icon-code" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
  '<path d="M5.7 3.3 1 8l4.7 4.7.9-.9L2.8 8l3.8-3.8zM10.3 3.3l-.9.9L13.2 8l-3.8 3.8.9.9L15 8z"/></svg>';
const ICON_GRAPH = '<svg class="spice-icon-graph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">' +
  '<rect x="1.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="5.5" y="11" width="5" height="3.5" rx=".5"/>' +
  '<path d="M4 5v3h8V5M8 8v3"/></svg>';
const TOGGLE = `<button type="button" class="spice-toggle" aria-pressed="false" aria-label="Source view" title="Source view">${ICON_CODE}${ICON_GRAPH}</button>`;
const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>\n';

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
test('every claimed fence is wrapped: toggle first, rendering slot, then the delegated source <pre>', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.equal(md.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${TOGGLE}` +
    `<div class="spice-rendering">${SIZED}</div>` +
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
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${TOGGLE}` +
    '<div class="spice-rendering"><div class="spice-error" role="alert"><pre>bad</pre></div>\n</div>' +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
  const threw = markdownPlugin(new MarkdownIt(), () => { throw new Error('boom'); });
  assert.equal(threw.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${TOGGLE}` +
    '<div class="spice-rendering"><div class="spice-error" role="alert"><pre>The schematic renderer failed: boom</pre></div>\n</div>' +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
  const loading = markdownPlugin(new MarkdownIt(), () => undefined);
  assert.equal(loading.render('```spice\nR1 a 0 1\n```'),
    `<div class="spice-fence code-line" data-line="0" data-fence-key="997d4f82">${TOGGLE}` +
    `<div class="spice-rendering">${LOADING}</div>` +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre>\n</div>\n');
});

test('a slot caches only the rendering: an edited fence keeps the old drawing but shows its new body in source view', () => {
  let next: RenderResult | undefined = schematic('<svg class="spice"><text>old</text></svg>');
  const md = markdownPlugin(new MarkdownIt(), () => next);
  const env = { currentDocument: { toString: () => 'a.md' } };
  md.render('```spice\nR1 a 0 1\n```', env);
  next = undefined;
  const html = md.render('```spice\nR1 a 0 1k\n```', env);
  assert.equal(html,
    `<div class="spice-fence code-line" data-line="0" data-fence-key="129600ed">${TOGGLE}` +
    '<div class="spice-rendering"><svg class="spice"><text>old</text></svg></div>' +
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
  // Counted on the schematic's own class: the toggle ships two SVG glyphs per fence.
  assert.equal((md.render(two, env('a.md')).match(/<svg class="spice"/g) ?? []).length, 2);
  next = undefined;
  assert.equal((md.render(two, env('a.md')).match(/<svg class="spice"/g) ?? []).length, 2, 'both slots keep their drawing');
  assert.match(md.render(two, env('b.md')), /^<div class="spice-fence [^>]*><button [\s\S]*?<\/button><div class="spice-rendering"><div class="spice-loading" role="status">Reading the netlist…<\/div>/, 'another document has its own slots');
  assert.match(md.render(two), /spice-loading/, 'no document, no slot');
  next = { status: 'failure', message: 'bad' };
  md.render(two, env('a.md'));
  next = undefined;
  assert.match(md.render(two, env('a.md')), /spice-error/, 'an error is remembered like a drawing');
});
