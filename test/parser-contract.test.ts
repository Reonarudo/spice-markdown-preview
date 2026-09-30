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
import { CONTRACT, type Card, type ParserOutput, type Span, type Token } from '../src/parser/contract';
import { loadParser, parse, type ParserFactory } from '../src/parser/registry';

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
}

const SPICE_FIXTURE: Fixture = {
  text: 'R1 in out 10k\n.model bc547 npn(bf=100)\n',
  cards: [{ kind: 'element', ref: 'R1', letter: 'R' }, { kind: 'directive', name: '.model' }],
  tokens: [['in', 'out', '10k'], ['bc547', 'npn(bf=100)']],
  broken: 'R1 in out 10k\n= 1\n'
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
    broken: 'r1 (in out) resistor r=10k\n= 1\n'
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
    assert.equal(output.error.found.text, '=', dialect);
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

/** The runtime check of the contract: shape, vocabulary, and positions that point back into `text`. */
function checkDocument(output: ParserOutput, text: string, dialect: string): void {
  const lines = text.split(/\r?\n/);
  assert.equal(output.contract, CONTRACT, dialect);
  assert.ok(Array.isArray(output.cards), dialect);
  for (const card of output.cards) checkCard(card, lines, dialect);
  if (output.afterEnd !== undefined) {
    assert.ok(Number.isInteger(output.afterEnd) && output.afterEnd >= 0, `${dialect}: afterEnd ${output.afterEnd}`);
  }
  if (output.error !== undefined) {
    const { error } = output;
    checkSpan(error, lines, dialect);
    assert.equal(typeof error.found.class, 'string', dialect);
    assert.equal(typeof error.found.text, 'string', dialect);
    assert.ok(Array.isArray(error.expected) && error.expected.length > 0, dialect);
    for (const name of error.expected) assert.match(name, /^[a-z][a-z -]*$/, `${dialect}: expected "${name}" is not a string alias`);
    if (error.code !== undefined) assert.equal(typeof error.code, 'string', dialect);
  }
  const keys = Object.keys(output).sort();
  assert.deepEqual(keys.filter((key) => !['contract', 'cards', 'error', 'afterEnd'].includes(key)), [], `${dialect}: unknown keys ${keys}`);
}

function checkCard(card: Card, lines: string[], dialect: string): void {
  checkSpan(card, lines, dialect);
  assert.ok(Array.isArray(card.tokens), dialect);
  if (card.kind === 'element') {
    assert.equal(typeof card.ref, 'string', dialect);
    assert.ok(card.ref.length > 0, dialect);
    assert.ok((card.letter === undefined) !== (card.master === undefined), `${dialect}: exactly one of letter and master`);
    if (card.letter !== undefined) assert.match(card.letter, /^[A-Z]$/, `${dialect}: letter "${card.letter}"`);
    if (card.selector !== undefined) assert.equal(typeof card.selector, 'string', dialect);
    if (card.nodesClosed !== undefined) assert.equal(card.nodesClosed, true, dialect);
  } else {
    assert.equal(card.kind, 'directive', dialect);
    assert.equal(card.name, card.name.toLowerCase(), `${dialect}: directive name "${card.name}" is lower-cased`);
  }
  for (const token of card.tokens) checkToken(token, lines, dialect);
}

function checkToken(token: Token, lines: string[], dialect: string): void {
  checkSpan(token, lines, dialect);
  assert.ok(['word', 'pair', 'group', 'keyword'].includes(token.class), `${dialect}: token class "${token.class}"`);
  const written = lines[token.line - 1]!.slice(token.column, token.end);
  if (token.class === 'pair') {
    assert.equal(typeof token.key, 'string', dialect);
    assert.equal(typeof token.value, 'string', dialect);
    assert.equal(token.text, `${token.key}=${token.value}`, dialect);
    assert.equal(written.replace(/\s+/g, ''), token.text, `${dialect}: pair "${written}" at ${token.line}:${token.column}`);
  } else {
    assert.equal(token.key, undefined, dialect);
    assert.equal(token.value, undefined, dialect);
    assert.equal(written, token.text, `${dialect}: ${token.class} "${token.text}" at ${token.line}:${token.column}`);
  }
}

function checkSpan(span: Span, lines: string[], dialect: string): void {
  assert.ok(Number.isInteger(span.line) && span.line >= 1 && span.line <= lines.length, `${dialect}: line ${span.line}`);
  assert.ok(Number.isInteger(span.column) && span.column >= 0, `${dialect}: column ${span.column}`);
  assert.ok(Number.isInteger(span.end) && span.end > span.column, `${dialect}: end ${span.end} after column ${span.column}`);
  assert.ok(span.end <= lines[span.line - 1]!.length, `${dialect}: end ${span.end} inside line ${span.line}`);
}
