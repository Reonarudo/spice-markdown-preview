/**
 * Turn a netlist into a laid-out schematic: every part becomes a symbol with its pins at fixed
 * positions, every node becomes wires between pins, and ELK decides where everything goes.
 *
 * The graph construction and the wire clean-up after layout are adapted from netlistsvg
 * (MIT, Copyright (c) 2016 Neil Turley; `lib/elkGraph.ts` and `lib/drawModule.ts`). Its
 * Yosys-specific machinery — bit vectors, constants, splits and joins, module hierarchy — is not
 * needed for SPICE and was left behind.
 */
import { DOMParser, type Element } from '@xmldom/xmldom';
import type { ElkNode, ElkExtendedEdge, ElkPoint, LayoutOptions } from 'elkjs/lib/elk-api';
import { GROUND, type Kind, type Netlist, type Part } from './netlist';

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface SymbolPin {
  x: number;
  y: number;
  side: Side;
}

/** One symbol from `symbols.svg`. */
export interface SchematicSymbol {
  type: string;
  width: number;
  height: number;
  pins: Map<string, SymbolPin>;
  /** The `<g>` to clone when drawing; null for a block, which is drawn in code. */
  template: Element | null;
  /** Where the symbol's `ref` and `value` texts sit, for reserving room around it. */
  labels: { attribute: 'ref' | 'value'; x: number; y: number; anchor: 'start' | 'middle' | 'end' }[];
}

export type Symbols = Map<string, SchematicSymbol>;

/** A symbol placed on the page. */
export interface Placed {
  part: Part | undefined;
  symbol: SchematicSymbol;
  x: number;
  y: number;
}

export interface Wire {
  points: ElkPoint[];
}

export interface Schematic {
  placed: Placed[];
  wires: Wire[];
  junctions: ElkPoint[];
  /** The drawing's extent, labels included. */
  bounds: { x: number; y: number; width: number; height: number };
}

export type Layout = (graph: ElkNode) => Promise<ElkNode>;

/** Text is measured as 10 px Courier: 6 px per character, 11 px from baseline to ascender. */
export const CHAR_WIDTH = 6;
const TEXT_ASCENT = 9;
const TEXT_DESCENT = 3;
/** Labels longer than this are cut with an ellipsis; a long SIN(…) would otherwise dwarf the part. */
export const MAX_LABEL = 24;

/** Block geometry: pins are this far apart, and the box keeps this much room for its title. */
const BLOCK_PITCH = 20;
const BLOCK_HEADER = 18;

const LAYOUT: LayoutOptions = {
  'org.eclipse.elk.algorithm': 'layered',
  'org.eclipse.elk.direction': 'DOWN',
  'org.eclipse.elk.spacing.nodeNode': '35',
  'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '5',
  'org.eclipse.elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONNECTION_LOCKING',
  'org.eclipse.elk.edgeRouting': 'ORTHOGONAL'
};

const KIND_TO_TYPE: Record<Exclude<Kind, 'block'>, string> = {
  resistor: 'resistor',
  capacitor: 'capacitor',
  inductor: 'inductor',
  diode: 'diode',
  vsource: 'vsource',
  isource: 'isource',
  npn: 'npn',
  pnp: 'pnp',
  nmos: 'nmos',
  pmos: 'pmos'
};

/** Read `symbols.svg`. Throws if the file is not the shape this module expects. */
export function loadSymbols(svg: string): Symbols {
  const document = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } })
    .parseFromString(svg, 'image/svg+xml');
  const symbols: Symbols = new Map();
  for (const g of Array.from(document.documentElement!.childNodes)) {
    if (g.nodeType !== 1) continue;
    const element = g as Element;
    const type = element.getAttribute('s:type');
    if (!type) continue;
    const pins = new Map<string, SymbolPin>();
    const labels: SchematicSymbol['labels'] = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== 1) continue;
      const node = child as Element;
      const pid = node.getAttribute('s:pid');
      if (pid) {
        pins.set(pid, {
          x: Number(node.getAttribute('s:x')),
          y: Number(node.getAttribute('s:y')),
          side: node.getAttribute('s:position') as Side
        });
      }
      const attribute = node.getAttribute('s:attribute');
      if (node.tagName === 'text' && (attribute === 'ref' || attribute === 'value')) {
        const anchor = node.getAttribute('class')?.includes('endlabel') ? 'end' : 'start';
        labels.push({ attribute, x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y')), anchor });
      }
    }
    symbols.set(type, {
      type,
      width: Number(element.getAttribute('s:width')),
      height: Number(element.getAttribute('s:height')),
      pins,
      template: element,
      labels
    });
  }
  for (const type of [...Object.values(KIND_TO_TYPE), 'nmos3', 'pmos3', 'gnd']) {
    if (!symbols.has(type)) throw new Error(`symbols.svg has no ${type} symbol.`);
  }
  return symbols;
}

