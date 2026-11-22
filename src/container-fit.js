import { boundsOf, ceilGrid, center, intersects, translate } from './layout.js';
import { ROUTE_MARGIN } from './route-flows.js';
import { isAnnotation } from './annotation-layout.js';
import { byId, right, bottom, transpose, descendantOf, contains, validBox, moveTree, attachments } from './alignment-state.js';

export const CONTAINER_INSET = 40;

// Coordinates are in the direction of the process, with the header on the left.
export function usableArea(container, frame, forNodes = true) {
  const inset = forNodes && container.kind !== 'lane' ? CONTAINER_INSET : 0;
  const trailing = forNodes ? Math.max(inset, ROUTE_MARGIN) : 0;
  const header = container.header ?? 0;
  return { x: frame.x + header + inset, y: frame.y + inset,
    width: frame.width - header - inset - trailing, height: frame.height - inset - trailing };
}

export function geometryWithLabels(figure, box) {
  const delta = { x: box.x - figure.box.x, y: box.y - figure.box.y };
  return [box, ...(figure.labels ?? []).map((label) => translate(label, delta))];
}

export function containsCenter(rect, box) {
  const x = center(box, 'x');
  const y = center(box, 'y');
  return x > rect.x && x < right(rect) && y > rect.y && y < bottom(rect);
}

export function resize(state, diagram, figure, next) {
  const old = state.boxes.get(figure);
  state.boxes.set(figure, next);

  for (const attachment of attachments(diagram, figure)) {
    const box = state.boxes.get(attachment);
    const x = center(box, 'x');
    const y = center(box, 'y');
    const distances = [Math.abs(x - old.x), Math.abs(y - old.y), Math.abs(x - right(old)), Math.abs(y - bottom(old))];
    const side = distances.indexOf(Math.min(...distances));
    const cross = ROUTE_MARGIN;
    const clamp = (value, start, end) => Math.max(start + cross, Math.min(value, end - cross)) - value;
    moveTree(state, diagram, attachment, {
      x: side === 2 ? right(next) - right(old) : side === 1 || side === 3 ? clamp(x, next.x, right(next)) : 0,
      y: side === 3 ? bottom(next) - bottom(old) : side === 0 || side === 2 ? clamp(y, next.y, bottom(next)) : 0
    });
  }
}

export function makeRoom(state, diagram, figure, old, gaps) {
  const current = state.boxes.get(figure);
  const lanes = (diagram.scopes.get(figure.scope) ?? []).filter((lane) => lane.kind === 'lane');
  const siblingLane = (other) => memberLane(other, lanes, state.boxes);
  const siblings = (diagram.children.get(figure.parent) ?? []).filter((other) =>
    other !== figure && !['lane', 'group', 'pool'].includes(other.kind) && !other.host && !isAnnotation(other) &&
    siblingLane(other) === (figure.lane ?? null));
  const expanded = { ...old };

  for (const [axis, span] of [['x', 'width'], ['y', 'height']]) {
    if (current[span] === old[span]) continue;
    const before = { ...expanded };
    expanded[span] = current[span];
    const order = siblings.sort((a, b) => state.boxes.get(a)[axis] - state.boxes.get(b)[axis] || byId(a, b));
    const moved = [];
    for (const sibling of order) {
      const box = state.boxes.get(sibling);
      let edge = box[axis];
      if (intersects(expanded, box) &&
          (!intersects(before, box) || box[axis] >= before[axis] + before[span])) {
        edge = expanded[axis] + expanded[span] + gaps[axis];
      }
      for (const [previous, previousOld] of moved) {
        const next = state.boxes.get(previous);
        if (intersects(next, box) && !intersects(previousOld, box)) {
          edge = Math.max(edge, next[axis] + next[span] + gaps[axis]);
        }
      }
      if (edge === box[axis]) continue;
      moved.push([sibling, box]);
      moveTree(state, diagram, sibling, { x: 0, y: 0, [axis]: ceilGrid(edge - box[axis]) });
    }
  }
}

