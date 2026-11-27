import { getDi, is } from 'bpmn-js/lib/util/ModelUtil';
import {
  collectLanes, getLabelAdjustment, getLanesRoot, isDirectionHorizontal,
  isExpanded, isHorizontal, LANE_INDENTATION, updateBounds
} from './bpmn-internals.js';
import { alignmentSelection } from './alignment-selection.js';
import { isFrame } from './annotation-layout.js';
import { placeGatewayLabel } from './gateway-label-layout.js';
import { sameBox } from './alignment-state.js';
import { translate, translateWaypoints } from './layout.js';

const COMMAND = 'editor.autoAlign';
const SKIP_REASONS = {
  bounds: 'раскладка выходит за допустимые координаты',
  annotations: 'не удалось разместить связанные аннотации без наложений',
  collisions: 'не удалось разместить фигуры без наложений в своих областях',
  poolStability: 'расстановка пулов пропущена: не достигнуто устойчивое положение',
  poolRouting: 'расстановка пулов пропущена: не удалось разместить пулы и провести потоки сообщений',
  routing: 'не удалось провести все стрелки в обход фигур',
  graphMixedOrientation: 'Пулы на активной плоскости имеют разную ориентацию',
  graphLaneOrientation: 'Ориентация дорожки отличается от ориентации её пула',
  graphNoPools: 'На активной плоскости не отображается ни одна рамка участника',
  graphGroup: 'Экспериментальная раскладка пока не поддерживает группы',
  graphNestedLanes: 'Экспериментальная раскладка поддерживает вложенные дорожки только в процессе пула на плоскости коллаборации',
  graphMissingLane: 'В пуле с дорожками каждый узел должен принадлежать дорожке',
  graphIncomplete: 'Геометрия активной плоскости не соответствует элементам BPMN',
  graphOwnership: 'Принадлежность фигуры пулу, подпроцессу или дорожке неоднозначна',
  graphMessageEndpoint: 'Конец потока сообщений не поддерживается или не принадлежит другому пулу',
  graphDataScope: 'Связь данных выходит за пределы поддерживаемой области',
  graphAssociationEndpoint: 'Ассоциация должна соединять две видимые фигуры',
  graphSequenceClearance: 'Не удалось провести поток последовательности с зазором 8 px',
  graphMessageRouting: 'Не удалось проложить поток сообщений',
  graphAssociationRouting: 'Не удалось проложить ассоциацию',
  graphConnectionLabel: 'Не удалось разместить подпись связи без наложений',
  graphGatewayLabel: 'Не удалось разместить подпись шлюза без наложений'
};

const SKIP_HINTS = {
  bounds: 'Уменьшите минимальные отступы.',
  annotations: 'Освободите место рядом со связанными аннотациями.',
  collisions: 'Разнесите пересекающиеся фигуры или уменьшите минимальные отступы.',
  poolStability: 'Разнесите перекрывающиеся пулы и повторите выравнивание.',
  poolRouting: 'Освободите место между пулами для потоков сообщений.',
  routing: 'Освободите проход между фигурами или увеличьте отступы.',
  graphSequenceClearance: 'Освободите проход между фигурами или увеличьте отступы.',
  graphMixedOrientation: 'Для этой схемы доступна кнопка «Выровнять схему».',
  graphLaneOrientation: 'Согласуйте isHorizontal дорожки с пулом. Для вертикальной дорожки укажите false.',
  graphNoPools: 'Проверьте BPMN DI участников.',
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
  const type = kind === 'pool' ? 'Пул' : is(element, 'bpmn:Collaboration') ? 'Коллаборация' :
    is(element, 'bpmn:SubProcess') ? 'Подпроцесс' : 'Процесс';
  return `${type} «${name?.trim() || id}»`;
}

function figureKind(shape) {
  if (is(shape, 'bpmn:Participant')) return 'pool';
  if (is(shape, 'bpmn:Lane')) return 'lane';
  if (is(shape, 'bpmn:Group')) return 'group';
  if (is(shape, 'bpmn:FlowNode') && !is(shape, 'bpmn:BoundaryEvent')) return 'node';
  return 'artifact';
}

