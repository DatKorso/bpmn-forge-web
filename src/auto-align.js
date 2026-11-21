import { getDi, is } from 'bpmn-js/lib/util/ModelUtil';
import { isExpanded, isHorizontal } from 'bpmn-js/lib/util/DiUtil';
import { collectLanes, getLanesRoot, LANE_INDENTATION } from 'bpmn-js/lib/features/modeling/util/LaneUtil';
import { isDirectionHorizontal } from 'bpmn-js/lib/features/modeling/util/ModelingUtil';
import { alignmentSelection, planAlignment, planSelection } from './alignment-plan.js';
import { translate, translateWaypoints } from './layout.js';

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
  if (is(shape, 'bpmn:Group')) return 'group';
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
    if (figure.kind === 'lane' && isHorizontal(scope) == null && isHorizontal(element) != null) {
      figure.scope.horizontal = isHorizontal(element);
    }

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
  static $inject = ['modeling', 'bpmnUpdater', 'eventBus'];

  constructor(modeling, bpmnUpdater, eventBus) {
    this.modeling = modeling;
    this.bpmnUpdater = bpmnUpdater;
    this.eventBus = eventBus;
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
    const { bounds, routes, relayout } = context;
    context.previous = new Map([...bounds.keys()].map((element) => [element, getBounds(element)]));
    const labelOwners = new Set([
      ...[...bounds.keys()].map((element) => element.labelTarget).filter(Boolean),
      ...routes.keys(), ...relayout
    ]);
    context.previousLabels = [...labelOwners].map((element) => {
      const di = getDi(element);
      return { di, label: di.label, bounds: di.label?.bounds, box: di.label?.bounds && getBounds(di.label.bounds) };
    });
    return this.setBounds(bounds);
  }

  revert({ previous, previousLabels }) {
    const changed = this.setBounds(previous);
    // Rendering the reverted labels can synthesize DI bounds that were absent in the input.
    this.eventBus.once('elements.changed', 500, () => {
      for (const { di, label, bounds, box } of previousLabels) {
        di.set('label', label);
        if (label) label.set('bounds', bounds);
        if (box) Object.assign(bounds, box);
      }
    });
    return changed;
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
  static $inject = ['canvas', 'elementRegistry', 'commandStack', 'layouter', 'connectionDocking'];

  constructor(canvas, elementRegistry, commandStack, layouter, connectionDocking) {
    this.canvas = canvas;
    this.elementRegistry = elementRegistry;
    this.commandStack = commandStack;
    this.layouter = layouter;
    this.connectionDocking = connectionDocking;
    commandStack.registerHandler(COMMAND, AlignCommand);
  }

  shapesByRoot(onlyRoot, includeGroups = false) {
    const shapesByRoot = new Map();

    for (const shape of this.elementRegistry.getAll()) {
      if (!shape.parent || shape.hidden || shape.waypoints || shape.labelTarget ||
          !includeGroups && is(shape, 'bpmn:Group')) continue;
      const root = this.canvas.findRoot(shape);
      if (onlyRoot && root !== onlyRoot) continue;
      if (!shapesByRoot.has(root)) shapesByRoot.set(root, []);
      shapesByRoot.get(root).push(shape);
    }
    return shapesByRoot;
  }

  selection(elements) {
    const root = this.canvas.getRootElement();
    const shapes = elements.length ? this.shapesByRoot(root, true).get(root) ?? [] : [];
    const diagram = snapshot(root, shapes, this.elementRegistry);
    return { diagram, ...alignmentSelection(diagram, elements) };
  }

  runSelection(elements, gaps) {
    const selection = this.selection(elements);
    if (selection.reason) return selection;
    const plan = planSelection(selection.diagram, selection, gaps);
    if (plan.reason) return { reason: SKIP_REASONS[plan.reason] };

    const bounds = new Map();
    const routes = new Map();
    const connections = new Set();
    for (const [{ element, box }, next] of plan.boxes) {
      bounds.set(element, next);
      const delta = { x: next.x - box.x, y: next.y - box.y };
      for (const label of element.labels) bounds.set(label, translate(label, delta));
      for (const connection of [...element.incoming, ...element.outgoing]) {
        if (!connection.hidden && !is(connection, 'bpmn:SequenceFlow')) connections.add(connection);
      }
    }

    for (const [{ connection }, points] of plan.routes) {
      if (!sameWaypoints(connection.waypoints, points)) routes.set(connection, points);
    }
    const projected = (element) => bounds.has(element) ? {
      ...element, ...bounds.get(element), businessObject: element.businessObject, di: element.di,
      parent: element.parent, host: element.host && projected(element.host)
    } : element;
    for (const connection of connections) {
      const { source, target, waypoints } = connection;
      const nextSource = projected(source);
      const nextTarget = projected(target);
      const delta = { x: nextSource.x - source.x, y: nextSource.y - source.y };
      const rigid = delta.x === nextTarget.x - target.x && delta.y === nextTarget.y - target.y;
      const points = rigid ? translateWaypoints(waypoints, delta) : this.connectionDocking.getCroppedWaypoints({
        ...connection,
        businessObject: connection.businessObject,
        source: nextSource,
        target: nextTarget,
        waypoints: this.layouter.layoutConnection(connection, { source: nextSource, target: nextTarget, waypoints: [] })
      });
      if (!points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return { reason: SKIP_REASONS.routing };
      if (!sameWaypoints(waypoints, points)) routes.set(connection, points);
    }

    if (bounds.size || routes.size) this.commandStack.execute(COMMAND, { bounds, routes, relayout: [] });
    return { moved: plan.boxes.size, rerouted: routes.size };
  }

  run(gaps) {
    const bounds = new Map();
    const routes = new Map();
    const relayout = new Set();
    const skipped = [];
    let moved = 0;
    let resized = 0;

    for (const [root, shapes] of this.shapesByRoot()) {
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
