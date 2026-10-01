import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { DOMParser } from '@xmldom/xmldom';
import { loadSymbols } from '../src/schematic';
import { renderNetlist } from '../src/draw-netlist';
import { loadNgspice } from './helpers/ngspice';

before(loadNgspice);

const symbols = loadSymbols(readFileSync('src/skin/symbols.svg', 'utf8'));
const elk = new ELK();
const layout = (graph: Parameters<typeof elk.layout>[0]) => elk.layout(graph);

async function draw(source: string): Promise<string> {
  const result = await renderNetlist(source, symbols, layout);
  assert.equal(result.status, 'success', JSON.stringify(result));
  return result.status === 'success' ? result.output : '';
}

test('a schematic is one SVG with the spice class, a viewBox, and its parts\' names and values', async () => {
  const svg = await draw('V1 in 0 5\nR1 in out 10k\nC1 out 0 100n');
  // The class comes first: the fence rule adds an author's class by rewriting it.
  assert.match(svg, /^<svg class="spice" width="[\d.]+" height="[\d.]+" viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+" xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  for (const text of ['V1', '5', 'R1', '10k', 'C1', '100n']) assert.match(svg, new RegExp(`>${text}</text>`), text);
  assert.equal((svg.match(/<path [^>]*class="wire"/g) ?? []).length > 0, true);
  // Two ground connections, two ground symbols.
  assert.equal((svg.match(/M0,15 H20/g) ?? []).length, 2);
});

test('the output carries no ids, no symbol-file markup, no comments and no styles', async () => {
  const svg = await draw('Q1 c b e Q\nM1 d g s b nch\nX1 a b sub\nD1 a k D\n.model nch NMOS\n.model Q PNP');
  assert.doesNotMatch(svg, /\bid=/);
  assert.doesNotMatch(svg, /\bs:|xmlns:s|<!--|<style|style=/);
  // It parses as XML and is SVG at the root.
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  assert.equal(document.documentElement!.tagName, 'svg');
});

test('text from the netlist is escaped, whatever it contains', async () => {
  const svg = await draw([
    'R1 a b <script>x</script>',
    'X1 a b "><img src=x onerror=alert(1)>',
    // No `;` here: it starts an inline comment in SPICE.
    'V1 a 0 &amp<b>'
  ].join('\n'));
  assert.doesNotMatch(svg, /<script|<img|<b>/);
  assert.match(svg, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(svg, />&amp;amp&lt;b&gt;<\/text>/);
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const elements = new Set(Array.from(document.getElementsByTagName('*')).map((element) => element.tagName));
  assert.deepEqual([...elements].sort(), ['circle', 'g', 'path', 'rect', 'svg', 'text'].filter((name) => elements.has(name)).sort());
});

test('a value too long for the page is cut with an ellipsis', async () => {
  const svg = await draw('V1 a 0 PULSE(0 1.8 0 10p 10p 1n 2n)\nR1 a 0 1k');
  assert.match(svg, />PULSE\(0 1\.8 0 10p 10p 1…<\/text>/);
});

test('a netlist error comes back with its line and column', async () => {
  assert.deepEqual(await renderNetlist('R1 a b 1k\nQ1 a', symbols, layout), {
    status: 'failure', message: 'Q1 needs 3 nodes; found 1.', line: 2, column: 5
  });
});

test('notes from the reader come back with a successful drawing', async () => {
  const result = await renderNetlist('R1 a 0 1k\n.include x.lib', symbols, layout);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.status === 'success' && result.notes, ['Line 2: .include x.lib is not read: no files are available here.']);
});

test('a layout failure is a failure with a plain message, never an exception', async () => {
  const result = await renderNetlist('R1 a 0 1k', symbols, () => Promise.reject(new Error('java.lang.NullPointerException')));
  assert.deepEqual(result, { status: 'failure', message: 'The schematic could not be laid out (java.lang.NullPointerException).' });
});

test('renderNetlist takes the dialect as an optional trailing argument, and ngspice is the default', async () => {
  const source = 'V1 in 0 5\nR1 in out 1k';
  assert.deepEqual(await renderNetlist(source, symbols, layout, undefined, 'ngspice'), await renderNetlist(source, symbols, layout));
});
