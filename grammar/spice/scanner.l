/*
 * SPICE base scanner (ADR 0009). The core every SPICE dialect shares: cards, `+` continuation,
 * `*` and `;` comments, one head token per card, words, pairs and groups.
 *
 * Lines `//@ section <name>` … `//@ end` delimit the sections a dialect's overlay in
 * grammar/dialects/<dialect>/scanner.l may replace whole, keep, or (empty) remove. The
 * `generated:*` sections are filled from the element catalogue. scripts/grammars/compose.ts
 * writes the result to grammar/generated/<dialect>.l; flex reads that file, never this one.
 *
 * The scanner only classifies: which token is an element head, a directive head, a word, a
 * keyword, a pair or a group. Node counts, models and drawing stay in TypeScript (ADR 0008).
 */
//@ section options
%option reentrant bison-bridge bison-locations
%option noyywrap nounistd never-interactive noinput nounput nodefault
%option extra-type="struct scan_state *"
//@ end
//@ section generated:options
//@ end

%{
#include "parser.h"
#include "driver.h"
#include "json.h"

/* Lines are 1-based, columns 0-based and `end` exclusive, as src/netlist.ts counts them. */
#define YY_USER_ACTION                                                       \
  yylloc->first_line = yylloc->last_line;                                    \
  yylloc->first_column = yylloc->last_column;                                \
  for (int i = 0; i < (int)yyleng; i++) {                                    \
    if (yytext[i] == '\n') { yylloc->last_line++; yylloc->last_column = 0; } \
    else yylloc->last_column++;                                              \
  }

/* Hand the token's text to the parser and remember it for the error report. */
#define TOKEN(kind) do {                                    \
    yylval->text = json_strndup(yytext, yyleng);            \
    scan_remember(yyextra, yytext, yyleng);                 \
    return kind;                                            \
  } while (0)

/* A head token opens a card: the rest of the line is read in INITIAL. */
#define HEAD(kind) do { BEGIN(INITIAL); yyextra->at_card_start = 0; TOKEN(kind); } while (0)
%}

//@ section definitions
WS        [ \t\r]
WORDCHAR  [^ \t\r\n;=(){}]
GROUP     \([^()\n]*\)|\{[^{}\n]*\}
//@ end
//@ section generated:letters
//@ end

/* Exclusive: at the start of a card, until its head token is read. */
%x LINESTART

%%
%{
  if (yyextra->at_card_start) { BEGIN(LINESTART); }
%}

//@ section generated:keywords
//@ end

//@ section comments
<LINESTART>\*[^\n]*\n     { /* a whole-line comment */ }
;[^\n]*                   { /* an inline comment runs to the end of the line */ }
//@ end

//@ section continuation
\n(\*[^\n]*\n)*{WS}*\+   { /* `+` continues the card; comment lines between are allowed, blank lines end it */ }
<LINESTART>\+            { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }
//@ end

//@ section quoting
  /* The base has no quoted expressions; HSPICE's overlay fills this section with '…' and "…". */
//@ end

//@ section opaque
  /* Opaque regions — .control…endc, HSPICE .DATA/.ALTER/.PROTECT — are swallowed here by the dialect grammars. */
//@ end

//@ section heads
<LINESTART>{WS}+                          { /* indentation before a head */ }
<LINESTART>\n                             { /* a blank line */ }
<LINESTART>\.{WORDCHAR}+                  { HEAD(DIRECTIVE_HEAD); }
<LINESTART>{ELEMENT_LETTER}{WORDCHAR}*    { HEAD(ELEMENT_HEAD); }
<LINESTART>{GROUP}                        { HEAD(GROUP); }
<LINESTART>{WORDCHAR}+                    { HEAD(WORD); }
<LINESTART>.                              { HEAD(WORD); }
<LINESTART><<EOF>>                        { return YYEOF; }
//@ end

//@ section tail
\n                    { yyextra->at_card_start = 1; return NEWLINE; }
{WS}+                 { }
"="                   { scan_remember(yyextra, yytext, yyleng); return EQUALS; }
{GROUP}               { TOKEN(GROUP); }
{WORDCHAR}+{GROUP}?   { TOKEN(WORD); }
.                     { TOKEN(WORD); }
<<EOF>>               { if (!yyextra->at_card_start) { yyextra->at_card_start = 1; return NEWLINE; } return YYEOF; }
//@ end
%%
