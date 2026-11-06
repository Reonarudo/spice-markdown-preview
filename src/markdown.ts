import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import type { BomRow, RenderResult } from '@reonarudo/spice-renderer';
import { parseAttributes, type FenceAttributes } from './attributes';

/**
 * The class on every schematic's root `<svg>`, set by the renderer, and the prefix of every class
 * the preview stylesheet selects.
 */
export const BASE_CLASS = 'spice';

/**
 * `spice`, alone or followed by an attribute block. First word only, case-sensitive.
 *
 * A fence whose block is malformed is still claimed: the attributes are dropped and the schematic
 * renders bare, rather than falling through to another renderer as a raw netlist (ADR 0002).
 */
const CLAIMED = /^spice(?:\s+\{|$)/;

/**
 * `env` is markdown-it's render environment; VS Code puts the document's URI in it. `attributes`
 * are the fence's, already parsed: the renderer reads `dialect` from them. `undefined` means the
 * fence is still being prepared (its netlist read, its included files loaded).
 */
export type Render = (source: string, env: unknown, attributes: FenceAttributes) => RenderResult | undefined;
export type Report = (message: string) => void;

/** How the BOM view's table is drawn (`spice.bomStyle`, docs/bom-view-spec.md section 8). */
export type BomStyle = 'plain' | 'compact' | 'card';
const BOM_STYLES: readonly string[] = ['plain', 'compact', 'card'] satisfies BomStyle[];

/**
 * The `spice.bomStyle` setting for the document in markdown-it's `env`, as configured and
 * unchecked; the fence rule reads anything outside the enum (a hand-edited settings file) as
 * `plain`, with one note per bad value.
 */
export type ReadBomStyle = (env: unknown) => unknown;

const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>\n';

/** What a fence's two slots last showed, as inner HTML. */
interface Shown {
  rendering: string;
  bom: string;
}

/** The last pair drawn per fence slot, bounded by entries and by characters (both strings count). */
const MAX_SLOTS = 64;
const MAX_SLOT_CHARS = 16 * 1024 * 1024;

/**
 * Claim `spice` fences and draw each as one schematic.
 *
 * Every fence we do not claim is delegated to whichever fence renderer was registered before us
 * (markdown-it's default, or another extension's, e.g. a Graphviz or SMILES preview).
 *
 * Preparation is asynchronous, so a fence can be not ready yet. It then keeps showing whatever its
 * slot (the document and the fence's position among its spice fences) last showed, so editing a
 * fence does not flash a placeholder on every keystroke. Only a slot seen for the first time shows
 * the loading message, and so does every fence rendered without a document (`markdown.api.render`
 * of a string), which has no slot: two unrelated strings must never show each other's schematics.
 *
 * Every claimed fence, whatever it shows, is wrapped with the BOM button and the view toggle
 * (`fence` below), and the slot caches what sits in the rendering and BOM slots, so an edited
 * fence that is not ready yet shows its old drawing and its old table beside its new source.
 */
export function markdownPlugin(md: MarkdownIt, render: Render, report: Report = () => {}, readBomStyle: ReadBomStyle = () => undefined): MarkdownIt {
  const original = md.renderer.rules.fence;
  const slots = new Map<string, Shown>();
  let slotChars = 0;
  const size = (shown: Shown) => shown.rendering.length + shown.bom.length;
  const remember = (slot: string, shown: Shown): void => {
    const previous = slots.get(slot);
    if (previous !== undefined) {
      slotChars -= size(previous);
      slots.delete(slot);
    }
    slots.set(slot, shown);
    slotChars += size(shown);
    while (slots.size > MAX_SLOTS || slotChars > MAX_SLOT_CHARS) {
      const [oldest, dropped] = slots.entries().next().value!;
      slots.delete(oldest);
      slotChars -= size(dropped);
    }
  };
  // One note per bad value, not one per fence per keystroke.
  const reported = new Set<string>();
  const bomStyle = (env: unknown): BomStyle => {
    const value = readBomStyle(env);
    if (value === undefined || (typeof value === 'string' && BOM_STYLES.includes(value))) return (value ?? 'plain') as BomStyle;
    const note = `spice.bomStyle "${String(value)}" is not a BOM style; using plain`;
    if (!reported.has(note)) report(note);
    reported.add(note);
    return 'plain';
  };

  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]!;
    const info = token.info.trim();
    if (!CLAIMED.test(info)) {
      return original
        ? original(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    }
    const { attributes, diagnostics } = parseAttributes(info);
    for (const diagnostic of diagnostics) {
      report(diagnostic);
    }
    const document = (env as { currentDocument?: { toString(): string } } | undefined)?.currentDocument;
    let slot: string | undefined;
    if (document) {
      let ordinal = 0;
      for (let before = 0; before < index; before++) {
        const other = tokens[before]!;
        if (other.type === 'fence' && CLAIMED.test(other.info.trim())) ordinal++;
      }
      slot = `${document.toString()}\n${ordinal}`;
    }
    // Before anything is rendered, so every return path below has the source view and the style.
    const source = sourceView(md, original, tokens, index, options, env, self);
    const style = bomStyle(env);

    let result: RenderResult | undefined;
    try {
      result = render(token.content, env, attributes);
    } catch (error) {
      // The renderer throws only for programmer errors, but a throw here would remove the whole
      // extension from the preview, so it degrades this fence alone.
      const cause = error instanceof Error ? error.message : String(error);
      report(`SPICE render failed: ${cause}`);
      return fence(token, { rendering: errorReport(md, `The schematic renderer failed: ${cause}`), bom: bomEmpty(NOT_RUNNING) }, style, source);
    }
    if (result === undefined) return fence(token, (slot && slots.get(slot)) || { rendering: LOADING, bom: BOM_LOADING }, style, source);

    const shown = {
      rendering: result.status === 'success'
        ? wrap(md, sized(withClass(md, result.output, attributes.class)), attributes)
        : errorReport(md, describe(result, token.content)),
      // By rule, not by status: whenever the reply carries rows the table shows, a timeout and a
      // layout failure included.
      bom: result.status === 'unavailable' ? bomEmpty(NOT_RUNNING)
        : result.bom ? bomView(md, result.bom)
        : bomEmpty(NOT_READ)
    };
    if (slot) remember(slot, shown);
    return fence(token, shown, style, source);
  };
  return md;
}

