import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compose, composeTree, generatedSections, type GeneratedSections } from '../scripts/grammars/compose';
import { DIALECTS } from '../src/catalogue/dialects';
import type { ElementType } from '../src/catalogue/types';

/** A generated-section set with nothing in it, for tests about the hand-written mechanism. */
const NO_GENERATED: GeneratedSections = {};

test('a base with no overlay is emitted whole, each section under a banner naming its source', () => {
  const base = {
    name: 'grammar/spice',
    l: ['%option reentrant', '//@ section comments', '\\*[^\\n]*\\n  { }', '//@ end', '%%'].join('\n'),
    y: ['%require "3.8"', '//@ section heads', 'card: HEAD ;', '//@ end'].join('\n')
  };
  const { l, y } = compose(base, undefined, NO_GENERATED);
  assert.equal(l, ['%option reentrant', '  /* from grammar/spice/scanner.l: comments */', '\\*[^\\n]*\\n  { }', '%%', ''].join('\n'));
  assert.equal(y, ['%require "3.8"', '  /* from grammar/spice/parser.y: heads */', 'card: HEAD ;', ''].join('\n'));
});

const BASE = {
  name: 'grammar/spice',
  l: ['//@ section comments', 'base-comments', '//@ end', '//@ section continuation', 'base-continuation', '//@ end'].join('\n'),
  y: ['//@ section heads', 'base-heads', '//@ end']
    .join('\n')
};

test('an overlay section replaces the base section whole, and an absent one keeps the base section', () => {
  const overlay = {
    name: 'grammar/dialects/ngspice',
    l: ['/* ngspice: `$` after whitespace starts a comment */', '', '//@ section comments', 'base-comments', 'dollar-comments', '//@ end'].join('\n')
  };
  const { l, y } = compose(BASE, overlay, NO_GENERATED);
  assert.equal(l, [
    '  /* from grammar/dialects/ngspice/scanner.l: comments */', 'base-comments', 'dollar-comments',
    '  /* from grammar/spice/scanner.l: continuation */', 'base-continuation', ''
  ].join('\n'));
  assert.equal(y, ['  /* from grammar/spice/parser.y: heads */', 'base-heads', ''].join('\n'), 'no overlay parser.y keeps every base section');
});

test('an overlay may not name a section the base does not declare, fill a generated section, or write outside its sections', () => {
  const base = { ...BASE, l: BASE.l + '\n//@ section generated:keywords\n//@ end' };
  const at = (name: string, l: string) => () => compose(base, { name, l }, { 'generated:keywords': '' });
  assert.throws(at('grammar/dialects/xyce', '//@ section quoting\nx\n//@ end'), { name: 'ComposeError', message: /grammar\/dialects\/xyce\/scanner\.l: section quoting is not declared by grammar\/spice\/scanner\.l/ });
  assert.throws(at('grammar/dialects/xyce', '//@ section generated:keywords\nx\n//@ end'), { message: /generated:keywords .*may not appear in an overlay/ });
  assert.throws(at('grammar/dialects/xyce', '%option caseless\n//@ section comments\nx\n//@ end'), { message: /scanner\.l: text outside a section: %option caseless/ });
  assert.throws(at('grammar/dialects/xyce', '//@ section comments\n//@ section continuation\n//@ end'), { message: /xyce\/scanner\.l:2: section continuation opens inside section comments/ });
  assert.throws(at('grammar/dialects/xyce', '//@ section comments\nx'), { message: /section comments is never ended/ });
  assert.throws(() => compose({ ...BASE, l: '//@ section generated:nothing\n//@ end' }, undefined, NO_GENERATED), { message: /grammar\/spice\/scanner\.l: no generator for section generated:nothing/ });
});

test('an overlay section that is present but empty removes the base section', () => {
  const overlay = { name: 'grammar/dialects/hspice', l: ['//@ section continuation', '', '//@ end'].join('\n') };
  const { l } = compose(BASE, overlay, NO_GENERATED);
  assert.equal(l, [
    '  /* from grammar/spice/scanner.l: comments */', 'base-comments',
    '  /* section continuation removed by grammar/dialects/hspice/scanner.l */', ''
  ].join('\n'));
});

