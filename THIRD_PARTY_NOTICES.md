# Third-party notices

The extension's original TypeScript, tests, build scripts, and artwork are MIT
licensed (see `LICENSE`). This does not relicense the software it ships.

## SPICE renderer

Schematics are read and drawn by
[spice-renderer](https://github.com/Reonarudo/spice-renderer) (MIT), shipped in
this extension under `node_modules/@reonarudo/spice-renderer/`. It carries the
generated dialect parsers (flex 2.6.4 and GNU Bison 3.8.2 skeletons, Emscripten
6.0.9 runtime) and the symbols and layout code adapted from netlistsvg 1.0.2. Its
own `THIRD_PARTY_NOTICES.md` and `licenses/` directory give their provenance and
licenses; keep them with any redistribution.

## elkjs (Eclipse Layout Kernel)

[`elkjs`](https://www.npmjs.com/package/elkjs), the JavaScript build of the Eclipse
Layout Kernel by Kiel University and the ELK contributors, places every symbol and
routes every wire. It is shipped unmodified under `node_modules/elkjs/` and used
under the **Eclipse Public License 2.0** (it is dual-licensed EPL-2.0 OR
GPL-3.0-or-later); the license is in `node_modules/elkjs/LICENSE.md`. Only
`lib/elk.bundled.js`, which the renderer loads, and `lib/elk-api.js` are shipped;
the package's other builds are left out. Source: <https://github.com/kieler/elkjs>
and <https://github.com/eclipse/elk>.

## xmldom

[`@xmldom/xmldom`](https://github.com/xmldom/xmldom), which the renderer uses to
read its symbol file and build each schematic, is shipped under
`node_modules/@xmldom/xmldom/` with its MIT license.

The exact versions are locked in `package-lock.json`.
