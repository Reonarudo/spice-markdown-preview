import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseDialect, DEFAULT_DIALECT, DIALECT_NAMES, publicDialect } from '../src/dialect';
import { DIALECTS } from '../src/catalogue/dialects';

test('the public dialects are the catalogue\'s, less the internal one, and ngspice is the default', () => {
  assert.deepEqual(DIALECT_NAMES, ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre']);
  assert.deepEqual(Object.values(DIALECTS).filter((d) => !d.internal).map((d) => d.id), DIALECT_NAMES);
  assert.equal(DEFAULT_DIALECT, 'ngspice');
});

test('a dialect name is read in any case, trimmed, with no aliases; anything else is undefined', () => {
  assert.equal(publicDialect('Xyce'), 'xyce');
  assert.equal(publicDialect(' spectre '), 'spectre');
  for (const value of ['spectre-spice', 'ngspice-47', 'lt', '', 7, null, undefined, ['ngspice'], { dialect: 'ngspice' }]) {
    assert.equal(publicDialect(value), undefined, JSON.stringify(value));
  }
});

test('the fence attribute beats the setting, and the setting beats the default', () => {
  assert.equal(chooseDialect('hspice', 'xyce'), 'hspice');
  assert.equal(chooseDialect(undefined, 'xyce'), 'xyce');
  assert.equal(chooseDialect(undefined, undefined), 'ngspice');
});
