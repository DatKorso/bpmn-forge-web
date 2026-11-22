import { getDi, is } from 'bpmn-js/lib/util/ModelUtil';
import {
  collectLanes, getLabelAdjustment, getLanesRoot, isDirectionHorizontal,
  isExpanded, isHorizontal, LANE_INDENTATION, updateBounds
} from './bpmn-internals.js';
import { alignmentSelection } from './alignment-selection.js';
import { isFrame } from './annotation-layout.js';
import { placeGatewayLabel } from './gateway-label-layout.js';
import { translate, translateWaypoints } from './layout.js';

const COMMAND = 'editor.autoAlign';
const SKIP_REASONS = {
  bounds: 'раскладка выходит за допустимые координаты',
  annotations: 'не удалось разместить связанные аннотации без наложений',
  collisions: 'не удалось разместить фигуры без наложений в своих областях',
  poolStability: 'расстановка пулов пропущена: не достигнуто устойчивое положение',
  poolRouting: 'расстановка пулов пропущена: не удалось разместить пулы и провести потоки сообщений',
  routing: 'не удалось провести все стрелки в обход фигур',
  graphCollaboration: 'Экспериментальная раскладка пока не поддерживает несколько участников и потоки сообщений',
  graphGroup: 'Экспериментальная раскладка пока не поддерживает группы',
  graphNestedLanes: 'Экспериментальная раскладка пока не поддерживает вложенные дорожки',
  graphMissingLane: 'В пуле с дорожками каждый узел должен принадлежать дорожке',
  graphIncomplete: 'Экспериментальная раскладка не смогла сопоставить все элементы модели и схемы'
};

const SKIP_HINTS = {
  bounds: 'Уменьшите минимальные отступы.',
  annotations: 'Освободите место рядом со связанными аннотациями.',
  collisions: 'Разнесите пересекающиеся фигуры или уменьшите минимальные отступы.',
  poolStability: 'Разнесите перекрывающиеся пулы и повторите выравнивание.',
  poolRouting: 'Освободите место между пулами для потоков сообщений.',
  routing: 'Освободите проход между фигурами или увеличьте отступы.',
  graphCollaboration: 'Для этой схемы доступна кнопка «Выровнять схему».',
  graphGroup: 'Для этой схемы доступна кнопка «Выровнять схему».',
  graphNestedLanes: 'Для этой схемы доступна кнопка «Выровнять схему».',
  graphMissingLane: 'Проверьте принадлежность фигур дорожкам.',
  graphIncomplete: 'Проверьте, что все узлы и потоки отображаются на схеме.'
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
  const diagramRoot = { id: root.id, element: root, kind: 'root', header: 0 };
  const byElement = new Map(shapes.map((element) => [element, {
    id: element.id,
    type: element.type,
    element,
    kind: figureKind(element),
    box: getBounds(element),
    labels: element.labels.filter((label) => !label.hidden).map(getBounds),
    expanded: is(element, 'bpmn:SubProcess') && isExpanded(element)
  }]));
  const scopes = new Map(shapes.map((element) => [element, getLanesRoot(element)]));
  const scopeOf = (element) => {
    const container = byElement.get(scopes.get(element));
    return container && container.element !== element ? container : diagramRoot;
  };
  const laneDirections = new Map();
  for (const [element, figure] of byElement) {
    if (figure.kind !== 'lane' || isHorizontal(scopes.get(element)) != null) continue;
    const horizontal = isHorizontal(element);
    if (horizontal != null) laneDirections.set(scopeOf(element), horizontal);
  }
  diagramRoot.horizontal = laneDirections.get(diagramRoot) ?? orientation(root);

  const laneCache = new Map();
  for (const [element, figure] of byElement) {
    const scope = scopes.get(element);
    figure.scope = scopeOf(element);
    figure.parent = byElement.get(element.parent) ?? diagramRoot;
    figure.host = byElement.get(element.host);
    figure.header = ['pool', 'lane'].includes(figure.kind) ? LANE_INDENTATION : 0;
    figure.horizontal = laneDirections.get(figure) ?? orientation(figure.kind === 'pool' ? element : scope);

    if (figure.kind === 'node') {
      if (!laneCache.has(scope)) laneCache.set(scope, collectLanes(scope));
      const lane = laneCache.get(scope).find((candidate) => element.businessObject.lanes?.includes(candidate.businessObject));
      figure.lane = byElement.get(lane);
    }
  }

  const edges = [];
  const messageFlows = [];
  const auxiliary = [];
  for (const [element, source] of byElement) {
    for (const connection of element.outgoing) {
      const target = byElement.get(connection.target);
      if (!target || connection.hidden) continue;
      const group = is(connection, 'bpmn:SequenceFlow') ? edges :
        is(connection, 'bpmn:MessageFlow') ? messageFlows : auxiliary;
      group.push({
        id: connection.id, type: connection.type, connection, source, target, points: connection.waypoints,
        isDefault: element.businessObject.default === connection.businessObject,
        projectLabels: (points) => connection.labels.filter((label) => !label.hidden).map((label) =>
          points && !sameWaypoints(connection.waypoints, points)
            ? translate(label, getLabelAdjustment(label, points, connection.waypoints, {}))
            : getBounds(label))
      });
    }
  }
  return { root: diagramRoot, figures: [...byElement.values()], edges, messageFlows, auxiliary };
}

