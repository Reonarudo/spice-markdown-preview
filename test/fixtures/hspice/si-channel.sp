* Signal-integrity channel: IBIS driver, coupled line, lumped line, S-parameter package, port
.OPTION POST
.GLOBAL vdd!
VDD vdd! 0 1.2
B1 vdd! 0 pad din file='driver.ibs' model='io_buf' buffer=2 $ IBIS output buffer
W1 N=2 pad agg gnd! rx1 rx2 gnd! RLGCMODEL=pair L=0.05
U1 rx1 rx2 0 pk1 pk2 0 umod L=0.01
S1 pk1 pk2 0 MNAME=pkg
P1 pk2 0 port=1 z0=50
EAMP amp 0 LAPLACE pk1 0 1 / 1 1n
EDLY dly 0 DELAY amp 0 TD=1n
GSUM 0 sum POLY(2) amp 0 dly 0 0 1 1
EOP vout 0 OPAMP sum 0
GN noise 0 NOISE='1e-15'
EV vth 0 VOL='v(sum) * 2'
T1 vout 0 far 0 Z0=50 TD=1n
RT far 0 50
VIN din 0 PULSE 0 1.2 0 50p 50p 1n 2n
.MODEL umod U LEVEL=3 ELEV=1 PLEV=1 NL=2
.MODEL pkg S TSTONEFILE='pkg.s2p'
.MODEL pair W MODELTYPE=RLGC N=2
.TRAN 10p 10n
.END
