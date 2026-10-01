/* pspice: composed by scripts/grammars/compose.ts from grammar/spice and grammar/dialects/pspice; do not edit. */
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
 *   GROUPSCAN  inside a `(…)` or `{…}` group, nested brackets counted, until it closes on its line;
 *   MODEL      the rest of a `.model` card, where `(` and `)` are only separators;
 *   OPAQUE     a region the dialect swallows (`.control` … `.endc`), back to its closing head;
 *   AFTEREND   after the first `.end`: lines are only counted.
 */
  /* from grammar/spice/scanner.l: options */
%option reentrant bison-bridge bison-locations
%option noyywrap nounistd never-interactive noinput nounput nodefault
%option extra-type="struct scan_state *"
  /* generated from src/catalogue/dialects.ts: pspice is case-insensitive */
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

/* The line ended inside a node list or group: the error points at the bracket that opened it. */
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

  /* from grammar/dialects/pspice/scanner.l: definitions */
WS        [ \t\r]
SEP       [ \t\r,]
WORDCHAR  [^ \t\r\n,;=(){}]
WORD      {WORDCHAR}+
WORDTAIL  {WORDCHAR}*
GROUP     {WS}*\([^()\n]*\)
BRACES    \{[^{}\n]*\}
  /* generated from src/catalogue/dialects.ts: pspice letters */
ELEMENT_LETTER  [BCDEFGHIJKLMNOQRSTUVWXZ]

%x LINESTART NODES GROUPSCAN MODEL OPAQUE AFTEREND

%%
%{
  if (yyextra->at_card_start) {
    if (yyextra->ending) BEGIN(AFTEREND);
    else if (yyextra->opaque) BEGIN(OPAQUE);
    else BEGIN(LINESTART);
  }
%}

  /* generated from src/catalogue/digital-adc.ts */
"ADC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts, src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"AND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"AND3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"AND3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"ANDA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"AO"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"AOI"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts */
"BUF"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"BUF3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"BUF3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"BUFA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"CHEBYSHEV"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-constraint.ts */
"CONSTRAINT"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts */
"CUR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-dac.ts */
"DAC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-flip-flop.ts */
"DFF"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-flip-flop.ts */
"DFFDE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-latch.ts */
"DLTCH"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-delay-line.ts */
"DLYLINE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"FREQ"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-stimulus.ts */
"FSTIM"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts */
"INV"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"INV3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"INV3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"INVA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-flip-flop.ts */
"JKFF"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-flip-flop.ts */
"JKFFDE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"LAPLACE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-logic-expression.ts */
"LOGICEXP"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts, src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NAND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NAND3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NAND3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"NANDA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-transfer-gate.ts */
"NBTG"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NOISE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts, src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"NOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NOR3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NOR3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"NORA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts */
"NOT"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts */
"NXOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NXOR3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"NXOR3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"NXORA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"OA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"OAI"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate.ts, src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"OR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"OR3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"OR3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"ORA"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-transfer-gate.ts */
"PBTG"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pin-delay.ts */
"PINDLY"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLAND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLANDC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNAND"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNANDC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNORC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNXOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLNXORC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLORC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLXOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pld.ts */
"PLXORC"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"POLY"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pull.ts */
"PULLDN"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-pull.ts */
"PULLUP"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-ram.ts */
"RAM"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-rom.ts */
"ROM"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-latch.ts */
"SRFF"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-stimulus.ts */
"STIM"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/vccs.ts, src/catalogue/vcvs.ts */
"TABLE"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-flip-flop.ts */
"TFF"{GROUP}?  { TOKEN(KEYWORD); }
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
  /* generated from src/catalogue/digital-gate.ts */
"XOR"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"XOR3"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-tristate-gate.ts */
"XOR3A"{GROUP}?  { TOKEN(KEYWORD); }
  /* generated from src/catalogue/digital-gate-array.ts */
"XORA"{GROUP}?  { TOKEN(KEYWORD); }

  /* from grammar/dialects/pspice/scanner.l: comments */
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>#[^\n]*\n?                       { /* PSpice: `#` at the start of a line is a comment */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }

  /* from grammar/spice/scanner.l: continuation */
<INITIAL,MODEL>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+   { /* `+` continues the card; comment and blank lines between the pieces are allowed */ }
<LINESTART>\+                                   { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }

  /* from grammar/dialects/pspice/scanner.l: quoting */
  /* PSpice: "…" is a string (a file name with spaces, a text parameter); |…| is a text expression. */
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
<INITIAL,MODEL>\|[^|\n]*\|                  { TOKEN(GROUP); }

  /* from grammar/dialects/pspice/scanner.l: opaque */
  /* `.ALIASES` … `.ENDALIASES` names pins and nets for Probe; its lines are not elements. Only the two directive cards come back. */
<LINESTART>".aliases"                       { yyextra->opaque = 1; HEAD(DIRECTIVE_HEAD); }
<OPAQUE>{WS}+                               { }
<OPAQUE>\n                                  { }
<OPAQUE>".endaliases"[^\n]*                 {
                                              /* `.endaliases` as a whole word closes the region */
                                              if (yyleng == 11 || strchr(" \t\r;", yytext[11])) { KEEP(11); yyextra->opaque = 0; HEAD(DIRECTIVE_HEAD); }
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
  /* A `(…)` or `{…}` group is one token, nested brackets and all, and must close on its line. */
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
