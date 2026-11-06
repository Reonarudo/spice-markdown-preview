# BOM view: specification

Every `spice` fence in the VS Code extension and the Obsidian plugin carries a second reader-only icon button beside the view toggle, the **BOM button**. It flips the fence to its **BOM view**: a table of the fence's parts aggregated into **BOM rows** (quantity, references, type, value, and the included file when the fence includes files). The rows are computed by spice-renderer and returned beside the schematic; the hosts only draw them. A fence left in BOM view stays there across re-renders, refreshes and reopening, as a fence left in source view does.

This document is the single source of truth for the three repositories it spans. It consolidates the decisions recorded on the map at `.scratch/spice-bom-view/` in the VS Code workspace root; the tickets there hold the rationale and the alternatives rejected. Order of work: spice-renderer 1.1.0, then the VS Code extension (the pilot, 0.5.0), then the Obsidian plugin (0.2.0).

It **amends** the source / rendering toggle's specification (`onnx-markdown-preview/docs/source-toggle-spec.md`, "the toggle spec" below) for SPICE only. Everything the toggle spec fixes stays fixed unless a section here says otherwise: the wrapper, the fence key, the delegated source `<pre>`, the toggle's markup, box and position, the script's facts and matching rules, the testing layers. This document never restates them; it points at them by section. The five other preview extensions are untouched.

Reference implementation (throwaway, not merged): branch `prototype/bom-view` in this repository, commit 947411f, `npm run prototype`. Its `src/markdown.ts`, `media/preview.js` and `media/preview.css` are what sections 5 to 8 describe, minus the variant switcher, the rejected variant B, and the throwaway reader that stood in for the renderer. Screenshots of the three table styles in three themes are on that branch under `docs/prototype-bom/`.

Vocabulary: `CONTEXT.md` in this repository (part, reference, value tail, BOM view, BOM row, grouping key, quantity, BOM button, BOM style, BOM slot, parsed stage) and `onnx-markdown-preview/CONTEXT.md` (claimed fence, rendering, source view, view toggle, inline-end corner, fence key).

## 1. Scope

In scope: the renderer's BOM rows and the two-phase reply (section 2); aggregation (section 3); the table (section 4); the amended DOM contract, stylesheet, setting and preview script of the VS Code extension (sections 5 to 8); the Obsidian plugin's differences (section 9); tests, sample documents, CHANGELOGs and releases (sections 10 to 12). Reader-only: no fence attribute presets the view.

Out of scope (map): copying or exporting the BOM, sorting or filtering the table; a whole-document BOM across fences; pricing, part-number or manufacturer columns; a BOM view in the other five extensions; an author-chosen initial view; unit normalisation in the grouping key (`10k`, `10000`, `1e4` as one part), a follow-on effort needing a per-dialect number reader.

## 2. The renderer contract (spice-renderer 1.1.0)

Additive. `Prepared`, `identity`, `prepare`, `Runtime.render`'s signature and `RuntimeOptions` are unchanged, so neither host's preparation or cache keys change.

### 2.1 Types

```ts
/** One reference of a BOM row: the part as written, where it is, and which included file it came from. */
export interface BomReference {
  /** The element name as written, e.g. `R1`. */
  ref: string;
  /** 1-based line the element starts on, in the fence or in `file`. */
  line: number;
  /** The included file's key, as `Prepared.files` names it; absent for the fence itself. */
  file?: string;
}

/** Every part sharing one grouping key (section 3). Quantity is `references.length`. */
export interface BomRow {
  /** The catalogue element type id, e.g. `bjt`: a stable key for styling and tests. */
  type: string;
  /** The catalogue's display name, e.g. `bipolar transistor`: the Type column. */
  name: string;
  /** The block title when the part has one: a subcircuit name, or a fixed title such as `VCVS`. */
  title?: string;
  /** The value tail as the row's first reference wrote it; may be empty. */
  value: string;
  /** In netlist order; never empty. */
  references: BomReference[];
}

export type RenderResult =
  | { status: 'success'; output: string; bom: BomRow[]; notes: string[] }
  | { status: 'failure'; message: string; line?: number; column?: number; bom?: BomRow[]; notes?: string[] }
  | { status: 'timeout'; budget: number; bom?: BomRow[]; notes?: string[] }
  | { status: 'unavailable'; reason: string };
```

`BomRow` and `BomReference` are exported from `index.ts`. On `failure` and `timeout`, `bom` and `notes` are present together or absent together: present when the netlist was read, absent when it was not (a parse error, a timeout inside the parse, an early payload that did not fit, see 2.3). `notes` are now part of the **parsed stage**, so a fence whose layout overran keeps its notes.

### 2.2 Stage boundary

`renderNetlist` (`src/draw-netlist.ts`) gains an optional `onParsed({ bom, notes })` callback, called once after the netlist reader returns and before layout starts. It is internal to the two worker bundles (the library's `src/worker.ts`, the plugin's `src/worker/entry.ts`) and is **not** exported from `index.ts`. The library's worker uses it for the early write (2.3); the plugin's worker posts an interim message from it (section 10.2).

Aggregation is a pure function over the parts list, `aggregate(parts: Part[]): BomRow[]` in a new `src/bom.ts`, called from `renderNetlist` on the same list the drawing gets. The grouping rule lives and is tested once, here.

### 2.3 Two-phase reply

Fact: the host's `render` blocks in `Atomics.wait`; when its budget expires the host terminates the worker, so nothing computed inside the worker reaches the host unless it was written to the shared buffer before layout began.

So the worker writes twice per request:

1. **Parsed stage, early.** As soon as `onParsed` fires, the worker serialises `{ bom, notes }` as UTF-8 JSON and writes it at the **tail** of the data region (ending at `HEADER + capacity`), recording its byte length in a new Int32 header slot `PARSED` (index 3; `HEADER` grows from 12 to 16 bytes). It writes the payload only when it fits in the buffer's slack, `buffer.byteLength - HEADER - 2 * outputBytes` (the 262144 bytes the runtime reserves beyond twice the output limit); otherwise `PARSED` stays 0 and the timeout carries nothing. 400 parts (the reader's cap) at one row each with a 200-byte reference list is about 100 KB; the implementation ticket measures the worst case and records it in the ADR.
2. **Final reply, as today.** The full `Reply` JSON at the head of the data region, `LENGTH` set, `READY` stored and notified. A `success` carries `bom` and `notes` inline. A `failure` produced **after** the parsed stage (ELK threw, the output exceeded `outputBytes`, the worker is to be discarded) carries `bom` and `notes` inline too, so the host never needs the tail for a failure.