/** A small catalogue: two dependent sources sharing `POLY`, a Xyce digital gate, two `Y` types, Spectre masters. */
const FIXTURE: Record<string, ElementType> = {
  vcvs: {
    name: 'VCVS',
    spellings: [{ dialect: 'ngspice', letter: 'E' }, { dialect: 'xyce', letter: 'E' }, { dialect: 'spectre', master: 'vcvs' }],
    forms: [
      { terminals: [], nodesEnd: 'count' },
      { match: { keyword: ['POLY', 'VALUE'] }, terminals: [], nodesEnd: 'count' },
      { match: { keyword: ['LAPLACE'] }, dialects: ['hspice'], terminals: [], nodesEnd: 'count' }
    ],
    tail: 'value',
    draw: 'none'
  },
  vccs: {
    name: 'VCCS',
    spellings: [{ dialect: 'ngspice', letter: 'G' }],
    forms: [{ terminals: [], nodesEnd: 'count' }, { match: { keyword: ['POLY'] }, terminals: [], nodesEnd: 'count' }],
    tail: 'value',
    draw: 'none'
  },
  'digital-gate': {
    name: 'digital gate',
    spellings: [{ dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['NAND', 'AND'] } }],
    forms: [{ match: { keyword: ['AND', 'NAND'] }, terminals: [], nodesEnd: 'count' }],
    tail: 'model',
    draw: 'none'
  },
  memristor: {
    name: 'memristor',
    spellings: [{ dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['MEMRISTOR'] } }],
    forms: [{ terminals: [], nodesEnd: 'count' }],
    tail: 'model',
    draw: 'none'
  },
  'xyce-device': {
    name: 'Xyce device',
    spellings: [{ dialect: 'xyce', letter: 'Y' }],
    forms: [{ terminals: [], nodesEnd: 'all-positional' }],
    tail: 'none',
    draw: 'none'
  },
  mosfet: {
    name: 'MOSFET',
    spellings: [{ dialect: 'spectre', master: 'bsim4' }, { dialect: 'spectre', master: 'mos1' }],
    forms: [{ terminals: [], nodesEnd: 'model' }],
    tail: 'model',
    draw: 'none'
  },
  subcircuit: {
    name: 'subcircuit',
    spellings: [{ dialect: 'spectre', master: '*' }],
    forms: [{ terminals: [], nodesEnd: 'last-positional' }],
    tail: 'value',
    draw: 'none'
  }
};

test('the generated sections spell a dialect’s case rule, letter set, keywords and suffixes from the catalogue, sorted, naming their files', () => {
  const ngspice = generatedSections(DIALECTS.ngspice, FIXTURE);
  assert.equal(ngspice['generated:options'], ['  /* generated from src/catalogue/dialects.ts: ngspice is case-insensitive */', '%option caseless', ''].join('\n'));
  assert.equal(ngspice['generated:letters'], ['  /* generated from src/catalogue/dialects.ts: ngspice letters */', 'ELEMENT_LETTER  [ABCDEFGHIJKLMNOPQRSTUVWXYZ]', ''].join('\n'));
  assert.equal(ngspice['generated:keywords'], [
    '  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */',
    '"POLY"{GROUP}?  { TOKEN(KEYWORD); }',
    '  /* generated from src/catalogue/vcvs.ts */',
    '"VALUE"{GROUP}?  { TOKEN(KEYWORD); }',
    ''
  ].join('\n'), 'the HSPICE-only LAPLACE form is not an ngspice keyword');
  assert.equal(ngspice['generated:masters'], '  /* generated from the catalogue: ngspice has no masters */\n');

  const xyce = generatedSections(DIALECTS.xyce, FIXTURE);
  assert.equal(xyce['generated:keywords'], [
    '  /* generated from src/catalogue/digital-gate.ts */',
    '"AND"{GROUP}?  { TOKEN(KEYWORD); }',
    '  /* generated from src/catalogue/digital-gate.ts */',
    '"NAND"{GROUP}?  { TOKEN(KEYWORD); }',
    '  /* generated from src/catalogue/vcvs.ts */',
    '"POLY"{GROUP}?  { TOKEN(KEYWORD); }',
    '  /* generated from src/catalogue/vcvs.ts */',
    '"VALUE"{GROUP}?  { TOKEN(KEYWORD); }',
    '  /* generated from src/catalogue/memristor.ts */',
    '<LINESTART>"YMEMRISTOR"  { TOKEN(SUFFIX_HEAD); }',
    ''
  ].join('\n'));
  assert.equal(xyce['generated:letters'], ['  /* generated from src/catalogue/dialects.ts: xyce letters */', 'ELEMENT_LETTER  [BCDEFGHIJKLMOPQRSTUVWXYZ]', ''].join('\n'));

  const spectre = generatedSections(DIALECTS.spectre, FIXTURE);
  assert.equal(spectre['generated:options'], '  /* generated from src/catalogue/dialects.ts: spectre is case-sensitive */\n');
  assert.equal(spectre['generated:letters'], '  /* generated from src/catalogue/dialects.ts: spectre has no element letters */\n');
  assert.equal(spectre['generated:masters'], [
    '  /* generated from src/catalogue/mosfet.ts */',
    '"bsim4"  { TOKEN(MASTER); }',
    '  /* generated from src/catalogue/mosfet.ts */',
    '"mos1"  { TOKEN(MASTER); }',
    '  /* generated from src/catalogue/vcvs.ts */',
    '"vcvs"  { TOKEN(MASTER); }',
    ''
  ].join('\n'), 'the fallback master * is not a rule');
});

