import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cell, drawnAs, section, splice, table, END, START } from '../scripts/readme-table';
import type { ElementType } from '../src/catalogue/types';

const FIXTURE: Record<string, ElementType> = {
  vdmos: {
    name: 'VDMOS',
    spellings: [
      { dialect: 'ngspice', letter: 'M', select: { by: 'model-type', types: ['vdmos', 'vdmosp'] } },
      { dialect: 'xyce', letter: 'M', select: { by: 'model-type', types: ['nmos', 'pmos'], levels: [18] } }
    ],
    forms: [{ terminals: [], nodesEnd: 'model' }],
    tail: 'model',
    draw: { symbol: { default: 'nmos3', byModelType: { pmos: 'pmos3' }, byModelFlag: { pchan: 'pmos3' }, note: '' } }
  },
  resistor: {
    name: 'resistor',
    spellings: [
      { dialect: 'ngspice', letter: 'R' },
      { dialect: 'ltspice', letter: 'I', select: { by: 'pair', keys: ['R'] } },
      { dialect: 'ltspice', letter: 'R' },
      { dialect: 'spectre', master: 'resistor' },
      { dialect: 'spectre', master: 'res' }
    ],
    forms: [{ terminals: [], nodesEnd: 'count' }],
    tail: 'value',
    draw: { symbol: 'resistor' }
  },
  'digital-gate': {
    name: 'digital gate',
    spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['NAND', 'AND'] } }],
    forms: [{ terminals: [], nodesEnd: 'count' }],
    tail: 'model',
    draw: { block: { title: 'keyword-with-arguments' } }
  },
  memristor: {
    name: 'memristor',
    spellings: [{ dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['MEMRISTOR'] } }],
    forms: [{ terminals: [], nodesEnd: 'count' }],
    tail: 'model',
    draw: { block: { title: { fixed: 'memristor' } } }
  },
  subcircuit: {
    name: 'subcircuit',
    spellings: [{ dialect: 'hspice', letter: 'X' }, { dialect: 'spectre', master: '*' }],
    forms: [{ terminals: [], nodesEnd: 'last-positional' }],
    tail: 'value',
    draw: { block: { title: 'master', pins: 'subcircuit-ports' } }
  }
};

test('a cell spells the letter, the letter with what selects the type, or the master; the plain letter first', () => {
  assert.equal(cell(FIXTURE.resistor!, 'ngspice'), '`R`');
  assert.equal(cell(FIXTURE.resistor!, 'ltspice'), '`R`; `I` with `R=`');
  assert.equal(cell(FIXTURE.resistor!, 'spectre'), '`resistor`, `res`');
  assert.equal(cell(FIXTURE.resistor!, 'pspice'), '—');
  assert.equal(cell(FIXTURE.vdmos!, 'ngspice'), '`M` with a `vdmos`, `vdmosp` model');
  assert.equal(cell(FIXTURE.vdmos!, 'xyce'), '`M` with a `nmos`, `pmos` model at level 18');
  assert.equal(cell(FIXTURE['digital-gate']!, 'pspice'), '`U` with `NAND`, `AND`');
  assert.equal(cell(FIXTURE.memristor!, 'xyce'), '`YMEMRISTOR`');
  assert.equal(cell(FIXTURE.subcircuit!, 'spectre'), 'any other master');
});

test('the drawn-as column names the symbol, the symbols a model may choose, or the block title and pin rule', () => {
  assert.equal(drawnAs(FIXTURE.resistor!.draw), 'the `resistor` symbol');
  assert.equal(drawnAs(FIXTURE.vdmos!.draw), 'the `nmos3` symbol, or `pmos3` by its model');
  assert.equal(drawnAs(FIXTURE['digital-gate']!.draw), 'a block titled by its keyword and arguments');
  assert.equal(drawnAs(FIXTURE.memristor!.draw), 'a block titled `memristor`');
  assert.equal(drawnAs(FIXTURE.subcircuit!.draw), 'a block titled by the subcircuit or master name, pins named by the definition');
  assert.equal(drawnAs('none'), 'nothing: a coupling, noted');
});

test('the table has one row per element type sorted by name and one column per public dialect', () => {
  const lines = table(FIXTURE).trimEnd().split('\n');
  assert.equal(lines[0], '| Element | ngspice | LTspice | PSpice | HSPICE | Xyce | Spectre | Drawn as |');
  assert.equal(lines[1], '| --- | --- | --- | --- | --- | --- | --- | --- |');
  assert.deepEqual(lines.slice(2).map((line) => line.split(' | ')[0]!.slice(2)), ['digital gate', 'memristor', 'resistor', 'subcircuit', 'VDMOS']);
  assert.equal(lines[4], '| resistor | `R` | `R`; `I` with `R=` | — | — | — | `resistor`, `res` | the `resistor` symbol |');
});

test('splice replaces only what lies between the markers and refuses a README without them', () => {
  assert.equal(splice(`before\n${START}\nold\n${END}\nafter`, `${START}\nnew\n${END}`), `before\n${START}\nnew\n${END}\nafter`);
  assert.throws(() => splice('no markers', 'x'), /lacks the markers/);
});

test('the committed README table is byte-identical to a fresh generation from the catalogue', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  assert.equal(splice(readme, section()), readme, 'README.md is stale: run npm run readme:table');
});
