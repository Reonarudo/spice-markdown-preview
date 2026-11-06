# SPICE Schematic Preview v0.5.0

Every schematic now carries a second button beside the view toggle that flips the fence to its **BOM view**: a table of the fence's parts, with identical parts gathered into one row. A fence left in BOM view stays there while you edit, after *Markdown: Refresh Preview* and when the preview is reopened.

- Columns: quantity, references, type and value, plus the included file when the fence includes files. Parts are identical when their type, subcircuit name and value as written match, ignoring case and spacing; `m=` stays in the value and does not change the quantity.
- A fence whose layout timed out still shows its table; one whose netlist does not read says so.
- The new `spice.bomStyle` setting draws the table `plain` (the default), `compact` or on a `card`.
- Fences you flipped to source view in 0.4.0 stay flipped.
- Schematics are drawn by spice-renderer 1.1.0. Still requires VS Code 1.101 or later.
