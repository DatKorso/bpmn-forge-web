import { is } from 'bpmn-js/lib/util/ModelUtil';
import { isHorizontal } from 'bpmn-js/lib/util/DiUtil';
import { collectLanes, getLanesRoot, LANE_INDENTATION } from 'bpmn-js/lib/features/modeling/util/LaneUtil';
import { isDirectionHorizontal } from 'bpmn-js/lib/features/modeling/util/ModelingUtil';
import { boundsOf, center, intersects, layoutRegion, translate } from './layout.js';

const COMMAND = 'editor.autoAlign';

function isAncestor(ancestor, element) {
  for (let parent = element.parent; parent; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

function membershipAfterMove(shape, nextBounds, lanes, positions) {
  const x = center(nextBounds, 'x');
  const y = center(nextBounds, 'y');
  const current = shape.businessObject.lanes ?? [];
  // Match the center-point check used by the modeler's lane update command.
  const next = lanes.filter((lane) => {
    const bounds = positions.get(lane) ?? lane;
    return x > bounds.x && x < bounds.x + bounds.width &&
      y > bounds.y && y < bounds.y + bounds.height;
  });
  return next.length === current.length && next.every((lane) => current.includes(lane.businessObject));
}

function contentLimits(region, root, positions) {
  const limits = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

  for (let container = region; container && container !== root; container = container.parent) {
    const hasHeader = is(container, 'bpmn:Lane') || is(container, 'bpmn:Participant');
    const horizontal = hasHeader && isHorizontal(container);
    const bounds = positions.get(container) ?? container;
    limits.left = Math.max(limits.left, bounds.x + (horizontal ? LANE_INDENTATION : 0));
    limits.top = Math.max(limits.top, bounds.y + (hasHeader && !horizontal ? LANE_INDENTATION : 0));
    limits.right = Math.min(limits.right, bounds.x + bounds.width);
    limits.bottom = Math.min(limits.bottom, bounds.y + bounds.height);
  }

  return limits;
}

function regionName(region) {
  const { businessObject } = region;
  const name = businessObject.name?.trim() || businessObject.id;
  if (is(region, 'bpmn:Lane')) return `Дорожка «${name}»`;
  if (is(region, 'bpmn:Participant')) return `Пул «${name}»`;
  if (is(region, 'bpmn:SubProcess')) return `Подпроцесс «${name}»`;
  return `Процесс «${name}»`;
}

function overlaps(shape, next, shapes, positions) {
  return shapes.some((other) =>
    other !== shape &&
    other.host !== shape &&
    shape.host !== other &&
    !(shape.host && shape.host === other.host) &&
    !isAncestor(other, shape) &&
    !isAncestor(shape, other) &&
    !is(other, 'bpmn:Lane') &&
    intersects(next, positions.get(other) ?? other)
  );
}

function sequenceFlows(units, region, elementRegistry) {
  const horizontal = isHorizontal(region) ?? isDirectionHorizontal(region, elementRegistry);
  if (!horizontal) return [];

  const byShape = new Map(units.flatMap((unit) => unit.members.map((shape) => [shape, unit])));
  const flows = [];
  for (const [shape, source] of byShape) {
    for (const connection of shape.outgoing) {
      const target = byShape.get(connection.target);
      if (!target || !is(connection, 'bpmn:SequenceFlow')) continue;
      flows.push({
        source,
        target,
        id: connection.id,
        isDefault: shape.businessObject.default === connection.businessObject
      });
    }
  }
  return flows;
}

function regionDepth(region) {
  let depth = 0;
  let subProcesses = 0;
  for (let parent = region; parent; parent = parent.parent) {
    depth++;
    if (is(parent, 'bpmn:SubProcess')) subProcesses++;
  }
  return { depth, subProcesses };
}

function planRoot(root, shapes, gaps, moves, skipped, elementRegistry) {
  const regions = new Map();
  const lanesByScope = new Map();
  const positions = new Map();

  for (const shape of shapes) {
    if (!is(shape, 'bpmn:FlowNode') || is(shape, 'bpmn:BoundaryEvent')) continue;

    const scope = getLanesRoot(shape);
    if (!lanesByScope.has(scope)) lanesByScope.set(scope, collectLanes(scope));
    const lanes = lanesByScope.get(scope);
    // collectLanes returns child lanes before their enclosing lanes.
    const region = lanes.find((lane) => shape.businessObject.lanes?.includes(lane.businessObject)) ?? scope;
    const members = [shape, ...(shape.attachers ?? [])];

    if (!regions.has(region)) regions.set(region, { units: [], lanes });
    regions.get(region).units.push({ shape, members });
  }

  // Place subprocesses before their contents, which snap in the final coordinates.
  // Lanes and their flow nodes can share a diagram parent, so count subprocess levels first.
  const depths = new Map([...regions.keys()].map((region) => [region, regionDepth(region)]));
  const ordered = [...regions].sort(([a], [b]) =>
    depths.get(a).subProcesses - depths.get(b).subProcesses || depths.get(b).depth - depths.get(a).depth
  );
  for (const [region, { units, lanes }] of ordered) {
    const placed = units.map(({ shape, members }) => ({
      shape: positions.has(shape) ? { id: shape.id, type: shape.type, ...positions.get(shape) } : shape,
      members,
      area: boundsOf(members.map((member) => positions.get(member) ?? member))
    }));
    const flows = sequenceFlows(placed, region, elementRegistry);
    const deltas = layoutRegion(placed, contentLimits(region, root, positions), gaps, flows);
    if (!deltas) {
      skipped.push({ name: regionName(region), reason: 'фигуры не помещаются в границах участка' });
      continue;
    }

    const pending = new Set();
    const candidatePositions = new Map(positions);
    const carried = new Map();
    for (const [unit, delta] of deltas) {
      if (delta.x === 0 && delta.y === 0) continue;
      for (const shape of unit.members) {
        pending.add(shape);
        candidatePositions.set(shape, translate(positions.get(shape) ?? shape, delta));
      }
      const [owner] = unit.members;
      if (is(owner, 'bpmn:SubProcess')) {
        for (const child of shapes.filter((shape) => isAncestor(owner, shape))) {
          const next = translate(positions.get(child) ?? child, delta);
          candidatePositions.set(child, next);
          carried.set(child, owner);
        }
      }
    }

    let reason;
    for (const shape of pending) {
      const next = candidatePositions.get(shape);
      if (!membershipAfterMove(shape, next, lanes, positions) || lanes.some((lane) => {
        if (lane === region || isAncestor(lane, region)) return false;
        const bounds = positions.get(lane) ?? lane;
        return intersects(next, bounds) && !intersects(positions.get(shape) ?? shape, bounds);
      })) {
        reason = 'изменится принадлежность фигур к дорожкам';
        break;
      }

      if (overlaps(shape, next, shapes, candidatePositions)) {
        reason = 'фигуры наложатся друг на друга или на неподвижный элемент';
        break;
      }
    }

    if (!reason) {
      for (const [child, container] of carried) {
        const obstacles = shapes.filter((shape) => !isAncestor(container, shape));
        if (overlaps(child, candidatePositions.get(child), obstacles, candidatePositions)) {
          reason = 'фигуры наложатся друг на друга или на неподвижный элемент';
          break;
        }
      }
    }

    if (reason) {
      skipped.push({ name: regionName(region), reason });
      continue;
    }

    for (const shape of [...pending, ...carried.keys()]) {
      const next = candidatePositions.get(shape);
      const delta = { x: next.x - shape.x, y: next.y - shape.y };
      if (delta.x || delta.y) moves.set(shape, delta);
      else moves.delete(shape);
      positions.set(shape, next);
    }
  }
}

class AlignCommand {
  static $inject = ['modeling'];

  constructor(modeling) {
    this.modeling = modeling;
  }

  // Nested commands belong in pre/postExecute so the command stack groups their undo and redo.
  postExecute({ moves }) {
    const connections = new Set();

    // Moving lanes last lets the modeler update membership from final node positions.
    const ordered = [...moves].sort(([a], [b]) => Number(is(a, 'bpmn:Lane')) - Number(is(b, 'bpmn:Lane')));
    for (const [shape, delta] of ordered) {
      for (const element of [shape, ...shape.labels]) {
        const parent = element.parent;
        this.modeling.moveShape(element, delta, parent, parent.children.indexOf(element), {
          layout: false,
          recurse: false
        });
      }

      for (const connection of [...shape.incoming, ...shape.outgoing]) connections.add(connection);
    }

    for (const connection of connections) {
      this.modeling.layoutConnection(connection, {
        waypoints: [],
        startChanged: moves.has(connection.source),
        endChanged: moves.has(connection.target)
      });
    }
  }
}

class AutoAlign {
  static $inject = ['canvas', 'elementRegistry', 'commandStack'];

  constructor(canvas, elementRegistry, commandStack) {
    this.canvas = canvas;
    this.elementRegistry = elementRegistry;
    this.commandStack = commandStack;
    commandStack.registerHandler(COMMAND, AlignCommand);
  }

  run(gaps) {
    const moves = new Map();
    const skipped = [];
    const shapesByRoot = new Map();

    for (const shape of this.elementRegistry.getAll()) {
      // BPMN groups are overlays. External labels follow their shapes.
      if (!shape.parent || shape.hidden || shape.waypoints || shape.labelTarget || is(shape, 'bpmn:Group')) continue;
      const root = this.canvas.findRoot(shape);
      if (!shapesByRoot.has(root)) shapesByRoot.set(root, []);
      shapesByRoot.get(root).push(shape);
    }

    for (const [root, shapes] of shapesByRoot) planRoot(root, shapes, gaps, moves, skipped, this.elementRegistry);
    if (moves.size) this.commandStack.execute(COMMAND, { moves });

    return { moved: moves.size, skipped };
  }
}

export default {
  __init__: ['autoAlign'],
  autoAlign: ['type', AutoAlign]
};
