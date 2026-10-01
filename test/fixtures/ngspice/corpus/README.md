# ngspice corpus fixtures

Real netlists from the ngspice source tree, tag `ngspice-47` (commit `a80f6e3e95d5`,
<https://sourceforge.net/p/ngspice/ngspice/ci/ngspice-47/tree/>, mirrored at
<https://github.com/imr/ngspice>), copied byte for byte under their original paths
(`examples/…`, `tests/…`). They are the "committable corpus slices" chosen by the research in
Redmine #1190: the `examples/` and `tests/` directories are under ngspice's Modified BSD licence
(`COPYING`), reproduced here as `LICENSE`. None of these files carries a third-party model with its
own terms; a file whose header names another copyright holder must not be added here.

`test/parser-ngspice.test.ts` parses each one with the vendored ngspice module after dropping its
first line — a SPICE deck's title, which a fence does not have (ADR 0006) — and checks that no
structural error is reported and that the card counts are what they were when the file was added.
Two files (`URC-TM-SUB.cir`, `loop_IfThenElse.cir`) have CRLF line endings on purpose.
