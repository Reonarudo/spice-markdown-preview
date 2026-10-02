/**
 * The worker loads a dialect's vendored module the first time a fence in that dialect arrives,
 * through `parserLoader` — the one place that knows a module is `<directory>/<dialect>.cjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DialectId } from '../src/catalogue/types';
import { parserLoader } from '../src/parser/modules';
import { parse } from '../src/parser/registry';

const VENDORED = resolve('vendor/parsers');

/** A directory of modules standing in for `vendor/parsers/`: one stale, one broken, nothing else. */
function fakeParsers(): string {
  const directory = mkdtempSync(join(tmpdir(), 'spice-parsers-'));
  const module = (json: string) => `module.exports = async () => ({
    lengthBytesUTF8: (text) => Buffer.byteLength(text), _malloc: () => 16, _free: () => {},
    stringToUTF8: () => {}, _netlist_parse: () => 1, UTF8ToString: () => ${JSON.stringify(json)} });`;
  writeFileSync(join(directory, 'xyce.cjs'), module('{"contract":2,"cards":[]}'));
  writeFileSync(join(directory, 'hspice.cjs'), 'throw new Error("no wasm here");');
  return directory;
}

test('loading a vendored dialect makes the registry parse it synchronously', async () => {
  const load = parserLoader(VENDORED);
  await load('ngspice');
  assert.equal(parse('ngspice', 'R1 a b 1k\n').cards.length, 1);
});

test('loading spectre loads its SPICE mode too, since a Spectre netlist may switch languages', async () => {
  const load = parserLoader(VENDORED);
  await load('spectre');
  assert.equal(parse('spectre', 'r1 (a b) resistor r=1k\n').cards.length, 1);
  assert.equal(parse('spectre-spice', 'R1 a b 1k\n').cards.length, 1);
});

test('a dialect with no module in the directory is reported, naming the dialect, without throwing synchronously', async () => {
  const load = parserLoader(fakeParsers());
  let promise!: Promise<void>;
  assert.doesNotThrow(() => { promise = load('ltspice'); });
  await assert.rejects(promise, (error: unknown) =>
    error instanceof Error && /^The ltspice parser could not be loaded: /.test(error.message) && /ltspice\.cjs/.test(error.message));
  assert.throws(() => parse('ltspice', ''), /not loaded/);
});

test('a module built against another contract is refused, naming both numbers', async () => {
  const load = parserLoader(fakeParsers());
  await assert.rejects(load('xyce'), /The xyce parser could not be loaded: .*contract 2.*contract 1/);
});

test('a module that throws while loading is reported with its own message, and asking again reports it again', async () => {
  const load = parserLoader(fakeParsers());
  await assert.rejects(load('hspice'), /The hspice parser could not be loaded: no wasm here/);
  await assert.rejects(load('hspice'), /The hspice parser could not be loaded: no wasm here/);
});

test('a name that is not a dialect never reaches the file system', async () => {
  const load = parserLoader(fakeParsers());
  await assert.rejects(load('../../etc/passwd' as DialectId), (error: unknown) =>
    error instanceof Error && error.message === 'The ../../etc/passwd parser could not be loaded: not a dialect');
});
