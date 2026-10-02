/* spectre: composed by scripts/grammars/compose.ts from grammar/spectre; do not edit. */
/*
 * Spectre base scanner (ADR 0009): the second base grammar, for Cadence Spectre's native netlist
 * language, per the Spectre research (#1189). It shares nothing with grammar/spice/scanner.l but
 * the driver, the JSON callbacks (ADR 0008) and the section markers; no dialect overlays it.
 *
 * What it reads (Spectre User Guide 5.1 p.29–31, 59–63; Reference 19.1):
 *   - an instance is `name [(nodes)] master [param=value …]` — the parentheses are optional, a
 *     controlled source may write two groups `(1 2)(3 4)`, and the master is what names the type,
 *     so the parser buffers the positional words until it knows which one is the master;
 *   - keyword-led statements (`model`, `subckt`, `inline subckt`, `ends`, `parameters`, `include`,
 *     `#include`, `ahdl_include`, `library`, `section`, `endsection`, `endlibrary`, `simulator`,
 *     `global`, `ic`, `nodeset`, `save`, `sens`, `real`, `export`, `protect`, `unprotect`, `if`,
 *     `else`, `statistics`) are directive cards; analyses and control statements are shaped like
 *     instances and told apart by their master in TypeScript (dialects.ts `skipMasters`);
 *   - `//` or `*` at the start of a line and a blank then `//` anywhere are comments;
 *   - a line ending in `\` or followed by a `+` line continues, inside a node list or a group too;
 *   - names are case-sensitive; `\` escapes any character into a name (`\2N2222`, `a\-b`);
 *   - `(…)`, `[…]` and `{…}` closed on their line are groups, nested brackets counted; `"…"` is a
 *     group; a `{` that ends a line opens a block and a `}` that starts one closes it — both come
 *     back as directive cards named `{` and `}`, so TypeScript sees `if`/`else`, `sweep` and
 *     `montecarlo` structure and the instances inside them — except after `statistics`, `paramset`
 *     and on a `model` line, whose blocks hold tables and distributions that are no statements:
 *     those are swallowed to their balanced `}`.
 *
 * Start conditions, all exclusive:
 *   LINESTART  at the start of a card, until its head token is read;
 *   INITIAL    the rest of an instance or directive card;
 *   NODES      inside a parenthesised node list after an instance's name (or a second one);
 *   GROUPSCAN  inside a `(…)`, `[…]` or `{…}` group until it closes, on its line or a continued one;
 *   MODEL      the rest of a `model` card, where `(` and `)` are only separators;
 *   BRACES     a swallowed brace block, to its balanced `}`.
 */
  /* from grammar/spectre/scanner.l: options */
%option reentrant bison-bridge bison-locations
%option noyywrap nounistd never-interactive noinput nounput nodefault
%option extra-type="struct scan_state *"
  /* generated from src/catalogue/dialects.ts: spectre is case-sensitive */

%{
#include <string.h>
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

/* `name =` was matched with its blanks and `=`: keep the name alone as the pair's key; `=` is scanned next. */
#define KEY() do {                                          \
    int n = (int)yyleng - 1;                                \
    while (n > 0 && strchr(" \t\r", yytext[n - 1])) n--;    \
    KEEP(n);                                                \
    TOKEN(KEY);                                             \
  } while (0)

/*
 * A head token opens a card; the rest of the line is read in `state`. `swallow` says whether a
 * `{` ending this card's line (or starting the next) opens a block nothing should read.
 */
#define HEAD_FULL(kind, state, swallow) do {                \
    BEGIN(state);                                           \
    yyextra->at_card_start = 0;                             \
    yyextra->opaque = (swallow);                            \
    yylval->text = json_strndup(yytext, yyleng);            \
    scan_remember(yyextra, yytext, yyleng);                 \
    yyextra->after_head = (kind) == INSTANCE_HEAD;          \
    return kind;                                            \
  } while (0)
#define HEAD_IN(kind, state) HEAD_FULL(kind, state, 0)
#define HEAD(kind) HEAD_IN(kind, INITIAL)

/* Start gathering a bracketed group at this match; `kind` is the token it becomes when it closes. */
#define GROUP_BEGIN(open, close, kind) do {                 \
    yyextra->open_line = yylloc->first_line;                \
    yyextra->open_column = yylloc->last_column - 1;         \
    yyextra->group.column = yylloc->first_column;           \
    scan_group_begin(yyextra, yytext, yyleng, open, close, kind); \
    BEGIN(GROUPSCAN);                                       \
  } while (0)

/* The card continues on the next line inside a node list or a group: the pieces of a group are joined by one blank. */
#define CONTINUED() do { if (YY_START == GROUPSCAN) scan_group_continue(yyextra); } while (0)

/* The line ended inside a node list or group with nothing continuing it: the error points at the bracket that opened it. */
#define UNTERMINATED_AT_OPEN(bracket) do {                  \
    yylloc->first_line = yylloc->last_line = yyextra->open_line; \
    yylloc->first_column = yyextra->open_column;            \
    yylloc->last_column = yyextra->open_column + 1;         \
    scan_remember(yyextra, bracket, 1);                     \
    return UNTERMINATED;                                    \
  } while (0)

