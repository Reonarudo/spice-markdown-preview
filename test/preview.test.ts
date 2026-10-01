import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import MarkdownIt from 'markdown-it';
import { createPreview } from '../src/preview';
import { DIALECT_NAMES, type PublicDialect } from '../src/dialect';

const document = [
  '```spice {caption="RC low-pass" algin="typo"}',
  'V1 in 0 AC 1',
  'R1 in out 10k',
  'C1 out 0 100n',
  '```',
  '',
  '```spice',
  'V1 in 0 AC 1',
  'R1 in out 10k',
  'C1 out 0 100n',
  '```',
  '',
  '```spice',
  'Q1 c b e BC547',
  'R1 c 0 1k',
  '```',
  '',
  '```spice',
  'R1 a b 1k',
  'D1 a',
  '```',
  '',
  '```cir',
  'R1 left alone 1k',
  '```'
].join('\n');

test('a Markdown document renders schematics beside delegated fences, logging notes once', async () => {
  const logged: string[] = [];
  const preview = await createPreview(resolve('dist'), (line) => logged.push(line));
  try {
    const html = preview.extendMarkdownIt(new MarkdownIt()).render(document);
    assert.equal((html.match(/<svg class="spice"/g) ?? []).length, 3);
    assert.match(html, /<figure class="spice-figure"><svg class="spice"[^>]*>[\s\S]*<\/svg><figcaption>RC low-pass<\/figcaption><\/figure>/);
    assert.match(html, /<pre>D1 needs 2 nodes; found 1\.\n\n2 │ D1 a\n         \^<\/pre>/);
    assert.match(html, /<pre><code class="language-cir">R1 left alone 1k/);
    assert.deepEqual(logged, [
      'Unknown attribute "algin"; ignored.',
      'Q1 c b e BC547: Line 1: model BC547 of Q1 is not defined here; drawn as NPN.'
    ]);
    // Rendering again is served from the cache: only the attribute diagnostic repeats.
    preview.extendMarkdownIt(new MarkdownIt()).render(document);
    assert.equal(logged.length, 3);
  } finally {
    preview.dispose();
  }
});

test('the preview takes a live budget and clears its cache on demand', async () => {
  let budget = 100;
  const preview = await createPreview(resolve('dist'), () => {}, { timeout: () => budget });
  try {
    const md = preview.extendMarkdownIt(new MarkdownIt());
    const slow = '```spice\n' + Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n') + '\n```';
    assert.match(md.render(slow), /longer than 0\.1 s/);
    budget = 30_000;
    assert.match(md.render(slow), /longer than 0\.1 s/, 'still cached');
    preview.clear();
    assert.match(md.render(slow), /<svg class="spice"/);
  } finally {
    preview.dispose();
  }
});

test('the dialect is the fence attribute, else the setting, else ngspice, and reaches the includes provider', async () => {
  let setting: PublicDialect | undefined;
  const seen: string[] = [];
  const preview = await createPreview(resolve('dist'), () => {}, {
    dialect: (env) => { assert.deepEqual(env, { document: 'demo.md' }); return setting; },
    includes: (_source, _env, dialect) => { seen.push(dialect); return { files: {}, identity: '' }; }
  });
  try {
    const md = preview.extendMarkdownIt(new MarkdownIt());
    const env = { document: 'demo.md' };
    md.render('```spice\nR1 a 0 1k\n```', env);
    setting = 'xyce';
    md.render('```spice\nR1 a 0 1k\n```', env);
    md.render('```spice {dialect="HSPICE"}\nR1 a 0 1k\n```', env);
    md.render('```spice {dialect="nope"}\nR1 a 0 1k\n```', env);
    assert.deepEqual(seen, ['ngspice', 'xyce', 'hspice', 'xyce']);
  } finally {
    preview.dispose();
  }
});

test('the chosen dialect reaches the worker, which loads its parser', async () => {
  // A dialect whose module is not vendored yet is the proof: the worker names it in its failure.
  // Once every overlay ships, there is nothing left to tell apart this way and the test passes trivially.
  const missing = DIALECT_NAMES.find((dialect) => !existsSync(resolve('vendor', 'parsers', `${dialect}.cjs`)));
  const preview = await createPreview(resolve('dist'), () => {}, { dialect: () => missing });
  try {
    const md = preview.extendMarkdownIt(new MarkdownIt());
    assert.match(md.render('```spice {dialect="ngspice"}\nR1 a 0 1k\n```'), /<svg class="spice"/, 'the attribute overrides the setting');
    if (!missing) return;
    const html = md.render('```spice\nR1 a 0 1k\n```');
    assert.match(html, new RegExp(`<pre>The ${missing} parser could not be loaded: `));
    // Cached per dialect: the same netlist in ngspice is not the cached failure.
    assert.match(md.render('```spice {dialect="NGSPICE"}\nR1 a 0 1k\n```'), /<svg class="spice"/);
  } finally {
    preview.dispose();
  }
});

test('a fence waits for its included files, then draws with them', async () => {
  let ready = false;
  const preview = await createPreview(resolve('dist'), () => {}, {
    includes: (_source, env, dialect) => {
      assert.deepEqual(env, { document: 'demo.md' }, 'the render environment reaches the provider');
      assert.equal(dialect, 'ngspice');
      return ready ? { files: { 'models.lib': '.model Q PNP' }, identity: 'v1' } : undefined;
    }
  });
  try {
    const md = preview.extendMarkdownIt(new MarkdownIt());
    const fence = '```spice\n.include models.lib\nQ1 c b e Q\nR1 c 0 1k\n```';
    assert.equal(md.render(fence, { document: 'demo.md' }), '<div class="spice-loading" role="status">Reading included files…</div>\n');
    ready = true;
    const html = md.render(fence, { document: 'demo.md' });
    // A PNP: the emitter pin is the one on top, drawn with the arrow on the upper leg.
    assert.match(html, /<path d="m14,9 6,-1 -3,-5 z" class="detail"\/>/);
  } finally {
    preview.dispose();
  }
});