export function memberLane(figure, lanes, boxes) {
  if (figure.lane) return figure.lane;
  if (figure.kind === 'node' || figure.host) return null;
  const box = boxes.get(figure);
  return lanes.find((lane) => contains(boxes.get(lane), box)) ?? null;
}

export function fitLanes(state, diagram, scope, members, lanes, original, frame, toLocal, toWorld) {
  const bounds = (figure) => toLocal(state.boxes.get(figure));
  const boxes = members.filter((figure) => !figure.host).map((figure) =>
    [figure, memberLane(figure, lanes, original.boxes)]);
  const byLane = Map.groupBy(boxes, ([, lane]) => lane);
  const children = Map.groupBy(lanes, (lane) => lane.parent);
  const unitArea = (figure) => boundsOf([figure, ...attachments(diagram, figure)].map(bounds));
  const scopeArea = frame && usableArea(scope, frame);
  const scopeLeft = scopeArea?.x ?? -Infinity;
  const scopeRight = scopeArea ? right(scopeArea) : Infinity;
  const scopeTop = scopeArea?.y ?? -Infinity;
  const scopeBottom = scopeArea ? bottom(scopeArea) : Infinity;
  const leftEdge = (lane) => lane ? Math.max(scopeLeft, usableArea(lane, bounds(lane)).x) : scopeLeft;
  const rightEdge = (lane) => lane ? Math.min(scopeRight, right(usableArea(lane, bounds(lane)))) : scopeRight;
  let xGrowth = 0;

  // Fit lanes to a common longitudinal envelope so cross-lane columns stay aligned.
  const nodes = boxes.filter(([figure]) => figure.kind === 'node');
  const minOffset = nodes.reduce((offset, [figure, lane]) =>
    Math.max(offset, ceilGrid(leftEdge(lane) - unitArea(figure).x)), -Infinity);
  const maxOffset = nodes.reduce((offset, [figure, lane]) =>
    Math.min(offset, -ceilGrid(right(unitArea(figure)) - rightEdge(lane))), Infinity);
  const dx = Math.max(minOffset, Math.min(0, maxOffset));

  for (const [figure, lane] of nodes) {
    if (dx) moveTree(state, diagram, figure, toWorld({ x: dx, y: 0 }));
    xGrowth = Math.max(xGrowth, ceilGrid(right(unitArea(figure)) - rightEdge(lane)));
  }

  function fitRows(parent, shift) {
    let growth = 0;
    const ordered = (children.get(parent) ?? []).sort((a, b) => bounds(a).y - bounds(b).y || byId(a, b));
    for (const lane of ordered) {
      const rect = bounds(lane);
      const offset = shift + growth;
      const occupants = byLane.get(lane) ?? [];
      const content = occupants.filter(([figure]) => figure.kind === 'node').map(([figure]) => unitArea(figure));
      let dy = 0;
      let extra = fitRows(lane, offset);
      if (content.length) {
        const area = boundsOf(content);
        const top = Math.max(rect.y, scopeTop - offset);
        const end = bottom(usableArea(lane, rect));
        dy = Math.max(ceilGrid(top - area.y), Math.min(0, -ceilGrid(bottom(area) - end)));
        extra = Math.max(extra, ceilGrid(bottom(area) + dy - end));
      }

      for (const [figure] of occupants) {
        const amount = offset + (figure.kind === 'node' ? dy : 0);
        if (amount) moveTree(state, diagram, figure, toWorld({ x: 0, y: amount }));
      }
      state.boxes.set(lane, toLocal({ ...rect, y: rect.y + offset, height: rect.height + extra, width: rect.width + xGrowth }));
      growth += extra;
    }
    return growth;
  }

  let yGrowth = fitRows(scope, 0);
  const free = (byLane.get(null) ?? []).filter(([figure]) => figure.kind === 'node');
  if (frame && free.length) {
    const area = boundsOf(free.map(([figure]) => unitArea(figure)));
    const dy = Math.max(ceilGrid(scopeTop - area.y), Math.min(0, -ceilGrid(bottom(area) - scopeBottom)));
    for (const [figure] of free) {
      if (dy) moveTree(state, diagram, figure, toWorld({ x: 0, y: dy }));
    }
    yGrowth = Math.max(yGrowth, ceilGrid(bottom(area) + dy - scopeBottom));
  }
  if (frame && lanes.length) {
    yGrowth = Math.max(yGrowth, ...nodes.map(([figure]) => ceilGrid(bottom(unitArea(figure)) - scopeBottom)));
    for (const lane of lanes) {
      const box = bounds(lane);
      if (bottom(toLocal(original.boxes.get(lane))) === bottom(frame)) {
        state.boxes.set(lane, toLocal({ ...box, height: bottom(frame) + yGrowth - box.y }));
      }
    }
  }
  return { xGrowth, yGrowth };
}

