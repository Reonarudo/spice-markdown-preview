# README screenshots

Real captures of VS Code's built-in Markdown preview showing `examples/demo.md`
with the packaged extension installed — not mockups. `npm run screenshots`
regenerates them: it installs the VSIX into a throwaway profile, opens the demo
beside its preview in a 1357×768 window with the Default Dark Modern theme, and
grabs each frame through Playwright's Electron support, so no screen-recording
permission is needed.

- `schematics.jpg`: an RC filter driving an emitter follower, then a CMOS
  inverter.
- `caption-and-error.jpg`: the inverter's caption, an op-amp block, and a netlist
  error pointing at its column.
- `dialects.jpg`: two fences naming their dialect — a PSpice NAND latch on the
  `$G_DPWR`/`$G_DGND` supplies, drawn with net labels, and an LTspice `A` Schmitt
  trigger. The demo's Spectre inverter follows them, below the frame.
