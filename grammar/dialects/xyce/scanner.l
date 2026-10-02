/*
 * Xyce overlay on the SPICE base (ADR 0009): what Xyce 7.10 accepts, per the Xyce research
 * (#1188). Only the sections named here differ from grammar/spice/scanner.l.
 *
 * Comments: `*` at the start of a line and `;` anywhere (RG §2.1.39.1–2), and — Xyce alone — any
 * line that starts with a blank or a tab, unless its first non-blank character is `+` (RG
 * §2.1.39.1: "Whitespace at the beginning of a line is also interpreted as a comment unless it is
 * followed by a + symbol"; SSFT L828). `$` is an ordinary character — `$GVDD` is a global node
 * (RG §2.3.1.1) — and `//` is not a comment in the tokenizer, so the base's word definitions
 * stand.
 * Continuation: a line-initial `+` (the base); comment lines may sit between a card and its
 * continuation — `*` lines, `;` lines and indented lines, since all three are comments in Xyce
 * (Xyce_Regression's BUG_250 deck continues a card past a `;` line).
 * Quoting: `'…'` is an expression (Xyce rewrites it as `{…}`) and `"…"` is one token (RG §2.2;
 * SSFT L168–219); both are groups.
 * Heads: `Y<type> <name> nodes…` names a device by its type, the instance name being the second
 * token (RG Table 2-35; DB L1153–1195). The catalogue's `generated:keywords` section turns the
 * types it knows (`YMEMRISTOR`, `YPDE`, …) into suffixed heads; the rule added to `heads` below
 * does the same for every other `Y<type>`, so an undocumented type is still a device drawn as a
 * block titled by its type, never an element named `YACC` with its name as a node. The generated
 * rules come first in the file and win an equal-length match; the generic rule wins a longer one.
 * No opaque regions: Xyce has no `.control`, `.DATA` or `.ALTER`; the base's `opaque` section
 * stands.
 */

//@ section comments
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>{WS}+[^+ \t\r\n][^\n]*\n?       { /* Xyce: a line starting with a blank is a comment unless its first non-blank character is `+` */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
//@ end

//@ section continuation
<INITIAL,MODEL>\n([*;][^\n]*\n|{WS}+[^+ \t\r\n][^\n]*\n|{WS}*\n)*{WS}*\+   { /* `+` continues the card; comment lines — `*`, `;` or indented — and blank lines between the pieces are allowed */ }
<NODES,GROUPSCAN>\n([*;][^\n]*\n|{WS}+[^+ \t\r\n][^\n]*\n|{WS}*\n)*{WS}*\+{WS}* { CONTINUED(); /* the same `+` inside a node list or a group */ }
<LINESTART>\+                                   { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }
//@ end

//@ section quoting
  /* Xyce: '…' is an expression, read as {…}; "…" is a string — a file name, a text parameter. Both may hold spaces. */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
//@ end

//@ section heads
<LINESTART>{WS}+                          { /* indentation before a `+` (any other indented line is a comment, above) */ }
<LINESTART>\n                             { /* a blank line */ }
<LINESTART>".end"                         { yyextra->ending = 1; HEAD(DIRECTIVE_HEAD); }
<LINESTART>".model"                       { HEAD_IN(DIRECTIVE_HEAD, MODEL); }
<LINESTART>\.{WORD}                       { HEAD(DIRECTIVE_HEAD); }
<LINESTART>Y{WORDCHAR}+                   { /* Xyce: `Y<type> <name> …` for a type the catalogue does not list */ HEAD_IN(SUFFIX_HEAD, INITIAL); }
<LINESTART>{ELEMENT_LETTER}{WORDTAIL}     { HEAD(ELEMENT_HEAD); }
<LINESTART>[({]                           { HEAD(GROUP); }
<LINESTART>{WORD}                         { HEAD(WORD); }
<LINESTART>.                              { HEAD(WORD); }
<LINESTART><<EOF>>                        { return YYEOF; }
//@ end
