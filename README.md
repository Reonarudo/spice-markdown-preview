# SPICE Schematic Preview

Draws SPICE netlists as circuit schematics in VS Code's built-in Markdown preview.
It draws; it never simulates.

Write a netlist in a fence tagged `spice`:

````markdown
```spice
* RC low-pass driving an emitter follower
V1 in 0 AC 1
R1 in mid 10k
C1 mid 0 100n
Q1 vcc mid out 2N3904
R2 out 0 1k
VCC vcc 0 5
.model 2N3904 NPN
```
````

![Two SPICE netlists drawn as schematics in VS Code's built-in Markdown preview](media/screenshots/schematics.jpg)

Only `spice` fences are claimed — `cir`, `ngspice` and other fences are left to
other renderers. Placement and wiring are automatic; the netlist says what is
connected, not where it goes.

## What is drawn

| Element | Drawn as |
| --- | --- |
| `R`, `C`, `L` | Resistor, capacitor, inductor, with the value |
| `D` | Diode, with its model |
| `V`, `I` | Source: + and − marks, or an arrow from n+ to n− |
| `Q` | NPN or PNP by its `.model`, with the model name |
| `M` | NMOS or PMOS by its `.model`; body drawn if not the source |
| `M` with a `VDMOS` model | Three-pin NMOS or PMOS (`pchan`, `VDMOSP`) |
| `X` | A box titled with the subcircuit, pins named from its `.subckt` |
| `A`, `N` | A box titled with the code model's or Verilog-A model's type, pins numbered |
| `B` `E` `F` `G` `H` `J` `O` `P` `S` `T` `U` `W` `Y` `Z` | A box titled with what it is |

Every element letter ngspice knows is read with the terminals ngspice gives it:
`E`/`G` in their linear, `POLY(n)`, `vol=`/`cur=`/`value=` and `TABLE` forms,
`Q` with substrate and thermal nodes, `M` with three to seven nodes by its
model, `D` with a thermal node, and `X1 (a b) sub` with its nodes in
parentheses.

Every connection to ground (`0` or `gnd`) gets its own ground symbol. Node names
are case-insensitive, as in SPICE. `+` and `\\` continuation lines, `*`, `#`,
`;`, `$` and `//` comments, and `'…'` and `{…}` expressions work as in ngspice.
Analysis directives such as `.tran` are skipped, as are `.subckt` bodies (which
may nest) and `.control` blocks. The first `.end` ends the netlist; `.if` is not
evaluated, so its first branch is drawn.

The first line of a SPICE file is its title; a fence has none, so start a title
with `*` to make it a comment.

A few things are noted in the *SPICE Schematic Preview* output channel rather
than shown: a transistor whose model is not defined (drawn as NPN or NMOS), a
subcircuit that is not defined (pins numbered), substrate and thermal nodes,
`K` coupling, lines after `.end`, and the `.elseif`/`.else` branches of an `.if`.

## Examples

Each of these is a complete fence; paste one into a Markdown file and open the
preview. Values, models and analysis lines are written as for ngspice.

An LED with its series resistor — the smallest useful netlist:

````markdown
```spice
V1 in 0 5
R1 in led 330
D1 led 0 RED
.model RED D
```
````

A second-order RLC low-pass; `.ac` is skipped, only the parts are drawn:

````markdown
```spice
* RLC low-pass, f0 ≈ 16 kHz
V1 in 0 AC 1
L1 in out 1m
C1 out 0 100n
R1 out 0 1k
.ac dec 20 100 1meg
```
````

A common-emitter amplifier with its bias network, coupling and bypass
capacitors:

````markdown
```spice
VCC vcc 0 12
VIN in 0 SIN(0 10m 1k)
C1 in b 10u
R1 vcc b 47k
R2 b 0 10k
Q1 c b e BC547
RC vcc c 4.7k
RE e 0 1k
CE e 0 100u
C2 c out 10u
RL out 0 100k
.model BC547 NPN
```
````

A full-wave bridge rectifier with a smoothing capacitor; the AC source floats,
so no ground symbol is attached to it:

````markdown
```spice
VAC ac1 ac2 SIN(0 12 50)
D1 ac1 plus 1N4007
D2 ac2 plus 1N4007
D3 0 ac1 1N4007
D4 0 ac2 1N4007
C1 plus 0 1000u
RL plus 0 1k
.model 1N4007 D
```
````

A CMOS NAND gate: the `.model` lines decide which transistors are PMOS, and the
fourth node of each MOSFET is drawn as a body pin only when it differs from the
source:

````markdown
```spice {caption="NAND2 in a 180 nm process" align="center"}
VDD vdd 0 1.8
VA a 0 PULSE(0 1.8 0 10p 10p 1n 2n)
VB b 0 PULSE(0 1.8 0 10p 10p 2n 4n)
M1 out a vdd vdd pch W=2u L=180n
M2 out b vdd vdd pch W=2u L=180n
M3 out a n1 0 nch W=1u L=180n
M4 n1 b 0 0 nch W=1u L=180n
CL out 0 5f
.model nch NMOS
.model pch PMOS
```
````

A subcircuit used twice — a buffer feeding a non-inverting stage. The `.subckt`
line names the pins of both boxes; what is inside the subcircuit is not drawn:

````markdown
```spice
V1 in 0 SIN(0 1 1k)
X1 in mid vcc vee mid opamp
R1 mid inv 10k
R2 inv out 47k
X2 mid inv vcc vee out opamp
RL out 0 10k
VCC vcc 0 15
VEE 0 vee 15
.subckt opamp inp inn vp vn out
E1 out 0 inp inn 100k
.ends
```
````

Continuation lines and every comment style ngspice accepts:

````markdown
```spice
* Voltage divider with a long source line
V1 in 0 PULSE(0 5
+ 0 1n 1n
+ 1u 2u)          ; the pulse spans three lines
R1 in out 10k     $ upper leg
R2 out 0 10k      // lower leg
```
````

## Included files

`.include`, `.inc` and `.lib` read files, as SPICE does, so a model library can
decide which transistors are PNP and name a subcircuit's pins, and a fence can
draw a circuit kept in its own file:

````markdown
```spice
.include "models/opamps.lib"
.lib corners.lib tt
X1 inp inn vcc vee out LM358
```
````

`.lib file section` reads one section; `.lib file` alone is an error, as in
ngspice. `.inc` and `.incl` are `.include`. Includes may nest. Elements in included files are drawn; an error
inside one is shown at the fence's include, naming the file and line.

Files are read only when all of these hold; otherwise the schematic draws
without them and the output channel says why:

- the workspace is trusted;
- the Markdown document is saved inside a local workspace folder;
- the path is relative to the Markdown document and stays inside that folder,
  through no symlink.

A file may be 8 MB; a fence may include 32 files and 16 MB in all. Saved
changes to an included file redraw the schematics that use it, and **SPICE:
Refresh Included Files** rereads everything. Only text is read, and only names
and elements are taken from it; nothing is run.

## Fence attributes

An optional attribute block after the tag adjusts how one schematic is presented:

````markdown
```spice {alt="A CMOS inverter" caption="Figure 1: CMOS inverter" align="center"}
M1 out in vdd vdd pch
M2 out in 0 0 nch
.model nch NMOS
.model pch PMOS
```
````

| Attribute | Effect |
| --- | --- |
| `alt` | Description for readers who cannot see the schematic |
| `caption` | Text shown beneath the schematic |
| `align` | `left`, `center` or `right` |
| `class` | Extra CSS class on the schematic's `<svg>` |
| `dialect` | The SPICE dialect this fence is written in (see below) |

Values are quoted. A mistyped or malformed attribute never costs you the
schematic: it is ignored, and a note is written to the output channel.

## Dialects

Netlists differ between simulators in what is a comment, which letters name
which devices and how many nodes they take. A fence is read in the dialect its
`dialect` attribute names — `ngspice`, `ltspice`, `pspice`, `hspice`, `xyce` or
`spectre`, in any case — else in the `spice.dialect` setting's (per workspace
folder; default `ngspice`). Files a fence includes are read in the fence's
dialect. An unknown attribute value is dropped, with a note in the output
channel, and the setting applies; an unknown setting value reads as ngspice.
The fence is always ` ```spice `: the dialect is never guessed from its content,
and ` ```ltspice ` is not claimed.

