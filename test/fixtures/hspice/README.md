# HSPICE fixtures

Written for this project, not copied: Synopsys publishes no redistributable HSPICE netlists
(Redmine #1190 — the only open HSPICE text is in Xyce_Regression's `XDM/` tree, which states no
licence; CI parses it without committing it, see `scripts/corpus.ts`). These decks follow the
shape of the HSPICE User Guide's own examples (B-2008.09, ch.3 and 8–9): a title line, `.OPTION`,
`.PARAM` with quoted expressions, `.GLOBAL vdd! gnd!`, `.MACRO` … `.EOM`, selector-suffixed
models (`nch.1`), `$` comments, `.DATA` … `.ENDDATA`, `.PROTECT`, `.ALTER` and `.END`. One deck
per group of research findings (#1187); `test/netlist-hspice.test.ts` reads each one through
`parseNetlist`.
