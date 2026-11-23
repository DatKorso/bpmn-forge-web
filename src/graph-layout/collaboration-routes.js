import { boundsOf, center, nearestFreeBox } from '../layout.js';
import { bottom, contains, right, validBox } from '../alignment-state.js';
import { acceptsRoute, cutsInterior, ROUTE_MARGIN, routeCost, routeFlow } from '../route-flows.js';
import { modelOf, typeIs } from './model-order.js';

const segments = (points) => points.slice(1).map((point, index) => [points[index], point]);
const middle = (box) => ({ x: center(box, 'x'), y: center(box, 'y') });
const pointIn = (point, box) => point.x >= box.x && point.x <= right(box) &&
  point.y >= box.y && point.y <= bottom(box);
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const structuralFrame = (figure) => figure.kind === 'pool' || figure.expanded;

function parents(figure) {
  const result = [];
  for (let parent = figure.parent; parent; parent = parent.parent) {
    if (structuralFrame(parent)) result.push(parent);
  }
  return result;
}

function headerBox(figure, box) {
  return figure.horizontal === false
    ? { ...box, height: Math.min(figure.header, box.height) }
    : { ...box, width: Math.min(figure.header, box.width) };
}

function withClearance(box) {
  return { x: box.x - ROUTE_MARGIN, y: box.y - ROUTE_MARGIN,
    width: box.width + ROUTE_MARGIN * 2, height: box.height + ROUTE_MARGIN * 2 };
}

function dockBox(figure, box) {
  // bpmn-js draws events as circles using width as the diameter and the DI midpoint as center.
  if (typeIs(modelOf(figure), 'bpmn:Event')) {
    return { ...box, y: center(box, 'y') - box.width / 2, height: box.width };
  }
  return box;
}

function ports(figure, box, other, inward) {
  const isParticipant = figure.kind === 'pool';
  const isActivity = typeIs(modelOf(figure), 'bpmn:Activity');
  if (!isParticipant && !isActivity) return { inward };

  // The flat portion of a rounded activity side starts after the 10 px corner radius.
  const inset = isActivity ? 10 : ROUTE_MARGIN;
  const mid = middle(box);
  const projection = middle(other);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const projected = {
    x: clamp(projection.x, box.x + inset, right(box) - inset),
    y: clamp(projection.y, box.y + inset, bottom(box) - inset)
  };
  const offset = 2 * ROUTE_MARGIN;
  return {
    inward, inset,
    projections: [
      projected,
      { x: mid.x - offset, y: mid.y - offset },
      { x: mid.x + offset, y: mid.y + offset }
    ]
  };
}

function passageBetween(exiting, entering) {
  const base = entering.length + 1;
  // Exits progress inside-out and entrances outside-in. Remember a crossed
  // boundary even if a later segment approaches it along the frame's edge.
  const passage = (phase, a, b) => {
    let left = Math.floor(phase / base);
    let entered = phase % base;
    for (const [index, frame] of exiting.entries()) {
      if (cutsInterior(a, b, frame) && (index < left || !pointIn(a, frame))) return -1;
      if (!pointIn(b, frame)) left = Math.max(left, index + 1);
    }
    for (const [index, frame] of entering.entries()) {
      const inside = pointIn(b, frame);
      if (index < entered && !inside) return -1;
      if (cutsInterior(a, b, frame)) {
        if (!inside) return -1;
        entered = Math.max(entered, index + 1);
      }
    }
    return left * base + entered;
  };
  return { passage, phaseCount: (exiting.length + 1) * base, frames: [...exiting, ...entering] };
}

