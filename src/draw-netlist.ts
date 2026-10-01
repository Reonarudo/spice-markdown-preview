import { parseNetlist, type IncludeSet } from './netlist';
import type { DialectId } from './catalogue/types';
import { layoutSchematic, type Layout, type Symbols } from './schematic';
import { drawSchematic } from './draw';
import type { RenderResult } from './renderer';

/**
 * Read, lay out and draw one netlist: everything the worker does, kept free of the worker so tests
 * can call it directly. `dialect` names the parser the netlist is read with; the caller has loaded it.
 */
export async function renderNetlist(
  source: string, symbols: Symbols, layout: Layout, includes?: IncludeSet, dialect: DialectId = 'ngspice'
): Promise<RenderResult> {
  const parsed = parseNetlist(source, includes, dialect);
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
