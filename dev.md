# Maintainer notes

Day-to-day development needs only Node (see `README.md`, *Development*). This file covers
the one thing a contributor does not need: rebuilding the generated parsers.

## Rebuilding the generated parsers

The parsers in `vendor/parsers/<dialect>.cjs` are committed, so `npm ci` and `npm test`
never need flex, Bison or Emscripten. They must be rebuilt whenever a grammar in
`grammar/spice/`, `grammar/spectre/` or `grammar/dialects/`, the driver in
`grammar/driver/`, or the element catalogue changes:

```sh
brew install flex bison emscripten   # once; GNU flex, not the flex Apple ships
npm run grammars                     # compose grammar/generated/, then build vendor/parsers/
npm test                             # test/grammars.test.ts and test/vendor.test.ts check the result
```

`npm run grammars` runs `scripts/grammars/compose.ts` and then `scripts/grammars.sh`. The
script is POSIX `sh` for macOS and Linux (no Windows). It looks for the tools at their
Homebrew paths (`/opt/homebrew/opt/bison/bin/bison`, `/opt/homebrew/opt/flex/bin/flex`,
`emcc`), overridable with `BISON`, `FLEX` and `EMCC`, and refuses anything but GNU Bison
3.8.2, GNU flex 2.6.4 and Emscripten 6.0.9 — Apple's `flex` and `bison` are refused by
name. `emcc` needs Python 3.10 or newer; the script finds one and sets `EMSDK_PYTHON`
unless it is already set. Intermediate C and objects go under `build/grammars/`, which is
not committed.

Only `vendor/parsers/<dialect>.cjs`, `SHA256SUMS` and `provenance.json` are committed.
`.gitattributes` marks them `-text` so Windows checkouts keep their bytes, and the VSIX
ships them through the `.vscodeignore` allowlist; esbuild leaves them external so the
worker can load one dialect at a time.

**CI's build is the reference.** The `grammars` job in `.github/workflows/ci.yml` rebuilds
every module on `ubuntu-24.04` with the same pins and fails if a byte differs from what is
committed. Local builds are for iterating; when CI disagrees with a build from your Mac,
download its `rebuilt-parsers` artifact and commit those files rather than yours.

## Iterating on a grammar without Emscripten

A grammar change is quickest to try natively: compose, run flex and Bison on the composed
files, compile them with the driver and a ten-line `main` that reads a file and prints
`netlist_parse`'s JSON, and diff the output against what you expect. Use the same warning flags
as `scripts/grammars.sh` (`-Wall -Wextra -Werror`, Bison `-Werror=all`, and fail on any flex
diagnostic), because the WebAssembly build will. The vendored module is still rebuilt with
`npm run grammars` once the grammar is right — the native build is for the loop, not the result.

What the base grammar does, and the ngspice overlay on top of it, is written up in ADR 0008
(*As built*) on the wiki; `test/parser-ngspice.test.ts` is the executable version, one case per
finding of the ngspice research plus the real decks under `test/fixtures/ngspice/corpus/`.
