import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import type { RenderResult } from './renderer';
import { parseAttributes, type FenceAttributes } from './attributes';

/** The class on every schematic's root `<svg>`, so the preview stylesheet can select it. */
export const BASE_CLASS = 'spice';

/**
 * `spice`, alone or followed by an attribute block. First word only, case-sensitive.
 *
 * A fence whose block is malformed is still claimed: the attributes are dropped and the schematic
 * renders bare, rather than falling through to another renderer as a raw netlist (ADR 0002).
 */
const CLAIMED = /^spice(?:\s+\{|$)/;

/** What the fence rule is given for one fence: a drawing's outcome, or word that files are loading. */
export type Outcome = RenderResult | { status: 'loading' };

/**
 * `env` is markdown-it's render environment; VS Code puts the document's URI in it. `attributes`
 * are the fence's, already checked: the renderer reads `dialect` from them.
 */
export type Render = (source: string, env: unknown, attributes: FenceAttributes) => Outcome;
export type Report = (message: string) => void;

/**
 * Claim `spice` fences and draw each as one schematic.
 *
 * Every fence we do not claim is delegated to whichever fence renderer was registered before us
 * (markdown-it's default, or another extension's, e.g. a Graphviz or SMILES preview).
 */
export function markdownPlugin(md: MarkdownIt, render: Render, report: Report = () => {}): MarkdownIt {
  const original = md.renderer.rules.fence;
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
    const result = render(token.content, env, attributes);
    if (result.status === 'loading') {
      return '<div class="spice-loading" role="status">Reading included files…</div>\n';
    }
    if (result.status !== 'success') return errorReport(md, describe(result, token.content));
    return wrap(md, withClass(md, result.output, attributes.class), attributes);
  };
  return md;
}

/** Add the author's class, if any, beside the base class the drawing already carries. */
function withClass(md: MarkdownIt, svg: string, extra: string | undefined): string {
  if (!extra) return svg;
  return svg.replace(/^<svg class="spice"/, `<svg class="${md.utils.escapeHtml(`${BASE_CLASS} ${extra}`)}"`);
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
  // One past the end is allowed: that is where the reader points when a token is missing.
  const column = Math.min(Math.max(result.column ?? 0, 0), text.length + 1);
  return `${result.message}\n\n${gutter}${text}\n${' '.repeat(gutter.length + column)}^`;
}

function errorReport(md: MarkdownIt, text: string): string {
  return `<div class="spice-error" role="alert"><pre>${md.utils.escapeHtml(text)}</pre></div>\n`;
}