The host (`src/runtime.ts`) zeroes `PARSED` before each request. On `READY` it reads the final reply and ignores the tail. On timeout it reads `PARSED`; when non-zero it parses the tail and returns `{ status: 'timeout', budget, bom, notes }`, else `{ status: 'timeout', budget }` as 1.0.0 did. The early payload is never read concurrently with a write: the host reads it only after terminating the worker, and the final reply at the head cannot reach the tail while both fit (the worker checks the slack before writing).

`src/protocol.ts` records the slot:

```ts
export const READY = 0;
export const LENGTH = 1;
export const ENGINE = 2;
/** Byte length of the parsed stage written at the tail of the data region, 0 when none. */
export const PARSED = 3;
export const HEADER = 16;
```

The two-phase reply is recorded as an ADR in spice-renderer (`docs/adr/0001-two-phase-reply.md`, the repository's first): it is hard to reverse once hosts depend on `bom` on a timeout, surprising without the termination fact, and a real trade-off against a host-side parse.

### 2.4 Release

Version 1.1.0, `CHANGELOG.md` entry, README section on the BOM rows (the worked examples of 3.5 are its illustration), tests per 11.1, the release tarball the hosts install from (`https://github.com/Reonarudo/spice-renderer/releases/download/v1.1.0/reonarudo-spice-renderer-1.1.0.tgz`, the URL form both hosts' `package.json` already use).

## 3. Aggregation

### 3.1 Which parts

The rows mirror the parts list the schematic is drawn from: every `Part` the netlist reader keeps, from the fence and from included files. Not rows: elements inside `.subckt` bodies (not parts); `draw: 'none'` elements, today only mutual inductance `K`, which the reader notes and drops before the parts list (the note stays a note); anything a dot command skips (`.alter`, an unevaluated `.if` branch, a library section not selected).

### 3.2 Grouping key

Two parts share a row when their **type**, **title** and **value tail** are equal after folding:

```ts
const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
const key = (part: Part) => `${part.type}\u0000${fold(part.title ?? '')}\u0000${fold(part.value)}`;
```

- **Type** is the catalogue id (`resistor`, `bjt`, `subcircuit`), never the letter: a Spectre `resistor` and an ngspice `R` are the same type.
- **Title** enters the key because a subcircuit instance's tail excludes the subcircuit name (it is the part's `title`); without it every `X` would merge. Controlled sources carry a fixed title (`VCVS`) from the catalogue.
- **Normalisation is case folding and whitespace collapsing only.** `10K` and `10k` merge; `1e4`, `{R}`, `'R'` do not. Nothing semantic is read from the tail.
- **Parameters stay in the key.** `10k tc1=0.01` and `10k` are different rows; `nch W=1u L=180n` and `nch W=2u L=180n` are different rows.
- **Multiplicity stays in the key and does not count toward quantity.** `R1 … 1k m=2` and `R2 … 1k` are two rows with `m=2` visible in the Value column. Every dialect defines `m=` (`M=`, Spectre `m`) as a positive real scale factor on the model, fractional in five of six, hierarchy- and compatibility-mode-dependent; a BOM quantity cannot honour it without evaluating the netlist (research on branch `research/dialect-multiplicity` of spice-renderer, `docs/research/dialect-multiplicity.md`).
- **Included parts share rows** with fence parts of the same key; the row's references record each part's file.

### 3.3 Row order and content

- Rows are in **first-reference order**: the netlist position of each row's first reference, with an included file's parts taking the position of the include that reached them. A later part joining an earlier row does not move the row. No sorting.
- `references` are in netlist order within the row.
- `value` is the tail as the row's **first** reference wrote it (unfolded).
- `title` is set when the first reference's part has one.
- `name` is the catalogue entry's `name`.

### 3.4 Presentation rules the hosts share

- **Quantity** is `references.length`, shown as a number, `1` included.
- **References** joined with `, ` and allowed to wrap.
- **Value** shows the title, a space, then the tail; an empty tail with no title is an empty cell.
- **File** column only when at least one row names a file; a row's cell lists its distinct files in first-reference order, joined with `, `; a part from the fence contributes nothing.

### 3.5 Worked examples

The spec's, the README's and the tests' examples; the netlists are from this repository's README. Columns: Qty | References | Type | Value (| File).

**Bridge rectifier.** Four diodes aggregate into one row.

```spice
VAC ac1 ac2 SIN(0 12 50)
D1 ac1 plus 1N4007
D2 ac2 plus 1N4007
D3 0 ac1 1N4007
D4 0 ac2 1N4007
C1 plus 0 1000u
RL plus 0 1k
.model 1N4007 D
```

| Qty | References | Type | Value |
| --: | --- | --- | --- |
| 1 | VAC | voltage source | SIN(0 12 50) |
| 4 | D1, D2, D3, D4 | diode | 1N4007 |
| 1 | C1 | capacitor | 1000u |
| 1 | RL | resistor | 1k |

**Common-emitter amplifier.** C2 joins C1's row at C1's position; the row does not move to C2's.

```spice
VCC vcc 0 12
VIN in 0 SIN(0 10m 1k)
C1 in b 10u
R1 vcc b 47k
R2 b 0 10k
Q1 c b e BC547
RC vcc c 4.7k
RE e 0 1k
CE e 0 100u
C2 c out 10u
RL out 0 100k
.model BC547 NPN
```

| Qty | References | Type | Value |
| --: | --- | --- | --- |
| 1 | VCC | voltage source | 12 |
| 1 | VIN | voltage source | SIN(0 10m 1k) |
| 2 | C1, C2 | capacitor | 10u |
| 1 | R1 | resistor | 47k |
| 1 | R2 | resistor | 10k |
| 1 | Q1 | bipolar transistor | BC547 |
| 1 | RC | resistor | 4.7k |
| 1 | RE | resistor | 1k |
| 1 | CE | capacitor | 100u |
| 1 | RL | resistor | 100k |

**Buffer feeding a non-inverting stage.** The subcircuit's title is the Value; the two supplies merge (same type, same tail `15`); `E1` inside the `.subckt` body is not a part.

```spice
V1 in 0 SIN(0 1 1k)
X1 in mid vcc vee mid opamp
R1 mid inv 10k
R2 inv out 47k
X2 mid inv vcc vee out opamp
RL out 0 10k
VCC vcc 0 15
VEE 0 vee 15
.subckt opamp inp inn vp vn out
E1 out 0 inp inn 100k
.ends
```

| Qty | References | Type | Value |
| --: | --- | --- | --- |
| 1 | V1 | voltage source | SIN(0 1 1k) |
| 2 | X1, X2 | subcircuit | opamp |
| 2 | R1, RL | resistor | 10k |
| 1 | R2 | resistor | 47k |
| 2 | VCC, VEE | voltage source | 15 |

Rows: `{ type: 'subcircuit', name: 'subcircuit', title: 'opamp', value: '', references: [X1, X2] }`.

**Includes and multiplicity.** `examples/included/stage.cir` holds one top-level part, `R7 c out 4k7`, so the File column appears; the include is reached first, so R7's row comes first; `m=2` keeps R1 and R2 apart; `LM358` is undefined, which is a note (*subcircuit LM358 of X1 is not defined here; its pins are numbered*), not an error, so the fence renders. The document sits in `examples/`.

```spice
.include "included/stage.cir"
X1 inp inn vcc vee out LM358
R1 out fb 1k m=2
R2 fb 0 1k
```

| Qty | References | Type | Value | File |
| --: | --- | --- | --- | --- |
| 1 | R7 | resistor | 4k7 | included/stage.cir |
| 1 | X1 | subcircuit | LM358 | |
| 1 | R1 | resistor | 1k m=2 | |
| 1 | R2 | resistor | 1k | |

## 4. The BOM table

What a host draws from `bom`, identical in both hosts apart from how the nodes are built. Classes carry the `spice-` prefix, as the toggle's do.

```html
<p class="spice-bom-summary" dir="auto">7 parts in 4 rows</p>
<table class="spice-bom-table">
  <thead>
    <tr>
      <th scope="col" class="spice-bom-qty">Qty</th>
      <th scope="col">References</th>
      <th scope="col">Type</th>
      <th scope="col">Value</th>
      <th scope="col">File</th>            <!-- only when a row names a file -->
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="spice-bom-qty">4</td>
      <td class="spice-bom-refs">D1, D2, D3, D4</td>
      <td class="spice-bom-type">diode</td>
      <td class="spice-bom-value">1N4007</td>
      <td class="spice-bom-file"></td>     <!-- only when the table has the column -->
    </tr>
  </tbody>
</table>
```

- The **summary** is `<N> part(s) in <M> row(s)` (singulars at 1), emitted on every style and shown by the stylesheet only in `card`. `dir="auto"` so the number lands at the start in a right-to-left container.
- Every cell is text: escaped in the extension (`md.utils.escapeHtml`), a text node in the plugin (`createEl` with `text`). Notes, references, values and file keys come from the netlist and are never markup.
- **Empty states**, one muted italic sentence in `div.spice-bom-empty` instead of the table, chosen by rule, not by status:
  - the reply carries `bom` with zero rows: *No parts.*
  - the reply carries no `bom` (a parse `failure`, a `timeout` or `failure` without the parsed stage): *The netlist did not read, so there are no parts.*
  - the renderer is `unavailable` or threw: *The schematic renderer is not running, so there are no parts.*
  - the fence is loading: *Reading the netlist…* with `role="status"`.
- Whenever the reply carries `bom`, the table shows: `success`, `timeout` and a layout `failure` alike. The rendering slot shows the timeout or error card beside it, unchanged.

## 5. The DOM contract (VS Code extension)

Amends toggle spec section 2 for `<base>` = `spice`. Every return path of the fence rule for a claimed fence (success, error card, renderer threw, loading placeholder, cached slot) emits exactly this:

```html
<div class="spice-fence code-line" data-line="12" data-fence-key="3f9a1c2b">
  <button type="button" class="spice-bom-button" aria-pressed="false" aria-label="BOM view" title="BOM view">
    <svg class="spice-icon-list" …>…</svg>
    <svg class="spice-icon-graph" …>…</svg>
  </button>
  <button type="button" class="spice-toggle" aria-pressed="false" aria-label="Source view" title="Source view">
    <svg class="spice-icon-code" …>…</svg>
    <svg class="spice-icon-graph" …>…</svg>
  </button>
  <div class="spice-rendering">…exactly 0.4.0's rendering: figure, role="img", svg, error card, or loading…</div>
  <div class="spice-bom spice-bom-plain">…section 4: the summary and table, or one empty-state sentence…</div>
  <pre><code class="language-spice" dir="auto">…escaped body…</code></pre>
</div>
```

Rules, in addition to the toggle spec's:

1. **Wrapper children, in order:** BOM button, view toggle, `div.spice-rendering`, `div.spice-bom`, `<pre>`. Both buttons precede the slots (the toggle spec's "button first" reason); tab order follows the visual row in both writing directions. The wrapper's own attributes are the toggle spec's; the plugin never emits `data-view`.
2. **The BOM button** ships two glyphs, list and graph, `class="spice-bom-button" aria-pressed="false" aria-label="BOM view" title="BOM view"`; the label is constant like the toggle's. Markup in section 6.1.
3. **`data-view`** is absent (rendering), `source` or `bom`, set by the script; exactly one of the three slots shows (section 7).
4. **The BOM slot** `div.spice-bom` carries exactly one **BOM style** class, `spice-bom-plain`, `spice-bom-compact` or `spice-bom-card` (section 8), outside the cached content. Its inner HTML is section 4's.
5. **The slot cache keeps the pair.** One entry per slot holding `{ rendering: string; bom: string }`, both counted toward `MAX_SLOT_CHARS`; an edited fence that is not ready yet shows its old table beside its new source exactly as it shows its old drawing. The style class is applied fresh on every render, so a cached table takes a changed style on the next render. A slot seen for the first time, and a document-less render, show *Reading the netlist…* in both slots.
6. **Click semantics.** Each button leads to its view from anywhere and back to the rendering from its own view: the toggle in BOM view goes to source, the BOM button in source view goes to BOM. `aria-pressed` is `true` on a button only in its own view.
7. **Scroll sync** stays at fence granularity: the wrapper is the one `.code-line` for the fence; the fourth child was verified not to disturb editor-to-preview or preview-to-editor sync.
8. **Never throws**, on every path, including the BOM slot's.

The wrapper builder:

```ts
function fence(token: { content: string; map: [number, number] | null }, rendering: string, bom: string, style: BomStyle, source: string): string {
  const line = token.map?.[0];
  const classes = line === undefined ? `${BASE_CLASS}-fence` : `${BASE_CLASS}-fence code-line`;
  const lineAttr = line === undefined ? '' : ` data-line="${line}"`;
  return `<div class="${classes}"${lineAttr} data-fence-key="${fenceKey(token.content)}">${BOM_BUTTON}${TOGGLE}` +
    `<div class="${BASE_CLASS}-rendering">${rendering}</div>` +
    `<div class="${BASE_CLASS}-bom ${BASE_CLASS}-bom-${style}">${bom}</div>${source}</div>\n`;
}
```

## 6. The buttons

### 6.1 Markup

The toggle is toggle spec section 5, unchanged. The BOM button:

```html
<button type="button" class="spice-bom-button" aria-pressed="false" aria-label="BOM view" title="BOM view">
  <svg class="spice-icon-list" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M5.5 4h9M5.5 8h9M5.5 12h9"/></svg>
  <svg class="spice-icon-graph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="5.5" y="11" width="5" height="3.5" rx=".5"/><path d="M4 5v3h8V5M8 8v3"/></svg>
</button>
```

The graph glyph is the toggle's, so the two buttons share three glyphs.

### 6.2 Glyphs per view

Each button shows the glyph of the view its click leads to.

| View | BOM button | Toggle |
| --- | --- | --- |
| rendering (`data-view` absent) | list | code |
| `source` | list | graph |
| `bom` | graph | code |

The toggle's existing rules (keyed on `data-view="source"`) already give its column; only the BOM button's rules are new (section 7).

### 6.3 Position

Two buttons in one row at the inline-end corner: the toggle at `inset-inline-end: 8px` and never moving, the BOM button at `inset-inline-end: 44px` (8 + 28 + 8). Same box, colours, hover, active, focus ring and `z-index` as the toggle (toggle spec section 5). In source view VS Code's copy button moves to `right: 80px`, three in a row; in a right-to-left container both buttons sit at the left and the copy button keeps `right: 8px`. Verified in light, dark and high contrast; in `card` the buttons over the white card look faded in high contrast, as they already do over the schematic card (accepted).

## 7. Stylesheet

Appended to `media/preview.css` after the toggle's rules (toggle spec section 6), which stay as they are except the copy-button offset, which changes from `44px` to `80px`.

```css
/* ---- The BOM view (docs/bom-view-spec.md). Three views, one attribute: absent (rendering),
   "source", "bom". Exactly one slot shows. ---- */
.spice-fence > .spice-bom {
  display: none;
}

.spice-fence[data-view="bom"] > .spice-rendering {
  display: none;
}

.spice-fence[data-view="bom"] > .spice-bom {
  display: block;
}

/* In source view VS Code's copy button moves past both buttons (8 + 28 + 8 + 28 + 8). Replaces
   the toggle spec's 44px rule; the :dir(rtl) rule keeping it at 8px is unchanged. */
.spice-fence[data-view="source"] > pre > .code-block-copy-button {
  right: 80px;
}

/* The BOM button: the toggle's box, 36px inline-start of it. The toggle never moves. */
.spice-bom-button {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: 44px;
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .35));
  border-radius: 4px;
  background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
  color: var(--vscode-editor-foreground);
  cursor: pointer;
  opacity: 1;
  z-index: 1;
}

.spice-bom-button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.spice-bom-button:active {
  background: var(--vscode-toolbar-activeBackground);
}

.spice-bom-button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}

.spice-bom-button svg {
  width: 16px;
  height: 16px;
}

/* The glyph names the view the click leads to: list everywhere but in BOM view, graph there. */
.spice-bom-button .spice-icon-graph {
  display: none;
}

.spice-fence[data-view="bom"] .spice-bom-button .spice-icon-list {
  display: none;
}

.spice-fence[data-view="bom"] .spice-bom-button .spice-icon-graph {
  display: inline;
}

/* The BOM slot, every style. */
.spice-bom {
  margin: 1em 0;
}

.spice-bom-empty {
  padding: .5em 1em;
  opacity: .7;
  font-style: italic;
}

.spice-bom-summary {
  display: none;
}

.spice-bom-table .spice-bom-qty {
  text-align: end;
}

/* plain: VS Code's own markdown.css table (th border-bottom, td border-top, 5px 10px padding),
   width auto, level with the buttons. A table wider than the column minus the two buttons wraps
   earlier instead of running under them; a single unbreakable token wider than that still
   overflows (accepted). */
.spice-bom-plain .spice-bom-table {
  max-width: calc(100% - 80px);
}

/* compact: a dense full-width table of our own, 36px below the buttons' row. */
.spice-bom-compact {
  padding-block-start: 36px;
}

.spice-bom-compact .spice-bom-table {
  width: 100%;
  font-size: .92em;
  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .35));
}

.spice-bom-compact .spice-bom-table th {
  font-size: .85em;
  text-transform: uppercase;
  letter-spacing: .04em;
  opacity: .8;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .35));
  background: var(--vscode-textCodeBlock-background);
}

.spice-bom-compact .spice-bom-table td {
  border-top: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, .35));
  padding: 3px 10px;
  vertical-align: top;
}

.spice-bom-compact .spice-bom-table .spice-bom-refs,
.spice-bom-compact .spice-bom-table .spice-bom-value,
.spice-bom-compact .spice-bom-table .spice-bom-file {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: .95em;
}

.spice-bom-compact .spice-bom-table .spice-bom-type {
  white-space: nowrap;
}

/* card: the table on the schematic's white card, the summary line first on the buttons' row. */
.spice-bom-card {
  background: #fff;
  color: #000;
  border-radius: 6px;
  padding: 8px 12px;
}

.spice-bom-card .spice-bom-summary {
  display: block;
  margin: 0 0 .5em;
  line-height: 28px;
  color: #555;
}

.spice-bom-card .spice-bom-table {
  width: 100%;
  margin-bottom: 0;
}

.spice-bom-card .spice-bom-table th {
  border-bottom: 1px solid #999;
  color: #000;
}

.spice-bom-card .spice-bom-table td {
  border-top: 1px solid #ddd;
  vertical-align: top;
}

.spice-bom-card .spice-bom-table .spice-bom-refs,
.spice-bom-card .spice-bom-table .spice-bom-value,
.spice-bom-card .spice-bom-table .spice-bom-file {
  font-family: var(--vscode-editor-font-family, monospace);
}

.spice-bom-card .spice-bom-empty {
  color: #555;
}
```

Direct-child selectors (`>`) on the slots matter, as in the toggle spec: the error card's own `<pre>` stays governed by the rendering slot.

## 8. The `spice.bomStyle` setting

Button behaviour is fixed; only the table's look is a setting.

`package.json`, beside `spice.dialect`:

```json
"spice.bomStyle": {
  "type": "string",
  "enum": ["plain", "compact", "card"],
  "enumDescriptions": [
    "The preview's own table styling, level with the buttons (the default)",
    "A dense full-width table below the buttons",
    "The table on the schematic's white card, with a summary line"
  ],
  "default": "plain",
  "scope": "resource",
  "markdownDescription": "How the BOM view's table is drawn. Takes effect on the next render."
}
```

Plumbing mirrors `spice.dialect`: `PreviewOptions` gains `bomStyle?(env: unknown): BomStyle | undefined` beside `dialect`, read per document through `workspace.getConfiguration('spice', document)`; the fence rule applies it as the class on `div.spice-bom`. A value outside the enum (a hand-edited settings file) reads as `plain`, with one note per bad value through `report` (`spice.bomStyle "<value>" is not a BOM style; using plain`). `type BomStyle = 'plain' | 'compact' | 'card'` lives in `src/markdown.ts` with the other fence types.

## 9. The preview script

Amends toggle spec section 8 and 9.1. The facts (patch-not-replace, once per page load, `localStorage`, CSP) and the matching rules (key, then ordinal, then index) are unchanged. What changes is the entry and the core's shape.

1. **Entries** are `{ key, ordinal, index, view }` with `view` one of `source` | `bom`. The storage key is unchanged: `spice-markdown-preview.view-toggle:<uri>`.
2. **Migration lives in `load`.** An entry without `view` (written by 0.4.0) is read as `source`; an entry whose `view` is anything else, or that is not an object with a string `key` and numeric `ordinal` and `index`, is dropped. `collect` always writes `view`, so a 0.4.0 entry is rewritten in the new shape on the first save.
3. **Pure core.** `match(entries, keys)` returns a `Map<position, view>` (a later entry for the same position wins, as a later entry won the set before); `collect(keys, views: Map<position, view>)` returns entries with `view`; `storageKey`, `load`, `save` keep their signatures. The `module.exports` guard exports the same five names.
4. **Wiring.** `setView(fence, view)` with `view` `'source'`, `'bom'` or `undefined` sets or removes `data-view` and sets `aria-pressed` on both buttons (`true` only for the view's own button). `viewsOf(all)` reads the `Map` back from the DOM. The delegated click listener matches `.spice-toggle` **or** `.spice-bom-button` inside `.spice-fence` and applies section 5 rule 6:

```js
document.addEventListener('click', (event) => {
  const toggle = event.target.closest(TOGGLE);
  const bom = event.target.closest(BOM);
  if (!toggle && !bom) return;
  const fence = (toggle || bom).closest(WRAPPER);
  if (!fence) return;
  const current = fence.getAttribute('data-view');
  if (toggle) setView(fence, current === 'source' ? undefined : 'source');
  else setView(fence, current === 'bom' ? undefined : 'bom');
  remember(fences());
});
```

The reference core (`match`, `collect`, `load`):

```js
/** The positions to flip, as a Map position -> view. */
function match(entries, keys) {
  const groups = new Map();
  keys.forEach((key, position) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(position);
  });
  const views = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.key);
    const target = group ? group[entry.ordinal] : (entry.index < keys.length ? entry.index : undefined);
    if (target !== undefined) views.set(target, entry.view);
  }
  return views;
}

/** The entries describing the flipped positions, recomputed from the document so they only ever name real fences. */
function collect(keys, views) {
  const seen = new Map();
  const entries = [];
  keys.forEach((key, index) => {
    const ordinal = seen.get(key) || 0;
    seen.set(key, ordinal + 1);
    if (views.has(index)) entries.push({ key, ordinal, index, view: views.get(index) });
  });
  return entries;
}

/** The stored entries, normalised: a 0.4.0 entry without a view is a source flip; anything else malformed is dropped. */
function load(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry.key !== 'string' || typeof entry.ordinal !== 'number' || typeof entry.index !== 'number') return [];
      const view = entry.view === undefined ? 'source' : entry.view;
      return view === 'source' || view === 'bom' ? [{ key: entry.key, ordinal: entry.ordinal, index: entry.index, view }] : [];
    });
  } catch (_) {
    return [];
  }
}
```

The script still never touches the wrapper's children beyond `aria-pressed` on the two buttons, and never reads fence text or table text.

## 10. The Obsidian plugin

The plugin ports the extension (its `src/fence.ts` builds the same DOM as nodes; `src/toggle.ts` is the preview script's core over the data file). Everything above holds except the following.

### 10.1 Reading view only

The BOM button is hidden in Live Preview like the toggle, and a stored `bom` view is ignored there: in Live Preview `data-view` has no effect and the block always shows its schematic. Obsidian's own "Edit this block" button keeps its corner. Stylesheet: the existing `.markdown-source-view` block gains `> .spice-bom-button { display: none }`, `[data-view="bom"] > .spice-rendering { display: block }` and `[data-view="bom"] > .spice-bom { display: none }`.

### 10.2 The interim `parsed` message

Fact: the host's timeout is a main-thread timer after which the worker is terminated, so nothing parsed reaches the host unless posted before layout.

The worker (`src/worker/entry.ts`) posts `{ type: 'parsed', id, bom, notes }` from `renderNetlist`'s `onParsed` callback before layout. `src/protocol.ts` gains:

```ts
/** The parsed stage of render request `id`, posted before layout so a timeout still has it. */
export interface Parsed {
  type: 'parsed';
  id: number;
  bom: BomRow[];
  notes: string[];
}
export type WorkerMessage = Started | ReadRequest | PreparedReply | Parsed | Reply;
```

The host (`src/host.ts`) keeps the parsed stage on the pending job and attaches `bom` and `notes` to its own `timeout` result, and to a `failure` reply that lacks them when a `parsed` message arrived for that id (the library's worker puts them in the reply itself; the port does the same, the join is belt and braces). A `discard` reply without a parsed stage and an `unavailable` outcome never carry them. The results cache (`src/cache.ts`) logs notes from any result carrying them, not only from `success`. ADR 0001 (`docs/adr/0001-runtime-host.md`) is amended with one paragraph on the interim message; the renderer's own ADR holds the reasoning for the two-phase reply.

### 10.3 Glyphs and labels

Lucide `list` in rendering and source view, Lucide `network` (the toggle's own way-back glyph) in BOM view, both as `svg-icon` like the toggle's, so the two buttons share three icons:

```html
<svg … class="svg-icon lucide-list spice-icon-list"><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>
```

The BOM button is a `clickable-icon` like the toggle, `aria-label="BOM view"` constant, `aria-pressed` true only in BOM view. The toggle keeps its swapping labels (*Show source* / *Show schematic*). `setView(wrapper, view)` takes `'source' | 'bom' | undefined`; `isSourceView` gains an `isBomView` sibling, or both give way to `viewOf(wrapper)`.

### 10.4 Position

The BOM button sits one button width plus the gap inline-start of the toggle: `inset-inline-end: calc(var(--size-2-2, 4px) * 2 + 28px)`. The rendering slot's end padding grows from 36px to 68px and the source `<pre>`'s from 44px to 76px, so neither button ever sits on a schematic or a long source line.

### 10.5 The BOM style is a body class

Settings are vault-wide, so the style is applied as a **body class** on every window, `spice-bom-plain` / `spice-bom-compact` / `spice-bom-card`, exactly as `spice-follow-dark` is in `main.ts`'s `applyTheme`, and a change applies instantly without a redraw. This is the one departure from section 5 rule 4: `div.spice-bom` carries no style class in the plugin, and the stylesheet's style selectors are `body.spice-bom-compact .spice-bom` and so on. Data-file key `bomStyle` under `settings`, default `plain`; `readSettings` reads an unknown value as `plain`.

Settings tab, a dropdown after "Follow dark themes":

- Name: **BOM table style**
- Description: *How the BOM view's table is drawn. Plain uses the theme's own table styling; Compact is a dense full-width table; Card puts the table on the schematic's card with a summary line.*
- Options: *Plain (the default)*, *Compact*, *Card*.

### 10.6 Theme variables

- `plain` relies on Obsidian's `.markdown-rendered table` rules plus the right-aligned quantity and the `max-width: calc(100% - 72px)` rule (two plugin buttons and their gaps).
- `compact` maps section 7's VS Code variables: `--background-modifier-border` for rules and edges, `--background-secondary` for the header row, `--text-muted` for the uppercase headers, `--font-monospace` for references, value and file, `--font-smaller` for the table.
- `card` follows **"Follow dark themes"** like the schematic: a white card (`#fff`, black text, `#555` summary, `#999` / `#ddd` rules) in a light theme or with the setting off; in a dark theme with the setting on (`body.theme-dark.spice-follow-dark`), a card in `--background-secondary` with a `1px solid var(--background-modifier-border)` edge and the theme's text colours (`--text-normal`, `--text-muted` for the summary).
- The live run measures the table's text contrast in light and dark as it measures the schematic's colours.

### 10.7 Store and commands

`src/toggle.ts`'s `Entry` gains `view`; `match` returns and `collect` takes a `Map`; `load` normalises as section 9 rule 2; `ToggleStore.isFlipped` becomes `viewOf(notePath, keys, index): 'source' | 'bom' | undefined` and `set` takes a view. The data file is rewritten lazily on the first save, as the extension's storage is. The "Show every schematic in this note" command resets both views. The BOM slot keeps its old table during a redraw, as the rendering slot keeps its drawing (`src/block.ts`); the table is built with `createEl` so every cell is a text node.

## 11. Testing

Mirrors toggle spec section 9: unit tests in `npm test`, the extension-host test, a Playwright live run against a committed sample document, a manual theme checklist, and a green live-run line in the release note. Each repository has its own layer.

### 11.1 spice-renderer (`npm test`)

- `test/bom.test.ts`: `aggregate` over the four worked examples of 3.5 yields exactly their rows (type, name, title, value, references with lines and file); the folding rules (`10K` / `10k` merge; `1e4` and `10k` do not; `10k tc1=0.01` and `10k` do not; `m=2` keeps rows apart; two `X` with different titles are two rows; an included part joins a fence row and its reference carries `file`); first-reference order; `K` absent; `.subckt` bodies absent; an empty tail gives `value: ''`.
- `test/runtime.test.ts` (or the existing worker tests): `success` carries `bom` and `notes`; a layout `failure` after a successful parse carries both; a parse `failure` carries neither; a `timeout` with a budget too short for layout but long enough to parse carries both (the parsed stage read from the tail); a `timeout` inside the parse carries neither; the early payload is skipped, not corrupted, when `outputBytes` is set so small that the slack cannot hold it; `PARSED` is zero at the start of every request; `identity` of a prepared input is byte-identical to 1.0.0's for the same fence (the golden `prepare` vectors stay green).
- Golden SVG tests stay green: the drawing is unchanged.

### 11.2 VS Code extension, unit (`npm test`)

- **Plugin HTML** (`test/markdown.test.ts`): the wrapper's five children in order on every return path (success, error card, renderer threw, loading, cached slot); the BOM button's exact markup with both glyphs and the constant label; `div.spice-bom` with the style class from `bomStyle(env)` and `spice-bom-plain` when the option is absent or invalid (and the invalid value reported once); the table for a known `bom` (the bridge rectifier: header without File, four rows, `4` beside `D1, D2, D3, D4`, right-aligned class on the quantity cells, the summary `7 parts in 4 rows` with `dir="auto"`); the File column and `included/stage.cir` for the includes example; the title-then-tail Value for the opamp example; the four empty-state sentences by rule (parse failure, `timeout` without `bom`, zero rows, renderer threw, loading with `role="status"`); a `timeout` **with** `bom` shows the table beside the timeout card; everything escaped (a value containing `<b>` is text); the slot cache keeps the pair (an edited fence not ready yet shows its old drawing **and** its old table beside its new source) and counts both strings toward the bound.
- **Existing exact-markup tests** keep going through the `rendering(html)` helper; a `bom(html)` sibling in `test/helpers.ts` returns the BOM slot's inner HTML.
- **Pure core** (`test/preview-script.test.ts`): the two tests whose expected shape changes (entries gain `view: 'source'`; `match` yields `new Map([[2, 'source']])`); new cases: a `bom` entry round-trips through `collect` and `match`; a 0.4.0 entry without `view` loads as `source`; an entry with an unknown `view` or a missing field is dropped; two same-key fences in different views keep their own views; a later entry for the same position wins.
- `test/preview.test.ts`: the renderer's `bom` reaches the fence rule unchanged, and `bomStyle` is read per document.

### 11.3 VS Code extension-host test (`npm run test:extension`)

`test/extension/index.cjs` gains: `contributes.configuration` declares `spice.bomStyle` with the three values and default `plain`; a rendered claimed fence has the BOM button before the toggle and a `div.spice-bom` before its `<pre>`; the installed spice-renderer is 1.1.0 (`require('@reonarudo/spice-renderer/package.json').version`).

### 11.4 Live run (`npm run test:preview`)

`scripts/test-preview.mjs` keeps its toggle checks on `examples/view-toggle.md` and then opens `examples/bom-view.md` (section 11.6) as a second document, copying `examples/included/` beside it, and asserts inside the preview iframe:

1. Every claimed fence has both buttons in order, each `aria-pressed="false"`, the rendering shown, the BOM slot and `<pre>` hidden; the `json` fence has neither button.
2. Clicking the BOM button sets `data-view="bom"`, `aria-pressed="true"` on it and `"false"` on the toggle, shows the BOM slot and hides the other two; clicking it again reverts to the rendering.
3. From BOM view the toggle goes to source view; from source view the BOM button goes to BOM view.
4. The bridge-rectifier fence's table has four body rows and no File header; its diode row reads `4`, `D1, D2, D3, D4`, `diode`, `1N4007`. The includes fence's table has a File header and a cell reading `included/stage.cir` in its first row. The failing fence's BOM slot holds the *did not read* sentence and no table.
5. Patch survival: a `bom` flip survives typing elsewhere; of the two identical bodies, one in `bom` and one in `source` keep their own views.
6. *Markdown: Refresh Preview* and close-and-reopen keep a `bom` flip.
7. Migration: before opening, seed `localStorage` for the document with a 0.4.0 entry `[{ key, ordinal: 0, index: 0 }]` for the first fence (its key is read from a first pass); on open the fence is in source view and the stored entry now carries `view: "source"`.
8. Style: with `spice.bomStyle: "compact"` in the throwaway profile's settings, the BOM slots carry `spice-bom-compact`; the default run carries `spice-bom-plain`.
9. Flipping everything back removes the `localStorage` entry.

One green line for the whole script is what the release note records.

### 11.5 Obsidian plugin

- Unit tests under happy-dom (`npm test`): `test/fence.test.ts` (five children in order, the BOM button's Lucide glyphs and constant label, `setView` with three views and both buttons' `aria-pressed`, the table as text nodes for the worked examples, the empty states); `test/toggle.test.ts` (entries with `view`, the `Map` shapes, the 0.4.0 migration, unknown views dropped, `viewOf`/`set` with a view, the JSON round trip); `test/host.test.ts` (a `parsed` message joined to a `timeout` and to a `failure` without `bom`; not to `unavailable` or to a `discard` without one); `test/cache.test.ts` (notes logged from a `timeout` that carries them); a settings test (`bomStyle` read, unknown value to `plain`); `test/worker.test.ts` (the embedded bundle posts `parsed` before `reply` for every dialect, and its `bom` equals Node's for the same fence); `test/main-bundle.test.ts` stays green.
- Live run (`scripts/test-live.mjs`): `examples/bom-view.md` with `examples/included/stage.cir` beside it joins the fixture; assertions as 11.4 items 1 to 6 in Reading view, plus: in Live Preview the BOM button is hidden and a block left in `bom` shows its schematic; the body class follows the setting; the `card` table's text contrast in light and dark with "Follow dark themes" on and off.
- Manual checklist: three styles × light and dark × "Follow dark themes" on and off for `card`; a pop-out window takes the body class.

### 11.6 Sample document

`examples/bom-view.md`, committed in both repositories (the plugin's copy with the same fences), the fixture for the live runs and the document for the manual checklist. Fences, in order:

1. The bridge rectifier (3.5): four diodes aggregate.
2. The common-emitter amplifier, captioned and centred: C2 joins C1's row at C1's position.
3. The buffer and non-inverting stage: the title in the Value column, the supplies merge, nothing from the `.subckt` body.
4. The includes and multiplicity fence: the File column, the included row first, `m=2` kept apart. Includes `included/stage.cir`.
5. Sixteen series resistors and a 100-character `PWL` source: a wrapping references cell and a wrapping value cell.
6. A failing fence (`Q1 a`): the error card and the *did not read* sentence.
7. Right-aligned with `alt`: the buttons stay at the column edge.
8. and 9. Two identical bodies: flip one to BOM and one to source, then edit the heading above.
10. An ordinary `json` fence: no buttons, VS Code's copy button on hover.
11. A fence inside a `<div dir="rtl">`: both buttons at the left, the `card` summary's number at the start.

A closing *Quirks* paragraph tells the reader what to look for: loading in both slots, a timeout keeping the table (`spice.layoutTimeout` set very low on fence 5), the parse failure, the three styles.

### 11.7 Manual checklist (VS Code)

On `examples/bom-view.md` in a development window (`npm run prototype`'s launch line without the prototype file, section 12.2 step 11): the three styles (`spice.bomStyle` in the workspace settings) × light, dark and high contrast; the three-button row in source view; both buttons in the RTL container; the focus ring on both buttons; scroll sync both ways on a fence in each of the three views; the `plain` wide table (fence 5) wrapping before the buttons; the `card` summary direction in RTL.

### 11.8 Release

A green `test:preview` line (11.4) is required in the extension's 0.5.0 release note, and a green `test:live` line in the plugin's 0.2.0 note, beside the lines the toggle already requires. spice-renderer 1.1.0's release records its `npm test` and the golden SVGs.

## 12. Per-host checklist

### 12.1 spice-renderer 1.1.0

1. `src/bom.ts`: `aggregate(parts)` per section 3; `BomRow`, `BomReference` types; export from `index.ts`.
2. `src/draw-netlist.ts`: `renderNetlist` gains the internal `onParsed` callback, called after the reader and before layout, with `aggregate`'s rows and the notes.
3. `src/protocol.ts`: `PARSED` slot, `HEADER = 16`. `src/worker.ts`: the early tail write guarded by the slack; `bom` and `notes` inline on `success` and on every `failure` after the parsed stage (ELK threw, output limit, discard). `src/runtime.ts`: zero `PARSED` per request; read the tail on timeout.
4. `RenderResult` per 2.1; `notes` on `timeout` and `failure`.
5. ADR `docs/adr/0001-two-phase-reply.md`.
6. Tests per 11.1; golden SVGs unchanged; the `prepare` vectors unchanged.
7. README (BOM rows, the worked examples), `CHANGELOG.md`, version 1.1.0, release tarball.

### 12.2 VS Code extension 0.5.0 (the pilot)

1. Read this spec; take spice-renderer 1.1.0 in `package.json` and `npm install`.
2. `src/markdown.ts`: `BOM_BUTTON`, `ICON_LIST`, `bomView(md, bom)` (section 4), `bomEmpty(text)`, `BomStyle`; `fence(token, rendering, bom, style, source)`; route **every** claimed-fence return through it, the catch path and the loading placeholder included; the slot cache holds `{ rendering, bom }`.
3. `src/extension.ts`: `bomStyle(env)` beside `dialect(env)`, per document, invalid values to `plain` with one report.
4. `package.json`: `spice.bomStyle`; version 0.5.0.
5. `media/preview.css`: section 7 appended; the copy-button offset changed to 80px.
6. `media/preview.js`: section 9.
7. `examples/bom-view.md` (11.6); `scripts/test-preview.mjs` gains the second document and copies `examples/included/`.
8. Tests per 11.2, 11.3, 11.4; `npm run lint`, `npm test`, `npm run test:extension`, `npm run test:preview`.
9. `CONTEXT.md`: terms already present; sharpen if the implementation renames anything.
10. `README.md`: the BOM view beside the view toggle, the setting, one table; `CHANGELOG.md`; `docs/release-notes.md`.
11. Manual checklist (11.7) in a development window, the installed copy disabled:

   ```sh
   code --new-window --disable-extension=ReoX86.spice-schematic-preview --extensionDevelopmentPath="$PWD" examples/bom-view.md
   ```

12. Remove the prototype's `prototype` and `prototype:screenshots` scripts if they were merged; the prototype branch stays as it is.
13. Record in the pilot ticket's answer what proved hard, for the Obsidian roll-out.
14. Publish and verify per the shared `PUBLISHING.md`; `docs/release-verification-0.5.0.md` records the green `test:preview` line.

### 12.3 Obsidian plugin 0.2.0

1. Read this spec and the pilot's *proved hard* notes.
2. Take spice-renderer 1.1.0 into the worker bundle; check `src/worker/entry.ts` against the release's `src/worker.ts` (the `onParsed` callback, the inline `bom` on failures) and `src/worker/parser-modules.ts` against `src/parser/modules.ts`.
3. `src/protocol.ts`: `Parsed`. `src/worker/entry.ts`: post it from `onParsed`. `src/host.ts`: keep it on the pending job; join to `timeout` and to a `failure` lacking `bom`. `src/cache.ts`: log notes from any result carrying them.
4. `src/fence.ts`: the BOM button (Lucide `list` / `network`, `clickable-icon`, constant label), the BOM slot, `showBom(slot, result)` building section 4 as nodes, `setView` with three views. `src/block.ts`: fill both slots; the BOM slot keeps its old table during a redraw.
5. `src/toggle.ts`: section 10.7. `main.ts`: `setView` from `viewOf`; the clear command resets both views; the body class in `applyTheme` from `bomStyle`, applied on `window-open` too.
6. `src/settings.ts`: `bomStyle`, `readSettings`, the dropdown (10.5).
7. `styles.css`: the three-state rules, the BOM button beside the toggle (10.4), the three styles under body classes (10.6), the Live Preview rules (10.1).
8. `docs/adr/0001-runtime-host.md`: the interim-message paragraph.
9. `examples/bom-view.md` and `examples/included/stage.cir`; `scripts/test-live.mjs` per 11.5.
10. Tests per 11.5; `npm run lint`, `npm test`, `npm run build`, `npm run test:live`.
11. `README.md`, `CHANGELOG.md`, `DEVELOPMENT.md` (the `parsed` message); `npm version minor` (0.2.0, which updates `manifest.json` and `versions.json`).
12. Manual checklist (11.5) in the dev vault (`npm run vault`); tag and release per `DEVELOPMENT.md`; `docs/release-verification-0.2.0.md` records the green `test:live` line.

## 13. Decision record

| Decision | Where |
| --- | --- |
| The library aggregates; row shape; two-phase reply with a second header slot; `onParsed`; rows mirror the parts list (`K` stays a note); 1.1.0 additive, `Prepared`/`identity` unchanged | map ticket 01, *What the renderer returns as the BOM* |
| Quantity does not count `m=`; the multiplier stays in the value tail | map ticket 02, *What multiplicity each dialect expresses on a part* |
| Key = type + title + tail, case-folded and whitespace-collapsed; parameters in the key; included parts share rows; first-reference order; `, ` join; `1` shown; the worked examples | map ticket 03, *The grouping key, row order and the edge cases of aggregation* |
| Three table styles behind `spice.bomStyle`, default `plain`; glyphs swap; two buttons in one row (44px / 8px / copy at 80px); the BOM slot as a third sibling; each button leads to its view and back to the rendering | map ticket 04, *Prototype the BOM button and table in the VS Code preview* |
| Slot cache keeps the pair; empty states by rule; button markup and wrapper order; style class on the slot; `max-width: calc(100% - 80px)`; `dir="auto"` on the summary; entries gain `view`, migration in `load`, key unchanged; `match`/`collect` over a `Map`; this spec holds the amended contract, the toggle spec points here | map ticket 05, *The three-state DOM contract and persistence* |
| Reading view only; the interim `parsed` message; Lucide `list` / `network`; the style as a body class, key `bomStyle`; `card` follows "Follow dark themes"; `compact` on Obsidian variables; ADR 0001 amended | map ticket 06, *What differs in the Obsidian plugin* |
| Out of scope: export, sorting, whole-document BOM, pricing columns, other extensions, an initial-view attribute, unit normalisation | map, charting session and ticket 03 |
