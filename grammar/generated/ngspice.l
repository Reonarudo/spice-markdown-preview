/* ngspice: composed by scripts/grammars/compose.ts from grammar/spice and grammar/dialects/ngspice; do not edit. */
/*
 * SPICE base scanner (ADR 0009). The core every SPICE dialect shares: cards, `+` continuation,
 * `*` and `;` comments, one head token per card, words, pairs and groups, a parenthesised node
 * list after an element's name, the trimmed `.model` card, and the stop at the first `.end`.
 *
 * Lines `//@ section <name>` … `//@ end` delimit the sections a dialect's overlay in
 * grammar/dialects/<dialect>/scanner.l may replace whole, keep, or (empty) remove. The
 * `generated:*` sections are filled from the element catalogue. scripts/grammars/compose.ts
 * writes the result to grammar/generated/<dialect>.l; flex reads that file, never this one.
 *
 * The scanner only classifies: which token is an element head, a directive head, a word, a
 * keyword, a pair or a group. Node counts, models and drawing stay in TypeScript (ADR 0008).
 *
 * Start conditions, all exclusive:
 *   LINESTART  at the start of a card, until its head token is read;
 *   INITIAL    the rest of an element or directive card;
 *   NODES      inside the parenthesised node list that may follow an element's name;
 *   GROUPSCAN  inside a `(…)` or `{…}` group, nested brackets counted, until it closes — on its line or
 *              on a `+` line continuing it (ADR 0008 *Groups across continuation lines*);
 *   MODEL      the rest of a `.model` card, where `(` and `)` are only separators;
 *   OPAQUE     a region the dialect swallows (`.control` … `.endc`), back to its closing head;
 *   AFTEREND   after the first `.end`: lines are only counted.
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

/* Keep only the first `n` characters of the match, and the location with them. */
#define KEEP(n) do { yyless(n); yylloc->last_line = yylloc->first_line; yylloc->last_column = yylloc->first_column + (n); } while (0)

/* Hand the token's text to the parser and remember it for the error report. */
#define TOKEN(kind) do {                                    \
    yylval->text = json_strndup(yytext, yyleng);            \
    scan_remember(yyextra, yytext, yyleng);                 \
    yyextra->after_head = 0;                                \
    return kind;                                            \
  } while (0)

/* A head token opens a card; the rest of the line is read in `state`. */
#define HEAD_IN(kind, state) do {                           \
    BEGIN(state);                                           \
    yyextra->at_card_start = 0;                             \
    yylval->text = json_strndup(yytext, yyleng);            \
    scan_remember(yyextra, yytext, yyleng);                 \
    yyextra->after_head = (kind) == ELEMENT_HEAD;           \
    return kind;                                            \
  } while (0)
#define HEAD(kind) HEAD_IN(kind, INITIAL)

/* Start gathering a bracketed group at this match; `kind` is the token it becomes when it closes. */
#define GROUP_BEGIN(open, close, kind) do {                 \
    yyextra->open_line = yylloc->first_line;                \
    yyextra->open_column = yylloc->last_column - 1;         \
    yyextra->group.column = yylloc->first_column;           \
    scan_group_begin(yyextra, yytext, yyleng, open, close, kind); \
    BEGIN(GROUPSCAN);                                       \
  } while (0)

/* A `+` line continues the card inside a node list or a group: the pieces of a group are joined by one blank. */
#define CONTINUED() do { if (YY_START == GROUPSCAN) scan_group_continue(yyextra); } while (0)

/* The line ended inside a node list or group with no `+` line to continue it: the error points at the bracket that opened it. */
#define UNTERMINATED_AT_OPEN(bracket) do {                  \
    yylloc->first_line = yylloc->last_line = yyextra->open_line; \
    yylloc->first_column = yyextra->open_column;            \
    yylloc->last_column = yyextra->open_column + 1;         \
    scan_remember(yyextra, bracket, 1);                     \
    return UNTERMINATED;                                    \
  } while (0)

