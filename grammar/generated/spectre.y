/* spectre: composed by scripts/grammars/compose.ts from grammar/spectre; do not edit. */
/*
 * Spectre base parser (ADR 0009). A netlist is cards; a card is an instance — `name [(nodes)]
 * master [param=value …]` — a keyword-led statement, or a block bracket, written to JSON as it is
 * read (ADR 0008). The master names an instance's type, and it comes after the nodes, so the
 * positional words are buffered until it is known: the last positional word when the nodes are
 * bare, the word after the closing `)` when they are parenthesised. No dialect overlays this
 * grammar; its composed result is grammar/generated/spectre.y.
 *
 * Errors with a code (ADR 0008) are explicit productions below; TypeScript maps each code to its
 * wording. The codes, the same as the SPICE base's:
 *   orphan-continuation   a `+` line with no card before it to continue
 *   not-an-element        a line that is neither an instance nor a statement
 *   unterminated-group    a `(`, `[` or `{` whose closing bracket comes neither on its line nor on a continued line
 * Anything else is a plain syntax error reported with what was found and what was expected.
 */
  /* from grammar/spectre/parser.y: options */
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
  #include <stdlib.h>
  #include <string.h>
  #include "driver.h"
  int yylex(YYSTYPE *yylval, YYLTYPE *yylloc, void *scanner);
  static void yyerror(YYLTYPE *loc, void *scanner, struct json *out, const char *message);
  static void coded_error(struct json *out, void *scanner, const char *code, const YYLTYPE *loc, const char *found_class, const char **expected, int count);
  static void pending_reset(void);
  static void pending_push(char *text, const YYLTYPE *loc);
  static void instance_open(struct json *out, char *ref, const YYLTYPE *at, char *master, int closed);
}

/* Columns are 0-based everywhere, as in src/netlist.ts; Bison's default starts them at 1. */
%initial-action { @$.first_line = @$.last_line = 1; @$.first_column = @$.last_column = 0; pending_reset(); }

  /* from grammar/spectre/parser.y: definitions */
%union { char *text; }
%token YYEOF 0 "end of file"
%token <text> INSTANCE_HEAD "instance" DIRECTIVE_HEAD "directive"
%token <text> WORD "word" MASTER "master" KEY "parameter name" GROUP "group"
%token <text> BLOCK_CLOSE "end of block"
%token NEWLINE "newline" BAD_CONTINUATION "continuation" EQUALS "=" BLOCK_OPEN "block"
%token OPEN_NODES "node list" CLOSE_NODES "end of node list" UNTERMINATED "unterminated group"
%type <text> pword master value
%destructor { free($$); } <text>

%%
  /* from grammar/spectre/parser.y: heads */
netlist
  : %empty
  | netlist card NEWLINE
  ;

card
  : bare_instance params block_opt         { json_card_end(out); }
  | closed_instance tokens block_opt       { json_card_end(out); }
  | directive tokens block_opt             { json_card_end(out); }
  | block_close words block_opt            { json_card_end(out); }
  | BLOCK_OPEN                             { json_directive(out, json_strndup("{", 1), @1.first_line, @1.first_column, @1.last_column); json_card_end(out); }
  | BAD_CONTINUATION        { static const char *expected[] = { "instance", "directive" }; coded_error(out, scanner, "orphan-continuation", &@1, "continuation", expected, 2); YYABORT; }
  | WORD                    { static const char *expected[] = { "instance", "directive" }; coded_error(out, scanner, "not-an-element", &@1, "word", expected, 2); free($1); YYABORT; }
  ;

/* `name n1 n2 master`: the nodes are bare, so the last positional word is the master and only parameters may follow. */
bare_instance
  : INSTANCE_HEAD positional               { instance_open(out, $1, &@1, NULL, 0); }
  ;

/* `name (n1 n2) master …`, or `name (1 2)(3 4) master …`: the master is the word after the last node list. */
closed_instance
  : INSTANCE_HEAD nodes master             { instance_open(out, $1, &@1, $3, 1); }
  ;

