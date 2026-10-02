# Spectre fixtures

Written for this project, not copied: Cadence publishes no redistributable Spectre netlists, and the
only open Spectre text — Xyce_Regression's `XDM/SPECTRE` tree — states no licence (Redmine #1190), so
CI parses it without committing it (see `scripts/corpus.ts` and the `corpus` job in
`.github/workflows/ci.yml`). These decks follow the shape of the Spectre User Guide's own examples
(5.1.41, ch.2 and 4) and of Virtuoso's exported netlists: `//` header lines, `simulator lang=`
switches, `global`, `include … section=`, `(nodes) master param=value` instances, `model`
statements with `type=`, `subckt` and `inline subckt`, `parameters`, analyses shaped like
instances, `statistics` and `sweep` blocks, `\` and `+` continuation. One deck per group of research
findings (#1189); `test/netlist-spectre.test.ts` reads each one through `parseNetlist`.