function routingGeometry(figures, boxes, edge, fixedLabels, area, chains) {
  const sourceChain = [...chains.get(edge.source)];
  const targetChain = [...chains.get(edge.target)];
  const sourceInward = targetChain.includes(edge.source);
  const targetInward = sourceChain.includes(edge.target);
  if (sourceInward) sourceChain.unshift(edge.source);
  if (targetInward) targetChain.unshift(edge.target);

  const shared = sourceChain.find((frame) => targetChain.includes(frame));
  const enclosing = new Set([...sourceChain, ...targetChain]);
  const exiting = sourceChain.filter((frame) => !targetChain.includes(frame)).map((frame) => boxes.get(frame));
  const entering = targetChain.filter((frame) => !sourceChain.includes(frame)).reverse().map((frame) => boxes.get(frame));
  const source = dockBox(edge.source, boxes.get(edge.source));
  const target = dockBox(edge.target, boxes.get(edge.target));
  const limit = shared ? boxes.get(shared) : area;
  if (!exiting.every((frame) => contains(frame, source)) || !entering.every((frame) => contains(frame, target)) ||
      !contains(limit, source) || !contains(limit, target)) return null;

  const bounds = { left: limit.x, top: limit.y, right: right(limit), bottom: bottom(limit) };
  const obstacles = fixedLabels.map(withClearance);
  for (const figure of figures) {
    const box = boxes.get(figure);
    if (figure === edge.source) {
      if (!sourceInward) obstacles.push(source);
      else if (figure.header) obstacles.push(withClearance(headerBox(figure, box)));
    } else if (figure === edge.target) {
      if (!targetInward) obstacles.push(target);
      else if (figure.header) obstacles.push(withClearance(headerBox(figure, box)));
    } else if (chains.get(figure).some((frame) => !enclosing.has(frame))) {
      // A blocked enclosing frame already prevents reaching its contents.
      // External labels remain independent obstacles.
      continue;
    } else if (enclosing.has(figure) || figure.kind === 'lane') {
      if (figure.header) obstacles.push(withClearance(headerBox(figure, box)));
    } else {
      obstacles.push(withClearance(dockBox(figure, box)));
    }
  }

  return {
    source, target, bounds, obstacles, ...passageBetween(exiting, entering),
    sourcePorts: ports(edge.source, source, target, sourceInward),
    targetPorts: ports(edge.target, target, source, targetInward)
  };
}

function findPath(geometry, lines, occupied, stacking) {
  const { bounds: world, source, target, obstacles } = geometry;
  const route = (bounds) => routeFlow(geometry, bounds, obstacles.filter((box) =>
    box.x < bounds.right && right(box) > bounds.left && box.y < bounds.bottom && bottom(box) > bounds.top),
  occupied, { preventReversals: true });
  if (!stacking) return route(world);

  // First consider the ordinary corridor between the endpoint pools. Keep
  // the full search available if obstacles or line interactions need a bypass.
  const area = boundsOf(stacking.frames);
  const padding = ROUTE_MARGIN * 4;
  const across = stacking.vertical
    ? { ...world, left: Math.max(world.left, area.x - padding), right: Math.min(world.right, right(area) + padding) }
    : { ...world, top: Math.max(world.top, area.y - padding), bottom: Math.min(world.bottom, bottom(area) + padding) };
  const endpointBounds = boundsOf([source, target]);
  const alongPadding = ROUTE_MARGIN * 16;
  const nearby = stacking.vertical
    ? { ...across, top: Math.max(across.top, endpointBounds.y - alongPadding),
      bottom: Math.min(across.bottom, bottom(endpointBounds) + alongPadding) }
    : { ...across, left: Math.max(across.left, endpointBounds.x - alongPadding),
      right: Math.min(across.right, right(endpointBounds) + alongPadding) };
  const candidate = route(nearby);
  if (candidate && routeCost([candidate], lines).slice(0, 2).every((value) => value === 0)) return candidate;
  return route(across) ?? route(world);
}

function movesAway(anchor, next, box, inward) {
  const sign = inward ? -1 : 1;
  return anchor.x === next.x && (
    (anchor.y === box.y && sign * (anchor.y - next.y) > 0) ||
    (anchor.y === bottom(box) && sign * (next.y - anchor.y) > 0)
  ) || anchor.y === next.y && (
    (anchor.x === box.x && sign * (anchor.x - next.x) > 0) ||
    (anchor.x === right(box) && sign * (next.x - anchor.x) > 0)
  );
}

function routeIsValid(path, geometry) {
  if (!acceptsRoute(path, geometry, geometry.bounds, geometry.obstacles) ||
      !movesAway(path[0], path[1], geometry.source, geometry.sourcePorts.inward) ||
      !movesAway(path.at(-1), path.at(-2), geometry.target, geometry.targetPorts.inward)) return false;
  let phase = 0;
  for (const [a, b] of segments(path)) {
    phase = geometry.passage(phase, a, b);
    if (phase < 0 || distance(a, b) === 0) return false;
  }
  return true;
}