export function fitSelectedFrame(state, diagram, scope, members, lanes, original, frame, local, world, flip) {
  const scopeArea = usableArea(scope, frame);
  const content = usableArea(scope, frame, false);
  // Minimum dimensions from bpmn-js ResizeBehavior, in process coordinates.
  const [minWidth, minHeight] = scope.kind === 'pool' ? [300, 150] : flip ? [120, 140] : [140, 120];
  let rightEdge = frame.x + minWidth;
  let bottomEdge = frame.y + minHeight;
  const groups = Map.groupBy(members.filter((figure) => !figure.host), (figure) =>
    diagram.followers.has(figure) ? null : memberLane(figure, lanes, original.boxes));
  const children = Map.groupBy(lanes, (lane) => lane.parent);
  const laneBoxes = new Map();
  const units = (figure) => [figure, ...attachments(diagram, figure)];
  const nodeArea = (figure) => boundsOf(units(figure).map((part) => local(state.boxes.get(part))));
  const visibleArea = (figure) => boundsOf(units(figure).flatMap((part) =>
    geometryWithLabels(part, state.boxes.get(part)).map(local)));
  let dx = -Infinity;

  function placeRows(parent, x, y) {
    const lane = parent === scope ? null : parent;
    const header = lane?.header ?? 0;
    const members = groups.get(lane) ?? [];
    const nodes = members.filter((figure) => figure.kind === 'node');
    const left = x + header;
    const top = Math.max(y, scopeArea.y);
    const laneMargin = lane ? ROUTE_MARGIN : CONTAINER_INSET;
    let end = lane ? y + 60 : bottomEdge;
    if (nodes.length) {
      const dy = ceilGrid(Math.max(...nodes.map((node) =>
        Math.max(top - nodeArea(node).y, y - visibleArea(node).y))));
      for (const node of nodes) {
        moveTree(state, diagram, node, world({ x: dx, y: dy }));
        const area = nodeArea(node);
        const visible = visibleArea(node);
        end = Math.max(end, bottom(area) + laneMargin, bottom(visible));
        bottomEdge = Math.max(bottomEdge, bottom(area) + CONTAINER_INSET, bottom(visible));
        rightEdge = Math.max(rightEdge, right(area) + CONTAINER_INSET, right(visible));
      }
    }
    for (const figure of members.filter((member) => member.kind !== 'node')) {
      const box = local(state.boxes.get(figure));
      if (diagram.followers.has(figure)) {
        const owner = diagram.notes.containers.get(figure).filter((container) => container.kind === 'lane').at(-1);
        rightEdge = Math.max(rightEdge, laneLeft(owner) + box.width + ROUTE_MARGIN * 2);
        continue;
      }
      if (lane) {
        const dy = y - local(original.boxes.get(lane)).y;
        moveTree(state, diagram, figure, world({ x: 0, y: dy }));
      }
      const area = visibleArea(figure);
      end = Math.max(end, bottom(area));
      rightEdge = Math.max(rightEdge, right(area));
    }
    const rows = (children.get(parent) ?? []).toSorted((a, b) =>
      local(original.boxes.get(a)).y - local(original.boxes.get(b)).y || byId(a, b));
    let next = lane && nodes.length ? end : y;
    for (const row of rows) next = placeRows(row, left, next);
    end = Math.max(end, next);
    if (lane) {
      rightEdge = Math.max(rightEdge, x + 300);
      laneBoxes.set(lane, { x, y, width: 0, height: end - y });
    }
    return end;
  }

  function laneLeft(lane) {
    let left = content.x;
    for (let owner = lane; owner?.kind === 'lane' && owner.scope === scope; owner = owner.parent) {
      left += owner.header;
    }
    return left;
  }

  for (const [lane, figures] of groups) {
    const left = laneLeft(lane);
    for (const node of figures.filter((figure) => figure.kind === 'node')) {
      dx = Math.max(dx, ceilGrid(Math.max(Math.max(scopeArea.x, left) - nodeArea(node).x, left - visibleArea(node).x)));
    }
  }

  bottomEdge = Math.max(placeRows(scope, content.x, frame.y), bottomEdge);
  // The last lane at each level fills the rest of its parent.
  const fill = (parent, end) => {
    const rows = [...(children.get(parent) ?? [])].sort((a, b) => laneBoxes.get(a).y - laneBoxes.get(b).y);
    for (const row of rows) {
      const box = laneBoxes.get(row);
      const height = row === rows.at(-1) ? end - box.y : box.height;
      state.boxes.set(row, local({ ...box, width: rightEdge - box.x, height }));
      fill(row, box.y + height);
    }
  };
  fill(scope, bottomEdge);
  return { xGrowth: rightEdge - right(frame), yGrowth: bottomEdge - bottom(frame) };
}

