import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { markdownPlugin } from '../src/markdown';
import type { RenderResult } from '../src/renderer';

const schematic = (output = '<svg class="spice" width="10"></svg>'): RenderResult => ({ status: 'success', output, notes: [] });

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
  assert.deepEqual(given, [{ document: 'demo.md' }, { dialect: 'xyce', alt: 'x' }, {}, {}]);
});

test('preserves unrelated fences byte for byte including highlighting', () => {
  for (const language of ['cir', 'SPICE', 'spice extra', 'ngspice', 'netlist', 'graphviz', 'smiles', 'swift', '']) {
    const input = '```' + language + '\nR1 a 0 1k\n```';
    const options = { highlight: () => '<b>highlight</b>' };
    const delegated = markdownPlugin(new MarkdownIt(options), () => { throw new Error('wrong fence'); });
    assert.equal(delegated.render(input), new MarkdownIt(options).render(input), language);
  }
});

test('a previously registered fence renderer still receives its fences', () => {
  const md = new MarkdownIt();
  md.renderer.rules.fence = () => '<div class="other-extension"></div>';
  markdownPlugin(md, () => schematic());
  assert.equal(md.render('```smiles\nCCO\n```'), '<div class="other-extension"></div>');
  assert.match(md.render('```spice\nR1 a 0 1\n```'), /<svg/);
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
  assert.equal(md.render('```spice\nR1 a 0 1\n```'), '<svg class="spice" width="10"></svg>');
});

test('alt becomes an accessible name, caption a figure, align a class', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  const html = md.render('```spice {alt="A divider" caption="Figure 1" align="center"}\nR1 a 0 1\n```');
  assert.equal(html, '<figure class="spice-figure spice-align-center"><div role="img" aria-label="A divider"><svg class="spice" width="10"></svg></div><figcaption>Figure 1</figcaption></figure>');
});

test('class lands on the root svg beside the base class, escaped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => schematic());
  assert.match(md.render('```spice {class="wide &quot;x\\" onload=\\"y"}\nR1 a 0 1\n```'),
    /^<svg class="spice wide &amp;quot;x&quot; onload=&quot;y" width="10">/);
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
  assert.equal(md.render('```spice {alt="unterminated}\nR1 a 0 1\n```'), '<svg class="spice" width="10"></svg>');
  assert.equal(reported.length, 1);
});

const fence = (source: string) => '# Before\n```spice\n' + source + '\n```\nAfter';

test('a netlist error quotes its line with a caret under the column, and the document continues', () => {
  const md = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'Q1 needs 3 nodes; found 1.', line: 2, column: 5 }));
  const html = md.render(fence('R1 a b 1k\nQ1 a'));
  assert.match(html, /<div class="spice-error" role="alert"><pre>Q1 needs 3 nodes; found 1\.\n\n2 │ Q1 a\n         \^<\/pre><\/div>/);
  assert.match(html, /<p>After<\/p>/);
});

test('an error with no line, or a line outside the fence, shows the message only; text is escaped', () => {
  const md = markdownPlugin(new MarkdownIt(), () => ({ status: 'failure', message: 'bad <b>thing</b>', line: 9, column: 0 }));
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
