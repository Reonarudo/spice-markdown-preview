/*
 * ngspice overlay on the SPICE base (ADR 0009). Only the sections named here differ from
 * grammar/spice/scanner.l; the ngspice grammar ticket fills in the rest of what ngspice-47 accepts.
 */

//@ section comments
<LINESTART>\*[^\n]*\n     { /* a whole-line comment */ }
;[^\n]*                   { /* an inline comment runs to the end of the line */ }
{WS}+\$[^\n]*             { /* ngspice: `$` after whitespace starts a comment */ }
//@ end
