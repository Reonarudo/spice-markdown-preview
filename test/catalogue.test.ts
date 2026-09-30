import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, ELEMENT_TYPE_IDS, elementTypeForLetter, elementTypeForMaster, spellingsOf, type ElementTypeId } from '../src/catalogue/index';
import { DIALECTS, PUBLIC_DIALECTS } from '../src/catalogue/dialects';
import type { DialectId, Form, Select, Terminal, Terminals } from '../src/catalogue/types';
import { loadSymbols } from '../src/schematic';

const symbols = loadSymbols(readFileSync(new URL('../src/skin/symbols.svg', import.meta.url), 'utf8'));

function terminals(list: Terminals): Terminal[] {
  return list.flatMap((entry) => ('repeat' in entry ? [...entry.terminals] : [entry]));
}

/** The symbol ids a type may be drawn with. */
function symbolIds(id: ElementTypeId): string[] {
  const { draw } = CATALOGUE[id];
  if (draw === 'none' || !('symbol' in draw)) return [];
  if (typeof draw.symbol === 'string') return [draw.symbol];
  const { default: fallback, byModelType = {}, byModelFlag = {}, byModelParameter = {} } = draw.symbol;
  return [fallback, ...Object.values(byModelType), ...Object.values(byModelFlag), ...Object.values(byModelParameter).flatMap((values) => Object.values(values))];
}

/** The forms of a type that apply in a dialect; a default written for the dialect replaces the general one. */
function formsIn(id: ElementTypeId, dialect: DialectId): Form[] {
  const applicable = CATALOGUE[id].forms.filter((form) => form.dialects === undefined || form.dialects.includes(dialect));
  const ownDefault = applicable.some((form) => form.match === undefined && form.dialects !== undefined);
  return ownDefault ? applicable.filter((form) => form.match !== undefined || form.dialects !== undefined) : applicable;
}

test('every symbol a type is drawn with exists, and every required terminal of its default form is a pin of it', () => {
  for (const id of ELEMENT_TYPE_IDS) {
    for (const symbolId of symbolIds(id)) {
      const symbol = symbols.get(symbolId);
      assert.ok(symbol, `${id}: symbols.svg has no ${symbolId}`);
      const defaultForm = CATALOGUE[id].forms.find((form) => form.match === undefined && form.dialects === undefined);
      assert.ok(defaultForm, `${id}: no default form`);
      for (const terminal of terminals(defaultForm.terminals)) {
        if (terminal.optional) continue;
        // A P-channel or PNP symbol lists the same pins as its N-type twin, and the 3-pin MOSFET has no B.
        if (symbolId.endsWith('3') && terminal.name === 'B') continue;
        assert.ok(symbol.pins.has(terminal.name), `${id}: symbol ${symbolId} has no pin ${terminal.name}`);
      }
    }
  }
});

function selectorValues(select: Select): string[] {
  switch (select.by) {
    case 'model-type': return select.types.map((type) => `${type}@${select.levels?.join('/') ?? '*'}`);
    case 'suffix': return [...select.suffixes];
    case 'keyword': return [...select.keywords];
    case 'pair': return select.keys.map((key) => key.toUpperCase());
  }
}

test('types sharing a letter in one dialect have disjoint selectors of one kind, and at most one fallback', () => {
  for (const dialect of Object.keys(DIALECTS) as DialectId[]) {
    if (dialect === 'spectre') continue;
    const byLetter = new Map<string, { id: ElementTypeId; select: Select | undefined }[]>();
    for (const { id, spelling } of spellingsOf(dialect)) {
      if (spelling.dialect === 'spectre') continue;
      const list = byLetter.get(spelling.letter) ?? [];
      list.push({ id, select: spelling.select });
      byLetter.set(spelling.letter, list);
    }
    for (const [letter, entries] of byLetter) {
      const fallbacks = entries.filter((entry) => entry.select === undefined);
      assert.ok(fallbacks.length <= 1, `${dialect} ${letter}: several fallbacks: ${fallbacks.map((entry) => entry.id).join(', ')}`);
      const selected = entries.filter((entry) => entry.select !== undefined);
      const kinds = new Set(selected.map((entry) => entry.select!.by));
      assert.ok(kinds.size <= 1, `${dialect} ${letter}: selectors of different kinds: ${[...kinds].join(', ')}`);
      const seen = new Map<string, ElementTypeId>();
      for (const entry of selected) {
        for (const value of selectorValues(entry.select!)) {
          const other = seen.get(value);
          assert.equal(other, undefined, `${dialect} ${letter}: ${value} selects both ${other} and ${entry.id}`);
          seen.set(value, entry.id);
        }
      }
    }
  }
});

