# SPICE Schematic Preview — verification document

Open this file's preview (`⇧⌘V` or *Open Preview to the Side*) and compare with
the expectations in each section. Open the *SPICE Schematic Preview* output
channel as well.

## 1. Passives, a source and ground

Expect: a white card; V1 with + and − marks, R1 and C1 each labelled with their
values, and three separate ground symbols.

```spice
V1 in 0 5
R1 in out 10k
C1 out 0 100n
```

## 2. Transistors

Expect: Q1 an NPN with its model beside it; Q2 a PNP with the emitter arrow on
top, toward VCC; the output channel notes nothing for these two.

```spice
VCC vcc 0 12
Q2 c2 b vcc QP
R1 c2 b 10k
Q1 c2 b 0 QN
.model QN NPN
.model QP PNP
```

## 3. MOSFETs

Expect: M1 and M2 as three-terminal symbols with the body tied inside; M3 with
a fourth, body pin wired to VB.

```spice {caption="Figure 3: MOSFET symbols" align="center"}
VDD vdd 0 1.8
M1 out in vdd vdd pch
M2 out in 0 0 nch
M3 x in 0 vb nch
VB vb 0 -1
.model nch NMOS
.model pch PMOS
```

## 4. Blocks

Expect: X1 a box titled `opamp` with pins `inp inn vp` on the left and `vn out`
on the right; E1 a box titled `VCVS`; the output channel notes nothing.

```spice
X1 in fb vcc vee out opamp
E1 y 0 out 0 2
R1 y 0 1k
.subckt opamp inp inn vp vn out
.ends
```

## 5. Included files

Expect, in a trusted workspace with this file saved inside it: Q1 is a PNP,
taken from `included/models.lib`, and R7 (4k7) comes from `included/stage.cir`.
Edit either file and save: the schematic follows. In Restricted Mode, Q1 is an
NPN and the output channel says the files are read only in a trusted workspace.

```spice
.include "included/models.lib"
.inc included/stage.cir
Q1 c b 0 QP
R1 c 0 1k
```

Expect: an error at the include, `nowhere.lib could not be read: the file does
not exist`, pointing at the path.

```spice
R1 a 0 1k
.include nowhere.lib
```

Expect: the output channel notes that model `2N2222` is drawn as NPN.

```spice
Q1 c b 0 2N2222
R1 c 0 1k
```

## 6. Netlist error

Expect: a warning-bordered box quoting `Q1 needs 3 nodes; found 1.` and the line
`2 │ Q1 out` with a caret after `out`.

```spice
R1 in out 10k
Q1 out
```

## 7. Title line

Expect: an error suggesting that a title line start with `*`.

```spice
Common emitter amplifier
R1 a b 1k
```

## 8. Timeout

Expect: after about 3 seconds, "Layout took longer than 3 s
(spice.layoutTimeout)". Every other schematic on the page still renders.