function lineBox(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function labelObstacles(figures, boxes) {
  const obstacles = [];
  for (const figure of figures) {
    const box = boxes.get(figure);
    if (structuralFrame(figure) || figure.kind === 'lane') {
      obstacles.push(
        { ...box, width: 0 }, { ...box, x: right(box), width: 0 },
        { ...box, height: 0 }, { ...box, y: bottom(box), height: 0 }
      );
      if (figure.header) obstacles.push(headerBox(figure, box));
    } else obstacles.push(dockBox(figure, box));
  }
  return obstacles;
}

function placeLabel(size, path, obstacles, diagonals) {
  const { width, height } = size;
  if (!validBox({ x: 0, y: 0, width, height }) || width <= 0 || height <= 0) return null;
  const length = segments(path).reduce((total, [a, b]) => total + distance(a, b), 0);
  let traveled = 0;
  const choices = segments(path).map(([a, b]) => {
    const span = distance(a, b);
    const along = Math.max(0, Math.min(span, length / 2 - traveled));
    const cost = Math.abs(length / 2 - traveled - along);
    const point = { x: a.x + (b.x - a.x) * along / span, y: a.y + (b.y - a.y) * along / span };
    traveled += span;
    return { a, b, point, cost };
  }).sort((a, b) => a.cost - b.cost);

  for (const { a, b, point } of choices) {
    const horizontal = a.y === b.y;
    const gap = ROUTE_MARGIN;
    const before = horizontal ? point.y - height - gap : point.x - width - gap;
    const after = horizontal ? point.y + gap : point.x + gap;
    const preferred = horizontal
      ? { x: point.x - width / 2, y: before, width, height }
      : { x: after, y: point.y - height / 2, width, height };
    const limits = horizontal
      ? { x: Math.min(a.x, b.x) - width / 2, y: before - gap * 2,
        width: Math.abs(a.x - b.x) + width, height: after + height + gap * 2 - (before - gap * 2) }
      : { x: before - gap * 2, y: Math.min(a.y, b.y) - height / 2,
        width: after + width + gap * 2 - (before - gap * 2), height: Math.abs(a.y - b.y) + height };
    const box = nearestFreeBox(preferred, obstacles, limits, gap, diagonals);
    if (box) return box;
  }
  return null;
}

export function finishCollaborationRoutes(diagram, collaboration, state, fixedLabels) {
  const { boxes } = state;
  const { messages, auxiliary, owner } = collaboration;
  const associations = auxiliary.filter(({ type }) => type === 'bpmn:Association');
  const routes = new Map();
  const labels = new Map();
  if (!messages.length && !associations.length) return { routes, labels };
  const orderedFigures = diagram.figures.toSorted((a, b) => collaboration.order.get(a) - collaboration.order.get(b));
  const chains = new Map(orderedFigures.map((figure) => [figure, parents(figure)]));
  const area = boundsOf([...boxes.values(), ...fixedLabels]);
  const padding = ROUTE_MARGIN * 4;
  const routingArea = { x: area.x - padding, y: area.y - padding,
    width: area.width + padding * 2, height: area.height + padding * 2 };
  const lines = [...state.routes.values()];
  const occupied = lines.flatMap(segments);
  const reservedLabels = [...fixedLabels];
  const figuresForLabels = labelObstacles(orderedFigures, boxes);
  const separation = ({ source, target }) => {
    const a = boxes.get(source);
    const b = boxes.get(target);
    return Math.max(0, a.x - right(b), b.x - right(a)) + Math.max(0, a.y - bottom(b), b.y - bottom(a));
  };
  const ordered = [...messages.toSorted((a, b) => separation(a) - separation(b)), ...associations];
  for (const edge of ordered) {
    const message = edge.type === 'bpmn:MessageFlow';
    const fail = (reason) => ({
      reason, scope: message ? diagram.root : owner.get(edge.source) ?? diagram.root, elementId: edge.id
    });
    const geometry = routingGeometry(orderedFigures, boxes, edge, reservedLabels, routingArea, chains);
    const sourcePool = owner.get(edge.source);
    const targetPool = owner.get(edge.target);
    const stacking = message && sourcePool && targetPool && {
      vertical: sourcePool.horizontal === false, frames: [boxes.get(sourcePool), boxes.get(targetPool)]
    };
    const route = geometry && findPath(geometry, lines, occupied, stacking);
    if (!route || !routeIsValid(route, geometry)) return fail(message ? 'graphMessageRouting' : 'graphAssociationRouting');
    lines.push(route);
    occupied.push(...segments(route));
    const sizes = edge.labels ?? edge.projectLabels?.() ?? [];
    if (sizes.length) {
      const labelBoxes = [...figuresForLabels, ...reservedLabels];
      const diagonals = [];
      for (const [a, b] of occupied) {
        if (a.x !== b.x && a.y !== b.y) diagonals.push([a, b]);
        else labelBoxes.push(lineBox(a, b));
      }
      const placed = [];
      for (const size of sizes) {
        const box = placeLabel(size, route, labelBoxes, diagonals);
        if (!box) return fail('graphConnectionLabel');
        placed.push(box);
        labelBoxes.push(box);
        reservedLabels.push(box);
      }
      labels.set(edge, placed);
    }
    routes.set(edge, route);
  }
  return { routes, labels };
}
