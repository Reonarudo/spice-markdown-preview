# The BOM view

Every `spice` fence below carries two buttons in its top corner: the BOM button, which flips the
fence to a table of its parts, and the view toggle, which flips it to its source. This file is the
fixture for the second half of `npm run test:preview` and the document for the manual checklist
(`docs/bom-view-spec.md`, sections 11.6 and 11.7): open it in a development window and view it in
a light, a dark and a high-contrast theme, with `spice.bomStyle` set to `plain`, `compact` and
`card` in turn.

## 1. A bridge rectifier: four diodes aggregate into one row

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

## 2. Captioned, centred: C2 joins C1's row at C1's position

```spice {caption="Figure 1: a common-emitter amplifier" align="center"}
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

## 3. A buffer feeding a non-inverting stage: the title is the Value, the supplies merge

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

## 4. Includes and multiplicity: the File column, the included row first, m=2 kept apart

```spice
.include "included/stage.cir"
X1 inp inn vcc vee out LM358
R1 out fb 1k m=2
R2 fb 0 1k
```

## 5. Sixteen series resistors and a long source: wrapping cells

```spice
VIN n0 0 PWL(0 0 1m 1 2m 0.5 3m 2 4m 0 5m 1.5 6m 0.25 7m 3 8m 0 9m 1 10m 0.75 11m 2.5 12m 0 13m 1 14m 0 15m 2 16m 0)
R1 n0 n1 1k
R2 n1 n2 1k
R3 n2 n3 1k
R4 n3 n4 1k
R5 n4 n5 1k
R6 n5 n6 1k
R7 n6 n7 1k
R8 n7 n8 1k
R9 n8 n9 1k
R10 n9 n10 1k
R11 n10 n11 1k
R12 n11 n12 1k
R13 n12 n13 1k
R14 n13 n14 1k
R15 n14 n15 1k
R16 n15 n16 1k
```

## 6. A parse error: the error card, and no parts

```spice
R1 a b 1k
Q1 a
```

## 7. Right-aligned with alt: the buttons stay at the column edge

```spice {alt="a resistor to ground" align="right"}
R1 a 0 1k
```

## 8. Two identical bodies: flip this one to BOM and the next to source, then edit this heading

```spice
R1 a 0 1k
C1 a 0 1u
```

```spice
R1 a 0 1k
C1 a 0 1u
```

## 9. An ordinary fence: no buttons, VS Code's own copy button on hover

```json
{ "compare": "hover me: the copy button is top-right, on hover only" }
```

## 10. Right-to-left container: both buttons at the left

<div dir="rtl">

```spice
V1 in 0 DC 5
R1 in out 1k
R2 out 0 1k
```

</div>

## Quirks

What to look for: on first open both slots read *Reading the netlist…* until the fence is
prepared. Set `spice.layoutTimeout` to its minimum and fence 5 times out, yet its BOM view still
shows the table, since the netlist was read before layout overran. Fence 6 does not read, so its
BOM view says so instead of showing a table. Switch `spice.bomStyle` between `plain`, `compact`
and `card`: the table restyles on the next render; in `plain` the wide table of fence 5 wraps
before it reaches the buttons, and in `card` the summary's number sits at the start in fence 10.
