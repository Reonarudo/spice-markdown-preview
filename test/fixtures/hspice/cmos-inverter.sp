* CMOS inverter chain, in the shape of an HSPICE deck (UG ch.3)
.OPTION POST ACCT
.PARAM supply=1.8 wn='2u' wp='wn * 2'
.GLOBAL vdd! gnd!
.TEMP 25
VDD vdd! 0 supply
VIN in gnd! PULSE 0 supply 0 0.1n 0.1n 5n 10n
.MACRO INV IN OUT W=wn
MP OUT IN vdd! vdd! pch W='W * 2' L=0.18u
MN OUT IN gnd! gnd! nch W=W L=0.18u
.EOM INV
X1 in out1 INV W=2u M=2
X2 out1 out2 INV W='wn * 2'
CL out2 GND! cmod 10f $ load
RL out ground rmod 1MEG $ leak, on the node .CONNECT joins to out2
M3 out2 out1 0 nch W=1u L=0.18u $ three nodes: the bulk comes from the model
J1 d g s b jm
.CONNECT out2 out
.MODEL nch.1 NMOS LEVEL=49 VTH0=0.5 LMIN=0.1u LMAX=1u
.MODEL nch.2 NMOS LEVEL=49 VTH0=0.45 LMIN=1u LMAX=10u
.MODEL pch.1 PMOS (LEVEL=49 VTH0=-0.5)
.MODEL cmod C CAP=1
.MODEL rmod R RES=1
.MODEL jm PJF
.DATA sweep W1 L1
1u 0.18u
+ 2u 0.18u
.ENDDATA
.TRAN 0.1n 20n SWEEP DATA=sweep
.MEASURE TRAN tphl TRIG V(in) VAL='supply/2' RISE=1 TARG V(out2) VAL='supply/2' FALL=1
.PROTECT
Q3bXz9== encrypted model text
.UNPROTECT
.ALTER second run
MN out1 in gnd! gnd! nch W=4u L=0.18u
.END
.TITLE a second simulation
R9 a 0 1k
.END
