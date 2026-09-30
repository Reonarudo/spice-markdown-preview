#!/bin/sh
# Build every composed grammar in grammar/generated/ into one WebAssembly module per dialect,
# vendor/parsers/<dialect>.cjs, and pin the result in SHA256SUMS and provenance.json.
#
# Maintainers and CI only: the modules are committed, so a contributor never needs these tools.
# Exact tool pins — GNU Bison 3.8.2, GNU flex 2.6.4 (Apple's flex is refused), Emscripten 6.0.9 —
# because each tool's version is written into its output. CI on ubuntu-24.04 is the reference
# build: when its bytes differ from what is committed, its artifact is what gets committed.
#
#   npm run grammars                       # Homebrew paths on macOS
#   BISON=bison FLEX=flex EMCC=emcc npm run grammars   # CI, or tools on the PATH
#
# Every path handed to the tools is relative to the repository root, because flex and Bison write
# the paths they are given into #line directives and Emscripten links them in: an absolute path
# would make two builds of the same sources differ.
set -eu
cd "$(dirname "$0")/.."

BISON="${BISON:-/opt/homebrew/opt/bison/bin/bison}"
FLEX="${FLEX:-/opt/homebrew/opt/flex/bin/flex}"
EMCC="${EMCC:-emcc}"
WANT_BISON=3.8.2
WANT_FLEX=2.6.4
WANT_EMCC=6.0.9

OUT=vendor/parsers
BUILD=build/grammars

fail() {
  echo "grammars: $*" >&2
  exit 1
}

# --- Tool pins ----------------------------------------------------------------------------------

command -v "$BISON" >/dev/null 2>&1 || fail "no Bison at $BISON (brew install bison, or set BISON)"
command -v "$FLEX" >/dev/null 2>&1 || fail "no flex at $FLEX (brew install flex, or set FLEX)"
command -v "$EMCC" >/dev/null 2>&1 || fail "no emcc at $EMCC (brew install emscripten, or set EMCC)"

bison_line=$("$BISON" --version 2>&1 | head -n 1)
[ "$bison_line" = "bison (GNU Bison) $WANT_BISON" ] || fail "need GNU Bison $WANT_BISON, found: $bison_line"

flex_line=$("$FLEX" --version 2>&1 | head -n 1)
case "$flex_line" in
  *Apple*) fail "$FLEX is Apple's flex ($flex_line); the build needs GNU flex $WANT_FLEX (brew install flex)" ;;
esac
[ "$flex_line" = "flex $WANT_FLEX" ] || fail "need GNU flex $WANT_FLEX, found: $flex_line"

# emcc needs a Python 3.10 or newer; a shell whose python3 is older breaks it before it prints a version.
if [ -z "${EMSDK_PYTHON:-}" ]; then
  for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10; do
    path=$(command -v "$candidate" 2>/dev/null) || continue
    if "$path" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      EMSDK_PYTHON=$path
      break
    fi
  done
  [ -n "${EMSDK_PYTHON:-}" ] || fail "no Python 3.10 or newer on the PATH; set EMSDK_PYTHON"
  export EMSDK_PYTHON
fi

# A fresh emsdk may emit sanity-check diagnostics before its version line.
emcc_output=$("$EMCC" --version 2>&1) || fail "emcc --version failed: $emcc_output"
emcc_line=$(printf '%s\n' "$emcc_output" | sed -n '/^emcc /{p;q;}')
# Homebrew builds Emscripten from the release tag and reports "6.0.9-git"; emsdk reports "6.0.9".
emcc_version=$(printf '%s\n' "$emcc_line" | sed -n 's/^emcc (.*) \([0-9][0-9.]*\)\(-git\)\{0,1\}\( ([0-9a-f][0-9a-f]*)\)\{0,1\}$/\1/p')
[ "$emcc_version" = "$WANT_EMCC" ] || fail "need Emscripten $WANT_EMCC, found: $emcc_line"

# --- Helpers ------------------------------------------------------------------------------------

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64
}

# Compile one C file for wasm32. Every warning is an error; a generated file may silence the one
# warning its generator's skeleton is known to raise, and nothing else.
cc() {
  "$EMCC" -Os -Wall -Wextra -Werror -I grammar/driver -I "$dir" "$@"
}

# --- Build --------------------------------------------------------------------------------------

