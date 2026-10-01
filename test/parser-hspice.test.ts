/**
 * The vendored HSPICE module against what HSPICE B-2008.09 accepts, one case per finding of the
 * HSPICE research (Redmine #1187) that changes how a line is cut into tokens. The module only
 * classifies (ADR 0008): these tests say which cards and tokens a line becomes, never what is
 * drawn — `test/netlist-hspice.test.ts` does that.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALECTS } from '../src/catalogue/dialects';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { parse } from '../src/parser/registry';
import { loadHspice } from './helpers/hspice';
import { checkDocument } from './helpers/parser-output';

before(loadHspice);

/** Parse, check the contract, and return the document. */
function read(text: string): ParserOutput {
  const output = parse('hspice', text);
  checkDocument(output, text, JSON.stringify(text));
  return output;
}

/** The cards of a well-formed netlist, compactly: `R1:R a b 1k`, `.model:m npn level=2`, `X1:X( a b ) sub`. */
function cards(text: string): string[] {
  const output = read(text);
  assert.equal(output.error, undefined, `${JSON.stringify(text)}: ${JSON.stringify(output.error)}`);
  return output.cards.map(compact);
}

function compact(card: Card): string {
  const head = card.kind === 'element' ? `${card.ref}:${card.letter}${card.selector !== undefined ? `/${card.selector}` : ''}${card.nodesClosed ? '(' : ''}` : card.name;
  return [head, ...card.tokens.map(token)].join(' ');
}

function token(t: Token): string {
  switch (t.class) {
    case 'word': return t.text;
    case 'keyword': return `K:${t.text}`;
    case 'group': return `G:${t.text}`;
    case 'pair': return `P:${t.text}`;
  }
}

function error(text: string) {
  const output = read(text);
  assert.ok(output.error, `${JSON.stringify(text)}: expected an error`);
  return { ...output.error, cards: output.cards.map(compact) };
}

// --- Comments (UG p.55–56, 60; disagreements 1–3): `*` lines, `$` after a blank, a comma or a number ----

test('* at the start of a line and $ as the first non-blank character are whole-line comments', () => {
  assert.deepEqual(cards('* amplifier\n  * indented\n$ MAY THE FORCE BE WITH YOU\n   $ indented dollar\nR1 a b 1k\n'), ['R1:R a b 1k']);
});

test('$ after a blank or a comma starts a comment; after a number it ends the number and the line, so 1k$x is 1k and 1$ loses a node', () => {
  assert.deepEqual(cards('R1 a b 1k $ load\nR2 a b 2k,$ comma\n.PARAM a=1k$comment b=1w$x\nR3 1$ 2 1k\nC1 a b .5u$c\n'), [
    'R1:R a b 1k',
    'R2:R a b 2k',
    '.param P:a=1k',
    'R3:R 1',
    'C1:C a b .5u'
  ]);
});

test('$ inside a name that does not start with a digit is a name character', () => {
  assert.deepEqual(cards('R1 a$b out 1k\nR2 n$1 0 2k\nX1 in out sub$2\n'), ['R1:R a$b out 1k', 'R2:R n$1 0 2k', 'X1:X in out sub$2']);
});

test('; is a name character, not a comment, and // is text', () => {
  assert.deepEqual(cards('R1 a;b out 1k\nR2 a b 2k ; not a comment\nR3 a b 3k//x\n.INCLUDE \'biasckt.inc\'; $ semicolon ignored\n'), [
    'R1:R a;b out 1k',
    'R2:R a b 2k ; not a comment',
    'R3:R a b 3k//x',
    ".include G:'biasckt.inc' ;"
  ]);
  const found = error('R1 a b 1k\n// not a comment here\n');
  assert.equal(found.code, 'not-an-element');
  assert.deepEqual([found.line, found.found.text, found.cards], [2, '//', ['R1:R a b 1k']]);
});

// --- Continuation (UG p.40, 44; disagreement 4): `+`, and a blank then `\` or `\\` at the end of a line ----

test('+ continues the previous card across comment and blank lines, and a blank then \\ or \\\\ at the end of a line continues it too', () => {
  const output = read('.MODEL n1 NMOS\n* comment between\n+ LEVEL=3\nV1 in 0 PWL 0 0 \\\n1n 1 \\\\\n2n 0\nR1 a b 1k\n');
  assert.deepEqual(output.cards.map(compact), ['.model n1 NMOS P:LEVEL=3', 'V1:V in 0 K:PWL 0 0 1n 1 2n 0', 'R1:R a b 1k']);
  assert.deepEqual(output.cards[1]!.tokens.map((t) => t.line), [4, 4, 4, 4, 4, 5, 5, 6, 6]);
});

test('a backslash with no blank before it is text, and a + line with nothing before it is an orphan', () => {
  assert.deepEqual(cards('R1 a b 1k\\\nR2 c d 2k\n'), ['R1:R a b 1k\\', 'R2:R c d 2k']);
  assert.equal(error('+ R1 a b 1k\n').code, 'orphan-continuation');
});

