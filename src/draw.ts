/**
 * Draw a laid-out schematic as SVG.
 *
 * Everything is built through the DOM and serialised by XMLSerializer, so the only text from the
 * document — part names, values, block titles and pin names — reaches the output as escaped text
 * content, never as markup or attribute values (ADR 0001). The output carries no ids, so any number
 * of schematics can share a preview.
 */
import { DOMImplementation, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { labelText, labelTextFor, type Placed, type Schematic } from './schematic';

const SVG = 'http://www.w3.org/2000/svg';
/** Room around the drawing, so strokes at the edge are not clipped. */
const PADDING = 8;

export function drawSchematic(schematic: Schematic, className = 'spice'): string {
  const document = new DOMImplementation().createDocument(SVG, 'svg', null);
  const root = document.documentElement!;
  const { x, y, width, height } = schematic.bounds;
  root.setAttribute('class', className);
  root.setAttribute('width', number(width + 2 * PADDING));
  root.setAttribute('height', number(height + 2 * PADDING));
  root.setAttribute('viewBox', [x - PADDING, y - PADDING, width + 2 * PADDING, height + 2 * PADDING].map(number).join(' '));

  for (const item of schematic.placed) {
    root.appendChild(item.symbol.template ? symbol(document, item) : block(document, item));
  }
  for (const wire of schematic.wires) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', wire.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${number(point.x)},${number(point.y)}`).join(' '));
    path.setAttribute('class', 'wire');
    root.appendChild(path);
  }
  for (const point of schematic.junctions) {
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('cx', number(point.x));
    dot.setAttribute('cy', number(point.y));
    dot.setAttribute('r', '2.5');
    dot.setAttribute('class', 'junction');
    root.appendChild(dot);
  }
  return new XMLSerializer().serializeToString(root);
}

/** A copy of the symbol's template, placed, with its labels filled in and its metadata removed. */
function symbol(document: Document, item: Placed): Element {
  const group = document.importNode(item.symbol.template!, true) as Element;
  strip(group);
  for (const text of Array.from(group.getElementsByTagName('text'))) {
    const attribute = text.getAttribute('s:attribute');
    text.removeAttribute('s:attribute');
    if (!attribute) continue;
    const entry = item.symbol.labels.find((label) => label.attribute === attribute);
    const value = entry ? labelTextFor(entry, item.part, item.label) : '';
    if (value) text.textContent = value;
    else text.parentNode!.removeChild(text);
  }
  group.setAttribute('transform', `translate(${number(item.x)},${number(item.y)})`);
  return group;
}

/** A box for a part with no symbol: its title inside, pin names by their pins. */
function block(document: Document, item: Placed): Element {
  const { symbol: shape, part } = item;
  const group = document.createElementNS(SVG, 'g');
  group.setAttribute('transform', `translate(${number(item.x)},${number(item.y)})`);
  const rect = document.createElementNS(SVG, 'rect');
  for (const [name, value] of [['x', '0'], ['y', '0'], ['width', number(shape.width)], ['height', number(shape.height)], ['class', 'symbol']]) {
    rect.setAttribute(name!, value!);
  }
  group.appendChild(rect);
  const text = (content: string, x: number, y: number, className: string) => {
    const node = document.createElementNS(SVG, 'text');
    node.setAttribute('x', number(x));
    node.setAttribute('y', number(y));
    node.setAttribute('class', className);
    node.textContent = content;
    group.appendChild(node);
  };
  for (const label of shape.labels) {
    const content = labelTextFor(label, part, item.label);
    if (!content) continue;
    const anchor = label.anchor === 'end' ? 'endlabel' : label.anchor === 'middle' ? 'nodelabel' : '';
    text(content, label.x, label.y, `${anchor}${label.attribute === 'title' ? ' title' : ''}`.trim());
  }
  for (const [name, pin] of shape.pins) {
    if (pin.side === 'left') text(name, pin.x + 4, pin.y + 3, 'pinlabel');
    else if (pin.side === 'right') text(name, pin.x - 4, pin.y + 3, 'pinlabel endlabel');
    else if (pin.side === 'top') text(name, pin.x, pin.y + 11, 'pinlabel nodelabel');
    else text(name, pin.x, pin.y - 4, 'pinlabel nodelabel');
  }
  return group;
}

/** Remove the symbol file's own markup: `s:` attributes, pin markers and the template's position. */
function strip(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('s:') && attribute.name !== 's:attribute') element.removeAttribute(attribute.name);
    if (attribute.name === 'transform' || attribute.name.startsWith('xmlns')) element.removeAttribute(attribute.name);
  }
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 8) {
      element.removeChild(child);
    } else if (child.nodeType === 1) {
      const node = child as Element;
      if (node.hasAttribute('s:pid') || node.tagName.startsWith('s:')) element.removeChild(node);
      else strip(node);
    }
  }
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}
