# Xyce fixtures

Written for this project, not copied: the only large body of real Xyce netlists, Xyce_Regression,
states no licence (Redmine #1190), so CI parses its `Netlists/` tree without committing it (see
`scripts/corpus.ts` and the `corpus` job in `.github/workflows/ci.yml`). These decks follow the
shape of the Xyce Reference Guide's own examples (7.10, ch.2): a `*` first line, `.PREPROCESS
REPLACEGROUND TRUE`, `.GLOBAL_PARAM` and `.PARAM`, `$G` global nodes, indented comment lines,
`Y<type> <name>` devices, `U` digital gates with a `DIG` model, the generic `S … CONTROL=` switch,
a `P` port, a multi-inductor `K` with a `CORE` model, a model name before a passive's value, and
`.END`. One deck per group of research findings (#1188); `test/netlist-xyce.test.ts` reads each
one through `parseNetlist`.
