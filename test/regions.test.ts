/**
 * A Spectre netlist is cut into language regions at its `simulator lang=` lines before parsing
 * (ADR 0009, *Driver and region splitting*; Spectre User Guide 5.1 p.50–54). Each region keeps its
 * line numbers by standing after as many blank lines as the file has before it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modulesFor, splitRegions, startLanguage } from '../src/parser/regions';

test('a fence and a .scs file start in Spectre; every other included file starts in SPICE mode', () => {
  assert.equal(startLanguage(''), 'spectre');
  assert.equal(startLanguage('models/nch.scs'), 'spectre');
  assert.equal(startLanguage('models/NCH.SCS'), 'spectre');
  assert.equal(startLanguage('models/nch.lib'), 'spectre-spice');
  assert.equal(startLanguage('deck.cir'), 'spectre-spice');
});

test('a Spectre netlist needs both modules; every other dialect needs its own', () => {
  assert.deepEqual(modulesFor('spectre'), ['spectre', 'spectre-spice']);
  assert.deepEqual(modulesFor('ngspice'), ['ngspice']);
  assert.deepEqual(modulesFor('spectre-spice'), ['spectre-spice']);
});

test('a text with no simulator line is one region in the start language', () => {
  assert.deepEqual(splitRegions('r1 (1 0) resistor r=1\n', 'spectre'), [{ language: 'spectre', start: 1, lines: ['r1 (1 0) resistor r=1', ''], text: 'r1 (1 0) resistor r=1\n' }]);
  assert.deepEqual(splitRegions('', 'spectre'), []);
  assert.deepEqual(splitRegions('\n  \n', 'spectre-spice'), [], 'blank lines are no region');
});

test('simulator lang= lines cut the text, in any case, and belong to no region; each region keeps its line numbers', () => {
  const text = 'r1 1 0 1k\nv1 1 0 1\nsimulator lang=spectre\nr2 (1 0) resistor r=1k\nSIMULATOR LANG=SPICE\n.op\n';
  const regions = splitRegions(text, 'spectre-spice');
  assert.deepEqual(regions.map((region) => [region.language, region.start, region.lines]), [
    ['spectre-spice', 1, ['r1 1 0 1k', 'v1 1 0 1']],
    ['spectre', 4, ['r2 (1 0) resistor r=1k']],
    ['spectre-spice', 6, ['.op', '']]
  ]);
  assert.deepEqual(regions.map((region) => region.text), ['r1 1 0 1k\nv1 1 0 1\n', '\n\n\nr2 (1 0) resistor r=1k\n', '\n\n\n\n\n.op\n']);
  for (const region of regions) assert.equal(region.text.split('\n').length - 1, region.start - 1 + region.lines.length - (region === regions.at(-1) ? 1 : 0), 'the region ends where its lines end');
});

test('a simulator line with insensitive=yes, blanks around =, or no language still switches or keeps the language and is dropped', () => {
  const regions = splitRegions('simulator lang = spectre insensitive=yes\nr1 (1 0) resistor r=1\nsimulator\nr2 (1 0) resistor r=1\nsimulator lang=spice\nR3 1 0 1\r\n', 'spectre-spice');
  assert.deepEqual(regions.map((region) => [region.language, region.start, region.lines.length]), [['spectre', 2, 1], ['spectre', 4, 1], ['spectre-spice', 6, 2]]);
  assert.deepEqual(splitRegions('simulator lang=spice\r\nR1 1 0 1\r\n', 'spectre').map((region) => region.language), ['spectre-spice'], 'a CRLF line switches too');
});

test('a switch inside a subcircuit is still a boundary: the blocks are matched over the cards, not here', () => {
  const regions = splitRegions('subckt s (a b)\nsimulator lang=spice\nR1 a b 1k\nsimulator lang=spectre\nends s\n', 'spectre');
  assert.deepEqual(regions.map((region) => [region.language, region.lines[0]]), [['spectre', 'subckt s (a b)'], ['spectre-spice', 'R1 a b 1k'], ['spectre', 'ends s']]);
});
