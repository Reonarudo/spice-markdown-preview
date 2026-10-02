/*
 * Overlay for Spectre's SPICE mode on the SPICE base (ADR 0009): what Spectre reads between
 * `simulator lang=spice` and the next `simulator lang=spectre`, and in every included file that
 * does not end in `.scs` (Spectre User Guide 5.1 p.49–55; Spectre research, #1189). Internal: no
 * fence names it; `src/parser/regions.ts` hands it the SPICE-mode regions of a Spectre netlist.
 *
 * SPICE mode is SPICE2G6/3e syntax with case folded (the generated options), `+` continuation and
 * `*` comments (the base), Spectre's `name=value` parameters appended to element lines (pairs,
 * which the base reads anywhere), and two things of its own: a line starting `*spectre:` is not a
 * comment but a statement hidden from other simulators (UG p.55) — the prefix is dropped and the
 * rest of the line read as the card it is — and `//` comments, at the start of a line or after a
 * blank, which Virtuoso writes above the `simulator lang=spectre` line of every netlist it exports
 * (so they are read in SPICE mode; inferred from Xyce_Regression's XDM Spectre decks, not from the
 * manual). `.end` stops the read, as in the base.
 */

//@ section comments
<LINESTART>\*[^\n]*\n?                      {
                                              /* `*spectre:` (any case) hides a SPICE-mode statement from other simulators: read what follows it */
                                              int i = 0;
                                              while (i < 8 && i + 1 < (int)yyleng && (yytext[i + 1] | 0x20) == "spectre:"[i]) i++;
                                              if (i == 8) KEEP(9);
                                            }
<LINESTART>"//"[^\n]*\n?                    { /* a `//` comment line, as Virtuoso writes before the language switch */ }
<INITIAL,MODEL>{WS}+"//"[^\n]*              { /* a blank then `//` starts a comment, as in Spectre mode */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
//@ end

//@ section quoting
  /* "…" is a string — a file name with blanks — and '…' an expression; both are groups, as in the other SPICE dialects. */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
//@ end