test('the generator refuses a dialect in which two catalogue entries claim one selector keyword, suffix or master, naming both files', () => {
  const twoGates = { ...FIXTURE, 'digital-adder': { ...FIXTURE['digital-gate']!, spellings: [{ dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['AND'] } }] } as ElementType };
  assert.throws(() => generatedSections(DIALECTS.xyce, twoGates), { name: 'ComposeError', message: /xyce: U AND is claimed by both src\/catalogue\/digital-adder\.ts and src\/catalogue\/digital-gate\.ts/ });
  const twoY = { ...FIXTURE, 'ideal-delay': { ...FIXTURE.memristor! } as ElementType };
  assert.throws(() => generatedSections(DIALECTS.xyce, twoY), { message: /xyce: Y MEMRISTOR is claimed by both src\/catalogue\/ideal-delay\.ts and src\/catalogue\/memristor\.ts/ });
  const twoMasters = { ...FIXTURE, resistor: { ...FIXTURE.mosfet!, spellings: [{ dialect: 'spectre', master: 'bsim4' }] } as ElementType };
  assert.throws(() => generatedSections(DIALECTS.spectre, twoMasters), { message: /spectre: master bsim4 is claimed by both src\/catalogue\/mosfet\.ts and src\/catalogue\/resistor\.ts/ });
  assert.doesNotThrow(() => generatedSections(DIALECTS.ngspice, FIXTURE), 'a form keyword shared by two types, POLY, is not a claim');
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('every dialect names its base, and the committed grammar/generated/ files are byte-identical to a fresh composition of the real tree', () => {
  for (const dialect of Object.values(DIALECTS)) {
    assert.equal(dialect.base, dialect.id === 'spectre' ? 'spectre' : 'spice', dialect.id);
  }
  const results = composeTree(ROOT);
  assert.deepEqual([...results.keys()], Object.keys(DIALECTS), 'the generator loops over every dialect in the table');
  let composed = 0;
  for (const [dialect, result] of results) {
    for (const kind of ['l', 'y'] as const) {
      const file = `${ROOT}grammar/generated/${dialect}.${kind}`;
      if ('skipped' in result) {
        assert.ok(!existsSync(file), `${dialect}: ${result.skipped}, yet ${file} is committed`);
        continue;
      }
      assert.ok(existsSync(file), `${dialect}: run npm run grammars:compose to write ${file}`);
      assert.equal(readFileSync(file, 'utf8'), result[kind], `${file} is stale: run npm run grammars:compose`);
      composed++;
    }
  }
  assert.ok(composed >= 2, 'at least the ngspice grammar is composed');
});
