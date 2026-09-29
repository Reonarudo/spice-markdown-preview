import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseIncludePath, resolveInclude, IncludePathError } from '../src/include-paths';
import { parseNetlist, includeReferences, MAX_INCLUDE_DEPTH, type IncludeSet, type Netlist } from '../src/netlist';

function netlist(source: string, files: IncludeSet['files']): Netlist {
  const result = parseNetlist(source, { files });
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function error(source: string, files: IncludeSet['files']) {
  const result = parseNetlist(source, { files });
  if (result.ok) assert.fail('expected an error');
  return result;
}

test('include paths lose their quotes, read \\ as /, and are normalised', () => {
  assert.equal(normaliseIncludePath('"models/bjt.lib"'), 'models/bjt.lib');
  assert.equal(normaliseIncludePath("'x.lib'"), 'x.lib');
  assert.equal(normaliseIncludePath('lib\\sub\\..\\op.lib'), 'lib/op.lib');
  assert.equal(normaliseIncludePath('./a/./b.inc'), 'a/b.inc');
  assert.equal(normaliseIncludePath('../shared/x.lib'), '../shared/x.lib');
});

test('absolute, home, drive, URL, empty, folder and control-character paths are refused', () => {
  for (const path of ['/etc/passwd', '~/x.lib', 'C:\\x.lib', 'c:x.lib', 'https://e.x/x.lib', 'file:///x', '""', '.', 'a/', 'a\u0000b', '\\\\server\\x']) {
    assert.throws(() => normaliseIncludePath(path), IncludePathError, path);
  }
});

test('a nested include is resolved from the folder of the file that names it', () => {
  assert.equal(resolveInclude('', 'models/amp.lib'), 'models/amp.lib');
  assert.equal(resolveInclude('models/amp.lib', 'bjt.lib'), 'models/bjt.lib');
  assert.equal(resolveInclude('models/amp.lib', '../common.lib'), 'common.lib');
});

test('an included .model decides the transistor type, and an included .subckt names the pins', () => {
  const { parts, notes } = netlist('.include "models.lib"\nQ1 c b e BC557\nX1 a b c d e opamp', {
    'models.lib': '.model BC557 PNP(BF=200)\n.subckt opamp in+ in- v+ v- out\nR1 in+ in- 1meg\n.ends'
  });
  assert.equal(parts[0]!.kind, 'pnp');
  assert.deepEqual(parts[1]!.pins.map((pin) => pin.name), ['in+', 'in-', 'v+', 'v-', 'out']);
  assert.deepEqual(notes, []);
});

test('elements in an included file are drawn, and say which file they come from', () => {
  const { parts } = netlist('V1 in 0 5\n.inc stage.cir\n', { 'stage.cir': '* a stage\nR1 in out 1k\nC1 out 0 1n\n.end' });
  assert.deepEqual(parts.map((part) => [part.ref, part.file ?? '', part.line]), [['V1', '', 1], ['R1', 'stage.cir', 2], ['C1', 'stage.cir', 3]]);
});

test('an .end in an included file ends that file only; after the fence\'s .end nothing is read', () => {
  const { parts } = netlist('.include a.lib\nR2 x 0 1\n.end\n.include never.lib', { 'a.lib': 'R1 x 0 1\n.end\nR9 y 0 1' });
  assert.deepEqual(parts.map((part) => part.ref), ['R1', 'R2']);
});

test('includes nest, relative to the including file', () => {
  const { parts } = netlist('.include lib/top.lib\nQ1 c b e Q', {
    'lib/top.lib': '.include models/q.lib',
    'lib/models/q.lib': '.model Q PNP'
  });
  assert.equal(parts[0]!.kind, 'pnp');
});

test('.lib path section includes only that section; .lib path alone includes the whole file', () => {
  const library = [
    '.lib tt', '.model N NMOS', '.endl',
    '.lib ff', '.model N PMOS', '.include missing.lib', '.endl'
  ].join('\n');
  // The ff section names a file nobody loaded; since it is never selected, that is no error.
  assert.equal(netlist('.lib "corners.lib" tt\nM1 d g s s N', { 'corners.lib': library, 'missing.lib': { error: 'not found' } }).parts[0]!.kind, 'nmos');
  assert.equal(netlist('.lib corners.lib ff\nM1 d g s s N', { 'corners.lib': library.replace('.include missing.lib\n', ''), 'missing.lib': { error: 'not found' } }).parts[0]!.kind, 'pmos');
  assert.equal(netlist('.lib standard.bjt\nQ1 c b e Q', { 'standard.bjt': '.model Q PNP' }).parts[0]!.kind, 'pnp');
});

test('a missing section is an error at the section name', () => {
  const result = error('.lib corners.lib ss\nR1 a 0 1', { 'corners.lib': '.lib tt\n.endl' });
  assert.deepEqual([result.message, result.line, result.column], ['corners.lib has no section ss.', 1, 17]);
});

test('an error inside an included file is shown at the fence\'s include, naming the file and line', () => {
  const result = error('R1 a 0 1\n.include "stage.cir"', { 'stage.cir': 'R2 a b 1\nD1 a' });
  assert.equal(result.message, 'In stage.cir, line 2: D1 needs 2 nodes; found 1.');
  assert.deepEqual([result.line, result.column], [2, 9]);
  // Nested: still the fence's include, still the innermost file.
  const nested = error('.include a.lib', { 'a.lib': '.include b.lib', 'b.lib': 'U1 x y z' });
  assert.equal(nested.message, 'In b.lib, line 1: Element type U (U1) is not supported.');
  assert.deepEqual([nested.line, nested.column], [1, 9]);
});

test('a file that could not be read is an error only where it is included', () => {
  const result = error('R1 a 0 1\n.include gone.lib', { 'gone.lib': { error: 'the file does not exist' } });
  assert.deepEqual([result.message, result.line, result.column], ['gone.lib could not be read: the file does not exist', 2, 9]);
});

test('a file that includes itself, directly or not, is an error', () => {
  assert.equal(error('.include a.lib', { 'a.lib': '.include a.lib' }).message, 'In a.lib, line 1: a.lib includes itself.');
  assert.equal(error('.include a.lib', { 'a.lib': '.include b.lib', 'b.lib': '.include a.lib' }).message, 'In b.lib, line 1: a.lib includes itself.');
});

test('includes nested too deep are an error', () => {
  const files: IncludeSet['files'] = {};
  for (let i = 0; i <= MAX_INCLUDE_DEPTH; i++) files[`f${i}.lib`] = `.include f${i + 1}.lib`;
  files[`f${MAX_INCLUDE_DEPTH + 1}.lib`] = 'R1 a 0 1';
  assert.match(error('.include f0.lib', files).message, /nested more than 8 deep/);
});

test('a bad path is an error at the path; a duplicate across files names the other file', () => {
  const bad = error('R1 a 0 1\n.include /etc/models.lib', {});
  assert.deepEqual([bad.message, bad.line, bad.column], ['Only paths relative to the Markdown document are read. (/etc/models.lib)', 2, 9]);
  assert.equal(error('.include a.lib\nR1 x 0 1', { 'a.lib': 'R1 y 0 1' }).message, 'Duplicate element R1; it is also defined on a.lib line 1.');
  assert.equal(error('.include', {}).message, '.include needs a file name.');
});

test('when no files are available, every include is noted with the reason and skipped', () => {
  const result = parseNetlist('.include models.lib\nQ1 c b e Q', { files: {}, unavailable: 'the workspace is not trusted' });
  assert.ok(result.ok);
  assert.deepEqual(result.netlist.notes, [
    'Line 1: .include models.lib is not read: the workspace is not trusted.',
    'Line 2: model Q of Q1 is not defined here; drawn as NPN.'
  ]);
});

test('notes about included elements name their file', () => {
  const { notes } = netlist('.include stage.cir', { 'stage.cir': 'Q1 c b e 2N2222' });
  assert.deepEqual(notes, ['Stage.cir line 1: model 2N2222 of Q1 is not defined here; drawn as NPN.']);
});

test('includeReferences lists every file a text names, resolved from its own folder, skipping bad paths', () => {
  const text = [
    '* comment .include nope.lib',
    '.include "a.lib"',
    '.INC sub/b.lib',
    '.lib c.lib tt',
    '.lib d.lib',
    '.lib section',
    '.include in-section.lib',
    '.endl',
    '.include /abs.lib',
    '.include a.lib'
  ].join('\n');
  assert.deepEqual(includeReferences(text, 'models/x.lib'), ['models/a.lib', 'models/sub/b.lib', 'models/c.lib', 'models/d.lib', 'models/in-section.lib']);
  assert.deepEqual(includeReferences('+ broken', ''), []);
});

test('a whole-file .lib before a section definition is still an include', () => {
  const { parts } = netlist('.lib models.bjt\n.lib local\n.model X NPN\n.endl\nQ1 c b e Q', { 'models.bjt': '.model Q PNP' });
  assert.equal(parts[0]!.kind, 'pnp');
});