test('every letter of every dialect has a spelling, and every spelling uses a letter the dialect has', () => {
  for (const dialect of Object.values(DIALECTS)) {
    if (dialect.id === 'spectre') continue;
    const spelt = new Set(spellingsOf(dialect.id).map(({ spelling }) => (spelling.dialect === 'spectre' ? '' : spelling.letter)));
    for (const letter of dialect.letters) assert.ok(spelt.has(letter), `${dialect.id}: no element type spells ${letter}`);
    for (const letter of spelt) assert.ok(dialect.letters.includes(letter), `${dialect.id}: ${letter} is spelt but not in the letter set`);
  }
});

test('Spectre masters are unique, none is an analysis or control keyword, and unknown masters are subcircuits', () => {
  const masters = spellingsOf('spectre').map(({ spelling }) => (spelling.dialect === 'spectre' ? spelling.master : ''));
  assert.equal(new Set(masters).size, masters.length, 'a master is spelt twice');
  for (const master of masters) assert.ok(!DIALECTS.spectre.skipMasters!.includes(master), `${master} is both an element and a skipped master`);
  assert.equal(elementTypeForMaster('bsim4'), 'mosfet');
  assert.equal(elementTypeForMaster('nch_mac'), 'subcircuit');
});

test('each type has one default form per dialect, or a matching form for every keyword that selects it', () => {
  for (const id of ELEMENT_TYPE_IDS) {
    const type = CATALOGUE[id];
    for (const spelling of type.spellings) {
      const forms = formsIn(id, spelling.dialect);
      const defaults = forms.filter((form) => form.match === undefined);
      assert.ok(defaults.length <= 1, `${id} in ${spelling.dialect}: ${defaults.length} default forms`);
      if (defaults.length === 1) continue;
      const select = spelling.dialect === 'spectre' ? undefined : spelling.select;
      assert.ok(select?.by === 'keyword', `${id} in ${spelling.dialect}: no default form and no keyword selector`);
      for (const keyword of select.keywords) {
        const matched = forms.some((form) => form.match !== undefined && 'keyword' in form.match && form.match.keyword.includes(keyword));
        assert.ok(matched, `${id} in ${spelling.dialect}: no form for ${keyword}`);
      }
    }
  }
});

test('every form connects a node — a terminal, a repeat or a positional rule — unless the type draws nothing', () => {
  for (const id of ELEMENT_TYPE_IDS) {
    const type = CATALOGUE[id];
    for (const form of type.forms) {
      const connects = form.terminals.length > 0 || form.nodesEnd === 'last-positional' || form.nodesEnd === 'all-positional';
      assert.ok(connects || type.draw === 'none', `${id}: a form connects nothing yet the type is drawn`);
      for (const entry of form.terminals) {
        if (!('repeat' in entry)) continue;
        for (const name of entry.repeat.split('*')) {
          assert.ok(/^\d+$/.test(name) || form.counts?.[name] !== undefined, `${id}: repeat ${entry.repeat} names no count`);
        }
        for (const terminal of entry.terminals) assert.ok(terminal.name.includes('#'), `${id}: repeated terminal ${terminal.name} has no # for its index`);
      }
    }
  }
});

test('a letter resolves to its fallback until a selector matches', () => {
  assert.equal(elementTypeForLetter('ngspice', 'R'), 'resistor');
  assert.equal(elementTypeForLetter('ngspice', 'm'), 'mosfet');
  assert.equal(elementTypeForLetter('ngspice', 'M', { modelType: 'vdmos' }), 'vdmos');
  assert.equal(elementTypeForLetter('ltspice', 'I'), 'isource');
  assert.equal(elementTypeForLetter('ltspice', 'I', { pairKeys: ['R'] }), 'resistor');
  assert.equal(elementTypeForLetter('ltspice', 'Z', { modelType: 'pigbt' }), 'igbt');
  assert.equal(elementTypeForLetter('pspice', 'Z'), 'igbt');
  assert.equal(elementTypeForLetter('pspice', 'U', { keywords: ['NAND'] }), 'digital-gate');
  assert.equal(elementTypeForLetter('pspice', 'U'), undefined, 'a digital U without a known type has no fallback');
  assert.equal(elementTypeForLetter('xyce', 'Y', { suffix: 'MEMRISTOR' }), 'memristor');
  assert.equal(elementTypeForLetter('xyce', 'Y', { suffix: 'ACC' }), 'xyce-device');
  assert.equal(elementTypeForLetter('xyce', 'M', { modelType: 'nmos', modelLevel: 18 }), 'vdmos');
  assert.equal(elementTypeForLetter('xyce', 'M', { modelType: 'nmos', modelLevel: 14 }), 'mosfet');
  assert.equal(elementTypeForLetter('hspice', 'A'), undefined);
});

test('the public dialects are the six a fence may name, and the internal one is marked', () => {
  assert.deepEqual(PUBLIC_DIALECTS, ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre']);
  for (const dialect of Object.values(DIALECTS)) {
    assert.equal(dialect.internal === true, !PUBLIC_DIALECTS.includes(dialect.id), `${dialect.id}`);
    for (const pattern of dialect.globalNodePatterns) assert.doesNotThrow(() => new RegExp(pattern));
  }
});
