// Helpers the tests share.
import assert from 'node:assert/strict';

/**
 * The rendering slot's inner HTML of the first claimed fence in `html`, so the exact-markup tests
 * keep asserting the rendering byte for byte while the wrapper, buttons, BOM slot and source
 * `<pre>` are asserted once, in the contract tests. The slot ends where the BOM slot begins.
 */
export function rendering(html: string): string {
  const open = '<div class="spice-rendering">';
  const start = html.indexOf(open);
  assert.notEqual(start, -1, `no rendering slot in ${html}`);
  const end = html.indexOf('</div><div class="spice-bom ', start);
  assert.notEqual(end, -1, `no BOM slot after the rendering slot in ${html}`);
  return html.slice(start + open.length, end);
}

/** The BOM slot's inner HTML of the first claimed fence in `html`: it ends where the source `<pre><code` begins. */
export function bom(html: string): string {
  const start = html.search(/<div class="spice-bom spice-bom-[a-z]+">/);
  assert.notEqual(start, -1, `no BOM slot in ${html}`);
  const open = html.indexOf('>', start) + 1;
  const end = html.indexOf('</div><pre><code', open);
  assert.notEqual(end, -1, `no source <pre> after the BOM slot in ${html}`);
  return html.slice(open, end);
}
