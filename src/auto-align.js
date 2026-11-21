import { is } from 'bpmn-js/lib/util/ModelUtil';
import { isExpanded, isHorizontal } from 'bpmn-js/lib/util/DiUtil';
import { collectLanes, getLanesRoot, LANE_INDENTATION } from 'bpmn-js/lib/features/modeling/util/LaneUtil';
import { isDirectionHorizontal } from 'bpmn-js/lib/features/modeling/util/ModelingUtil';
import { planAlignment } from './alignment-plan.js';
import { translate } from './layout.js';

const COMMAND = 'editor.autoAlign';
const SKIP_REASONS = {
  bounds: 'раскладка выходит за допустимые координаты',
  collisions: 'не удалось разместить фигуры без наложений в своих областях',
  routing: 'не удалось провести все стрелки в обход фигур'
};

function getBounds({ x, y, width, height }) {
  return { x, y, width, height };
}

function regionName({ element, kind }) {
  const { name, id } = element.businessObject;
  const type = kind === 'pool' ? 'Пул' : kind === 'root' ? 'Процесс' : 'Подпроцесс';
  return `${type} «${name?.trim() || id}»`;
}

function figureKind(shape) {
  if (is(shape, 'bpmn:Participant')) return 'pool';
  if (is(shape, 'bpmn:Lane')) return 'lane';
  if (is(shape, 'bpmn:FlowNode') && !is(shape, 'bpmn:BoundaryEvent')) return 'node';
  return 'artifact';
}

function snapshot(root, shapes, elementRegistry) {
  const orientation = (element) => isHorizontal(element) ?? isDirectionHorizontal(element, elementRegistry);
  const diagramRoot = { element: root, kind: 'root', horizontal: orientation(root), header: 0 };
  const byElement = new Map(shapes.map((element) => [element, {
    id: element.id,
    type: element.type,
    element,
    kind: figureKind(element),
    box: getBounds(element),
    expanded: is(element, 'bpmn:SubProcess') && isExpanded(element)
  }]));
  const laneCache = new Map();

  for (const [element, figure] of byElement) {
    const scope = getLanesRoot(element);
    const container = byElement.get(scope);
    figure.scope = container && container !== figure ? container : diagramRoot;
    figure.parent = byElement.get(element.parent) ?? diagramRoot;
    figure.host = byElement.get(element.host);
    figure.header = ['pool', 'lane'].includes(figure.kind) ? LANE_INDENTATION : 0;
    figure.horizontal = orientation(figure.kind === 'pool' ? element : scope);

    if (figure.kind === 'node') {
      if (!laneCache.has(scope)) laneCache.set(scope, collectLanes(scope));
      const lane = laneCache.get(scope).find((candidate) => element.businessObject.lanes?.includes(candidate.businessObject));
      figure.lane = byElement.get(lane);
    }
  }

  const edges = [];
  for (const [element, source] of byElement) {
    for (const connection of element.outgoing) {
      const target = byElement.get(connection.target);
      if (!target || connection.hidden || !is(connection, 'bpmn:SequenceFlow')) continue;
      edges.push({
        id: connection.id, connection, source, target, points: connection.waypoints,
        isDefault: element.businessObject.default === connection.businessObject
      });
    }
  }
  return { root: diagramRoot, figures: [...byElement.values()], edges };
}

function sameWaypoints(a, b) {
  return a.length === b.length && a.every((point, index) =>
    Math.abs(point.x - b[index].x) < 1e-7 && Math.abs(point.y - b[index].y) < 1e-7);
}

class AlignCommand {
  static $inject = ['modeling', 'bpmnUpdater'];

  constructor(modeling, bpmnUpdater) {
    this.modeling = modeling;
    this.bpmnUpdater = bpmnUpdater;
  }

  // Apply final geometry together so intermediate lane boundaries never rewrite flowNodeRef.
  setBounds(bounds) {
    for (const [element, box] of bounds) {
      Object.assign(element, box);
      this.bpmnUpdater.updateBounds(element);
    }
    return [...bounds.keys()];
  }

  execute(context) {
    const { bounds } = context;
    context.previous = new Map([...bounds.keys()].map((element) => [element, getBounds(element)]));
    return this.setBounds(bounds);
  }

  revert({ previous }) {
    return this.setBounds(previous);
  }

  // Nested commands belong in postExecute so the command stack groups their undo and redo.
  postExecute({ bounds, routes, relayout }) {
    for (const connection of relayout) {
      this.modeling.layoutConnection(connection, {
        waypoints: [],
        startChanged: bounds.has(connection.source),
        endChanged: bounds.has(connection.target)
      });
    }
    for (const [connection, waypoints] of routes) {
      this.modeling.updateWaypoints(connection, waypoints, { createElementsBehavior: false });
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
    const bounds = new Map();
    const routes = new Map();
    const relayout = new Set();
    const skipped = [];
    const shapesByRoot = new Map();
    let moved = 0;
    let resized = 0;

    for (const shape of this.elementRegistry.getAll()) {
      if (!shape.parent || shape.hidden || shape.waypoints || shape.labelTarget || is(shape, 'bpmn:Group')) continue;
      const root = this.canvas.findRoot(shape);
      if (!shapesByRoot.has(root)) shapesByRoot.set(root, []);
      shapesByRoot.get(root).push(shape);
    }

    for (const [root, shapes] of shapesByRoot) {
      const diagram = snapshot(root, shapes, this.elementRegistry);
      const plan = planAlignment(diagram, gaps);
      for (const [{ element, box }, next] of plan.boxes) {
        bounds.set(element, next);
        const delta = { x: next.x - box.x, y: next.y - box.y };
        if (delta.x || delta.y) {
          moved++;
          for (const label of element.labels) bounds.set(label, translate(label, delta));
        }
        if (next.width !== box.width || next.height !== box.height) resized++;
        for (const connection of [...element.incoming, ...element.outgoing]) {
          if (!connection.hidden) relayout.add(connection);
        }
      }
      for (const [{ connection }, route] of plan.routes) {
        relayout.delete(connection);
        if (!sameWaypoints(connection.waypoints, route)) routes.set(connection, route);
      }
      for (const { scope, reason } of plan.skipped) {
        skipped.push({ name: regionName(scope), reason: SKIP_REASONS[reason] });
      }
    }

    if (bounds.size || routes.size) this.commandStack.execute(COMMAND, { bounds, routes, relayout });
    return { moved, resized, rerouted: routes.size + relayout.size, skipped };
  }
}

export default {
  __init__: ['autoAlign'],
  autoAlign: ['type', AutoAlign]
};