/* A brace block nothing should read: swallow it to its balanced `}`, remembering whether a card is open around it. */
#define SWALLOW_BLOCK() do {                                \
    yyextra->opaque = 0;                                    \
    yyextra->block_depth = 1;                               \
    yyextra->block_card_open = !yyextra->at_card_start;     \
    BEGIN(BRACES);                                          \
  } while (0)

/* The card's line ends: the next token is a head. */
#define END_OF_CARD() do { yyextra->at_card_start = 1; yyextra->after_head = 0; return NEWLINE; } while (0)
%}

  /* from grammar/spectre/scanner.l: definitions */
WS        [ \t\r]
SEP       [ \t\r,]
ESCAPE    \\[^\n]
WORDCHAR  [^ \t\r\n,=(){}\[\]\\]
WORD      ({WORDCHAR}|{ESCAPE})+
NAME      ([A-Za-z_]|{ESCAPE})({WORDCHAR}|{ESCAPE})*
COMMENT   {WS}*("//"|\*)[^\n]*\n

%x LINESTART NODES GROUPSCAN MODEL BRACES

%%
%{
  if (yyextra->at_card_start && YY_START != BRACES) BEGIN(LINESTART);
%}

  /* generated from src/catalogue/bjt.ts */
"bjt"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim1"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim2"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim3"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim3v3"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim4"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsim6"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"bsimcmg"  { TOKEN(MASTER); }
  /* generated from src/catalogue/soi-mosfet.ts */
"bsimsoi"  { TOKEN(MASTER); }
  /* generated from src/catalogue/capacitor.ts */
"capacitor"  { TOKEN(MASTER); }
  /* generated from src/catalogue/cccs.ts */
"cccs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/ccvs.ts */
"ccvs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/diode.ts */
"diode"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"ekv"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mesfet.ts */
"gaas"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"hisim"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"hisim2"  { TOKEN(MASTER); }
  /* generated from src/catalogue/inductor.ts */
"inductor"  { TOKEN(MASTER); }
  /* generated from src/catalogue/ammeter.ts */
"iprobe"  { TOKEN(MASTER); }
  /* generated from src/catalogue/isource.ts */
"isource"  { TOKEN(MASTER); }
  /* generated from src/catalogue/jfet.ts */
"jfet"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"mos1"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"mos2"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"mos3"  { TOKEN(MASTER); }
  /* generated from src/catalogue/multiconductor-line.ts */
"mtline"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mutual-inductance.ts */
"mutual_inductor"  { TOKEN(MASTER); }
  /* generated from src/catalogue/nport.ts */
"nport"  { TOKEN(MASTER); }
  /* generated from src/catalogue/cccs.ts */
"pcccs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/ccvs.ts */
"pccvs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/port.ts */
"port"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"psp102"  { TOKEN(MASTER); }
  /* generated from src/catalogue/mosfet.ts */
"psp103"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vccs.ts */
"pvccs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vcvs.ts */
"pvcvs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vswitch.ts */
"relay"  { TOKEN(MASTER); }
  /* generated from src/catalogue/resistor.ts */
"resistor"  { TOKEN(MASTER); }
  /* generated from src/catalogue/multiposition-switch.ts */
"switch"  { TOKEN(MASTER); }
  /* generated from src/catalogue/lossless-line.ts */
"tline"  { TOKEN(MASTER); }
  /* generated from src/catalogue/transformer.ts */
"transformer"  { TOKEN(MASTER); }
  /* generated from src/catalogue/bjt.ts */
"vbic"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vccs.ts */
"vccs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vcvs.ts */
"vcvs"  { TOKEN(MASTER); }
  /* generated from src/catalogue/vsource.ts */
"vsource"  { TOKEN(MASTER); }

  /* from grammar/spectre/scanner.l: comments */
<LINESTART>{WS}*("//"|\*)[^\n]*\n?        { /* a whole-line comment, `//` or `*` first on the line */ }
<INITIAL,MODEL>{WS}+"//"[^\n]*            { /* a blank then `//` starts a comment anywhere (UG p.59) */ }

  /* from grammar/spectre/scanner.l: continuation */
<INITIAL,MODEL>\\{WS}*\n                                  { /* a line ending in `\` continues on the next */ }
<INITIAL,MODEL>\n({WS}*\n|{COMMENT})*{WS}*\+              { /* `+` at the start of the next line continues too; blank and comment lines between are allowed */ }
<NODES,GROUPSCAN>\\{WS}*\n{WS}*                           { CONTINUED(); /* the same `\` inside a node list or a group: the bracket may close on the continued line */ }
<NODES,GROUPSCAN>\n({WS}*\n|{COMMENT})*{WS}*\+{WS}*       { CONTINUED(); }
<LINESTART>\+                                             { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }

  /* from grammar/spectre/scanner.l: quoting */
<INITIAL,MODEL>\"[^\"\n]*\"               { TOKEN(GROUP); }

  /* from grammar/spectre/scanner.l: opaque */
  /* A `{` that ends a line opens a block. After `statistics` or `paramset`, and on a `model` line (a bin group), the
     block is swallowed to its balanced `}`; any other block is a `{` card, its statements read as usual, and its `}` a card. */
