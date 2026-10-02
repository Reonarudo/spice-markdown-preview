/**
 * Every vendored parser module is run on a small fixture in its dialect and its output checked
 * against the contract (ADR 0008, `src/parser/contract.ts`) at runtime — the types say what the
 * shape is; this test says the bytes in `vendor/parsers/` actually produce it.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DialectId } from '../src/catalogue/types';
import { CONTRACT, type Card } from '../src/parser/contract';
import { loadParser, parse, type ParserFactory } from '../src/parser/registry';
import { checkDocument } from './helpers/parser-output';

const require = createRequire(import.meta.url);
const DIR = 'vendor/parsers';
const modules = readdirSync(DIR).filter((name) => name.endsWith('.cjs')).map((name) => name.replace(/\.cjs$/, '') as DialectId);

interface Fixture {
  /** A well-formed netlist, and what its cards must be: kind, head, and the tokens' texts. */
  text: string;
  cards: ({ kind: 'element'; ref: string; letter?: string; master?: string } | { kind: 'directive'; name: string })[];
  tokens: string[][];
  /** A netlist whose second line is structurally wrong: the first card is kept, the error points at line 2. */
  broken: string;
  /** The text of the token the error names. */
  brokenFound: string;
}

/**
 * `.model` cards are trimmed to the name, the bare type and a `level` pair (ADR 0008); a group may close on a `+` line, its
 * pieces joined by one blank; `1R` is no element in any SPICE dialect.
 */
const SPICE_FIXTURE: Fixture = {
  text: 'R1 in out 10k\n.model bc547 npn(bf=100 level=1)\nV1 in 0 PWL(0 0\n+ 1m 5)\n',
  cards: [{ kind: 'element', ref: 'R1', letter: 'R' }, { kind: 'directive', name: '.model' }, { kind: 'element', ref: 'V1', letter: 'V' }],
  tokens: [['in', 'out', '10k'], ['bc547', 'npn', 'level=1'], ['in', '0', 'PWL(0 0 1m 5)']],
  broken: 'R1 in out 10k\n1R a b\n',
  brokenFound: '1R'
};

/** One fixture per dialect a module may be built for; a module without one fails below. */
const FIXTURES: Partial<Record<DialectId, Fixture>> = {
  ngspice: SPICE_FIXTURE,
  ltspice: SPICE_FIXTURE,
  pspice: SPICE_FIXTURE,
  hspice: SPICE_FIXTURE,
  xyce: SPICE_FIXTURE,
  'spectre-spice': SPICE_FIXTURE,
  spectre: {
    text: 'r1 (in out) resistor r=10k\n',
    cards: [{ kind: 'element', ref: 'r1', master: 'resistor' }],
    tokens: [['in', 'out', 'r=10k']],
    broken: 'r1 (in out) resistor r=10k\n= 1\n',
    brokenFound: '='
  }
};

before(async () => {
  for (const dialect of modules) await loadParser(dialect, require(`../${DIR}/${dialect}.cjs`) as ParserFactory);
});

test('a module is vendored for at least one dialect, and every module has a fixture', () => {
  assert.ok(modules.length > 0, `no modules in ${DIR}`);
  for (const dialect of modules) assert.ok(FIXTURES[dialect], `add a fixture for ${dialect} to test/parser-contract.test.ts`);
});

test('the empty file is the empty document', () => {
  for (const dialect of modules) assert.deepEqual(parse(dialect, ''), { contract: CONTRACT, cards: [] }, dialect);
});

test('each module reads its fixture into the expected cards, and every field obeys the contract', () => {
  for (const dialect of modules) {
    const fixture = FIXTURES[dialect]!;
    const output = parse(dialect, fixture.text);
    checkDocument(output, fixture.text, dialect);
    assert.equal(output.error, undefined, `${dialect}: ${JSON.stringify(output.error)}`);
    assert.deepEqual(output.cards.map(head), fixture.cards, dialect);
    assert.deepEqual(output.cards.map((card) => card.tokens.map((token) => token.text)), fixture.tokens, dialect);
  }
});

test('on a structural error the cards before it are kept and the error is positioned in the contract vocabulary', () => {
  for (const dialect of modules) {
    const fixture = FIXTURES[dialect]!;
    const output = parse(dialect, fixture.broken);
    checkDocument(output, fixture.broken, dialect);
    assert.ok(output.error, `${dialect}: expected an error`);
    assert.equal(output.cards.length, 1, `${dialect}: the card before the error is kept`);
    assert.equal(output.error.line, 2, dialect);
    assert.equal(output.error.column, 0, dialect);
    assert.equal(output.error.found.text, fixture.brokenFound, dialect);
  }
});

test('a token in the fixture keeps its position, so a message can point at it', () => {
  for (const dialect of modules) {
    const fixture = FIXTURES[dialect]!;
    const [first] = parse(dialect, fixture.text).cards;
    assert.equal(first!.line, 1, dialect);
    assert.equal(first!.column, 0, dialect);
    // Every fixture's first card has a node named `in` as its first token, so its column is known.
    const token = first!.tokens[0]!;
    assert.equal(token.text, 'in', dialect);
    assert.equal(token.line, 1, dialect);
    assert.equal(fixture.text.split('\n')[0]!.indexOf('in'), token.column, dialect);
  }
});

function head(card: Card) {
  if (card.kind === 'directive') return { kind: card.kind, name: card.name };
  return { kind: card.kind, ref: card.ref, ...(card.letter !== undefined ? { letter: card.letter } : {}), ...(card.master !== undefined ? { master: card.master } : {}) };
}
