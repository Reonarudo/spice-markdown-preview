// Helpers the tests share.
import assert from 'node:assert/strict';

/**
 * The rendering slot's inner HTML of the first claimed fence in `html`, so the exact-markup tests
 * keep asserting the rendering byte for byte while the wrapper, toggle and source `<pre>` are
 * asserted once, in the contract tests. The slot ends where the delegated source `<pre><code`
 * begins; an error card's own `<pre>` carries no `<code>`, so it never ends the slot early.
 */
export function rendering(html: string): string {
  const open = '<div class="spice-rendering">';
  const start = html.indexOf(open);
  assert.notEqual(start, -1, `no rendering slot in ${html}`);
  const end = html.indexOf('</div><pre><code', start);
  assert.notEqual(end, -1, `no source <pre> after the rendering slot in ${html}`);
  return html.slice(start + open.length, end);
}
