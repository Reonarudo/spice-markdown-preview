import { parseNetlist, type IncludeSet } from './netlist';
import { layoutSchematic, type Layout, type Symbols } from './schematic';
import { drawSchematic } from './draw';
import type { RenderResult } from './renderer';

/**
 * Read, lay out and draw one netlist: everything the worker does, kept free of the worker so tests
 * can call it directly.
 */
export async function renderNetlist(source: string, symbols: Symbols, layout: Layout, includes?: IncludeSet): Promise<RenderResult> {
  const parsed = parseNetlist(source, includes);
  if (!parsed.ok) {
    return { status: 'failure', message: parsed.message, line: parsed.line, column: parsed.column };
  }
  let schematic;
  try {
    schematic = await layoutSchematic(parsed.netlist, symbols, layout);
  } catch (error) {
    // ELK's messages are Java exception names; they are logged, and the author gets a plain one.
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'failure', message: `The schematic could not be laid out (${detail.slice(0, 200)}).` };
  }
  return { status: 'success', output: drawSchematic(schematic), notes: parsed.netlist.notes };
}
