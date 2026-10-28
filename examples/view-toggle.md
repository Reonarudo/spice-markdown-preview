# The view toggle

Every `spice` fence below carries a button in its top corner that flips it between the schematic
and the fence's source. This file is the fixture for `npm run test:preview` and the document for
the manual checklist (the source-toggle spec in `onnx-markdown-preview`, section 9.5): open it in
a development window and view it in a light, a dark and a high-contrast theme.

## 1. A plain fence

```spice
V1 in 0 DC 5
R1 in out 10k
C1 out 0 100n
```

## 2. Captioned, centred: the button stays at the column edge

```spice {caption="Figure 1: a voltage divider" align="center"}
V1 in 0 DC 12
R1 in mid 10k
R2 mid 0 10k
```

## 3. Right-aligned with alt: the card sits under the button

```spice {alt="a resistor to ground" align="right"}
R1 a 0 1k
```

## 4. Error card: the source view shows the body alone

```spice
R1 a b 1k
Q1 a
```

## 5. Long lines and a tall body: horizontal scroll, height jump

```spice
* An audio amplifier stage, with a comment line that runs well past the width of the preview column so the source view has to scroll sideways
V1 vcc 0 DC 12
V2 in 0 SIN(0 10m 1k)
C1 in b 10u
R1 vcc b 100k
R2 b 0 22k
Q1 c b e BC547
R3 vcc c 4k7
R4 e 0 1k
C2 e 0 100u
C3 c out 10u
R5 out 0 100k
```

## 6. Two identical bodies: flip the second one only, then edit this heading

```spice
R1 a 0 1k
```

```spice
R1 a 0 1k
```

## 7. An ordinary fence: no toggle, VS Code's own copy button on hover

```json
{ "compare": "hover me: the copy button is top-right, on hover only" }
```

## 8. Right-to-left container: the button moves to the left

<div dir="rtl">

```spice
V1 in 0 DC 5
R1 in out 1k
```

</div>

## 9. Quirks

A fence seen for the first time shows *Reading the netlist…* until its netlist is read; the
toggle is already there, and a flip made while it loads survives the swap to the schematic.
Editing a fence keeps its previous drawing until the new one is ready, while the source view
already shows the edited body:

```spice
V1 in 0 DC 3.3
R1 in led 330
D1 led 0 LED
```

The source view is the fence as written: an `.include` line stays an include line, never the
included file's contents. Here the file is missing, so the rendering is an error card at the
include:

```spice
.include nowhere.lib
Q1 c b e Q
R1 c 0 1k
```

A schematic that takes longer than `spice.layoutTimeout` shows a timeout card, which the toggle
treats like any error card.
