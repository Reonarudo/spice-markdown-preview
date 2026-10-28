import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { createRuntime, prepare, type Prepared, type Runtime } from '@reonarudo/spice-renderer';
import { createPreview, type PreviewOptions } from '../src/preview';

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

/** The library's `prepare` behind a cache, as the extension's include reader keeps it; files come from `files`. */
function preparer(files: Record<string, string> = {}) {
  const seen: string[] = [];
  const ready = new Map<string, Prepared>();
  const pending: Promise<unknown>[] = [];
  const reader = { read: async (key: string) => key in files ? { bytes: new TextEncoder().encode(files[key]) } : { error: 'file not found' } };
  const options: PreviewOptions['prepare'] = (source, _env, dialect) => {
    seen.push(dialect);
    const key = JSON.stringify([dialect, source]);
    if (ready.has(key)) return ready.get(key);
    pending.push(prepare(source, { reader, dialect }).then((prepared) => { ready.set(key, prepared); }));
    return undefined;
  };
  return { prepare: options, seen, settled: async () => { await Promise.all(pending.splice(0)); } };
}

async function withRuntime(timeout: number, body: (runtime: Runtime) => Promise<void>): Promise<void> {
  const runtime = await createRuntime({ timeout });
  try {
    await body(runtime);
  } finally {
    await runtime.dispose();
  }
}

