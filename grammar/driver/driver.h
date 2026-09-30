/*
 * The one driver every generated parser is linked with (ADR 0009): scanner state, the entry
 * point the WebAssembly module exports, and the helpers the grammars call.
 */
#ifndef NETLIST_DRIVER_H
#define NETLIST_DRIVER_H
#include <stddef.h>

/* What the reentrant scanner carries between tokens (`%option extra-type`). */
struct scan_state {
  int at_card_start;        /* the next token is a card's head */
  char last_text[64];       /* the last token's text, for the error report */
};

void scan_remember(struct scan_state *state, const char *text, size_t length);

/* The text of the token the parser choked on; `scanner` is the flex yyscan_t. */
const char *scan_last_text(void *scanner);

/* A Bison string alias without its quotes: `"word"` → `word`. Other names pass through. */
const char *symbol_alias(const char *name);

/*
 * Parse `length` bytes of one file and return the ADR 0008 JSON document. The string belongs to
 * the module and is valid until the next call.
 */
const char *netlist_parse(const char *source, int length);

#endif
