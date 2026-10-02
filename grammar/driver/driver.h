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
  int after_head;           /* the last token was an element head: a `(` here opens its node list */
  int opaque;               /* inside an opaque region (`.control` … `.endc`): lines are swallowed */
  int ending;               /* the first `.end` was read: what follows is only counted */
  int after_end;            /* non-blank, non-comment lines after the first `.end` */
  int open_line;            /* where the unterminated node list or group opened, for the error */
  int open_column;
  struct {                  /* the bracketed group being gathered, nested brackets counted */
    char *text;
    size_t length, capacity;
    int depth;
    char open, close;
    int kind;               /* the token to return: a bare group, or a word with its group glued on */
    int column;             /* where the token starts: the glued word, or the bracket itself */
  } group;
  char last_text[64];       /* the last token's text, for the error report */
};

/* Start gathering a group at `text` (the opening bracket, with any word glued before it). */
void scan_group_begin(struct scan_state *state, const char *text, size_t length, char open, char close, int kind);
void scan_group_append(struct scan_state *state, const char *text, size_t length);
/* The group continues on a `+` line: drop the blanks before the line break and join the pieces with one blank. */
void scan_group_continue(struct scan_state *state);
/* The gathered group as a fresh string the json_* calls will free; the buffer is kept for the next. */
char *scan_group_take(struct scan_state *state);
void scan_group_free(struct scan_state *state);

void scan_remember(struct scan_state *state, const char *text, size_t length);

/* The text of the token the parser choked on; `scanner` is the flex yyscan_t. */
const char *scan_last_text(void *scanner);

/* The scanner state behind a flex yyscan_t, for the parser's coded errors. */
struct scan_state *scan_state_of(void *scanner);

/* A Bison string alias without its quotes: `"word"` → `word`. Other names pass through. */
const char *symbol_alias(const char *name);


/*
 * Parse `length` bytes of one file and return the ADR 0008 JSON document. The string belongs to
 * the module and is valid until the next call.
 */
const char *netlist_parse(const char *source, int length);

#endif