<INITIAL>\{{WS}*("//"[^\n]*)?$            { if (yyextra->opaque) SWALLOW_BLOCK(); else { scan_remember(yyextra, "{", 1); return BLOCK_OPEN; } }
<MODEL>\{                                 { SWALLOW_BLOCK(); }
<INITIAL,MODEL>"paramset"                 { yyextra->opaque = 1; TOKEN(WORD); }
<BRACES>[^{}\n]+                          { }
<BRACES>\n                                { }
<BRACES>\{                                { yyextra->block_depth++; }
<BRACES>\}                                {
                                            if (--yyextra->block_depth == 0) {
                                              /* Back to the card the block belongs to, or to the next head when the `{` stood on a line of its own. */
                                              if (yyextra->block_card_open) BEGIN(INITIAL);
                                              else { yyextra->at_card_start = 1; BEGIN(LINESTART); }
                                            }
                                          }
<BRACES><<EOF>>                           { if (yyextra->block_card_open) { yyextra->block_card_open = 0; END_OF_CARD(); } return YYEOF; }

  /* from grammar/spectre/scanner.l: heads */
<LINESTART>{WS}+                          { /* indentation before a head */ }
<LINESTART>\n                             { /* a blank line */ }
<LINESTART>\}                             { HEAD(BLOCK_CLOSE); }
<LINESTART>\{                             { if (yyextra->opaque) SWALLOW_BLOCK(); else { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, "{", 1); return BLOCK_OPEN; } }
<LINESTART>"model"                        { HEAD_IN(DIRECTIVE_HEAD, MODEL); }
<LINESTART>"inline"{WS}+"subckt"          { HEAD(DIRECTIVE_HEAD); }
<LINESTART>"statistics"                   { HEAD_FULL(DIRECTIVE_HEAD, INITIAL, 1); }
<LINESTART>"subckt"|"ends"|"parameters"|"include"|"#include"|"ahdl_include"|"library"|"section"|"endsection"|"endlibrary"|"simulator"|"global"|"ic"|"nodeset"|"save"|"sens"|"real"|"export"|"protect"|"unprotect"|"if"|"else"  { HEAD(DIRECTIVE_HEAD); }
<LINESTART>{NAME}                         { HEAD(INSTANCE_HEAD); }
<LINESTART>{WORD}                         { HEAD(WORD); }
<LINESTART>.                              { HEAD(WORD); }
<LINESTART><<EOF>>                        { return YYEOF; }

  /* from grammar/spectre/scanner.l: nodes */
  /* `r1 (in out) resistor`: a `(` right after an instance's name — or right after its first node list — opens its node list, unwrapped into words. */
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
<NODES>\)                                 { BEGIN(INITIAL); yyextra->after_head = 1; scan_remember(yyextra, yytext, yyleng); return CLOSE_NODES; }
<NODES>{WORD}                             { TOKEN(WORD); }
<NODES>\n                                 |
<NODES><<EOF>>                            { UNTERMINATED_AT_OPEN("("); }
<NODES>.                                  { TOKEN(WORD); }

  /* from grammar/spectre/scanner.l: groups */
  /* A `(…)`, `[…]` or `{…}` group is one token, nested brackets and all; it must close on its line or on a continued line. */
<INITIAL>{WORD}?\[                        { GROUP_BEGIN('[', ']', yyleng == 1 ? GROUP : WORD); }
<INITIAL>\{                               { GROUP_BEGIN('{', '}', GROUP); }
<GROUPSCAN>[^()\[\]{}\\\n]+               { scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>{ESCAPE}                       { scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>\\                             { scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>[(\[{]                         { if (yytext[0] == yyextra->group.open) yyextra->group.depth++; scan_group_append(yyextra, yytext, yyleng); }
<GROUPSCAN>[)\]}]                         {
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

  /* from grammar/spectre/scanner.l: model */
  /* `model name master param=value …`: parentheses are separators; the writer keeps the bare words and the `type` pair. */
<MODEL>{SEP}+                             { }
<MODEL>[()]                               { }
<MODEL>{WORD}{WS}*"="                     { KEY(); }
<MODEL>"="                                { yyextra->after_head = 0; scan_remember(yyextra, yytext, yyleng); return EQUALS; }
<MODEL>{WORD}                             { TOKEN(WORD); }
<MODEL>.                                  { TOKEN(WORD); }

  /* from grammar/spectre/scanner.l: tail */
<INITIAL,MODEL>\n                         { END_OF_CARD(); }
<INITIAL>{SEP}+                           { }
<INITIAL>{WORD}{WS}*"="                   { KEY(); }
<INITIAL>"="                              { yyextra->after_head = 0; scan_remember(yyextra, yytext, yyleng); return EQUALS; }
<INITIAL>{WORD}                           { TOKEN(WORD); }
<INITIAL>.                                { TOKEN(WORD); }
<INITIAL,MODEL><<EOF>>                    { if (!yyextra->at_card_start) END_OF_CARD(); return YYEOF; }
%%