// --- Heads (UG p.46–47, 57; disagreements 9–13): B S W U P are HSPICE devices; no A N O Y Z ----------

test('every HSPICE element letter opens an element card, upper-cased, P included', () => {
  for (const letter of DIALECTS.hspice.letters) {
    const lower = letter.toLowerCase();
    assert.deepEqual(cards(`${lower}1 a b c\n`), [`${lower}1:${letter} a b c`]);
  }
  assert.ok(['B', 'P', 'S', 'U', 'W'].every((letter) => DIALECTS.hspice.letters.includes(letter)));
});

test('A, N, O, Y and Z are not HSPICE elements', () => {
  for (const letter of ['A', 'N', 'O', 'Y', 'Z']) {
    const found = error(`${letter}1 a b c\n`);
    assert.equal(found.code, 'not-an-element', letter);
    assert.equal(found.found.text, `${letter}1`);
  }
});

// --- Quoting (CR p.208, 265; UG p.46, 50; disagreements 5 and 6): '…' and "…" expressions keep their spaces; { } are a group ----

test("'…' and \"…\" are groups that may hold spaces and comment characters; {…} is a group too", () => {
  assert.deepEqual(cards("M1 d g s b nch W='Strength * 2u' L=1u\nR2 1 0 'abs(v(c)) + abs(v(d))'\n.PARAM p=\"(m1 > 1) && (m2 < 2)\" q='1k $ not a comment'\nR3 a b {x}\n"), [
    "M1:M d g s b nch P:W='Strength * 2u' P:L=1u",
    "R2:R 1 0 G:'abs(v(c)) + abs(v(d))'",
    ".param P:p=\"(m1 > 1) && (m2 < 2)\" P:q='1k $ not a comment'",
    'R3:R a b G:{x}'
  ]);
});

// --- Dependent sources (UG p.216–253; disagreements 14–16): every keyword is one token, bare POLY included ----

test('VCVS, POLY with or without a count, the gates, LAPLACE, DELAY, POLE, FREQ, FOSTER, OPAMP, TRANSFORMER, PWL and the two-node VOL=, CUR= and NOISE= forms', () => {
  assert.deepEqual(cards([
    'E1 2 3 VCVS 14 1 2.0',
    'E2 3 4 POLY 21 17 10.5 2.1 1.75',
    'E3 3 4 POLY(2) 21 17 5 6 10.5 2.1 1.75',
    'E4 1 0 AND(2) 3 0 4 0 0,0 1,1',
    'E5 1 0 LAPLACE 3 0 1 / 1 1',
    'E6 1 0 DELAY 3 0 TD=1n',
    'E7 1 0 POLE 3 0 1 / 1 1 2',
    'E8 1 0 FREQ 3 0 1k 0 0 10k -3 -45',
    'E9 1 0 FOSTER 3 0 1 (1,2)/(3,4)',
    'E10 1 0 OPAMP 3 0',
    'E11 1 0 TRANSFORMER 3 0 10',
    'E12 1 0 PWL(1) 3 0 0,0 1,1',
    "E13 1 0 VOL='v(3)*2'",
    "G1 1 0 CUR='v(3)*2'",
    "G2 1 0 NOISE='1e-15'",
    'G3 1 0 VCR 3 0 1k',
    'G4 1 0 VCCAP 3 0 1p',
    'G5 1 0 NPWL(1) 3 0 0,0 1,1'
  ].join('\n') + '\n'), [
    'E1:E 2 3 K:VCVS 14 1 2.0',
    'E2:E 3 4 K:POLY 21 17 10.5 2.1 1.75',
    'E3:E 3 4 K:POLY(2) 21 17 5 6 10.5 2.1 1.75',
    'E4:E 1 0 K:AND(2) 3 0 4 0 0 0 1 1',
    'E5:E 1 0 K:LAPLACE 3 0 1 / 1 1',
    'E6:E 1 0 K:DELAY 3 0 P:TD=1n',
    'E7:E 1 0 K:POLE 3 0 1 / 1 1 2',
    'E8:E 1 0 K:FREQ 3 0 1k 0 0 10k -3 -45',
    'E9:E 1 0 K:FOSTER 3 0 1 G:(1,2) /(3,4)',
    'E10:E 1 0 K:OPAMP 3 0',
    'E11:E 1 0 K:TRANSFORMER 3 0 10',
    'E12:E 1 0 K:PWL(1) 3 0 0 0 1 1',
    "E13:E 1 0 P:VOL='v(3)*2'",
    "G1:G 1 0 P:CUR='v(3)*2'",
    "G2:G 1 0 P:NOISE='1e-15'",
    'G3:G 1 0 K:VCR 3 0 1k',
    'G4:G 1 0 K:VCCAP 3 0 1p',
    'G5:G 1 0 K:NPWL(1) 3 0 0 0 1 1'
  ]);
});

