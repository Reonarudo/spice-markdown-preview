# Changelog

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
