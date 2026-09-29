import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { parseNetlist, GROUND, type Netlist } from '../src/netlist';
import { blockSymbol, labelBox, layoutSchematic, loadSymbols, labelText, MAX_LABEL, type Schematic } from '../src/schematic';

const symbols = loadSymbols(readFileSync('src/skin/symbols.svg', 'utf8'));
const elk = new ELK();
const layout = (graph: Parameters<typeof elk.layout>[0]) => elk.layout(graph);

function netlist(source: string): Netlist {
  const result = parseNetlist(source);
  if (!result.ok) assert.fail(result.message);
  return result.netlist;
}

type Point = { x: number; y: number };
const key = (p: Point) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;

/** Whether `p` lies on the axis-aligned segment from `a` to `b`. */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const eps = 0.01;
  if (Math.abs(a.x - b.x) < eps) return Math.abs(p.x - a.x) < eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
  if (Math.abs(a.y - b.y) < eps) return Math.abs(p.y - a.y) < eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps;
  return false;
}

/**
 * Group every drawn pin by what the wires actually connect it to: two pins are in one group when a
 * path of wires joins them, where wires join only at an end of one lying on the other.
 */
function drawnConnectivity(schematic: Schematic): Map<string, string> {
  const segments = schematic.wires.flatMap((wire) => wire.points.slice(1).map((point, i) => [wire.points[i]!, point] as const));
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  segments.forEach(([a, b], i) => {
    segments.forEach(([c, d], j) => {
      if (i < j && (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b))) parent[find(i)] = find(j);
    });
  });
  const group = new Map<string, string>();
  schematic.placed.forEach((item, index) => {
    for (const [name, pin] of item.symbol.pins) {
      const at = { x: item.x + pin.x, y: item.y + pin.y };
      const segment = segments.findIndex(([a, b]) => onSegment(at, a, b));
      group.set(`${item.part?.ref ?? `ground${index}`}.${name}`, segment === -1 ? `open:${key(at)}` : `wire:${find(segment)}`);
    }
  });
  return group;
}

/** Assert that the drawing connects exactly the pins the netlist connects. */
function assertFaithful(schematic: Schematic): void {
  const drawn = drawnConnectivity(schematic);
  const byNode = new Map<string, string[]>();
  for (const item of schematic.placed) {
    for (const pin of item.part?.pins ?? []) {
      if (!item.symbol.pins.has(pin.name) || pin.node === GROUND) continue;
      const list = byNode.get(pin.node) ?? [];
      list.push(`${item.part!.ref}.${pin.name}`);
      byNode.set(pin.node, list);
    }
  }
  const groups = new Map<string, string>();
  for (const [node, pins] of byNode) {
    if (pins.length < 2) continue;
    const found = new Set(pins.map((pin) => drawn.get(pin)));
    assert.equal(found.size, 1, `node ${node}: pins ${pins.join(', ')} are drawn in ${found.size} separate groups`);
    const [only] = found;
    assert.ok(only!.startsWith('wire:'), `node ${node} has no wire`);
    assert.equal(groups.get(only!), undefined, `nodes ${groups.get(only!)} and ${node} are drawn connected`);
    groups.set(only!, node);
  }
  // Every connection to ground ends at a ground symbol of its own.
  for (const item of schematic.placed) {
    for (const pin of item.part?.pins ?? []) {
      if (pin.node !== GROUND || !item.symbol.pins.has(pin.name)) continue;
      const group = drawn.get(`${item.part!.ref}.${pin.name}`)!;
      const grounds = [...drawn].filter(([name, g]) => g === group && name.startsWith('ground'));
      assert.equal(grounds.length, 1, `${item.part!.ref}.${pin.name} reaches ${grounds.length} ground symbols`);
      assert.ok(![...drawn].some(([name, g]) => g === group && !name.startsWith('ground') && name !== `${item.part!.ref}.${pin.name}`),
        `${item.part!.ref}.${pin.name} shares its ground with another pin`);
    }
  }
}

const circuits: Record<string, string> = {
  'RC low-pass with an emitter follower': 'V1 in 0 AC 1\nR1 in mid 10k\nC1 mid 0 100n\nQ1 vcc mid out 2N3904\nR2 out 0 1k\nVCC vcc 0 5\n.model 2N3904 NPN',
  'CMOS inverter': 'VDD vdd 0 1.8\nVIN in 0 1.8\nM1 out in vdd vdd pch\nM2 out in 0 0 nch\nCL out 0 10f\n.model nch NMOS\n.model pch PMOS',
  'inverting amplifier with a subcircuit': 'V1 in 0 1\nR1 in inv 10k\nR2 inv out 100k\nX1 0 inv vcc vee out opamp\nVCC vcc 0 15\nVEE 0 vee 15\n.subckt opamp inp inn vp vn out\n.ends',
  'bridge rectifier': 'V1 a b SIN(0 10 50)\nD1 a p D\nD2 b p D\nD3 n a D\nD4 n b D\nRL p n 1k\nC1 p n 100u\n.model D D',
  'differential pair': 'VCC vcc 0 12\nVEE vee 0 -12\nQ1 c1 in1 e Q\nQ2 c2 in2 e Q\nRC1 vcc c1 10k\nRC2 vcc c2 10k\nIE e vee 1m\nV1 in1 0 0\nV2 in2 0 0\n.model Q NPN',
  'MOSFET with a separate body': 'M1 d g s b nch\nVD d 0 1\nVG g 0 1\nVS s 0 0\nVB b 0 -1\n.model nch NMOS',
  'LC tank with a dependent source': 'I1 0 t 1m\nL1 t 0 1u\nC1 t 0 1n\nE1 o 0 t 0 10\nRL o 0 1k'
};

