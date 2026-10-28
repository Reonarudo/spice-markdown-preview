# SPICE Schematic Preview v0.4.0

Every schematic now carries a view toggle in its top corner that flips the fence between the schematic and its source text, highlighted as the preview highlights any code block. A flipped fence stays flipped while you edit, after *Markdown: Refresh Preview* and when the preview is reopened; flip it back to see the schematic again.

- The source text is the fence as written: an `.include` line stays an include line, never the included file's contents.
- The toggle is also present on error cards and on the *Reading the netlist…* placeholder, and a flip made while a fence is being read survives the swap to its schematic.
- It is a reader's control; no fence attribute presets it.
- Still requires VS Code 1.101 or later.
