/* The shared driver (ADR 0009): owns the scanner and the JSON document, exports netlist_parse. */
#include <stdlib.h>
#include <string.h>
#include "json.h"
#include "parser.h"
#include "driver.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORTED EMSCRIPTEN_KEEPALIVE
#else
#define EXPORTED
#endif

/* The flex entry points the generated scanner defines. */
typedef void *yyscan_t;
int yylex_init_extra(struct scan_state *extra, yyscan_t *scanner);
int yylex_destroy(yyscan_t scanner);
void *yy_scan_bytes(const char *bytes, int length, yyscan_t scanner);
struct scan_state *yyget_extra(yyscan_t scanner);

void scan_remember(struct scan_state *state, const char *text, size_t length) {
  if (length >= sizeof state->last_text) length = sizeof state->last_text - 1;
  memcpy(state->last_text, text, length);
  state->last_text[length] = 0;
}

const char *scan_last_text(void *scanner) {
  return yyget_extra(scanner)->last_text;
}

const char *symbol_alias(const char *name) {
  static char alias[64];
  size_t length = strlen(name);
  if (length < 2 || name[0] != '"' || name[length - 1] != '"') return name;
  length -= 2;
  if (length >= sizeof alias) length = sizeof alias - 1;
  memcpy(alias, name + 1, length);
  alias[length] = 0;
  return alias;
}

EXPORTED const char *netlist_parse(const char *source, int length) {
  static struct json out;
  json_init(&out);
  struct scan_state state;
  memset(&state, 0, sizeof state);
  state.at_card_start = 1;
  yyscan_t scanner;
  yylex_init_extra(&state, &scanner);
  yy_scan_bytes(source, length, scanner);
  yyparse(scanner, &out);
  yylex_destroy(scanner);
  return json_finish(&out);
}
