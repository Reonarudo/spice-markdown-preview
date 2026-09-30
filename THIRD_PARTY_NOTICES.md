# Third-party notices and provenance

The extension's original TypeScript, tests, build scripts, and artwork are MIT
licensed (see `LICENSE`). This does not relicense bundled software.

## elkjs 0.12.0 (Eclipse Layout Kernel)

`dist/worker.js` bundles `lib/elk.bundled.js` from the npm package
[`elkjs`](https://www.npmjs.com/package/elkjs) 0.12.0: the layered layout algorithm
of the Eclipse Layout Kernel, transpiled from Java to JavaScript by the elkjs
project. It places every symbol and routes every wire.

elkjs is dual-licensed EPL-2.0 OR GPL-3.0-or-later; this extension uses it under the
**Eclipse Public License 2.0**, whose full text is in `licenses/ELKJS-EPL-2.0.md`.
Copyright is held by Kiel University and the ELK contributors. It is bundled
unmodified; esbuild only removes whitespace from the file. Source code:
<https://github.com/kieler/elkjs> (the JavaScript build) and
<https://github.com/eclipse/elk> (the Java source it is transpiled from).

npm integrity
`sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==`.

## netlistsvg 1.0.2 (adapted)

Parts of [netlistsvg](https://github.com/nturley/netlistsvg) by Neil Turley, MIT
licensed (`licenses/NETLISTSVG-LICENSE`), were adapted rather than bundled, from the
npm package 1.0.2 (git `eb9dc546beae573d98635a7b9d9c5d12af3f695b`, npm integrity
`sha512-g6E7Q58HLevr+ls7FZTMf1xT3iXXxUVD+s7I4ijGKH+bhaobjnZbzKAi+Ex1AlNWK7fzujz3x4V3xMKOGiWfQw==`):

- `src/skin/symbols.svg` derives from `lib/analog.svg`. Kept: the resistor,
  capacitor, inductor, diode, transistor and ground symbols and the file format.
  Changed: the voltage source shows + and − and the current source an arrow; diodes
  and transistors show their model; bipolar pins sit on the symbol's edge; the PNP
  emitter pin is where its arrow is drawn. Added: NMOS and PMOS, with and without a
  body terminal. Removed: styles, aliases, and symbols SPICE does not name.
- `src/schematic.ts` adapts the graph construction of `lib/elkGraph.ts` and the wire
  clean-up of `lib/drawModule.ts` to ELK 0.12's edge format, without the Yosys
  bit-vector, constant, split and join handling.

## XML library

`@xmldom/xmldom` 0.9.12 is bundled to read the symbol file and to build and serialise
each schematic. Its MIT license and attribution are in `licenses/XMLDOM-LICENSE`.
npm integrity
`sha512-5AXjrcMClTryPe9LgZrygpB1lj7s0S9E0+W+AHaVKAVyHanafK86iPSvG5xHVSp/jC+VH1UXu0TAEmY279xH7A==`.

## Generated parsers (`vendor/parsers/`)

Each `vendor/parsers/<dialect>.cjs` is a netlist scanner and parser for one SPICE
dialect, generated from this repository's own grammars (`grammar/generated/<dialect>.l`
and `.y`, composed from `grammar/spice/`, `grammar/spectre/`, `grammar/dialects/` and
the element catalogue) and the shared driver in `grammar/driver/`, then compiled to
WebAssembly and inlined into one CommonJS file. `scripts/grammars.sh` builds them with
GNU flex 2.6.4, GNU Bison 3.8.2 and Emscripten 6.0.9; `vendor/parsers/provenance.json`
records those versions and the SHA-256 of every input, `vendor/parsers/SHA256SUMS` pins
the modules, and the test suite checks both. The grammars and driver are MIT licensed
with the rest of the extension; the generated modules also contain the following.

### flex 2.6.4 scanner skeleton

The scanner half of each module is flex's output: flex's own skeleton code plus the
tables generated from the grammar. flex is distributed under a BSD-style license by The
Flex Project and The Regents of the University of California; the full text is in
`licenses/flex-COPYING`. Source: <https://github.com/westes/flex>.

### GNU Bison 3.8.2 parser skeleton

The parser half of each module is Bison's output: the `yacc.c` skeleton plus the tables
generated from the grammar. The skeleton is copyright the Free Software Foundation and
licensed GPL-3.0-or-later **with the Bison special exception**, which permits
distributing a larger work containing the skeleton "under terms of your choice, so long
as that work isn't itself a parser generator using the skeleton or a modified version
thereof as a parser skeleton". This extension is not a parser generator, so the modules
are distributed under the extension's MIT license as the exception allows. The full
exception text is at the head of every file Bison generates. Source:
<https://www.gnu.org/software/bison/>.

### Emscripten 6.0.9

The JavaScript loader and the linked runtime (including `emmalloc`) in each module
contain Emscripten code, available under the MIT and University of Illinois/NCSA
licenses; the full text is in `licenses/emscripten-LICENSE`. Source:
<https://github.com/emscripten-core/emscripten>.