rm -rf "$BUILD"
mkdir -p "$OUT" "$BUILD"
set -- grammar/generated/*.y
[ -f "$1" ] || fail "no composed grammars in grammar/generated/; run npm run grammars:compose"

dialects=""
for y in "$@"; do
  dialect=$(basename "$y" .y)
  l=grammar/generated/$dialect.l
  [ -f "$l" ] || fail "$l is missing"
  dir=$BUILD/$dialect
  mkdir -p "$dir"
  echo "grammars: $dialect"

  # Any flex diagnostic — an unmatchable rule, a dangerous trailing context — fails the build.
  if ! "$FLEX" -o "$dir/scanner.c" "$l" >"$dir/flex.log" 2>&1; then
    cat "$dir/flex.log" >&2
    fail "flex failed on $l"
  fi
  if [ -s "$dir/flex.log" ]; then
    cat "$dir/flex.log" >&2
    fail "flex warned on $l"
  fi
  "$BISON" -Werror=all -o "$dir/parser.c" --header="$dir/parser.h" "$y"

  # flex's skeleton compares signed with unsigned sizes and defines helpers a grammar may not use.
  cc -Wno-unused-parameter -Wno-unused-function -Wno-sign-compare -c "$dir/scanner.c" -o "$dir/scanner.o"
  # Bison's skeleton counts errors it never reads.
  cc -Wno-unused-parameter -Wno-unused-but-set-variable -c "$dir/parser.c" -o "$dir/parser.o"
  cc -c grammar/driver/driver.c -o "$dir/driver.o"
  cc -c grammar/driver/json.c -o "$dir/json.o"

  # One self-contained CommonJS file with the WebAssembly inlined. The factory returns a promise
  # (Emscripten 6); the worker awaits it once per dialect and parses synchronously afterwards.
  "$EMCC" -Os "$dir/scanner.o" "$dir/parser.o" "$dir/driver.o" "$dir/json.o" \
    -s SINGLE_FILE=1 -s MODULARIZE=1 -s WASM_ASYNC_COMPILATION=0 -s ENVIRONMENT=node \
    -s ALLOW_MEMORY_GROWTH=1 -s MALLOC=emmalloc -s STRICT=1 \
    -s EXPORTED_FUNCTIONS='["_netlist_parse","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["UTF8ToString","stringToUTF8","lengthBytesUTF8","HEAPU8"]' \
    -o "$OUT/$dialect.cjs"
  dialects="$dialects $dialect"
done

# A module whose grammar is gone is stale: remove it rather than ship it.
for module in "$OUT"/*.cjs; do
  [ -f "$module" ] || continue
  name=$(basename "$module" .cjs)
  [ -f "grammar/generated/$name.y" ] || { echo "grammars: removing stale $module"; rm -f "$module"; }
done

# --- Provenance ---------------------------------------------------------------------------------

# Tool versions and the SHA-256 of every input, in a fixed order, so two builds of the same tree
# write the same file. The tool versions are the pins, not the reported strings (Homebrew's
# "-git" suffix must not make a Mac build differ from CI).
{
  echo '{'
  echo "  \"tools\": { \"bison\": \"$WANT_BISON\", \"flex\": \"$WANT_FLEX\", \"emscripten\": \"$WANT_EMCC\" },"
  echo '  "script": "scripts/grammars.sh",'
  printf '  "modules": ['
  first=1
  for dialect in $dialects; do
    [ $first = 1 ] || printf ', '
    printf '"%s.cjs"' "$dialect"
    first=0
  done
  echo '],'
  echo '  "inputs": {'
  first=1
  for input in grammar/driver/*.c grammar/driver/*.h grammar/generated/*.l grammar/generated/*.y; do
    [ $first = 1 ] || echo ','
    printf '    "%s": "%s"' "$input" "$(sha256 "$input")"
    first=0
  done
  echo
  echo '  }'
  echo '}'
} >"$OUT/provenance.json"

# --- Checksums ----------------------------------------------------------------------------------

# The same two-space format as sha256sum -c; test/vendor.test.ts checks it on every OS.
: >"$OUT/SHA256SUMS"
for file in "$OUT"/*.cjs "$OUT"/provenance.json; do
  echo "$(sha256 "$file")  $(basename "$file")" >>"$OUT/SHA256SUMS"
done
echo "grammars: built$dialects -> $OUT/"
