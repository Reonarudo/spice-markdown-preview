/*
 * PSpice overlay on the SPICE base (ADR 0009): what PSpice A/D 16.6 accepts, per the PSpice
 * research (#1186). Only the sections named here differ from grammar/spice/scanner.l.
 *
 * Comments: `*` at the start of a line and `;` anywhere (RG p.125-126), plus `#` at the start of a
 * line, which PSpice reads as a comment too (Xyce_Regression, XDM/PSPICE/OTHER_PARSING). `$` is an
 * ordinary character — `$G_DPWR` is a global node, `DATA=B$ 01 $` is program data — and `//` is
 * not a comment, so the base's word definitions stand.
 * Continuation: only a line-initial `+` (the base); comment lines may sit between the pieces.
 * Keywords: a digital primitive's parameters may follow its type after blanks — `PINDLY (5,0,10)`,
 * `STIM( 1, 1 )` (RG p.350, 374, 401) — so GROUP, which the generated keyword rules glue to a
 * keyword, allows leading blanks and is parentheses only: `TABLE {…}` stays a keyword and a group.
 * Quoting: `"…"` strings and `|…|` text expressions (RG p.13, 110-111) are groups; `'…'` is not
 * documented as a delimiter and stays ordinary text.
 * Opaque region: `.ALIASES` … `.ENDALIASES` (RG p.34), whose lines look like elements and are not.
 */

//@ section definitions
WS        [ \t\r]
SEP       [ \t\r,]
WORDCHAR  [^ \t\r\n,;=(){}]
WORD      {WORDCHAR}+
WORDTAIL  {WORDCHAR}*
GROUP     {WS}*\([^()\n]*\)
BRACES    \{[^{}\n]*\}
//@ end

//@ section comments
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART>#[^\n]*\n?                       { /* PSpice: `#` at the start of a line is a comment */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
//@ end

//@ section quoting
  /* PSpice: "…" is a string (a file name with spaces, a text parameter); |…| is a text expression. */
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
<INITIAL,MODEL>\|[^|\n]*\|                  { TOKEN(GROUP); }
//@ end

//@ section opaque
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
//@ end