export function scopeCollisions(state, original, members, lanes, scope, fitted) {
  const frame = state.boxes.get(scope);
  const local = scope.horizontal === false ? transpose : (box) => box;
  for (const figure of members) {
    const box = state.boxes.get(figure);
    if (!validBox(box)) return true;
    const lane = figure.lane ?? figure.host?.lane;
    if (lane && !contains(state.boxes.get(lane), box)) return true;
    if (figure.kind === 'node' || figure.host) {
      for (const other of lanes) {
        if (other === lane || lane && descendantOf(lane, other)) continue;
        const originalBox = original.boxes.get(figure);
        const currentLane = state.boxes.get(other);
        const originalLane = original.boxes.get(other);
        if (fitted ? intersects(box, currentLane) :
            containsCenter(currentLane, box) !== containsCenter(originalLane, originalBox) ||
            intersects(box, currentLane) && !intersects(originalBox, originalLane)) return true;
      }
      if (frame && !contains(usableArea(scope, local(frame)), local(box))) return true;
    }
  }

  for (let index = 0; index < members.length; index++) {
    const a = members[index];
    const box = state.boxes.get(a);
    for (let next = index + 1; next < members.length; next++) {
      const b = members[next];
      if (a.host === b || b.host === a || a.host && a.host === b.host) continue;
      if (intersects(box, state.boxes.get(b)) &&
          (a.kind === 'node' || b.kind === 'node' || a.host || b.host)) return true;
    }
  }

  return false;
}

export function newOverlap(state, original, figure, others) {
  const next = state.boxes.get(figure);
  return others.some((other) => other !== figure && other.parent === figure.parent &&
    !other.host && other.kind !== 'lane' && other.kind !== 'group' &&
    figure.lane === other.lane &&
    intersects(next, state.boxes.get(other)) &&
    !intersects(original.boxes.get(figure), original.boxes.get(other)));
}
