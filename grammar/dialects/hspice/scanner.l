/*
 * HSPICE overlay on the SPICE base (ADR 0009): what HSPICE B-2008.09 accepts, per the HSPICE
 * research (#1187). Only the sections named here differ from grammar/spice/scanner.l.
 *
 * Words: `;` is a name character (UG p.45), not a comment, so the base's word definitions are
 * widened — and `$` is a name character only inside a name that does not start with a digit: `$`
 * after a blank, a comma or a number starts a comment (UG p.55–56, 60), so `1k$comment` is `1k`
 * and `R1 1$ 2 1k` loses a node, as the manual warns. A name therefore never starts with `$`, nor
 * with a quote, so that `'file';` is the quoted name and then `;`.
 * Comments: `*` at the start of a line; `$` as the first non-blank character; `$` after a blank,
 * a comma or a number. `//` is not documented and stays text.
 * Continuation: a line-initial `+` (the base), and a blank then `\` or `\\` at the end of a line
 * (UG p.40, 44).
 * Quoting: `'…'` and `"…"` are expressions that may hold spaces (CR p.208, 265; UG p.46, 50).
 * Opaque regions: `.DATA` … `.ENDDATA`, whose rows need no `+` and look like elements (CR p.57);
 * `.PROTECT`/`.PROT` … `.UNPROTECT`/`.UNPROT`, encrypted text (CR p.227); and everything from the
 * first `.ALTER` to the `.END` that ends the read, a re-run that redefines elements (CR p.28).
 * The opener's kind is kept in `opaque` so that only its own closer ends the region.
 */

//@ section definitions
WS        [ \t\r]
SEP       [ \t\r,]
WORDCHAR  [^ \t\r\n,=(){}]
NAMECHAR  [^ \t\r\n,=(){}$]
NUMWORD   [+-]?[0-9.]{NAMECHAR}*
NAMEWORD  [^ \t\r\n,=(){}$0-9.+'"-]{WORDCHAR}*|[+-]([^ \t\r\n,=(){}$0-9.'"]{WORDCHAR}*)?
WORD      ({NUMWORD}|{NAMEWORD})
WORDTAIL  {NAMECHAR}*
GROUP     \([^()\n]*\)|\{[^{}\n]*\}
BRACES    \{[^{}\n]*\}
//@ end

//@ section comments
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>\$[^\n]*\n?                      { /* HSPICE: `$` as the first non-blank character is a whole-line comment */ }
<INITIAL,MODEL>\$[^\n]*                     { /* HSPICE: `$` after a blank, a comma or a number starts a comment; a name never starts with `$` */ }
//@ end

//@ section continuation
<INITIAL,MODEL>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+   { /* `+` continues the card; comment and blank lines between the pieces are allowed */ }
<NODES,GROUPSCAN>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+{WS}* { CONTINUED(); /* the same `+` inside a node list or a group */ }
<INITIAL,MODEL>{WS}+\\\\?{WS}*\n                { /* HSPICE: a blank then `\` or `\\` at the end of a line continues it */ }
<LINESTART>\+                                   { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }
//@ end

//@ section quoting
  /* HSPICE: '…' and "…" are expressions (and file names); both may hold spaces and comment characters. */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
//@ end

//@ section opaque
  /* `.data` … `.enddata`, `.protect` … `.unprotect` and `.alter` … `.end`: only the directive cards come back. */
<LINESTART>".data"                          { yyextra->opaque = 1; HEAD(DIRECTIVE_HEAD); }
<LINESTART>".protect"                       |
<LINESTART>".prot"                          { yyextra->opaque = 2; HEAD(DIRECTIVE_HEAD); }
<LINESTART>".alter"                         { yyextra->opaque = 3; HEAD(DIRECTIVE_HEAD); }
<OPAQUE>{WS}+                               { }
<OPAQUE>\n                                  { }
<OPAQUE>".enddata"[^\n]*                    {
                                              /* `.enddata` as a whole word closes a `.data` region */
                                              if (yyextra->opaque == 1 && (yyleng == 8 || strchr(" \t\r$", yytext[8]))) { KEEP(8); yyextra->opaque = 0; HEAD(DIRECTIVE_HEAD); }
                                            }
<OPAQUE>".unprotect"[^\n]*                  {
                                              if (yyextra->opaque == 2 && (yyleng == 10 || strchr(" \t\r$", yytext[10]))) { KEEP(10); yyextra->opaque = 0; HEAD(DIRECTIVE_HEAD); }
                                            }
<OPAQUE>".unprot"[^\n]*                     {
                                              if (yyextra->opaque == 2 && (yyleng == 7 || strchr(" \t\r$", yytext[7]))) { KEEP(7); yyextra->opaque = 0; HEAD(DIRECTIVE_HEAD); }
                                            }
<OPAQUE>".end"[^\n]*                        {
                                              /* `.end` as a whole word closes an `.alter` region and ends the read */
                                              if (yyextra->opaque == 3 && (yyleng == 4 || strchr(" \t\r$", yytext[4]))) { KEEP(4); yyextra->opaque = 0; yyextra->ending = 1; HEAD(DIRECTIVE_HEAD); }
                                            }
<OPAQUE>[^ \t\r\n][^\n]*                    { }
<OPAQUE><<EOF>>                             { return YYEOF; }
//@ end
