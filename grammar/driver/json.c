/* The JSON writer (ADR 0008). See json.h. */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "json.h"

char *json_strndup(const char *text, size_t length) {
  char *copy = malloc(length + 1);
  memcpy(copy, text, length);
  copy[length] = 0;
  return copy;
}

static void put(struct json *j, const char *s, size_t n) {
  if (j->len + n + 1 > j->cap) {
    while (j->len + n + 1 > j->cap) j->cap = j->cap ? j->cap * 2 : 4096;
    j->buf = realloc(j->buf, j->cap);
  }
  memcpy(j->buf + j->len, s, n);
  j->len += n;
  j->buf[j->len] = 0;
}

static void puts_(struct json *j, const char *s) { put(j, s, strlen(s)); }

static void put_string(struct json *j, const char *s) {
  put(j, "\"", 1);
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    char esc[8];
    if (c == '"' || c == '\\') { esc[0] = '\\'; esc[1] = (char)c; put(j, esc, 2); }
    else if (c < 0x20) { snprintf(esc, sizeof esc, "\\u%04x", c); put(j, esc, 6); }
    else put(j, (const char *)s, 1);
  }
  put(j, "\"", 1);
}

static void put_int(struct json *j, int n) { char b[16]; snprintf(b, sizeof b, "%d", n); puts_(j, b); }

static void put_span(struct json *j, int line, int column, int end) {
  puts_(j, ",\"line\":"); put_int(j, line);
  puts_(j, ",\"column\":"); put_int(j, column);
  puts_(j, ",\"end\":"); put_int(j, end);
}

/* A token's span; `endLine` only when the token runs onto a later line. */
static void put_token_span(struct json *j, int line, int column, int end_line, int end) {
  put_span(j, line, column, end);
  if (end_line != line) { puts_(j, ",\"endLine\":"); put_int(j, end_line); }
}

void json_init(struct json *j) {
  free(j->buf);
  memset(j, 0, sizeof *j);
  puts_(j, "{\"contract\":1,\"cards\":[");
}

static void open_card(struct json *j, const char *kind) {
  if (j->cards++) put(j, ",", 1);
  puts_(j, "{\"kind\":"); put_string(j, kind);
  j->in_card = 1;
  j->tokens_open = 0;
  j->tokens = 0;
  j->model = 0;
}

/* The tokens array starts after every head field is written. */
static void open_tokens(struct json *j) {
  if (j->tokens_open) return;
  puts_(j, ",\"tokens\":[");
  j->tokens_open = 1;
}

static void close_card(struct json *j) {
  if (!j->in_card) return;
  open_tokens(j);
  puts_(j, "]}");
  j->in_card = 0;
}

static void upper(char *text) {
  for (; *text; text++) *text = (char)toupper((unsigned char)*text);
}

void json_element(struct json *j, char *ref, char *head, int line, int column, int end) {
  if (j->failed) { free(ref); free(head); return; }
  open_card(j, "element");
  puts_(j, ",\"ref\":"); put_string(j, ref);
  const char *spelling = head ? head : ref;
  char letter[2] = { (char)toupper((unsigned char)spelling[0]), 0 };
  puts_(j, ",\"letter\":"); put_string(j, letter);
  if (head) {
    upper(head + 1);
    puts_(j, ",\"selector\":"); put_string(j, head + 1);
  }
  put_span(j, line, column, end);
  free(ref); free(head);
}

void json_instance(struct json *j, char *ref, char *master, int line, int column, int end) {
  if (j->failed) { free(ref); free(master); return; }
  open_card(j, "element");
  puts_(j, ",\"ref\":"); put_string(j, ref);
  puts_(j, ",\"master\":"); put_string(j, master);
  put_span(j, line, column, end);
  free(ref); free(master);
}

void json_nodes_closed(struct json *j) {
  if (j->failed || !j->in_card || j->tokens_open) return;
  puts_(j, ",\"nodesClosed\":true");
}

void json_directive(struct json *j, char *name, int line, int column, int end) {
  if (j->failed) { free(name); return; }
  open_card(j, "directive");
  for (char *c = name; *c; c++) *c = (char)tolower((unsigned char)*c);
  puts_(j, ",\"name\":"); put_string(j, name);
  put_span(j, line, column, end);
  j->model = strcmp(name, ".model") == 0;
  free(name);
}

static void open_token(struct json *j, const char *class, const char *text, int line, int column, int end_line, int end) {
  open_tokens(j);
  if (j->tokens++) put(j, ",", 1);
  puts_(j, "{\"class\":"); put_string(j, class);
  puts_(j, ",\"text\":"); put_string(j, text);
  put_token_span(j, line, column, end_line, end);
}

void json_token(struct json *j, const char *class, char *text, int line, int column, int end_line, int end) {
  if (j->failed || !j->in_card) { free(text); return; }
  /* A `.model` card keeps its bare words — name, type, flags such as `pchan` — and drops parameters below. */
  if (j->model && j->tokens == 1) {
    char *paren = strchr(text, '(');
    if (paren) { end -= (int)strlen(paren); *paren = 0; }
  }
  open_token(j, class, text, line, column, end_line, end);
  put(j, "}", 1);
  free(text);
}

void json_pair(struct json *j, char *key, char *value, int line, int column, int end_line, int end) {
  if (j->failed || !j->in_card) { free(key); free(value); return; }
  if (j->model) {
    char lowered[8] = "";
    if (strlen(key) == 5) { memcpy(lowered, key, 6); for (char *c = lowered; *c; c++) *c = (char)tolower((unsigned char)*c); }
    if (strcmp(lowered, "level") != 0) { free(key); free(value); return; }
  }
  size_t n = strlen(key) + strlen(value) + 2;
  char *joined = malloc(n);
  snprintf(joined, n, "%s=%s", key, value);
  open_token(j, "pair", joined, line, column, end_line, end);
  puts_(j, ",\"key\":"); put_string(j, key);
  puts_(j, ",\"value\":"); put_string(j, value);
  put(j, "}", 1);
  free(joined); free(key); free(value);
}

void json_card_end(struct json *j) {
  if (j->failed) return;
  close_card(j);
}

void json_error(struct json *j, const char *code, int line, int column, int end, const char *found_class, const char *found_text, const char **expected, int count) {
  if (j->failed) return;
  j->failed = 1;
  close_card(j);
  puts_(j, "],\"error\":{");
  if (code) { puts_(j, "\"code\":"); put_string(j, code); put(j, ",", 1); }
  puts_(j, "\"line\":"); put_int(j, line);
  puts_(j, ",\"column\":"); put_int(j, column);
  puts_(j, ",\"end\":"); put_int(j, end);
  puts_(j, ",\"found\":{\"class\":"); put_string(j, found_class);
  puts_(j, ",\"text\":"); put_string(j, found_text ? found_text : "");
  puts_(j, "},\"expected\":[");
  for (int i = 0; i < count; i++) { if (i) put(j, ",", 1); put_string(j, expected[i]); }
  puts_(j, "]}");
}

const char *json_finish(struct json *j, int after_end) {
  close_card(j);
  if (!j->failed) put(j, "]", 1);
  if (after_end > 0) { puts_(j, ",\"afterEnd\":"); put_int(j, after_end); }
  put(j, "}", 1);
  return j->buf;
}