directive
  : DIRECTIVE_HEAD                         { json_directive(out, $1, @1.first_line, @1.first_column, @1.last_column); }
  ;

block_close
  : BLOCK_CLOSE                            { json_directive(out, $1, @1.first_line, @1.first_column, @1.last_column); }
  ;

block_opt
  : %empty
  | BLOCK_OPEN                             { json_card_end(out); json_directive(out, json_strndup("{", 1), @1.first_line, @1.first_column, @1.last_column); }
  ;

positional
  : pword                                  { pending_push($1, &@1); }
  | positional pword                       { pending_push($2, &@2); }
  ;

pword
  : WORD
  | MASTER
  ;

master
  : WORD
  | MASTER
  ;

nodes
  : node_list
  | nodes node_list
  ;

node_list
  : OPEN_NODES node_words CLOSE_NODES
  | OPEN_NODES node_words UNTERMINATED     { static const char *expected[] = { "end of node list" }; coded_error(out, scanner, "unterminated-group", &@3, "unterminated group", expected, 1); YYABORT; }
  ;

node_words
  : %empty
  | node_words WORD                        { pending_push($2, &@2); }
  ;

words
  : %empty
  | words WORD                             { json_token(out, "word", $2, @2.first_line, @2.first_column, @2.last_line, @2.last_column); }
  ;

  /* from grammar/spectre/parser.y: tail */
/* After bare nodes only parameters follow — a word there would have been a node — until the first parameter is written. */
params
  : %empty
  | params_begun
  ;

params_begun
  : param
  | params_begun param
  | params_begun pword                     { json_token(out, "word", $2, @2.first_line, @2.first_column, @2.last_line, @2.last_column); }
  ;

param
  : GROUP            { json_token(out, "group", $1, @1.first_line, @1.first_column, @1.last_line, @1.last_column); }
  | KEY EQUALS value { json_pair(out, $1, $3, @1.first_line, @1.first_column, @3.last_line, @3.last_column); }
  | UNTERMINATED     { static const char *expected[] = { "group" }; coded_error(out, scanner, "unterminated-group", &@1, "unterminated group", expected, 1); YYABORT; }
  ;

tokens
  : %empty
  | tokens token
  ;

token
  : pword            { json_token(out, "word", $1, @1.first_line, @1.first_column, @1.last_line, @1.last_column); }
  | param
  ;

value
  : WORD
  | MASTER
  | GROUP
  | UNTERMINATED     { $$ = NULL; static const char *expected[] = { "group" }; coded_error(out, scanner, "unterminated-group", &@1, "unterminated group", expected, 1); YYABORT; }
  ;
%%

/* The positional words of the instance being read, kept until its master is known (ADR 0008: the master is a card field). */
static struct {
  struct pending { char *text; int line, column, end_line, end; } *items;
  int count, capacity;
} pending;

static void
pending_reset(void)
{
  for (int i = 0; i < pending.count; i++) free(pending.items[i].text);
  pending.count = 0;
}

static void
pending_push(char *text, const YYLTYPE *loc)
{
  if (pending.count == pending.capacity) {
    pending.capacity = pending.capacity ? pending.capacity * 2 : 16;
    pending.items = realloc(pending.items, (size_t)pending.capacity * sizeof *pending.items);
  }
  struct pending *item = &pending.items[pending.count++];
  item->text = text;
  item->line = loc->first_line;
  item->column = loc->first_column;
  item->end_line = loc->last_line;
  item->end = loc->last_column;
}

/*
 * The master is known: open the card, then hand over the buffered words as its node tokens. With
 * bare nodes (`master` NULL) the last buffered word is the master itself.
 */
static void
instance_open(struct json *out, char *ref, const YYLTYPE *at, char *master, int closed)
{
  if (master == NULL) master = pending.items[--pending.count].text;
  json_instance(out, ref, master, at->first_line, at->first_column, at->last_column);
  if (closed) json_nodes_closed(out);
  for (int i = 0; i < pending.count; i++) {
    struct pending *item = &pending.items[i];
    json_token(out, "word", item->text, item->line, item->column, item->end_line, item->end);
  }
  pending.count = 0;
}

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
