import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import type { RenderResult } from '@reonarudo/spice-renderer';
import { parseAttributes, type FenceAttributes } from './attributes';

/** The class on every schematic's root `<svg>`, set by the renderer, so the preview stylesheet can select it. */
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

/** The last HTML drawn per fence slot, bounded by entries and by characters. */
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

    let result: RenderResult | undefined;
    try {
      result = render(token.content, env, attributes);
    } catch (error) {
      // The renderer throws only for programmer errors, but a throw here would remove the whole
      // extension from the preview, so it degrades this fence alone.
      const cause = error instanceof Error ? error.message : String(error);
      report(`SPICE render failed: ${cause}`);
      return errorReport(md, `The schematic renderer failed: ${cause}`);
    }
    if (result === undefined) return (slot && slots.get(slot)) ?? LOADING;

    const html = result.status === 'success'
      ? wrap(md, sized(withClass(md, result.output, attributes.class)), attributes)
      : errorReport(md, describe(result, token.content));
    if (slot) remember(slot, html);
    return html;
  };
  return md;
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