// --- Subcircuits and models (CR p.86, 91, 147–148, 188–193; SH 15-8; disagreements 20 and 21) ----------

test('.MACRO and .EOM are directives like .SUBCKT and .ENDS; a model name may carry a selector suffix; a model keeps its type and level', () => {
  assert.deepEqual(cards('.MACRO INV IN OUT VDD VSS W=10 L=1\nM1 OUT IN VSS VSS nch W=W L=L\n.EOM INV\n.MODEL nch.1 NMOS LEVEL=49 VTH0=0.5\n.MODEL pch.2 PMOS (LEVEL=49)\n.MODEL rmod R TC1=0.01\n'), [
    '.macro INV IN OUT VDD VSS P:W=10 P:L=1',
    'M1:M OUT IN VSS VSS nch P:W=W P:L=L',
    '.eom INV',
    '.model nch.1 NMOS P:LEVEL=49',
    '.model pch.2 PMOS P:LEVEL=49',
    '.model rmod R'
  ]);
});

test('.LIB with a quoted file and an entry, a section definition closed by .ENDL, and .INC are directives with their arguments', () => {
  assert.deepEqual(cards(".LIB 'models.lib' tt\n.LIB tt\n.ENDL tt\n.INC 'sub.inc'\n.GLOBAL vdd! gnd!\n.CONNECT a b\n"), [
    ".lib G:'models.lib' tt", '.lib tt', '.endl tt', ".inc G:'sub.inc'", '.global vdd! gnd!', '.connect a b'
  ]);
});

// --- Opaque regions (CR p.28–29, 54–58, 227; disagreements 22 and 23): .DATA, .PROTECT and .ALTER ----------

test('.DATA … .ENDDATA returns only its two directive cards, rows with or without + swallowed', () => {
  assert.deepEqual(cards('R1 a 0 1k\n.DATA sweep W1 W2 L CAP\n1u 2u 0.5u 1p\n+ 2u 3u 0.5u 2p\nVBS VDS L\n.ENDDATA\nR2 a 0 2k\n'), ['R1:R a 0 1k', '.data sweep W1 W2 L CAP', '.enddata', 'R2:R a 0 2k']);
  assert.deepEqual(read('.DATA d1 x\n1 2\n').cards.map(compact), ['.data d1 x'], 'an unclosed block ends at the file');
});

test('.PROTECT (or .PROT) … .UNPROTECT (or .UNPROT) swallows the encrypted lines between them', () => {
  assert.deepEqual(cards('.PROTECT\n7h9ZkQ== not a netlist\n.ENDDATA not the closer\n.UNPROTECT\nR1 a 0 1k\n.PROT\n*junk*\n.UNPROT\n'), ['.protect', '.unprotect', 'R1:R a 0 1k', '.prot', '.unprot']);
});

test('.ALTER swallows everything to the first .END, which still ends the read', () => {
  const output = read('R1 a 0 1k\n.ALTER second run\nR1 a 0 2k\n.ALTER third\nR2 a 0 3k\n.END\nR3 a 0 4k\n');
  assert.deepEqual(output.cards.map(compact), ['R1:R a 0 1k', '.alter second run', '.end']);
  assert.equal(output.afterEnd, 1);
  assert.deepEqual(read('R1 a 0 1k\n.ALTER\nR1 a 0 2k\n').cards.map(compact), ['R1:R a 0 1k', '.alter'], 'an .alter with no .end runs to the file');
});

// --- HSPICE-only devices (UG p.154–159, 176–177, 184; SI p.29): their lines are words and pairs, nothing special ----

test('W, U, S, B and P lines keep their nodes as words and their parameters as pairs, nodes and pairs mixed', () => {
  assert.deepEqual(cards("W1 N=2 in1 in2 gnd out1 out2 gnd RLGCMODEL=2_line l=0.1\nU1 in1 in2 refin out1 out2 refout umod L=1\nS1 nd1 nd2 MNAME=smod\nB1 pu pd out in file='x.ibs' model='m' buffer=2\nP1 in 0 port=1 z0=50\n"), [
    'W1:W P:N=2 in1 in2 gnd out1 out2 gnd P:RLGCMODEL=2_line P:l=0.1',
    'U1:U in1 in2 refin out1 out2 refout umod P:L=1',
    'S1:S nd1 nd2 P:MNAME=smod',
    "B1:B pu pd out in P:file='x.ibs' P:model='m' P:buffer=2",
    'P1:P in 0 P:port=1 P:z0=50'
  ]);
});

// --- Several circuits in one file (CR p.82; disagreement 25): the first .END ends the read ----------

test('the first .END stops the read, and the lines of the next simulation are counted', () => {
  const output = read('R1 a 0 1k\n.END $ first\n* second\nR2 a 0 1k\n.END\n');
  assert.deepEqual(output.cards.map(compact), ['R1:R a 0 1k', '.end']);
  assert.equal(output.afterEnd, 2);
});
