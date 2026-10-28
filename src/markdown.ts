import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import type { RenderResult } from '@reonarudo/spice-renderer';
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

const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>\n';

/** The last rendering drawn per fence slot (the rendering slot's inner HTML only), bounded by entries and by characters. */
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
 * Every claimed fence, whatever it shows, is wrapped with the view toggle (`fence` below), and
 * the slot caches only what sits in the rendering slot, so an edited fence that is not ready yet
 * shows its old drawing beside its new source.
 */
export function markdownPlugin(md: MarkdownIt, render: Render, report: Report = () => {}): MarkdownIt {
  const original = md.renderer.rules.fence;
  const slots = new Map<string, string>();
  let slotChars = 0;
  const remember = (slot: string, html: string): void => {
    const previous = slots.get(slot);
    if (previous !== undefined) {
      slotChars -= previous.length;
      slots.delete(slot);
    }
    slots.set(slot, html);
    slotChars += html.length;
    while (slots.size > MAX_SLOTS || slotChars > MAX_SLOT_CHARS) {
      const [oldest, dropped] = slots.entries().next().value!;
      slots.delete(oldest);
      slotChars -= dropped.length;
    }
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
    // Before anything is rendered, so every return path below has the source view.
    const source = sourceView(md, original, tokens, index, options, env, self);

    let result: RenderResult | undefined;
    try {
      result = render(token.content, env, attributes);
    } catch (error) {
      // The renderer throws only for programmer errors, but a throw here would remove the whole
      // extension from the preview, so it degrades this fence alone.
      const cause = error instanceof Error ? error.message : String(error);
      report(`SPICE render failed: ${cause}`);
      return fence(token, errorReport(md, `The schematic renderer failed: ${cause}`), source);
    }
    if (result === undefined) return fence(token, (slot && slots.get(slot)) ?? LOADING, source);

    const html = result.status === 'success'
      ? wrap(md, sized(withClass(md, result.output, attributes.class)), attributes)
      : errorReport(md, describe(result, token.content));
    if (slot) remember(slot, html);
    return fence(token, html, source);
  };
  return md;
}

// The view toggle (docs/source-toggle-spec.md in onnx-markdown-preview): every claimed fence is
// wrapped with a toggle button, its rendering, and the hidden source view that media/preview.js
// and preview.css swap.

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
 * The wrapper every claimed fence gets: toggle first, the rendering slot, then the source `<pre>`.
 * `code-line` and `data-line` keep VS Code's scroll sync; a token without a map (a bare string
 * through `markdown.api.render`) gets neither.
 */
function fence(token: { content: string; map: [number, number] | null }, rendering: string, source: string): string {
  const line = token.map?.[0];
  const classes = line === undefined ? `${BASE_CLASS}-fence` : `${BASE_CLASS}-fence code-line`;
  const lineAttr = line === undefined ? '' : ` data-line="${line}"`;
  return `<div class="${classes}"${lineAttr} data-fence-key="${fenceKey(token.content)}">${TOGGLE}` +
    `<div class="${BASE_CLASS}-rendering">${rendering}</div>${source}</div>\n`;
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