```spice
R0 n0 n3 1k
R1 n1 n10 1k
R2 n2 n17 1k
R3 n3 n24 1k
R4 n4 n31 1k
R5 n5 n38 1k
R6 n6 n4 1k
R7 n7 n11 1k
R8 n8 n18 1k
R9 n9 n25 1k
R10 n10 n32 1k
R11 n11 n39 1k
R12 n12 n5 1k
R13 n13 n12 1k
R14 n14 n19 1k
R15 n15 n26 1k
R16 n16 n33 1k
R17 n17 n40 1k
R18 n18 n6 1k
R19 n19 n13 1k
R20 n20 n20 1k
R21 n21 n27 1k
R22 n22 n34 1k
R23 n23 n0 1k
R24 n24 n7 1k
R25 n25 n14 1k
R26 n26 n21 1k
R27 n27 n28 1k
R28 n28 n35 1k
R29 n29 n1 1k
R30 n30 n8 1k
R31 n31 n15 1k
R32 n32 n22 1k
R33 n33 n29 1k
R34 n34 n36 1k
R35 n35 n2 1k
R36 n36 n9 1k
R37 n0 n16 1k
R38 n1 n23 1k
R39 n2 n30 1k
R40 n3 n37 1k
R41 n4 n3 1k
R42 n5 n10 1k
R43 n6 n17 1k
R44 n7 n24 1k
R45 n8 n31 1k
R46 n9 n38 1k
R47 n10 n4 1k
R48 n11 n11 1k
R49 n12 n18 1k
R50 n13 n25 1k
R51 n14 n32 1k
R52 n15 n39 1k
R53 n16 n5 1k
R54 n17 n12 1k
R55 n18 n19 1k
R56 n19 n26 1k
R57 n20 n33 1k
R58 n21 n40 1k
R59 n22 n6 1k
R60 n23 n13 1k
R61 n24 n20 1k
R62 n25 n27 1k
R63 n26 n34 1k
R64 n27 n0 1k
R65 n28 n7 1k
R66 n29 n14 1k
R67 n30 n21 1k
R68 n31 n28 1k
R69 n32 n35 1k
R70 n33 n1 1k
R71 n34 n8 1k
R72 n35 n15 1k
R73 n36 n22 1k
R74 n0 n29 1k
R75 n1 n36 1k
R76 n2 n2 1k
R77 n3 n9 1k
R78 n4 n16 1k
R79 n5 n23 1k
R80 n6 n30 1k
R81 n7 n37 1k
R82 n8 n3 1k
R83 n9 n10 1k
R84 n10 n17 1k
R85 n11 n24 1k
R86 n12 n31 1k
R87 n13 n38 1k
R88 n14 n4 1k
R89 n15 n11 1k
R90 n16 n18 1k
R91 n17 n25 1k
R92 n18 n32 1k
R93 n19 n39 1k
R94 n20 n5 1k
R95 n21 n12 1k
R96 n22 n19 1k
R97 n23 n26 1k
R98 n24 n33 1k
R99 n25 n40 1k
R100 n26 n6 1k
R101 n27 n13 1k
R102 n28 n20 1k
R103 n29 n27 1k
R104 n30 n34 1k
R105 n31 n0 1k
R106 n32 n7 1k
R107 n33 n14 1k
R108 n34 n21 1k
R109 n35 n28 1k
R110 n36 n35 1k
R111 n0 n1 1k
R112 n1 n8 1k
R113 n2 n15 1k
R114 n3 n22 1k
R115 n4 n29 1k
R116 n5 n36 1k
R117 n6 n2 1k
R118 n7 n9 1k
R119 n8 n16 1k
R120 n9 n23 1k
R121 n10 n30 1k
R122 n11 n37 1k
R123 n12 n3 1k
R124 n13 n10 1k
R125 n14 n17 1k
R126 n15 n24 1k
R127 n16 n31 1k
R128 n17 n38 1k
R129 n18 n4 1k
R130 n19 n11 1k
R131 n20 n18 1k
R132 n21 n25 1k
R133 n22 n32 1k
R134 n23 n39 1k
R135 n24 n5 1k
R136 n25 n12 1k
R137 n26 n19 1k
R138 n27 n26 1k
R139 n28 n33 1k
R140 n29 n40 1k
R141 n30 n6 1k
R142 n31 n13 1k
R143 n32 n20 1k
R144 n33 n27 1k
R145 n34 n34 1k
R146 n35 n0 1k
R147 n36 n7 1k
R148 n0 n14 1k
R149 n1 n21 1k
R150 n2 n28 1k
R151 n3 n35 1k
R152 n4 n1 1k
R153 n5 n8 1k
R154 n6 n15 1k
R155 n7 n22 1k
R156 n8 n29 1k
R157 n9 n36 1k
R158 n10 n2 1k
R159 n11 n9 1k
R160 n12 n16 1k
R161 n13 n23 1k
R162 n14 n30 1k
R163 n15 n37 1k
R164 n16 n3 1k
R165 n17 n10 1k
R166 n18 n17 1k
R167 n19 n24 1k
R168 n20 n31 1k
R169 n21 n38 1k
R170 n22 n4 1k
R171 n23 n11 1k
R172 n24 n18 1k
R173 n25 n25 1k
R174 n26 n32 1k
R175 n27 n39 1k
R176 n28 n5 1k
R177 n29 n12 1k
R178 n30 n19 1k
R179 n31 n26 1k
R180 n32 n33 1k
R181 n33 n40 1k
R182 n34 n6 1k
R183 n35 n13 1k
R184 n36 n20 1k
R185 n0 n27 1k
R186 n1 n34 1k
R187 n2 n0 1k
R188 n3 n7 1k
R189 n4 n14 1k
R190 n5 n21 1k
R191 n6 n28 1k
R192 n7 n35 1k
R193 n8 n1 1k
R194 n9 n8 1k
R195 n10 n15 1k
R196 n11 n22 1k
R197 n12 n29 1k
R198 n13 n36 1k
R199 n14 n2 1k
```

## 9. Delegated fence

Expect: a plain code block, not a schematic.

```cir
R1 left alone 1k
```
