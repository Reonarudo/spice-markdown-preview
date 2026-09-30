import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PUBLIC_DIALECTS } from '../src/catalogue/dialects';

const require = createRequire(import.meta.url);
const DIR = 'vendor/parsers';

const sha256 = (name: string) => createHash('sha256').update(readFileSync(`${DIR}/${name}`)).digest('hex');

function sums(): Map<string, string> {
  const lines = readFileSync(`${DIR}/SHA256SUMS`, 'utf8').trim().split('\n');
  assert.ok(lines.length > 0, 'SHA256SUMS is empty');
  return new Map(lines.map((line) => {
    const match = /^([0-9a-f]{64})  (\S+)$/.exec(line);
    assert.ok(match, `SHA256SUMS line is not "<sha256>  <name>": ${line}`);
    return [match[2]!, match[1]!];
  }));
}

test('every vendored parser and the provenance match SHA256SUMS, and nothing unlisted is vendored', () => {
  const pinned = sums();
  for (const [name, expected] of pinned) {
    // A line-ending conversion on Windows would change these bytes: .gitattributes marks them -text.
    assert.equal(sha256(name), expected, `${name} differs from SHA256SUMS: run npm run grammars`);
  }
  const present = readdirSync(DIR).filter((name) => name !== 'SHA256SUMS').sort();
  assert.deepEqual(present, [...pinned.keys()].sort(), 'every file in vendor/parsers/ except SHA256SUMS is pinned');
  assert.ok(pinned.has('provenance.json'));
  assert.ok(pinned.has('ngspice.cjs'), 'the first vendored module is ngspice');
});

test('the provenance records the pinned tools, every module, and the inputs it was built from', () => {
  const provenance = JSON.parse(readFileSync(`${DIR}/provenance.json`, 'utf8')) as {
    tools: Record<string, string>;
    modules: string[];
    inputs: Record<string, string>;
  };
  assert.deepEqual(provenance.tools, { bison: '3.8.2', flex: '2.6.4', emscripten: '6.0.9' });
  const modules = readdirSync(DIR).filter((name) => name.endsWith('.cjs')).sort();
  assert.deepEqual([...provenance.modules].sort(), modules);
  for (const module of modules) {
    const dialect = module.replace(/\.cjs$/, '');
    assert.ok((PUBLIC_DIALECTS as readonly string[]).includes(dialect) || dialect === 'spectre-spice', `${module} is not a dialect`);
    assert.ok(`grammar/generated/${dialect}.l` in provenance.inputs, `${module} was built from grammar/generated/${dialect}.l`);
    assert.ok(`grammar/generated/${dialect}.y` in provenance.inputs, `${module} was built from grammar/generated/${dialect}.y`);
  }
  for (const [input, digest] of Object.entries(provenance.inputs)) {
    assert.match(input, /^grammar\/(driver|generated)\//, input);
    const actual = createHash('sha256').update(readFileSync(input)).digest('hex');
    assert.equal(actual, digest, `${input} changed since the modules were built: run npm run grammars`);
  }
});

test('each vendored module is awaited once and then parses synchronously to the contract', async () => {
  for (const module of readdirSync(DIR).filter((name) => name.endsWith('.cjs'))) {
    const factory = require(`../${DIR}/${module}`) as () => Promise<{
      _netlist_parse(pointer: number, length: number): number;
      _malloc(bytes: number): number;
      _free(pointer: number): void;
      lengthBytesUTF8(text: string): number;
      stringToUTF8(text: string, pointer: number, bytes: number): void;
      UTF8ToString(pointer: number): string;
    }>;
    const instance = await factory();
    const parse = (text: string) => {
      const bytes = instance.lengthBytesUTF8(text);
      const pointer = instance._malloc(bytes + 1);
      instance.stringToUTF8(text, pointer, bytes + 1);
      const out = instance.UTF8ToString(instance._netlist_parse(pointer, bytes));
      instance._free(pointer);
      return JSON.parse(out) as { contract: number; cards: unknown[] };
    };
    const result = parse('R1 a b 1k\n');
    assert.equal(result.contract, 1, module);
    assert.equal(result.cards.length, 1, module);
    assert.deepEqual(parse(''), { contract: 1, cards: [] }, module);
  }
});