// The view toggle (docs/source-toggle-spec.md in onnx-markdown-preview), amended for SPICE by the
// BOM view (docs/bom-view-spec.md): every claimed fence is wrapped with the BOM button, the toggle,
// its rendering, its BOM, and the hidden source view that media/preview.js and preview.css swap.

type FenceRule = NonNullable<MarkdownIt['renderer']['rules']['fence']>;

/**
 * The source view: VS Code's highlighted `<pre><code>` for this fence, from the fence rule that
 * was registered before us, called with a shallow-cloned token so neither rule sees the other's
 * changes. Without one (bare markdown-it in a unit test) a plain escaped block stands in. It is
 * the fence as written: the netlist with its includes expanded never reaches this plugin.
 */
function sourceView(md: MarkdownIt, original: FenceRule | undefined, ...args: Parameters<FenceRule>): string {
  const [tokens, index, options, env, self] = args;
  const token = tokens[index]!;
  if (!original) {
    const word = md.utils.escapeHtml(token.info.trim().split(/\s+/)[0] ?? '');
    return `<pre><code class="language-${word}">${md.utils.escapeHtml(token.content)}</code></pre>\n`;
  }
  const clone = Object.assign(Object.create(Object.getPrototypeOf(token)), token, {
    attrs: token.attrs ? token.attrs.map((attr) => [...attr]) : null
  });
  const copy = tokens.slice();
  copy[index] = clone;
  return unsynced(original(copy, index, options, env, self));
}

/**
 * Drop VS Code's `code-line` class and `data-line` from the delegated `<code>`, so the wrapper is
 * the one element VS Code's scroll sync sees for this fence. VS Code measures an element's height
 * up to its first nested `.code-line`; a hidden one has a zero rect, which collapsed the wrapper
 * to a pixel in rendering view and sent editor-to-preview sync to the top of the page.
 */
