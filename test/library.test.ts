import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
const locked = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version: string; integrity: string }> };

for (const [name, heading, licence, installedLicence] of [
  ['elkjs', 'elkjs', 'licenses/ELKJS-EPL-2.0.md', 'node_modules/elkjs/LICENSE.md'],
  ['@xmldom/xmldom', '`@xmldom/xmldom`', 'licenses/XMLDOM-LICENSE', 'node_modules/@xmldom/xmldom/LICENSE']
] as const) {
  test(`${name}: the bundled version, its integrity and its licence text match the notices`, () => {
    const lock = locked.packages[`node_modules/${name}`]!;
    const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version: string };
    assert.equal(installed.version, lock.version);
    assert.ok(notices.includes(`${heading} ${lock.version}`), `notices name ${name} ${lock.version}`);
    assert.ok(notices.includes(lock.integrity), `notices carry ${name}'s integrity`);
    assert.equal(readFileSync(licence, 'utf8'), readFileSync(installedLicence, 'utf8'));
  });
}

test('the adapted netlistsvg is credited in the files that derive from it', () => {
  assert.match(readFileSync('licenses/NETLISTSVG-LICENSE', 'utf8'), /Copyright \(c\) 2016 Neil Turley/);
  assert.match(readFileSync('src/skin/symbols.svg', 'utf8'), /netlistsvg \(MIT, Copyright \(c\) 2016 Neil Turley/);
  assert.match(readFileSync('src/schematic.ts', 'utf8'), /netlistsvg\s+\* \(MIT, Copyright \(c\) 2016 Neil Turley/);
});

test('every bundled runtime dependency is declared, and nothing else is', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@xmldom/xmldom', 'elkjs']);
});
