/* ltspice: composed by scripts/grammars/compose.ts from grammar/spice and grammar/dialects/ltspice; do not edit. */
/*
 * SPICE base parser (ADR 0009). A netlist is cards; a card is a head token followed by words,
 * keywords, groups and `key=value` pairs, written to JSON as it is read (ADR 0008). Sections
 * `//@ section <name>` … `//@ end` may be replaced by grammar/dialects/<dialect>/parser.y; the
 * composed result is grammar/generated/<dialect>.y.
 *
 * Errors with a code (ADR 0008) are explicit productions below; TypeScript maps each code to its
 * wording. The codes every SPICE dialect shares:
 *   orphan-continuation   a `+` line with no card before it to continue
 *   not-an-element        a line that is neither an element nor a directive
 *   unterminated-group    a `(` or `{` whose closing bracket comes neither on its line nor on a `+` line continuing it
 * Anything else is a plain syntax error reported with what was found and what was expected.
 */
  /* from grammar/spice/parser.y: options */
%require "3.8"
%define api.pure full
%locations
%define parse.error custom
%define parse.lac full
%expect 0
%param { void *scanner }
%parse-param { struct json *out }

%code requires {
  #include "json.h"
}
%code {
  #include <string.h>
  #include "driver.h"
  int yylex(YYSTYPE *yylval, YYLTYPE *yylloc, void *scanner);
  static void yyerror(YYLTYPE *loc, void *scanner, struct json *out, const char *message);
  static void coded_error(struct json *out, void *scanner, const char *code, const YYLTYPE *loc, const char *found_class, const char **expected, int count);
}

/* Columns are 0-based everywhere, as in src/netlist.ts; Bison's default starts them at 1. */
%initial-action { @$.first_line = @$.last_line = 1; @$.first_column = @$.last_column = 0; }

  /* from grammar/spice/parser.y: definitions */
%union { char *text; }
%token YYEOF 0 "end of file"
%token <text> ELEMENT_HEAD "element" SUFFIX_HEAD "suffixed element" DIRECTIVE_HEAD "directive"
%token <text> WORD "word" KEYWORD "keyword" GROUP "group"
%token NEWLINE "newline" BAD_CONTINUATION "continuation" EQUALS "="
%token OPEN_NODES "node list" CLOSE_NODES "end of node list" UNTERMINATED "unterminated group"
%type <text> key value
%destructor { free($$); } <text>

%%
  /* from grammar/spice/parser.y: heads */
netlist
  : %empty
  | netlist card NEWLINE
  ;

card
  : head tokens             { json_card_end(out); }
  | BAD_CONTINUATION        { static const char *expected[] = { "element", "directive" }; coded_error(out, scanner, "orphan-continuation", &@1, "continuation", expected, 2); YYABORT; }
  | WORD                    { static const char *expected[] = { "element", "directive" }; coded_error(out, scanner, "not-an-element", &@1, "word", expected, 2); free($1); YYABORT; }
  | GROUP                   { static const char *expected[] = { "element", "directive" }; coded_error(out, scanner, "not-an-element", &@1, "group", expected, 2); free($1); YYABORT; }
  ;

head
  : element_head nodes
  | DIRECTIVE_HEAD          { json_directive(out, $1, @1.first_line, @1.first_column, @1.last_column); }
  ;

element_head
  : ELEMENT_HEAD            { json_element(out, $1, NULL, @1.first_line, @1.first_column, @1.last_column); }
  | SUFFIX_HEAD WORD        { json_element(out, $2, $1, @1.first_line, @1.first_column, @2.last_column); }
  ;

nodes
  : %empty
  | OPEN_NODES node_words CLOSE_NODES
  | OPEN_NODES node_words UNTERMINATED  { static const char *expected[] = { "end of node list" }; coded_error(out, scanner, "unterminated-group", &@3, "unterminated group", expected, 1); YYABORT; }
  ;

node_words
  : %empty                  { json_nodes_closed(out); }
  | node_words WORD         { json_token(out, "word", $2, @2.first_line, @2.first_column, @2.last_line, @2.last_column); }
  ;

  /* from grammar/spice/parser.y: tail */
tokens
  : %empty
  | tokens token
  ;

token
  : WORD             { json_token(out, "word", $1, @1.first_line, @1.first_column, @1.last_line, @1.last_column); }
  | KEYWORD          { json_token(out, "keyword", $1, @1.first_line, @1.first_column, @1.last_line, @1.last_column); }
  | GROUP            { json_token(out, "group", $1, @1.first_line, @1.first_column, @1.last_line, @1.last_column); }
  | key EQUALS value { json_pair(out, $1, $3, @1.first_line, @1.first_column, @3.last_line, @3.last_column); }
  | UNTERMINATED     { static const char *expected[] = { "group" }; coded_error(out, scanner, "unterminated-group", &@1, "unterminated group", expected, 1); YYABORT; }
  ;

key
  : WORD
  | KEYWORD
  | GROUP
  ;

value
  : WORD
  | KEYWORD
  | GROUP
  | UNTERMINATED     { $$ = NULL; static const char *expected[] = { "group" }; coded_error(out, scanner, "unterminated-group", &@1, "unterminated group", expected, 1); YYABORT; }
  ;
%%

/* Only "memory exhausted" reaches here: syntax errors go through yyreport_syntax_error. */
static void
yyerror(YYLTYPE *loc, void *scanner, struct json *out, const char *message)
{
  (void)scanner;
  json_error(out, NULL, loc->first_line, loc->first_column, loc->last_column, "fatal", message, NULL, 0);
}

/* An explicit error production: its stable code, where it is, and the token classes that would have done. */
static void
coded_error(struct json *out, void *scanner, const char *code, const YYLTYPE *loc, const char *found_class, const char **expected, int count)
{
  json_error(out, code, loc->first_line, loc->first_column, loc->last_column, found_class, scan_last_text(scanner), expected, count);
}

/* The first structural error: where, what was found and which token classes were expected. */
static int
yyreport_syntax_error(const yypcontext_t *ctx, void *scanner, struct json *out)
{
  enum { MAX = 8 };
  yysymbol_kind_t expected[MAX];
  int n = yypcontext_expected_tokens(ctx, expected, MAX);
  const YYLTYPE *loc = yypcontext_location(ctx);
  const char *names[MAX];
  int count = 0;
  /* The scanner's error token for an open bracket is never something to write: leave it out of what was expected. */
  for (int i = 0; i < (n < 0 ? 0 : n); i++) {
    const char *name = symbol_alias(yysymbol_name(expected[i]));
    if (strcmp(name, "unterminated group") != 0) names[count++] = name;
  }
  const char *found = symbol_alias(yysymbol_name(yypcontext_token(ctx)));
  /* A newline or the end of the file has no width of its own: point at the character before it. */
  int column = loc->first_column, end = loc->last_column;
  if (loc->last_line != loc->first_line || end <= column) {
    if (column > 0) column--;
    end = column + 1;
  }
  json_error(out, NULL, loc->first_line, column, end, found, scan_last_text(scanner), names, count);
  return 0;
}
