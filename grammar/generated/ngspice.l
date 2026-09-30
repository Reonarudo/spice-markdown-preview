/* ngspice: composed by scripts/grammars/compose.ts from grammar/spice and grammar/dialects/ngspice; do not edit. */
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
  /* from grammar/spice/scanner.l: options */
%option reentrant bison-bridge bison-locations
%option noyywrap nounistd never-interactive noinput nounput nodefault
%option extra-type="struct scan_state *"
  /* generated from src/catalogue/dialects.ts: ngspice is case-insensitive */
%option caseless

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

  /* from grammar/spice/scanner.l: definitions */
WS        [ \t\r]
WORDCHAR  [^ \t\r\n;=(){}]
GROUP     \([^()\n]*\)|\{[^{}\n]*\}
  /* generated from src/catalogue/dialects.ts: ngspice letters */
ELEMENT_LETTER  [ABCDEFGHIJKLMNOPQRSTUVWXYZ]

/* Exclusive: at the start of a card, until its head token is read. */
%x LINESTART

%%
%{
  if (yyextra->at_card_start) { BEGIN(LINESTART); }
%}

  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"AND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"CHEBYSHEV"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts */
"CUR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"FREQ"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"LAPLACE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NAND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NOISE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"OR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"POLY"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"TABLE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"VALUE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts */
"VCCAP"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts */
"VCCS"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts */
"VCR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vcvs.ts */
"VCVS"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vcvs.ts */
"VOL"{GROUP}?  { TOKEN(KEYWORD); }

  /* from grammar/dialects/ngspice/scanner.l: comments */
<LINESTART>\*[^\n]*\n     { /* a whole-line comment */ }
;[^\n]*                   { /* an inline comment runs to the end of the line */ }
{WS}+\$[^\n]*             { /* ngspice: `$` after whitespace starts a comment */ }

  /* from grammar/spice/scanner.l: continuation */
\n(\*[^\n]*\n)*{WS}*\+   { /* `+` continues the card; comment lines between are allowed, blank lines end it */ }
<LINESTART>\+            { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }

  /* from grammar/spice/scanner.l: quoting */
  /* The base has no quoted expressions; HSPICE's overlay fills this section with '…' and "…". */

  /* from grammar/spice/scanner.l: opaque */
  /* Opaque regions — .control…endc, HSPICE .DATA/.ALTER/.PROTECT — are swallowed here by the dialect grammars. */

  /* from grammar/spice/scanner.l: heads */
<LINESTART>{WS}+                          { /* indentation before a head */ }
<LINESTART>\n                             { /* a blank line */ }
<LINESTART>\.{WORDCHAR}+                  { HEAD(DIRECTIVE_HEAD); }
<LINESTART>{ELEMENT_LETTER}{WORDCHAR}*    { HEAD(ELEMENT_HEAD); }
<LINESTART>{GROUP}                        { HEAD(GROUP); }
<LINESTART>{WORDCHAR}+                    { HEAD(WORD); }
<LINESTART>.                              { HEAD(WORD); }
<LINESTART><<EOF>>                        { return YYEOF; }

  /* from grammar/spice/scanner.l: tail */
\n                    { yyextra->at_card_start = 1; return NEWLINE; }
{WS}+                 { }
"="                   { scan_remember(yyextra, yytext, yyleng); return EQUALS; }
{GROUP}               { TOKEN(GROUP); }
{WORDCHAR}+{GROUP}?   { TOKEN(WORD); }
.                     { TOKEN(WORD); }
<<EOF>>               { if (!yyextra->at_card_start) { yyextra->at_card_start = 1; return NEWLINE; } return YYEOF; }
%%
