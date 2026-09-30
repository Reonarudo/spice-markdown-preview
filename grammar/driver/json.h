/*
 * The JSON writer every generated grammar calls (ADR 0008): `{ contract: 1, cards, error? }`,
 * written as the parser reads, strings always escaped. A change to the output shape is made here,
 * once, for every dialect.
 */
#ifndef NETLIST_JSON_H
#define NETLIST_JSON_H
#include <stddef.h>

struct json {
  char *buf;
  size_t len, cap;
  int cards;        /* cards written so far */
  int in_card;      /* a card is open: its tokens array is being written */
  int tokens;       /* tokens written in the open card */
  int failed;       /* the error was written; nothing else may follow */
};

/* A copy of `length` bytes of `text`, NUL-terminated; the json_* calls free the strings they take. */
char *json_strndup(const char *text, size_t length);

void json_init(struct json *j);

/* Open an element card: `ref` as written, the letter upper-cased from `head` (or from `ref` when `head` is NULL), the selector after it. */
void json_element(struct json *j, char *ref, char *head, int line, int column, int end);
/* Open a directive card; `name` is lower-cased. */
void json_directive(struct json *j, char *name, int line, int column, int end);
void json_token(struct json *j, const char *class, char *text, int line, int column, int end);
void json_pair(struct json *j, char *key, char *value, int line, int column, int end);
void json_card_end(struct json *j);

/* The first error only; `found_class` and `expected` use the token-class vocabulary. */
void json_error(struct json *j, int line, int column, int end, const char *found_class, const char *found_text, const char **expected, int count);

const char *json_finish(struct json *j);

#endif