/** Shorten a label to what is drawn. */
export function labelText(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/**
 * A block's symbol, built to fit: pins split between the left and right sides in netlist order,
 * the box wide enough for its title and pin names.
 */
export function blockSymbol(part: Part): SchematicSymbol {
  const left = part.pins.slice(0, Math.ceil(part.pins.length / 2));
  const right = part.pins.slice(left.length);
  const widest = (pins: typeof left) => Math.max(0, ...pins.map((pin) => pin.name.length * CHAR_WIDTH));
  const title = labelText(part.title ?? '');
  // As wide as its title, its pin names side by side, and the name and value above and below it,
  // so that no label reaches past a pin.
  const width = Math.max(
    40,
    title.length * CHAR_WIDTH + 12,
    widest(left) + widest(right) + 20,
    part.ref.length * CHAR_WIDTH,
    labelText(part.value).length * CHAR_WIDTH
  );
  const rows = Math.max(left.length, right.length, 1);
  const height = BLOCK_HEADER + rows * BLOCK_PITCH;
  const pins = new Map<string, SymbolPin>();
  left.forEach((pin, index) => pins.set(pin.name, { x: 0, y: BLOCK_HEADER + BLOCK_PITCH / 2 + index * BLOCK_PITCH, side: 'left' }));
  right.forEach((pin, index) => pins.set(pin.name, { x: width, y: BLOCK_HEADER + BLOCK_PITCH / 2 + index * BLOCK_PITCH, side: 'right' }));
  return {
    type: 'block',
    width,
    height,
    pins,
    template: null,
    labels: [{ attribute: 'ref', x: width / 2, y: -4, anchor: 'middle' }, { attribute: 'value', x: width / 2, y: height + 12, anchor: 'middle' }]
  };
}

interface Cell {
  id: string;
  part: Part | undefined;
  symbol: SchematicSymbol;
  /** The symbol and its labels, relative to the symbol's origin. */
  box: Box;
  /**
   * Whether the laid-out node is the whole box, labels included, so that ELK routes no wire
   * through a label. Only possible when every pin still sits on the box's edge.
   */
  whole: boolean;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ELK_SIDE: Record<Side, string> = { top: 'NORTH', bottom: 'SOUTH', left: 'WEST', right: 'EAST' };

/** The symbol a part is drawn with: a MOSFET whose body is its source uses the 3-pin symbol. */
function symbolFor(part: Part, symbols: Symbols): SchematicSymbol {
  if (part.kind === 'block') return blockSymbol(part);
  if (part.kind === 'nmos' || part.kind === 'pmos') {
    const node = (name: string) => part.pins.find((pin) => pin.name === name)?.node;
    if (node('B') === node('S')) return symbols.get(`${part.kind}3`)!;
  }
  return symbols.get(KIND_TO_TYPE[part.kind])!;
}

function cellFor(id: string, part: Part | undefined, symbol: SchematicSymbol): Cell {
  const box = labelBox(symbol, part);
  const whole = [...symbol.pins.values()].every((pin) =>
    pin.side === 'top' ? pin.y === box.top
      : pin.side === 'bottom' ? pin.y === box.bottom
        : pin.side === 'left' ? pin.x === box.left
          : pin.x === box.right);
  return { id, part, symbol, box, whole };
}

interface Connection {
  port: string;
  side: Side;
}

/**
 * Lay out a netlist. Ground is drawn where it is used: every connection to node 0 gets its own
 * ground symbol, as a hand-drawn schematic would, rather than one net wired across the page.
 */
export async function layoutSchematic(netlist: Netlist, symbols: Symbols, layout: Layout): Promise<Schematic> {
  const cells: Cell[] = [];
  const nets = new Map<string, Connection[]>();
  const connect = (net: string, connection: Connection) => {
    const list = nets.get(net);
    if (list) list.push(connection);
    else nets.set(net, [connection]);
  };
  let grounds = 0;
  netlist.parts.forEach((part, index) => {
    const symbol = symbolFor(part, symbols);
    const id = `p${index}`;
    cells.push(cellFor(id, part, symbol));
    for (const pin of part.pins) {
      const placed = symbol.pins.get(pin.name);
      // A pin the symbol does not draw: a MOSFET body tied to its source, or a substrate the parser
      // noted.
      if (!placed) continue;
      const port = `${id}.${pin.name}`;
      if (pin.node === GROUND) {
        const ground = `g${grounds++}`;
        cells.push(cellFor(ground, undefined, symbols.get('gnd')!));
        connect(`#${ground}`, { port: `${ground}.A`, side: 'top' });
        connect(`#${ground}`, { port, side: placed.side });
      } else {
        connect(pin.node, { port, side: placed.side });
      }
    }
  });

  const children: ElkNode[] = cells.map((cell) => {
    const { box, symbol, whole } = cell;
    // The node's origin is the box's corner when the node is the whole box, else the symbol's.
    const dx = whole ? -box.left : 0;
    const dy = whole ? -box.top : 0;
    return {
      id: cell.id,
      width: whole ? box.right - box.left : symbol.width,
      height: whole ? box.bottom - box.top : symbol.height,
      layoutOptions: {
        'org.eclipse.elk.portConstraints': 'FIXED_POS',
        ...(whole ? {} : { 'org.eclipse.elk.margins': margins(cell) })
      },
      ports: [...symbol.pins].map(([pid, pin]) => ({
        id: `${cell.id}.${pid}`,
        width: 0,
        height: 0,
        x: pin.x + dx,
        y: pin.y + dy,
        layoutOptions: { 'org.eclipse.elk.port.side': ELK_SIDE[pin.side] }
      }))
    };
  });
  const edges: ElkExtendedEdge[] = [];
  const dummies: string[] = [];
  for (const connections of nets.values()) {
    route(connections, edges, children, dummies);
  }

  const result = await layout({ id: 'root', layoutOptions: LAYOUT, children, edges });
  const positions = new Map((result.children ?? []).map((child) => [child.id, child]));
  const laidOut = (result.edges ?? []) as ElkExtendedEdge[];
  removeDummies(laidOut, dummies);

  const placed: Placed[] = cells.map((cell) => {
    const child = positions.get(cell.id)!;
    const x = (child.x ?? 0) - (cell.whole ? cell.box.left : 0);
    const y = (child.y ?? 0) - (cell.whole ? cell.box.top : 0);
    return { part: cell.part, symbol: cell.symbol, x, y };
  });
  const wires: Wire[] = [];
  const junctions: ElkPoint[] = [];
  for (const edge of laidOut) {
    for (const section of edge.sections ?? []) {
      wires.push({ points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] });
    }
    junctions.push(...(edge.junctionPoints ?? []));
  }
  return { placed, wires, junctions: unique(junctions), bounds: bounds(placed, wires) };
}

/**
 * Wire one node. Pins below a symbol drive the node and pins above it ride it, so current flows
 * down the page; side pins are lateral. The cases follow netlistsvg's `buildElkGraph`.
 */
function route(connections: Connection[], edges: ElkExtendedEdge[], children: ElkNode[], dummies: string[]): void {
  const drivers = connections.filter((c) => c.side === 'bottom').map((c) => c.port);
  const riders = connections.filter((c) => c.side === 'top').map((c) => c.port);
  const laterals = connections.filter((c) => c.side === 'left' || c.side === 'right').map((c) => c.port);
  const add = (sources: string[], targets: string[]) => {
    for (const source of sources) {
      for (const target of targets) {
        edges.push({
          id: `e${edges.length}`,
          sources: [source],
          targets: [target],
          layoutOptions: { 'org.eclipse.elk.layered.priority.direction': '10' }
        });
      }
    }
  };
  const dummy = () => {
    const id = `d${dummies.length}`;
    dummies.push(id);
    children.push({
      id,
      width: 0,
      height: 0,
      layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_SIDE' },
      ports: [{ id: `${id}.p`, width: 0, height: 0 }]
    });
    return `${id}.p`;
  };
  if (drivers.length > 0 && riders.length > 0 && laterals.length === 0) {
    add(drivers, riders);
  } else if (drivers.length + riders.length > 0 && laterals.length > 0) {
    add(drivers, laterals);
    add(laterals, riders);
  } else if (drivers.length > 1 && riders.length === 0) {
    // Several drivers and nobody to drive: meet at a point below them.
    add(drivers, [dummy()]);
  } else if (riders.length > 1 && drivers.length === 0) {
    // Several riders and no driver: feed them from a point above them.
    add([dummy()], riders);
  } else if (laterals.length > 1) {
    add(laterals.slice(0, 1), laterals.slice(1));
  }
  // A node with one connection is an open end: nothing to wire.
}

/**
 * A dummy is where several wires of one node meet. After layout, move the meeting point from the
 * dummy to the nearest bend, so the wires join where they turn, and drop the junction dot where
 * fewer than three wires actually meet.
 */
function removeDummies(edges: ElkExtendedEdge[], dummies: string[]): void {
  for (const dummy of dummies) {
    const port = `${dummy}.p`;
    const group = edges.filter((edge) => edge.sources[0] === port || edge.targets[0] === port);
    const first = group[0];
    if (!first?.sections?.[0]) continue;
    const isSource = first.sources[0] === port;
    const location = isSource ? first.sections[0].startPoint : first.sections[0].endPoint;
    const candidates = group
      .map((edge) => {
        const bends = edge.sections?.[0]?.bendPoints ?? [];
        return isSource ? bends[0] : bends.at(-1);
      })
      .filter((point): point is ElkPoint => point !== undefined);
    if (candidates.length === 0) continue;
    const meet = candidates.reduce((best, point) =>
      distance(point, location) < distance(best, location) ? point : best);
    for (const edge of group) {
      const section = edge.sections![0]!;
      const bends = section.bendPoints ?? [];
      if (isSource) {
        if (bends[0] && same(bends[0], meet)) bends.shift();
        section.startPoint = meet;
      } else {
        if (bends.at(-1) && same(bends.at(-1)!, meet)) bends.pop();
        section.endPoint = meet;
      }
      section.bendPoints = bends;
    }
    const directions = new Set(group.map((edge) => {
      const section = edge.sections![0]!;
      const bends = section.bendPoints ?? [];
      const next = isSource ? (bends[0] ?? section.endPoint) : (bends.at(-1) ?? section.startPoint);
      return next.x > meet.x ? 'right' : next.x < meet.x ? 'left' : next.y > meet.y ? 'down' : 'up';
    }));
    if (directions.size < 3) {
      for (const edge of group) {
        edge.junctionPoints = (edge.junctionPoints ?? []).filter((point) => !same(point, meet));
      }
    }
  }
}

/** Room ELK must keep free around a symbol so that its labels overlap nothing. */
function margins(cell: Cell): string {
  const box = cell.box;
  const top = Math.max(0, -box.top);
  const left = Math.max(0, -box.left);
  const bottom = Math.max(0, box.bottom - cell.symbol.height);
  const right = Math.max(0, box.right - cell.symbol.width);
  return `[top=${top},left=${left},bottom=${bottom},right=${right}]`;
}

/** The extent of a symbol and its labels, relative to the symbol's origin. */
export function labelBox(symbol: SchematicSymbol, part: Part | undefined): Box {
  const box = { left: 0, top: 0, right: symbol.width, bottom: symbol.height };
  for (const label of symbol.labels) {
    const text = part === undefined ? '' : label.attribute === 'ref' ? part.ref : labelText(part.value);
    if (!text) continue;
    const width = text.length * CHAR_WIDTH;
    const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
    box.left = Math.min(box.left, left);
    box.right = Math.max(box.right, left + width);
    box.top = Math.min(box.top, label.y - TEXT_ASCENT);
    box.bottom = Math.max(box.bottom, label.y + TEXT_DESCENT);
  }
  return box;
}

function bounds(placed: Placed[], wires: Wire[]): Schematic['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of placed) {
    const box = labelBox(item.symbol, item.part);
    minX = Math.min(minX, item.x + box.left);
    minY = Math.min(minY, item.y + box.top);
    maxX = Math.max(maxX, item.x + box.right);
    maxY = Math.max(maxY, item.y + box.bottom);
  }
  for (const wire of wires) {
    for (const point of wire.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function distance(a: ElkPoint, b: ElkPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function same(a: ElkPoint, b: ElkPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function unique(points: ElkPoint[]): ElkPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
