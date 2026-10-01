# LTspice fixtures

Written for this project, not copied: LTspice ships no redistributable example netlists
(Redmine #1190), so these decks follow the shape of a netlist LTspice exports from a schematic
(LTspice 26.1 help, *Netlist options*): a `* <path>.asc` first line, default `.model` cards,
`.lib` lines for the standard libraries, `.backanno`, and `.end`. One deck per group of research
findings (#1185); `test/netlist-ltspice.test.ts` reads each one through `parseNetlist`.