test('a Markdown document renders schematics beside delegated fences, logging notes once', () => withRuntime(3000, async (runtime) => {
  const logged: string[] = [];
  const files = preparer();
  const md = createPreview(runtime, (line) => logged.push(line), { prepare: files.prepare }).extendMarkdownIt(new MarkdownIt());
  assert.equal((md.render(document).match(/spice-loading/g) ?? []).length, 4, 'nothing is prepared yet');
  await files.settled();
  const html = md.render(document);
  assert.equal((html.match(/<svg class="spice" width="[0-9.]+px"/g) ?? []).length, 3);
  assert.match(html, /<figure class="spice-figure"><svg [^>]*>[\s\S]*<\/svg><figcaption>RC low-pass<\/figcaption><\/figure>/);
  assert.match(html, /<pre>D1 needs 2 nodes; found 1\.\n\n2 │ D1 a\n         \^<\/pre>/);
  assert.match(html, /<pre><code class="language-cir">R1 left alone 1k/);
  // The view toggle: one wrapper per claimed fence, the source view showing the fence as written.
  assert.equal((html.match(/<div class="spice-fence code-line" data-line="\d+" data-fence-key="[0-9a-f]{8}"><button /g) ?? []).length, 4);
  assert.match(html, /<\/figure><\/div><pre><code class="language-spice">V1 in 0 AC 1\nR1 in out 10k\nC1 out 0 100n\n<\/code><\/pre>\n<\/div>/);
  assert.match(html, /<\/div>\n<\/div><pre><code class="language-spice">R1 a b 1k\nD1 a\n<\/code><\/pre>\n<\/div>/);
  assert.equal((html.match(/<div class="spice-fence /g) ?? []).length, 4, 'the cir fence is not wrapped');
  assert.deepEqual(logged, [
    'Unknown attribute "algin"; ignored.',
    'Unknown attribute "algin"; ignored.',
    'Q1 c b e BC547: Line 1: model BC547 of Q1 is not defined here; drawn as NPN.'
  ]);
  // Rendering again is served from the cache: only the attribute diagnostic repeats.
  md.render(document);
  assert.equal(logged.length, 4);
}));

test('timeouts are cached until the preview is cleared', () => withRuntime(100, async (runtime) => {
  let calls = 0;
  const files = preparer();
  const preview = createPreview({ render: (input) => { calls++; return runtime.render(input); } }, () => {}, { prepare: files.prepare });
  const md = preview.extendMarkdownIt(new MarkdownIt());
  const slow = '```spice\n' + Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n') + '\n```';
  md.render(slow);
  await files.settled();
  assert.match(md.render(slow), /longer than 0\.1 s/);
  assert.match(md.render(slow), /longer than 0\.1 s/);
  assert.equal(calls, 1, 'still cached');
  preview.clear();
  md.render(slow);
  assert.equal(calls, 2);
}));

test('unavailable is never cached', () => {
  let calls = 0;
  const md = createPreview({ render: () => { calls++; return { status: 'unavailable', reason: 'gone' }; } }, () => {}, {
    prepare: (source) => ({ source, dialect: 'ngspice', files: [], identity: '0'.repeat(64) })
  }).extendMarkdownIt(new MarkdownIt());
  md.render('```spice\nR1 a 0 1\n```');
  assert.match(md.render('```spice\nR1 a 0 1\n```'), /could not start: gone/);
  assert.equal(calls, 2);
});

test('the dialect is the fence attribute as written, else the setting, else ngspice; an unknown one fails the fence', () => withRuntime(3000, async (runtime) => {
  let setting: string | undefined;
  const files = preparer();
  const md = createPreview(runtime, () => {}, {
    prepare: files.prepare,
    dialect: (env) => { assert.deepEqual(env, { document: 'demo.md' }); return setting; }
  }).extendMarkdownIt(new MarkdownIt());
  const env = { document: 'demo.md' };
  const fences = ['```spice\nR1 a 0 1k\n```', '```spice {dialect="HSPICE"}\nR1 a 0 1k\n```', '```spice {dialect="nope"}\nR1 a 0 1k\n```'];
  for (const fence of fences) md.render(fence, env);
  setting = 'xyce';
  md.render(fences[0]!, env);
  assert.deepEqual(files.seen, ['ngspice', 'HSPICE', 'nope', 'xyce']);
  await files.settled();
  assert.match(md.render(fences[1]!, env), /<svg /, 'any case');
  assert.match(md.render(fences[2]!, env), /<pre>&quot;nope&quot; is not a SPICE dialect; use one of ngspice, ltspice, pspice, hspice, xyce, spectre<\/pre>/);
  // In LTspice `$` is not a comment, so `$G_VDD` is a node; in ngspice it ends the card.
  const dollar = (dialect: string) => '```spice {dialect="' + dialect + '"}\nR1 $G_VDD out 1k\nR2 out 0 1k\n```';
  md.render(dollar('ltspice'), env);
  md.render(dollar('ngspice'), env);
  await files.settled();
  assert.match(md.render(dollar('ltspice'), env), /<svg /);
  assert.match(md.render(dollar('ngspice'), env), /R1 needs 2 nodes; found 0/);
}));

test('a fence draws with its included files, and an unreadable one is an error at its include', () => withRuntime(3000, async (runtime) => {
  const files = preparer({ 'models.lib': '.model Q PNP' });
  const md = createPreview(runtime, () => {}, { prepare: files.prepare }).extendMarkdownIt(new MarkdownIt());
  const good = '```spice\n.include models.lib\nQ1 c b e Q\nR1 c 0 1k\n```';
  const missing = '```spice\nR1 a 0 1\n.include nowhere.lib\n```';
  md.render(good + '\n' + missing);
  await files.settled();
  const html = md.render(good + '\n' + missing);
  // A PNP: the emitter pin is the one on top, drawn with the arrow on the upper leg.
  assert.match(html, /<path d="m14,9 6,-1 -3,-5 z" class="detail"/);
  assert.match(html, /<pre>nowhere\.lib could not be read: file not found\n\n2 │ \.include nowhere\.lib\n {13}\^<\/pre>/);
  // The source view is the fence as written: the include line, not the included file's contents.
  assert.match(html, /<\/div><pre><code class="language-spice">\.include models\.lib\nQ1 c b e Q\nR1 c 0 1k\n<\/code><\/pre>\n<\/div>/);
  assert.doesNotMatch(html, /language-spice">[^<]*\.model Q PNP/);
}));

test('a preparation message is shown in place of the schematic, escaped', () => {
  const md = createPreview({ render: () => assert.fail('not rendered') }, () => {}, {
    prepare: () => 'the <cache> is full'
  }).extendMarkdownIt(new MarkdownIt());
  assert.match(md.render('```spice\nR1 a 0 1\n```'), /<pre>the &lt;cache&gt; is full<\/pre>/);
});