/* The card's line ends: the next token is a head, read in the state the card left behind. */
#define END_OF_CARD() do { yyextra->at_card_start = 1; yyextra->after_head = 0; return NEWLINE; } while (0)
%}

  /* from grammar/dialects/ngspice/scanner.l: definitions */
WS        [ \t\r]
SEP       [ \t\r,]
WORDCHAR  [^ \t\r\n,;=(){}/]
WORD      ({WORDCHAR}|\/{WORDCHAR})+
WORDTAIL  ({WORDCHAR}|\/{WORDCHAR})*
GROUP     \([^()\n]*\)|\{[^{}\n]*\}
BRACES    \{[^{}\n]*\}
  /* generated from src/catalogue/dialects.ts: ngspice letters */
ELEMENT_LETTER  [ABCDEFGHIJKLMNOPQRSTUVWXYZ]

%x LINESTART NODES GROUPSCAN MODEL OPAQUE AFTEREND

%%
%{
  if (yyextra->at_card_start) {
    if (yyextra->ending) BEGIN(AFTEREND);
    else if (yyextra->opaque) BEGIN(OPAQUE);
    else BEGIN(LINESTART);
  }
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
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>#[^\n]*\n?                       { /* ngspice: `#` at the start of a line is a comment */ }
<LINESTART>[=\[\]?()&%$\"!:,][^\n]*\n?      { /* ngspice: a line starting with one of these is a comment (with a warning) */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
<INITIAL,MODEL>{SEP}+\$[^\n]*               { /* ngspice: `$` after a blank, tab or comma starts a comment */ }
<LINESTART,INITIAL,MODEL>"//"[^\n]*         { /* ngspice: `//` starts a comment anywhere */ }

  /* from grammar/dialects/ngspice/scanner.l: continuation */
<INITIAL,MODEL>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+   { /* `+` continues the card; comment and blank lines between the pieces are allowed */ }
<NODES,GROUPSCAN>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+{WS}* { CONTINUED(); /* the same `+` inside a node list or a group */ }
<INITIAL,MODEL>\\\\{WS}*\n                      { /* ngspice: a line ending in `\\` continues on the next */ }
<LINESTART>\+                                   { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }

  /* from grammar/dialects/ngspice/scanner.l: quoting */
  /* ngspice: '…' is an expression like {…}; "…" is a string. Both may hold spaces and comment characters. */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }

  /* from grammar/dialects/ngspice/scanner.l: opaque */
  /* `.control` … `.endc` is a script, not netlist lines: only the two directive cards come back. */
<LINESTART>".control"                       { yyextra->opaque = 1; HEAD(DIRECTIVE_HEAD); }
<OPAQUE>{WS}+                               { }
<OPAQUE>\n                                  { }
<OPAQUE>".endc"[^\n]*                       {
                                              /* `.endc` as a whole word closes the region; `.endcx` is script text */
                                              if (yyleng == 5 || strchr(" \t\r;", yytext[5])) { KEEP(5); yyextra->opaque = 0; HEAD(DIRECTIVE_HEAD); }
                                            }
<OPAQUE>[^ \t\r\n][^\n]*                    { }
<OPAQUE><<EOF>>                             { return YYEOF; }

  /* from grammar/spice/scanner.l: heads */
<LINESTART>{WS}+                          { /* indentation before a head */ }
<LINESTART>\n                             { /* a blank line */ }
<LINESTART>".end"                         { yyextra->ending = 1; HEAD(DIRECTIVE_HEAD); }
<LINESTART>".model"                       { HEAD_IN(DIRECTIVE_HEAD, MODEL); }
<LINESTART>\.{WORD}                       { HEAD(DIRECTIVE_HEAD); }
<LINESTART>{ELEMENT_LETTER}{WORDTAIL}     { HEAD(ELEMENT_HEAD); }
<LINESTART>[({]                           { HEAD(GROUP); }
<LINESTART>{WORD}                         { HEAD(WORD); }
<LINESTART>.                              { HEAD(WORD); }
<LINESTART><<EOF>>                        { return YYEOF; }

  /* from grammar/spice/scanner.l: nodes */
  /* `X1 (a b) sub`: a `(` right after an element's name opens its node list, unwrapped into words. */
<INITIAL>{WORD}?\(                        {
                                            if (yyextra->after_head && yyleng == 1) {
                                              yyextra->open_line = yylloc->first_line;
                                              yyextra->open_column = yylloc->first_column;
                                              BEGIN(NODES);
                                              scan_remember(yyextra, yytext, yyleng);
                                              yyextra->after_head = 0;
                                              return OPEN_NODES;
                                            }
                                            GROUP_BEGIN('(', ')', yyleng == 1 ? GROUP : WORD);
                                          }
<NODES>{SEP}+                             { }
<NODES>\)                                 { BEGIN(INITIAL); scan_remember(yyextra, yytext, yyleng); return CLOSE_NODES; }
<NODES>{WORD}                             { TOKEN(WORD); }
<NODES>\n                                 |
<NODES><<EOF>>                            { UNTERMINATED_AT_OPEN("("); }
<NODES>.                                  { TOKEN(WORD); }

  /* from grammar/spice/scanner.l: groups */
  /* A `(…)` or `{…}` group is one token, nested brackets and all; it must close on its line or on a `+` line continuing it (the `continuation` section). */
<INITIAL>\{                               { GROUP_BEGIN('{', '}', GROUP); }
<GROUPSCAN>[^(){}\n]+                     { scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>[({]                           { if (yytext[0] == yyextra->group.open) yyextra->group.depth++; scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>[)}]                           {
                                            scan_group_append(yyextra, yytext, yyleng);
                                            if (yytext[0] == yyextra->group.close && --yyextra->group.depth == 0) {
                                              BEGIN(INITIAL);
                                              yylloc->first_line = yyextra->open_line;
                                              yylloc->first_column = yyextra->group.column;
                                              yylval->text = scan_group_take(yyextra);
                                              scan_remember(yyextra, yylval->text, yyextra->group.length);
                                              yyextra->after_head = 0;
                                              return yyextra->group.kind;
                                            }
                                          }
<GROUPSCAN>\n                             |
<GROUPSCAN><<EOF>>                        { UNTERMINATED_AT_OPEN(&yyextra->group.open); }

  /* from grammar/spice/scanner.l: model */
  /* `.model name type (p=v …)`: parentheses are separators, so `level=` is seen as a pair. */
<MODEL>{SEP}+                             { }
<MODEL>[()]                               { }
<MODEL>"="                                { yyextra->after_head = 0; scan_remember(yyextra, yytext, yyleng); return EQUALS; }
<MODEL>{BRACES}                           { TOKEN(GROUP); }
<MODEL>{WORD}                             { TOKEN(WORD); }
<MODEL>.                                  { TOKEN(WORD); }

  /* from grammar/spice/scanner.l: ending */
  /* After the first `.end` nothing is read; non-blank, non-comment lines are counted for a note. */
<AFTEREND>{WS}*\*[^\n]*\n?                { }
<AFTEREND>{WS}*\n                         { }
<AFTEREND>[^\n]*\n?                       { yyextra->after_end++; }
<AFTEREND><<EOF>>                         { return YYEOF; }

  /* from grammar/spice/scanner.l: tail */
<INITIAL,MODEL>\n                         { END_OF_CARD(); }
<INITIAL>{SEP}+                           { }
<INITIAL>"="                              { yyextra->after_head = 0; scan_remember(yyextra, yytext, yyleng); return EQUALS; }
<INITIAL>{WORD}                           { TOKEN(WORD); }
<INITIAL>.                                { TOKEN(WORD); }
<INITIAL,MODEL><<EOF>>                    { if (!yyextra->at_card_start) END_OF_CARD(); return YYEOF; }
%%
