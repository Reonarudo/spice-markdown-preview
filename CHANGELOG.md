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

- `dialect="hspice"` reads a fence with a parser generated from the HSPICE
  overlay (`vendor/parsers/hspice.cjs`): `*` and `$` comment (`$` after a blank,
  a comma or a number), `;` is a name character, ` \` and ` \\` continue a line,
  quoted expressions keep their spaces; `GND!`, `GROUND` and `!GND` are ground;
  `B` IBIS buffer, `S` n-port, `W` coupled and `U` lumped lossy lines, `P` port;
  four-node `LAPLACE`, `DELAY`, `POLE`, `FREQ`, `FOSTER`, `OPAMP`, `TRANSFORMER`,
  `PWL`, `VCR` and `VCCAP` sources, bare `POLY`, an optional `VCVS`/`VCCS` before
  the controlling pair; three-node `M`, four-node `J`; the `name.N` model
  selector; `.CONNECT`; library sections calling sections of their own file;
  `.DATA`, `.PROTECT` and `.ALTER` blocks skipped with a note.

- `dialect="xyce"` reads a fence with a parser generated from the Xyce overlay
  (`vendor/parsers/xyce.cjs`): `*`, `;` and any indented line comment (`$GVDD`
  is a node, `//` is text, no `\\` continuation); `gnd`, `gnd!` and `ground`
  are ground only under `.PREPROCESS REPLACEGROUND TRUE`; `Y<type> <name>`
  devices by the catalogue or as blocks titled by their type; `U` gates with
  supply pins first, `P` ports, the two-node `S … CONTROL=` switch, no `A`/`N`;
  multi-inductor `K` with a core model; three-node MVS, four- to seven-node SOI
  and level-18 VDMOS `M`; `[SUB]` substrate names; a model before a passive's
  value; `.INCL` and quoted file names; `.LIB file entry` only. The advisory
  `corpus` CI job also parses Xyce_Regression's native decks.
- `dialect="spectre"` reads a fence with parsers generated from a second base
  grammar for Cadence Spectre's own language (`vendor/parsers/spectre.cjs`) and
  from an overlay for its SPICE mode (`spectre-spice.cjs`), switched by
  `simulator lang=` anywhere in the netlist: `name (nodes) master param=value`
  instances, the master naming the part directly, through a `model` statement
  whose `type=` decides polarity, or as a subcircuit; case-sensitive names;
  `global`'s first name as ground; `//` comments, `\` and `+` continuation;
  `include "file" [section=name]` and `#include`, `.scs` files in Spectre and
  others in SPICE mode; `if`/`else` blocks read like `.if`, `sweep` blocks read
  through, `statistics` and model bin groups skipped; analyses skipped by their
  master; `*spectre:` lines in SPICE mode. A model card now keeps its `type`
  pair in every dialect, so every vendored module was rebuilt.

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
