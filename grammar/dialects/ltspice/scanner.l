/*
 * LTspice overlay on the SPICE base (ADR 0009): what LTspice 26.1 accepts, per the LTspice
 * research (#1185). Only the sections named here differ from grammar/spice/scanner.l.
 *
 * Comments: only `*` at the start of a line and `;` anywhere. `$` is an ordinary character —
 * `$G_VDD` is a global node — and `//` is not a comment, so the base's word definitions stand.
 * Continuation: only a line-initial `+` (the base); LTspice has no trailing `\\`.
 * Element heads: the dialect table adds `@` (FRA) and `&` (FRA probe) to the letters.
 * No opaque regions: LTspice has no `.control`.
 */

//@ section comments
<LINESTART>\*[^\n]*\n?                      { /* a whole-line comment */ }
<LINESTART,INITIAL,MODEL>;[^\n]*            { /* an inline comment runs to the end of the line */ }
//@ end

//@ section quoting
  /* LTspice: "…" is a string — a file name with spaces, a string parameter; '…' is an expression (accepted historically, like {…}). */
<INITIAL,MODEL>'[^'\n]*'                    { TOKEN(GROUP); }
<INITIAL,MODEL>\"[^\"\n]*\"                 { TOKEN(GROUP); }
//@ end