function unsynced(html: string): string {
  return html.replace(/^<pre><code\b[^>]*>/, (tag) =>
    tag.replace(/ data-line="[^"]*"/, '').replace(/ class="([^"]*)"/, (_, names: string) => {
      const kept = names.split(' ').filter((name) => name !== 'code-line').join(' ');
      return kept ? ` class="${kept}"` : '';
    }));
}

/**
 * The wrapper every claimed fence gets (docs/bom-view-spec.md section 5): both buttons first, the
 * rendering slot, the BOM slot with its style class, then the source `<pre>`. `code-line` and
 * `data-line` keep VS Code's scroll sync; a token without a map (a bare string through
 * `markdown.api.render`) gets neither.
 */
function fence(token: { content: string; map: [number, number] | null }, shown: Shown, style: BomStyle, source: string): string {
  const line = token.map?.[0];
  const classes = line === undefined ? `${BASE_CLASS}-fence` : `${BASE_CLASS}-fence code-line`;
  const lineAttr = line === undefined ? '' : ` data-line="${line}"`;
  return `<div class="${classes}"${lineAttr} data-fence-key="${fenceKey(token.content)}">${BOM_BUTTON}${TOGGLE}` +
    `<div class="${BASE_CLASS}-rendering">${shown.rendering}</div>` +
    `<div class="${BASE_CLASS}-bom ${BASE_CLASS}-bom-${style}">${shown.bom}</div>${source}</div>\n`;
}

/** The fence key: FNV-1a, 32-bit, of the exact body, as eight hex digits. The script never hashes. */
function fenceKey(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Both glyphs ship; the stylesheet shows the one naming the view a click leads to.
const ICON_CODE = `<svg class="${BASE_CLASS}-icon-code" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
  '<path d="M5.7 3.3 1 8l4.7 4.7.9-.9L2.8 8l3.8-3.8zM10.3 3.3l-.9.9L13.2 8l-3.8 3.8.9.9L15 8z"/></svg>';
const ICON_GRAPH = `<svg class="${BASE_CLASS}-icon-graph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">` +
  '<rect x="1.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="9.5" y="1.5" width="5" height="3.5" rx=".5"/><rect x="5.5" y="11" width="5" height="3.5" rx=".5"/>' +
  '<path d="M4 5v3h8V5M8 8v3"/></svg>';
const TOGGLE = `<button type="button" class="${BASE_CLASS}-toggle" aria-pressed="false" aria-label="Source view" title="Source view">${ICON_CODE}${ICON_GRAPH}</button>`;
const ICON_LIST = `<svg class="${BASE_CLASS}-icon-list" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">` +
  '<circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none"/>' +
  '<path d="M5.5 4h9M5.5 8h9M5.5 12h9"/></svg>';
// The label is constant; the glyph names the view a click leads to, as the toggle's does.
const BOM_BUTTON = `<button type="button" class="${BASE_CLASS}-bom-button" aria-pressed="false" aria-label="BOM view" title="BOM view">${ICON_LIST}${ICON_GRAPH}</button>`;

// The BOM view's table (docs/bom-view-spec.md section 4), drawn from the rows the renderer returns.

const BOM_LOADING = `<div class="${BASE_CLASS}-bom-empty" role="status">Reading the netlist…</div>`;
const NOT_READ = 'The netlist did not read, so there are no parts.';
const NOT_RUNNING = 'The schematic renderer is not running, so there are no parts.';

function bomEmpty(text: string): string {
  return `<div class="${BASE_CLASS}-bom-empty">${text}</div>`;
}

/** The summary line and the table; the File column only when a row names a file. Every cell is escaped text. */
function bomView(md: MarkdownIt, rows: readonly BomRow[]): string {
  if (rows.length === 0) return bomEmpty('No parts.');
  const escape = md.utils.escapeHtml;
  const withFile = rows.some((row) => row.references.some((reference) => reference.file !== undefined));
  const partCount = rows.reduce((sum, row) => sum + row.references.length, 0);
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const head = `<th scope="col" class="${BASE_CLASS}-bom-qty">Qty</th><th scope="col">References</th><th scope="col">Type</th><th scope="col">Value</th>` +
    (withFile ? '<th scope="col">File</th>' : '');
  const body = rows.map((row) => {
    const files = [...new Set(row.references.flatMap((reference) => reference.file === undefined ? [] : [reference.file]))];
    const value = [row.title, row.value].filter(Boolean).join(' ');
    return `<tr><td class="${BASE_CLASS}-bom-qty">${row.references.length}</td>` +
      `<td class="${BASE_CLASS}-bom-refs">${escape(row.references.map((reference) => reference.ref).join(', '))}</td>` +
      `<td class="${BASE_CLASS}-bom-type">${escape(row.name)}</td>` +
      `<td class="${BASE_CLASS}-bom-value">${escape(value)}</td>` +
      (withFile ? `<td class="${BASE_CLASS}-bom-file">${escape(files.join(', '))}</td>` : '') + '</tr>';
  }).join('');
  return `<p class="${BASE_CLASS}-bom-summary" dir="auto">${plural(partCount, 'part')} in ${plural(rows.length, 'row')}</p>` +
    `<table class="${BASE_CLASS}-bom-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Add the author's class, if any, beside the base class the drawing already carries. */
function withClass(md: MarkdownIt, svg: string, extra: string | undefined): string {
  if (!extra) return svg;
  return svg.replace(/^<svg class="spice"/, `<svg class="${md.utils.escapeHtml(`${BASE_CLASS} ${extra}`)}"`);
}

/**
 * Give the schematic its natural width. The renderer emits a `viewBox` and no size, so a small
 * circuit would otherwise stretch to the preview column; its units are pixels, the same width the
 * extension drew before. The stylesheet still scales a wide one down.
 */
function sized(svg: string): string {
  const width = /^<svg\b[^>]*\sviewBox="[^"\s]+\s+[^"\s]+\s+([0-9.]+)\s/.exec(svg)?.[1];
  return width ? svg.replace(/^<svg class="[^"]*"/, (start) => `${start} width="${width}px"`) : svg;
}

function wrap(md: MarkdownIt, schematic: string, attributes: FenceAttributes): string {
  const escape = md.utils.escapeHtml;
  let html = schematic;
  if (attributes.alt !== undefined) {
    // `role="img"` sits inside the figure so that a caption stays outside the image role and
    // remains available to assistive technology.
    html = `<div role="img" aria-label="${escape(attributes.alt)}">${html}</div>`;
  }
  if (attributes.caption === undefined && attributes.align === undefined) {
    return html;
  }
  const classes = attributes.align
    ? `spice-figure spice-align-${attributes.align}`
    : 'spice-figure';
  const caption = attributes.caption === undefined
    ? ''
    : `<figcaption>${escape(attributes.caption)}</figcaption>`;
  return `<figure class="${classes}">${html}${caption}</figure>`;
}

/** The text of the error report shown in place of a schematic. */
function describe(result: Exclude<RenderResult, { status: 'success' }>, source: string): string {
  if (result.status === 'timeout') {
    const seconds = (result.budget / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
    return `Layout took longer than ${seconds} s (spice.layoutTimeout). ` +
      'Split the circuit into several fences, or raise the limit.';
  }
  if (result.status === 'unavailable') {
    return `The schematic renderer could not start: ${result.reason}. It will retry on the next render.`;
  }
  // Echo the line the reader names, with a caret under the column, so the author need not count.
  const lines = source.split('\n');
  const text = result.line !== undefined ? lines[result.line - 1]?.replace(/\r$/, '') : undefined;
  if (text === undefined || result.line === undefined) return result.message;
  const gutter = `${result.line} │ `;
  // Columns are 1-based. One past the end is allowed: that is where the reader points when a
  // token is missing.
  const column = Math.min(Math.max((result.column ?? 1) - 1, 0), text.length + 1);
  return `${result.message}\n\n${gutter}${text}\n${' '.repeat(gutter.length + column)}^`;
}

function errorReport(md: MarkdownIt, text: string): string {
  return `<div class="spice-error" role="alert"><pre>${md.utils.escapeHtml(text)}</pre></div>\n`;
}