for (const [name, source] of Object.entries(circuits)) {
  test(`${name}: every node drawn connects exactly its pins`, async () => {
    assertFaithful(await layoutSchematic(netlist(source), symbols, layout));
  });
}

test('each connection to ground gets its own ground symbol', async () => {
  const schematic = await layoutSchematic(netlist('V1 a 0 1\nR1 a 0 1k\nC1 a gnd 1n'), symbols, layout);
  assert.equal(schematic.placed.filter((item) => item.symbol.type === 'gnd').length, 3);
});

test('a MOSFET whose body is its source uses the three-pin symbol; otherwise all four pins are drawn', async () => {
  const tied = await layoutSchematic(netlist('M1 d g s s nch\nM2 d g s b pch\n.model nch NMOS\n.model pch PMOS'), symbols, layout);
  assert.deepEqual(tied.placed.map((item) => item.symbol.type), ['nmos3', 'pmos']);
});

test('the bounds enclose every symbol, label and wire', async () => {
  const schematic = await layoutSchematic(netlist(circuits['inverting amplifier with a subcircuit']!), symbols, layout);
  const { x, y, width, height } = schematic.bounds;
  for (const item of schematic.placed) {
    const box = labelBox(item.symbol, item.part);
    assert.ok(item.x + box.left >= x - 0.01 && item.x + box.right <= x + width + 0.01, item.part?.ref);
    assert.ok(item.y + box.top >= y - 0.01 && item.y + box.bottom <= y + height + 0.01, item.part?.ref);
  }
  for (const point of schematic.wires.flatMap((wire) => wire.points)) {
    assert.ok(point.x >= x - 0.01 && point.x <= x + width + 0.01 && point.y >= y - 0.01 && point.y <= y + height + 0.01);
  }
});

test('no two symbols overlap, labels included', async () => {
  for (const source of Object.values(circuits)) {
    const schematic = await layoutSchematic(netlist(source), symbols, layout);
    const boxes = schematic.placed.map((item) => {
      const box = labelBox(item.symbol, item.part);
      return { name: item.part?.ref ?? item.symbol.type, left: item.x + box.left, right: item.x + box.right, top: item.y + box.top, bottom: item.y + box.bottom };
    });
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
      }
    }
  }
});

test('a block is wide enough for its title, pin names, name and value, with pins split left and right', () => {
  const [part] = netlist('X1 in out vcc gnd a_rather_long_subcircuit').parts;
  const block = blockSymbol(part!);
  assert.deepEqual([...block.pins].map(([name, pin]) => [name, pin.side]), [['1', 'left'], ['2', 'left'], ['3', 'right'], ['4', 'right']]);
  assert.ok(block.width >= labelText('a_rather_long_subcircuit').length * 6 + 12);
  const box = labelBox(block, part);
  assert.ok(box.left >= 0 && box.right <= block.width, 'labels stay within the block\'s width');
});

test('long labels are cut with an ellipsis', () => {
  assert.equal(labelText('x'.repeat(MAX_LABEL)), 'x'.repeat(MAX_LABEL));
  assert.equal(labelText('x'.repeat(MAX_LABEL + 1)), `${'x'.repeat(MAX_LABEL - 1)}…`);
});

test('the symbol file has every symbol the netlist can ask for, and loading refuses one without them', () => {
  for (const type of ['resistor', 'capacitor', 'inductor', 'diode', 'vsource', 'isource', 'npn', 'pnp', 'nmos', 'pmos', 'nmos3', 'pmos3', 'gnd']) {
    assert.ok(symbols.has(type), type);
  }
  assert.throws(() => loadSymbols('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="x"><g s:type="gnd"/></svg>'), /has no resistor symbol/);
  // Emitter on top for a PNP, where its arrow is drawn; source on top for a PMOS.
  assert.equal(symbols.get('pnp')!.pins.get('E')!.side, 'top');
  assert.equal(symbols.get('pmos3')!.pins.get('S')!.side, 'top');
});

test('every pin in the symbol file sits on the edge of its symbol it faces, so wires meet it exactly', () => {
  for (const [type, symbol] of symbols) {
    for (const [name, pin] of symbol.pins) {
      const onEdge = pin.side === 'top' ? pin.y === 0
        : pin.side === 'bottom' ? pin.y === symbol.height
          : pin.side === 'left' ? pin.x === 0
            : pin.x === symbol.width;
      assert.ok(onEdge, `${type}.${name} at ${pin.x},${pin.y} is not on its ${pin.side} edge`);
    }
  }
});
