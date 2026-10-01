# Changelog

## Unreleased

- A fence names its dialect with a `dialect` attribute (`ngspice`, `ltspice`,
  `pspice`, `hspice`, `xyce` or `spectre`); fences without one follow the new
  `spice.dialect` setting (per workspace folder, default `ngspice`). Included
  files are read in the fence's dialect.
- Netlists are read by a parser generated from an ngspice grammar with flex and
  Bison, compiled to WebAssembly and vendored (`vendor/parsers/ngspice.cjs`), with
  the element catalogue deciding each element's terminals. New: `A`, `N`, `P`, `U`
  and `Y` elements; `E`/`G` in every form; three- to seven-node `M` by its model,
  P-channel VDMOS; substrate and thermal nodes on `Q` and `D`; `X1 (a b) sub`;
  nested `.subckt`, `.macro`/`.eom`; `#` comments, `\\` continuation and quoted
  expressions; `.incl`; the first branch of an `.if`; a note for lines after
  `.end`. Changed: `.lib file` without a section is an error, as in ngspice.
- `dialect="ltspice"` reads a fence with a parser generated from the LTspice
  overlay (`vendor/parsers/ltspice.cjs`): only `*` and `;` comment, so `$G_`
  nodes survive; `@` and `&` FRA elements; eight-pin `A` functions titled by
  their keyword; three-pin VDMOS; `Z` as IGBT by model; `I`/`B … R=` as
  resistors; `value=`, `Laplace=` and `tbl=` dependent-source shapes; `.lib file`
  reads a library's models and subcircuits without its top-level elements, and a
  `.lib` of a file that is not here (LTspice's standard libraries) is a note.
- `dialect="pspice"` reads a fence with a parser generated from the PSpice
  overlay (`vendor/parsers/pspice.cjs`): `*`, `;` and `#` comment, so `$G_` and
  `$D_` nodes survive; `B` GaAsFET, `Z` IGBT, `N`/`O` digital interfaces and
  `U` digital primitives with their type-dependent pins (arguments after blanks
  allowed); two-node `VALUE`, `TABLE`, `LAPLACE`, `FREQ`, `CHEBYSHEV`, `F=` and
  `Q=` sources and `POLY(n)` pairs written `(a,b)`; `OPTIONAL:` subcircuit pins
  left off from the right, `PARAMS:` and `TEXT:`; `[SUB]` substrate names;
  `AKO:` models; `.LIB file` as a sectionless library, a bare `.LIB` and a missing
  library as notes; `.ALIASES` blocks skipped. A digital primitive selected by
  its keyword no longer counts that keyword as a node.

## 0.1.0 — 2026-09-30

- Draw `spice` fences as schematics in the Markdown preview, laid out by elkjs
  0.12.0 in a worker with a time limit set by `spice.layoutTimeout` (default 3 s).
- Resistors, capacitors, inductors, diodes, sources, bipolar transistors and
  MOSFETs get symbols; subcircuits and other elements are drawn as labelled boxes.
- Continuation lines, comments, `.model`, `.subckt`, `.control` and `.end` are read
  as ngspice reads them; netlist errors quote the line with a caret.
- `.include`, `.inc` and `.lib` read files in a trusted local workspace,
  relative to the Markdown document and inside its folder, with nested includes
  and `.lib` sections; included models, subcircuits and elements are used, and
  changes to them redraw. **SPICE: Refresh Included Files** rereads everything.
- `alt`, `caption`, `align` and `class` fence attributes; notes and attribute
  diagnostics go to the output channel.
