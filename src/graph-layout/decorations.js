import { intersects, nearestFreeBox, translate } from '../layout.js';
import { validBox } from '../alignment-state.js';
import { isAnnotation, isFrame } from '../annotation-layout.js';
import { placeGatewayLabel } from '../gateway-label-layout.js';
import { cutsInterior, expandObstacle, ROUTE_MARGIN } from '../route-flows.js';
import { rerouteForLabel } from './arrange.js';
import { modelOf, typeIs } from './model-order.js';
import { routingBox } from './support.js';

function ancestry(figure) {
  const frames = [];
  for (let parent = figure.parent; parent; parent = parent.parent) {
    if (isFrame(parent)) frames.push(parent);
  }
  return frames;
}

function headerBox(figure, box) {
  return figure.horizontal === false ? { ...box, height: figure.header } : { ...box, width: figure.header };
}

export function fixedLabels(figures, state) {
  const labels = new Map();
  for (const figure of figures) {
    const { x, y } = state.boxes.get(figure);
    const delta = { x: x - figure.box.x, y: y - figure.box.y };
    const projected = (figure.labels ?? []).map((label) => translate(label, delta));
    if (!projected.every(validBox)) return { reason: 'bounds', scope: figure.scope, elementId: figure.id };
    labels.set(figure, projected);
  }
  const projectedLabels = () => [...state.routes].flatMap(([edge, path]) =>
    edge.projectLabels?.(path) ?? edge.labels ?? []);
  const paths = () => [...state.routes.values()];
  const crosses = (label) => {
    const clearance = expandObstacle(label, ROUTE_MARGIN);
    return paths().some((path) => path.slice(1).some((point, index) => cutsInterior(path[index], point, clearance)));
  };
  let rerouted = false;
  let sequenceLabels = projectedLabels();
  if (!sequenceLabels.every(validBox)) {
    const [edge] = [...state.routes].find(([edge, path]) =>
      !(edge.projectLabels?.(path) ?? edge.labels ?? []).every(validBox));
    return { reason: 'graphConnectionLabel', scope: edge.source.scope, elementId: edge.id };
  }
  const gateways = figures.filter((figure) => typeIs(modelOf(figure), 'bpmn:Gateway') && labels.get(figure).length);
  const labelFailure = (gateway) => ({ reason: 'graphGatewayLabel', scope: gateway.scope, elementId: gateway.id });
  for (const gateway of gateways) {
    const containers = new Set(ancestry(gateway));
    const obstacles = figures.filter((figure) => figure !== gateway).flatMap((figure) => {
      const box = routingBox(figure, state.boxes.get(figure));
      if (!isFrame(figure) || (figure.kind !== 'lane' && !containers.has(figure))) return [box];
      return figure.header ? [headerBox(figure, box)] : [];
    });
    const neighbors = [...labels].filter(([figure]) => figure !== gateway).flatMap(([, boxes]) => boxes);
    const gatewayBox = state.boxes.get(gateway);
    const limits = [...containers].map((frame) => state.boxes.get(frame));
    for (let figure = gateway; figure; figure = figure.parent) {
      const band = state.labelBands.get(figure);
      if (band) limits.push(translate(band, state.boxes.get(figure)));
    }
    const placed = [];
    for (const label of labels.get(gateway)) {
      const occupied = [...obstacles, ...neighbors, ...placed, ...sequenceLabels];
      let next = placeGatewayLabel(label, gatewayBox, occupied, paths(), limits, true, 120);
      if (!next) {
        const candidate = placeGatewayLabel(label, gatewayBox, occupied, [], limits, true, 120);
        if (candidate && rerouteForLabel(state, gateway.scope, candidate, [...neighbors, ...placed])) {
          rerouted = true;
          sequenceLabels = projectedLabels();
          if (sequenceLabels.every((box) => validBox(box) && !intersects(box, candidate)) && !crosses(candidate)) {
            next = candidate;
          }
        }
      }
      if (!next || !validBox(next)) return labelFailure(gateway);
      placed.push(next);
    }
    labels.set(gateway, placed);
  }
  if (rerouted) {
    const conflict = gateways.find((gateway) => labels.get(gateway).some((label) =>
      crosses(label) || sequenceLabels.some((box) => intersects(label, box))));
    if (conflict) return labelFailure(conflict);
  }
  return { labels, obstacles: [...sequenceLabels, ...[...labels.values()].flat()] };
}

export function placeNotes(diagram, collaboration, state, figures, labels) {
  const { owner, order, auxiliary } = collaboration;
  const notes = figures.filter(isAnnotation);
  const solids = figures.filter((figure) => !isAnnotation(figure));
  const anchors = new Map(notes.map((note) => [note, new Set()]));
  for (const { type, source, target } of auxiliary) {
    if (type !== 'bpmn:Association') continue;
    if (anchors.has(source) && !anchors.has(target)) anchors.get(source).add(target);
    if (anchors.has(target) && !anchors.has(source)) anchors.get(target).add(source);
  }
  const lines = [...state.routes.values()].flatMap((path) => path.slice(1).map((b, index) => {
    const a = path[index];
    return expandObstacle({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, ROUTE_MARGIN);
  }));
  const placed = [];
  for (const note of notes) {
    const containers = ancestry(note);
    const frame = containers[0];
    const pool = owner.get(note);
    const priority = (figure) => {
      if (figure.scope === note.scope) return 0;
      return pool && owner.get(figure) === pool ? 1 : 2;
    };
    const anchor = [...anchors.get(note)].sort((a, b) =>
      priority(a) - priority(b) || order.get(a) - order.get(b))[0] ?? frame;
    const bounds = anchor && state.boxes.get(anchor);
    const preferred = bounds ? translate(note.box, { x: bounds.x - anchor.box.x, y: bounds.y - anchor.box.y }) : note.box;
    const obstacles = solids.flatMap((figure) => {
      const box = routingBox(figure, state.boxes.get(figure));
      if (!(containers.includes(figure) || (figure.kind === 'lane' && figure.scope === (frame ?? diagram.root)))) {
        return [box];
      }
      return figure.header ? [headerBox(figure, box)] : [];
    });
    const limit = frame && state.boxes.get(frame);
    const next = nearestFreeBox(preferred, [...obstacles, ...labels, ...lines, ...placed], limit, 0);
    if (!next || !validBox(next)) return { reason: 'annotations', scope: frame ?? diagram.root, elementId: note.id };
    state.boxes.set(note, next);
    placed.push(next);
  }
}
