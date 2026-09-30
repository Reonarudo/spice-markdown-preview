/* ngspice: composed by scripts/grammars/compose.ts from grammar/spice and grammar/dialects/ngspice; do not edit. */
/*
 * SPICE base parser (ADR 0009). A netlist is cards; a card is a head token followed by words,
 * keywords, groups and `key=value` pairs, written to JSON as it is read (ADR 0008). Sections
 * `//@ section <name>` … `//@ end` may be replaced by grammar/dialects/<dialect>/parser.y; the
 * composed result is grammar/generated/<dialect>.y.
 */
  /* from grammar/spice/parser.y: options */
%require "3.8"
%define api.pure full
%locations
%define parse.error custom
%define parse.lac full
%param { void *scanner }
%parse-param { struct json *out }

%code requires {
  #include "json.h"
}
%code {
  #include "driver.h"
  int yylex(YYSTYPE *yylval, YYLTYPE *yylloc, void *scanner);
  static void yyerror(YYLTYPE *loc, void *scanner, struct json *out, const char *message);
}

/* Columns are 0-based everywhere, as in src/netlist.ts; Bison's default starts them at 1. */
%initial-action { @$.first_line = @$.last_line = 1; @$.first_column = @$.last_column = 0; }

  /* from grammar/spice/parser.y: definitions */
%union { char *text; }
%token <text> ELEMENT_HEAD "element" SUFFIX_HEAD "suffixed element" DIRECTIVE_HEAD "directive"
%token <text> WORD "word" KEYWORD "keyword" GROUP "group"
%token NEWLINE "newline" BAD_CONTINUATION "continuation" EQUALS "="
%type <text> key value

%%
  /* from grammar/spice/parser.y: heads */
netlist
  : %empty
  | netlist card NEWLINE
  ;

card
  : head tokens   { json_card_end(out); }
  ;

head
  : ELEMENT_HEAD          { json_element(out, $1, NULL, @1.first_line, @1.first_column, @1.last_column); }
  | SUFFIX_HEAD WORD      { json_element(out, $2, $1, @1.first_line, @1.first_column, @2.last_column); }
  | DIRECTIVE_HEAD        { json_directive(out, $1, @1.first_line, @1.first_column, @1.last_column); }
  ;

  /* from grammar/spice/parser.y: tail */
tokens
  : %empty
  | tokens token
  ;

token
  : WORD             { json_token(out, "word", $1, @1.first_line, @1.first_column, @1.last_column); }
  | KEYWORD          { json_token(out, "keyword", $1, @1.first_line, @1.first_column, @1.last_column); }
  | GROUP            { json_token(out, "group", $1, @1.first_line, @1.first_column, @1.last_column); }
  | key EQUALS value { json_pair(out, $1, $3, @1.first_line, @1.first_column, @3.last_column); }
  ;

key
  : WORD
  | KEYWORD
  ;

value
  : WORD
  | KEYWORD
  | GROUP
  ;
%%

/* Only "memory exhausted" reaches here: syntax errors go through yyreport_syntax_error. */
static void
yyerror(YYLTYPE *loc, void *scanner, struct json *out, const char *message)
{
  (void)scanner;
  json_error(out, loc->first_line, loc->first_column, loc->last_column, "fatal", message, NULL, 0);
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
  int count = n < 0 ? 0 : n;
  for (int i = 0; i < count; i++) names[i] = symbol_alias(yysymbol_name(expected[i]));
  const char *found = symbol_alias(yysymbol_name(yypcontext_token(ctx)));
  json_error(out, loc->first_line, loc->first_column, loc->last_column, found, scan_last_text(scanner), names, count);
  return 0;
}