function sameWaypoints(a, b) {
  return a.length === b.length && a.every((point, index) =>
    Math.abs(point.x - b[index].x) < 1e-7 && Math.abs(point.y - b[index].y) < 1e-7);
}

function gatewayLabelBounds(groups) {
  const bounds = new Map();
  for (const { diagram, gateways, stabilize } of groups) {
    if (!gateways.length) continue;
    const { figures } = diagram;
    const connections = figures.flatMap(({ element }) => element.outgoing.filter((edge) => !edge.hidden));
    const paths = connections.map(({ waypoints }) => waypoints);
    const labels = [...figures.map(({ element }) => element), ...connections]
      .flatMap(({ labels }) => labels.filter((label) => !label.hidden));
    const ordered = stabilize ? gateways : gateways.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    // A later label can free space for a label that could not move on the first pass.
    for (let pass = 0; pass < (stabilize ? labels.length : 1); pass++) {
      let changed = false;
      for (const gateway of ordered) {
        const visible = gateway.element.labels.filter((label) => !label.hidden);
        if (!visible.length) continue;
        const containers = new Set();
        for (let figure = gateway; figure; figure = figure.parent) {
          if (isFrame(figure)) containers.add(figure);
          for (let lane = figure.lane; lane?.kind === 'lane'; lane = lane.parent) containers.add(lane);
        }
        const obstacles = figures.filter((figure) => figure !== gateway && figure.kind !== 'group')
          .flatMap((figure) => {
            const box = getBounds(figure.element);
            if (!containers.has(figure)) return [box];
            if (!figure.header) return [];
            return [figure.horizontal === false ? { ...box, height: figure.header } : { ...box, width: figure.header }];
          });
        for (const label of visible) {
          const before = bounds.get(label) ?? getBounds(label);
          const after = placeGatewayLabel(before, getBounds(gateway.element), [
            ...obstacles, ...labels.filter((other) => other !== label).map((other) => bounds.get(other) ?? getBounds(other))
          ], paths, [...containers].map(({ element }) => getBounds(element)));
          if (after !== before) {
            bounds.set(label, after);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }
  return bounds;
}

class AlignCommand {
  static $inject = ['modeling', 'bpmnUpdater', 'eventBus', 'commandStack'];

  constructor(modeling, bpmnUpdater, eventBus, commandStack) {
    this.modeling = modeling;
    this.bpmnUpdater = bpmnUpdater;
    this.eventBus = eventBus;
    this.commandStack = commandStack;
  }

  // Apply final geometry together so intermediate lane boundaries never rewrite flowNodeRef.
  setBounds(bounds) {
    for (const [element, box] of bounds) {
      Object.assign(element, box);
      updateBounds(this.bpmnUpdater, element);
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
  postExecute(context) {
    const { bounds, routes, relayout, labelGroups } = context;
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
    if (labelGroups?.length) {
      const labels = gatewayLabelBounds(labelGroups);
      context.movedLabels = labels.size;
      if (labels.size) this.commandStack.execute(COMMAND, { bounds: labels, routes: new Map(), relayout: [] });
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

  shapesByRoot(onlyRoot) {
    const shapesByRoot = new Map();

    for (const shape of this.elementRegistry.getAll()) {
      if (!shape.parent || shape.hidden || shape.waypoints || shape.labelTarget) continue;
      const root = this.canvas.findRoot(shape);
      if (onlyRoot && root !== onlyRoot) continue;
      if (!shapesByRoot.has(root)) shapesByRoot.set(root, []);
      shapesByRoot.get(root).push(shape);
    }
    return shapesByRoot;
  }

  selection(elements) {
    const root = this.canvas.getRootElement();
    const shapes = elements.length ? this.shapesByRoot(root).get(root) ?? [] : [];
    const diagram = snapshot(root, shapes, this.elementRegistry);
    return { diagram, ...alignmentSelection(diagram, elements) };
  }

  prepareCommand(bounds, routes, relayout, labelGroups, result) {
    const hasGeometry = bounds.size || routes.size || relayout.length;
    const labels = hasGeometry ? null : gatewayLabelBounds(labelGroups);
    const context = { bounds: labels ?? bounds, routes, relayout,
      labelGroups: hasGeometry ? labelGroups : [], movedLabels: labels?.size ?? 0 };
    if (!hasGeometry && !labels.size) return result;
    return {
      ...result,
      movedLabels: context.movedLabels,
      apply: () => {
        this.commandStack.execute(COMMAND, context);
        return { ...result, movedLabels: context.movedLabels };
      }
    };
  }

  async planSelection(elements, gaps) {
    const selection = this.selection(elements);
    if (selection.reason) return selection;
    const { planSelection } = await import('./alignment-plan.js');
    const plan = planSelection(selection.diagram, selection, gaps);
    if (plan.reason) return { reason: SKIP_REASONS[plan.reason] };

    const bounds = new Map();
    const routes = new Map();
    const connections = new Set();
    for (const [{ element, box }, next] of plan.boxes) {
      bounds.set(element, next);
      const delta = { x: next.x - box.x, y: next.y - box.y };
      if (delta.x || delta.y) {
        for (const label of element.labels) bounds.set(label, translate(label, delta));
      }
      for (const connection of [...element.incoming, ...element.outgoing]) {
        if (!connection.hidden && !is(connection, 'bpmn:SequenceFlow') && !is(connection, 'bpmn:MessageFlow')) {
          connections.add(connection);
        }
      }
    }

    for (const [{ connection }, points] of plan.routes) {
      connections.delete(connection);
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
      const rigid = delta.x === nextTarget.x - target.x && delta.y === nextTarget.y - target.y &&
        nextSource.width === source.width && nextSource.height === source.height &&
        nextTarget.width === target.width && nextTarget.height === target.height;
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

    const result = {
      moved: [...plan.boxes].filter(([{ box }, next]) => box.x !== next.x || box.y !== next.y).length,
      resized: [...plan.boxes].filter(([{ box }, next]) => box.width !== next.width || box.height !== next.height).length,
      rerouted: routes.size,
      movedPools: [...plan.boxes].filter(([{ kind, box }, next]) =>
        kind === 'pool' && (box.x !== next.x || box.y !== next.y)).length,
      reroutedMessages: [...routes.keys()].filter((connection) => is(connection, 'bpmn:MessageFlow')).length
    };
    return this.prepareCommand(bounds, routes, [], [{ diagram: selection.diagram, gateways: plan.labelGateways }], result);
  }

  diagramSnapshots() {
    return [...this.shapesByRoot()].map(([root, shapes]) => snapshot(root, shapes, this.elementRegistry));
  }

  async planDiagram(gaps) {
    const diagrams = this.diagramSnapshots();
    const { planAlignment } = await import('./alignment-plan.js');
    function* plans() {
      for (const diagram of diagrams) yield { diagram, plan: planAlignment(diagram, gaps) };
    }
    return this.prepareDiagramPlans(plans());
  }

  async planGraphDiagram(gaps) {
    const diagrams = this.diagramSnapshots();
    const { planGraphLayout } = await import('./graph-layout/index.js');
    const plans = [];
    for (const diagram of diagrams) {
      const plan = await planGraphLayout(diagram, gaps);
      if (plan.reason) {
        const scope = plan.scope ?? diagram.root;
        return { reason: `${regionName(scope)} — ${SKIP_REASONS[plan.reason]}. ${SKIP_HINTS[plan.reason]}` };
      }
      plans.push({ diagram, plan });
    }
    return this.prepareDiagramPlans(plans, true);
  }

  prepareDiagramPlans(plans, graph = false) {
    const bounds = new Map();
    const routes = new Map();
    const relayout = new Set();
    const skipped = [];
    const labelGroups = [];
    let moved = 0;
    let resized = 0;
    let movedPools = 0;

    for (const { diagram, plan } of plans) {
      if (plan.reason) return { reason: SKIP_REASONS[plan.reason] };
      labelGroups.push({ diagram, gateways: plan.labelGateways, stabilize: graph });
      for (const [{ element, box, kind }, next] of plan.boxes) {
        bounds.set(element, next);
        const delta = { x: next.x - box.x, y: next.y - box.y };
        if (delta.x || delta.y) {
          moved++;
          if (kind === 'pool') movedPools++;
          for (const label of element.labels) bounds.set(label, translate(label, delta));
        }
        if (next.width !== box.width || next.height !== box.height) resized++;
        for (const connection of [...element.incoming, ...element.outgoing]) {
          if (!connection.hidden && !is(connection, 'bpmn:MessageFlow')) relayout.add(connection);
        }
      }
      for (const [{ connection }, route] of plan.routes) {
        relayout.delete(connection);
        if (!sameWaypoints(connection.waypoints, route)) routes.set(connection, route);
      }
      for (const { scope, reason } of plan.skipped) {
        skipped.push({ scope, name: regionName(scope), reason: SKIP_REASONS[reason], hint: SKIP_HINTS[reason] });
      }
    }

    const result = { moved, resized, rerouted: routes.size + relayout.size, skipped, movedPools,
      reroutedMessages: [...routes.keys()].filter((connection) => is(connection, 'bpmn:MessageFlow')).length };
    return this.prepareCommand(bounds, routes, [...relayout], labelGroups, result);
  }
}

export default {
  __init__: ['autoAlign'],
  autoAlign: ['type', AutoAlign]
};
