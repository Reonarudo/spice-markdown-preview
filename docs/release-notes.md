# SPICE Schematic Preview v0.3.0

Schematics are now drawn by [spice-renderer](https://github.com/Reonarudo/spice-renderer) 1.0.0, the same library that draws SPICE on reonarudo.github.io, instead of a copy inside the extension. It reads netlists with the same six dialect parsers and draws the same schematics. **Requires VS Code 1.101 or later**; older versions stay on 0.2.0.

- A `dialect` attribute that is not one of `ngspice`, `ltspice`, `pspice`, `hspice`, `xyce` or `spectre` is now an error naming the six, instead of falling back to the `spice.dialect` setting.
- A file named by `.include` or `.lib` that cannot be read here — in Restricted Mode, in an unsaved document, outside a local workspace folder — is now an error at the include, as a missing file already was, instead of a note.
- The schematic paints itself, so it looks the same wherever the SVG is shown; the preview stylesheet adds only the white card.
- Changing `spice.layoutTimeout` restarts the layout worker with the new limit and retries schematics that timed out.
- While an edited fence is read again, the preview keeps its previous drawing instead of a placeholder.