In `ltspice`, netlists are read as LTspice 26 reads them: only `*` and `;`
comment (`$G_VDD` is a node, `//` is text), `@` and `&` are the FRA elements,
`A` functions have eight pins, `U` is an RC line, a VDMOS `M` has three pins and
is P-channel by `pchan`, `Z` is an IGBT with an `NIGBT`/`PIGBT` model, `I`/`B`
with `R=` are resistors, `value=` sources have two pins and `Laplace=`/`tbl=`
sources four. `.lib file` reads the whole file for its models and subcircuits
but not its top-level elements; a `.lib` whose file is not next to the document
(`standard.dio`, `UniversalOpAmps2.sub`) is noted and skipped, since LTspice
reads it from its own library folder. Expressions as node names (`{n}`) are
not read.

![An op-amp drawn as a labelled block in an inverting amplifier, and a netlist error pointing at its column](media/screenshots/caption-and-error.jpg)

## Errors and limits

A netlist error is shown in place of the schematic, quoting the line with a caret
under the column. A netlist may have up to 400 elements and 64 KB. Layout is
limited by the `spice.layoutTimeout` setting (seconds, 0.5 to 60, default 3); a
circuit that takes longer shows a timeout message until it changes, and a change
to the setting retries it. Densely connected circuits of a few hundred parts can
need more than the default.

Schematics are drawn on a white card in every theme. In Restricted Mode and
virtual workspaces everything works except reading included files.

## Development

Requires Node 22 or newer (see `.nvmrc`).

```sh
npm ci
npm run lint            # tsc --noEmit
npm test                # node --test, after building
npm run package         # vsce package
npm run test:package    # the VSIX inside a real VS Code
npm run screenshots     # regenerate media/screenshots from examples/demo.md
```

Symbols live in `src/skin/symbols.svg`; `test/schematic.test.ts` traces every
wire of a set of reference circuits and fails if a drawing connects the wrong
pins.

The netlist parsers in `vendor/parsers/` are generated and committed; rebuilding
them needs flex, Bison and Emscripten and is described in `dev.md`.

## License

MIT for this extension. Bundled elkjs is EPL-2.0; symbols and layout code are
adapted from netlistsvg (MIT) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
