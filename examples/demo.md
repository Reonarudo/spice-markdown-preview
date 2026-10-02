# SPICE Schematic Preview

## RC filter and emitter follower

```spice
* RC low-pass driving an emitter follower
V1 in 0 AC 1
R1 in mid 10k
C1 mid 0 100n
Q1 vcc mid out 2N3904
R2 out 0 1k
VCC vcc 0 5
.model 2N3904 NPN
.tran 1u 1m
```

## CMOS inverter

```spice {caption="Figure 1: a CMOS inverter driving a load" align="center"}
VDD vdd 0 1.8
VIN in 0 PULSE(0 1.8 0 10p 10p 1n 2n)
M1 out in vdd vdd pch W=2u L=180n
M2 out in 0 0 nch W=1u L=180n
CL out 0 10f
.model nch NMOS
.model pch PMOS
```

## Inverting amplifier

```spice
V1 in 0 SIN(0 0.1 1k)
R1 in inv 10k
R2 inv out 100k
X1 0 inv vcc vee out opamp
VCC vcc 0 15
VEE 0 vee 15
.subckt opamp inp inn vp vn out
.ends
```

## Netlist error

```spice
R1 in out 10k
Q1 out in
```

## Dialects

```spice {dialect="pspice" caption="A NAND latch on the digital supplies (PSpice)" align="center"}
U1 NAND(2) $G_DPWR $G_DGND set qb q D_00 IO_STD
U2 NAND(2) $G_DPWR $G_DGND rst q qb D_00 IO_STD
U_SET STIM(1,1) $G_DPWR $G_DGND set IO_STM 0s 1 10ns 0 20ns 1
U_RST STIM(1,1) $G_DPWR $G_DGND rst IO_STM 0s 1 30ns 0 40ns 1
```

```spice {dialect="ltspice" caption="An RC filter into a Schmitt trigger (LTspice)" align="center"}
V1 in 0 SIN(0 1 1k)
R1 in n1 10k
C1 n1 0 100n
A1 n1 0 0 0 0 0 out 0 SCHMITT Vt=0.5 Vh=0.1
RL out 0 10k
```

```spice {dialect="spectre" caption="A CMOS inverter with vdd global (Spectre)" align="center"}
global 0 vdd
V1 (vdd 0) vsource dc=1.8
Vin (in 0) vsource type=pulse val0=0 val1=1.8
M1 (out in vdd vdd) pch w=2u l=180n
M2 (out in 0 0) nch w=1u l=180n
C1 (out 0) capacitor c=10f
model nch bsim4 type=n
model pch bsim4 type=p
```
