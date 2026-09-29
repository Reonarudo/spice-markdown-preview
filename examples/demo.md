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
