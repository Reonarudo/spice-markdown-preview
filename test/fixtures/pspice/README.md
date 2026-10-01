# PSpice fixtures

Written for this project, not copied: no real PSpice netlist can be committed (Redmine #1190 —
PSpice's own demos ship only inside licensed installs, and the Xyce_Regression `XDM/PSPICE` decks
state no licence; CI parses those without committing them, see `scripts/corpus.ts`). These decks
follow the shape OrCAD Capture 16.6 exports (PSpice A/D Reference Guide 16.6): a `* source NAME`
first line, `R_` / `X_` / `U_` reference prefixes, `TC=0,0` on passives, `.LIB` lines for the
standard libraries, `.PROBE`, an `.ALIASES` block and `.END`. One deck per group of research
findings (#1186); `test/netlist-pspice.test.ts` reads each one through `parseNetlist`.
