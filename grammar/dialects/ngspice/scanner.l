/*
 * ngspice overlay on the SPICE base (ADR 0009): what ngspice-47 accepts with no compatibility
 * mode, per the ngspice research (#1184). Only the sections named here differ from
 * grammar/spice/scanner.l.
 *
 * Words: `//` starts a comment anywhere, even glued to a word (`3k//x`), so a word may contain a
 * single `/` (`a/b`, KiCad's `/in`) but never two in a row.
 */

//@ section definitions
WS        [ \t\r]
SEP       [ \t\r,]
WORDCHAR  [^ \t\r\n,;=(){}/]
WORD      ({WORDCHAR}|\/{WORDCHAR})+
WORDTAIL  ({WORDCHAR}|\/{WORDCHAR})*
GROUP     \([^()\n]*\)|\{[^{}\n]*\}
BRACES    \{[^{}\n]*\}
//@ end

//@ section comments
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>#[^\n]*\n?                       { /* ngspice: `#` at the start of a line is a comment */ }
<LINESTART>[=\[\]?()&%$\"!:,][^\n]*\n?      { /* ngspice: a line starting with one of these is a comment (with a warning) */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
<INITIAL,MODEL>{SEP}+\$[^\n]*               { /* ngspice: `$` after a blank, tab or comma starts a comment */ }
<LINESTART,INITIAL,MODEL>"//"[^\n]*         { /* ngspice: `//` starts a comment anywhere */ }
//@ end

//@ section continuation
<INITIAL,MODEL>\n(\*[^\n]*\n|{WS}*\n)*{WS}*\+   { /* `+` continues the card; comment and blank lines between the pieces are allowed */ }
<INITIAL,MODEL>\\\\{WS}*\n                      { /* ngspice: a line ending in `\\` continues on the next */ }
<LINESTART>\+                                   { BEGIN(INITIAL); yyextra->at_card_start = 0; scan_remember(yyextra, yytext, yyleng); return BAD_CONTINUATION; }
//@ end

//@ section quoting
  /* ngspice: '…' is an expression like {…}; "…" is a string. Both may hold spaces and comment characters. */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
//@ end

//@ section opaque
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
//@ end
