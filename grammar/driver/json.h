/*
 * The JSON writer every generated grammar calls (ADR 0008): `{ contract: 1, cards, error?,
 * afterEnd? }`, written as the parser reads, strings always escaped. A change to the output shape
 * is made here, once, for every dialect.
 */
#ifndef NETLIST_JSON_H
#define NETLIST_JSON_H
#include <stddef.h>

struct json {
  char *buf;
  size_t len, cap;
  int cards;        /* cards written so far */
  int in_card;      /* a card is open */
  int tokens_open;  /* the open card's tokens array has started */
  int tokens;       /* tokens written in the open card */
  int model;        /* the open card is `.model`: keep its bare words and the `level` pair only */
  int failed;       /* the error was written; nothing else may follow */
};

/* A copy of `length` bytes of `text`, NUL-terminated; the json_* calls free the strings they take. */
char *json_strndup(const char *text, size_t length);

void json_init(struct json *j);

/* Open an element card: `ref` as written, the letter upper-cased from `head` (or from `ref` when `head` is NULL), the selector after it. */
void json_element(struct json *j, char *ref, char *head, int line, int column, int end);
/* Open a Spectre instance card: `ref` as written and the master; no letter. */
void json_instance(struct json *j, char *ref, char *master, int line, int column, int end);
/* The element's node list was parenthesised: say so before its tokens begin. */
void json_nodes_closed(struct json *j);
/* Open a directive card; `name` is lower-cased. `.model` cards are trimmed (ADR 0008). */
void json_directive(struct json *j, char *name, int line, int column, int end);
void json_token(struct json *j, const char *class, char *text, int line, int column, int end);
void json_pair(struct json *j, char *key, char *value, int line, int column, int end);
void json_card_end(struct json *j);

/*
 * The first error only. `code` names an explicit error production, or is NULL for a plain syntax
 * error; `found_class` and `expected` use the token-class vocabulary.
 */
void json_error(struct json *j, const char *code, int line, int column, int end, const char *found_class, const char *found_text, const char **expected, int count);

/* Close the document; `after_end` > 0 is written as `afterEnd`. */
const char *json_finish(struct json *j, int after_end);

#endif