function snapshot(root, shapes, elementRegistry, graph = false) {
  const orientation = (element) => isHorizontal(element) ?? isDirectionHorizontal(element, elementRegistry);
  const diagramRoot = { id: root.id, element: root, model: root.businessObject, kind: 'root', header: 0 };
  const byElement = new Map(shapes.map((element) => [element, {
    id: element.id,
    type: element.type,
    element,
    model: element.businessObject,
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

    if (!graph && figure.kind === 'node') {
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
      const points = graph ? translateWaypoints(connection.waypoints, { x: 0, y: 0 }) : connection.waypoints;
      const labels = connection.labels.filter((label) => !label.hidden).map(getBounds);
      group.push({
        id: connection.id, type: connection.type, connection, model: connection.businessObject, source, target, points, labels,
        isDefault: element.businessObject.default === connection.businessObject,
        projectLabels: (next) => labels.map((label) =>
          next && !sameWaypoints(points, next) ? translate(label, getLabelAdjustment(label, next, points, {})) : label)
      });
    }
  }
  return { root: diagramRoot, figures: [...byElement.values()], edges, messageFlows, auxiliary,
    diElements: graph ? [...(getDi(root)?.planeElement ?? [])] : undefined };
}

function sameWaypoints(a, b) {
  return a.length === b.length && a.every((point, index) =>
    Math.abs(point.x - b[index].x) < 1e-7 && Math.abs(point.y - b[index].y) < 1e-7);
}

function gatewayLabelBounds(groups) {
  const bounds = new Map();
  for (const { diagram, gateways } of groups) {
    if (!gateways.length) continue;
    const { figures } = diagram;
    const connections = figures.flatMap(({ element }) => element.outgoing.filter((edge) => !edge.hidden));
    const paths = connections.map(({ waypoints }) => waypoints);
    const labels = [...figures.map(({ element }) => element), ...connections]
      .flatMap(({ labels }) => labels.filter((label) => !label.hidden));
    const ordered = gateways.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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
        if (after !== before) bounds.set(label, after);
      }
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
    const { bounds, routes, relayout, explicitLabels } = context;
    context.previous = new Map([...bounds.keys()].map((element) => [element, getBounds(element)]));
    const labelOwners = new Set([
      ...[...bounds.keys()].map((element) => element.labelTarget).filter(Boolean),
      ...routes.keys(), ...relayout, ...[...(explicitLabels?.keys() ?? [])].map((label) => label.labelTarget)
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
    const { bounds, routes, relayout, labelGroups, explicitLabels, explicitOwners } = context;
    for (const connection of relayout) {
      this.modeling.layoutConnection(connection, {
        waypoints: [],
        startChanged: bounds.has(connection.source),
        endChanged: bounds.has(connection.target)
      });
    }
    for (const [connection, waypoints] of routes) {
      this.modeling.updateWaypoints(connection, waypoints, {
        createElementsBehavior: false,
        labelBehavior: !explicitOwners?.has(connection)
      });
    }
    if (labelGroups?.length) {
      const labels = gatewayLabelBounds(labelGroups);
      context.movedLabels = labels.size;
      if (labels.size) this.commandStack.execute(COMMAND, { bounds: labels, routes: new Map(), relayout: [] });
    }
    if (explicitLabels?.size) {
      this.commandStack.execute(COMMAND, { bounds: explicitLabels, routes: new Map(), relayout: [] });
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

  prepareCommand(bounds, routes, relayout, labelGroups, result, explicitLabels, explicitOwners) {
    const hasGeometry = bounds.size || routes.size || relayout.length;
    const labels = hasGeometry ? null : gatewayLabelBounds(labelGroups);
    const context = { bounds: labels ?? bounds, routes, relayout, explicitLabels, explicitOwners,
      labelGroups: hasGeometry ? labelGroups : [], movedLabels: (labels?.size ?? 0) + (explicitLabels?.size ?? 0) };
    if (!hasGeometry && !labels.size && !explicitLabels?.size) return result;
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

  async planGraphDiagram(gaps, stale) {
    const start = performance.now();
    const root = this.canvas.getRootElement();
    const diagram = snapshot(root, this.shapesByRoot(root).get(root) ?? [], this.elementRegistry, true);
    const end = performance.now();
    for (const stage of ['snapshot', 'local', 'pools', 'notes', 'messages', 'associations', 'routes']) {
      performance.clearMeasures(`bpmn:graph:${stage}`);
    }
    performance.measure('bpmn:graph:snapshot', { start, end });
    const { planGraphLayout } = await import('./graph-layout/index.js');
    if (stale?.()) return {};
    // Verification builds enable mixed pools while production latency exceeds the target.
    const plan = await planGraphLayout(diagram, gaps, undefined, {
      allowMixedPools: import.meta.env.MODE === 'graph-mixed-verification'
    });
    if (stale?.()) return {};
    if (plan.reason) {
      const scope = plan.scope ?? diagram.root;
      const subject = plan.elementId ? ` (${plan.elementId})` : '';
      const hint = SKIP_HINTS[plan.reason] ?? '';
      return {
        reason: `${regionName(scope)}${subject} — ${SKIP_REASONS[plan.reason] ?? SKIP_REASONS.routing}. ${hint}`.trim(),
        blockedPreview: ['graphSequenceClearance', 'graphGatewayLabel'].includes(plan.reason)
      };
    }
    return this.prepareDiagramPlans([{ diagram, plan }], true);
  }

  prepareDiagramPlans(plans, graph = false) {
    const bounds = new Map();
    const routes = new Map();
    const relayout = new Set();
    const skipped = [];
    const labelGroups = [];
    const explicitLabels = new Map();
    const explicitOwners = new Set();
    let moved = 0;
    let resized = 0;
    let movedPools = 0;

    for (const { diagram, plan } of plans) {
      if (plan.reason) return { reason: SKIP_REASONS[plan.reason] };
      if (plan.labelGateways.length) labelGroups.push({ diagram, gateways: plan.labelGateways });
      for (const [figure, next] of plan.boxes) {
        const { element, box, kind } = figure;
        bounds.set(element, next);
        const delta = { x: next.x - box.x, y: next.y - box.y };
        if (delta.x || delta.y) {
          moved++;
          if (kind === 'pool') movedPools++;
          for (const label of element.labels) {
            if (label.hidden || !plan.labels?.has(figure)) bounds.set(label, translate(label, delta));
          }
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
      for (const [entry, boxes] of plan.labels ?? []) {
        const owner = entry.element ?? entry.connection;
        if (!boxes.length) continue;
        explicitOwners.add(owner);
        const labels = owner.labels.filter((label) => !label.hidden);
        for (const [index, box] of boxes.entries()) {
          const label = labels[index];
          const changed = !sameBox(label, box);
          const missing = !getDi(owner).label?.bounds &&
            (bounds.has(owner) || routes.has(owner) || graph && is(owner, 'bpmn:Gateway'));
          if (changed || missing) explicitLabels.set(label, box);
        }
      }
      for (const { scope, reason } of plan.skipped) {
        skipped.push({ scope, name: regionName(scope), reason: SKIP_REASONS[reason], hint: SKIP_HINTS[reason] });
      }
    }

    const result = { moved, resized, rerouted: routes.size + relayout.size, skipped, movedPools,
      reroutedMessages: [...routes.keys()].filter((connection) => is(connection, 'bpmn:MessageFlow')).length };
    return this.prepareCommand(bounds, routes, [...relayout], labelGroups, result, explicitLabels, explicitOwners);
  }
}

export default {
  __init__: ['autoAlign'],
  autoAlign: ['type', AutoAlign]
};
