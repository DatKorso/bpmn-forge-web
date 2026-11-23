import { modelOf, modelOrder, processOf, typeIs } from './model-order.js';

const failure = (reason, scope, model) => ({ reason, scope, elementId: model?.id });
const isShape = (di) => typeIs(di, 'bpmndi:BPMNShape');
const isEdge = (di) => typeIs(di, 'bpmndi:BPMNEdge');
const isData = (model) => typeIs(model, 'bpmn:DataAssociation');
const finitePoint = ({ x, y }) => Number.isFinite(x) && Number.isFinite(y);

function endpoints(model) {
  if (typeIs(model, 'bpmn:DataInputAssociation')) return [model.sourceRef?.[0], model.$parent];
  if (typeIs(model, 'bpmn:DataOutputAssociation')) return [model.$parent, model.targetRef];
  return [model.sourceRef, model.targetRef];
}

function activeDi(diagram) {
  if (diagram.diElements) return diagram.diElements;
  const root = modelOf(diagram.root);
  for (let model = root; model; model = model.$parent) {
    const selected = model.diagrams?.find(({ plane }) => plane?.bpmnElement === root);
    if (selected) return selected.plane.planeElement ?? [];
  }
  return [];
}

function structuralScope(figure) {
  let parent = figure.parent;
  while (parent?.kind === 'lane') parent = parent.parent;
  return parent;
}

function validMessageEndpoint(model, source) {
  // Mirror bpmn-js's message-event rules using the BPMN objects in the snapshot.
  if (!typeIs(model, 'bpmn:InteractionNode')) return false;
  if (!source && model?.isForCompensation) return false;
  if (typeIs(model, 'bpmn:Participant') || typeIs(model, 'bpmn:Activity')) return true;
  if (!typeIs(model, source ? 'bpmn:ThrowEvent' : 'bpmn:CatchEvent')) return false;
  const definitions = model.eventDefinitions ?? [];
  return definitions.every((definition) => typeIs(definition, 'bpmn:MessageEventDefinition')) &&
    (!typeIs(model, 'bpmn:BoundaryEvent') || (!source && definitions.length > 0));
}

export function unsupportedGraph(diagram) {
  const byModel = new Map(diagram.figures.map((figure) => [modelOf(figure), figure]));
  function check(model, scope) {
    const group = model?.artifacts?.find((artifact) => typeIs(artifact, 'bpmn:Group'));
    if (group) return failure('graphGroup', scope, group);
    const lanes = modelOrder(scope).lanes;
    const nested = lanes.find((lane) => lane.childLaneSet);
    if (nested) return failure('graphNestedLanes', scope, nested);
    if (scope?.kind === 'pool' && lanes.length) {
      const owned = new Set();
      for (const member of lanes.flatMap((lane) => lane.flowNodeRef ?? [])) {
        if (owned.has(member)) return failure('graphOwnership', scope, member);
        owned.add(member);
      }
      const unassigned = model.flowElements?.find((node) => typeIs(node, 'bpmn:FlowNode') && !owned.has(node));
      if (unassigned) return failure('graphMissingLane', scope, unassigned);
    }
    for (const child of model?.flowElements ?? []) {
      const figure = byModel.get(child);
      if (!figure?.expanded || !typeIs(child, 'bpmn:SubProcess')) continue;
      const issue = check(child, figure);
      if (issue) return issue;
    }
  }
  for (const scope of [diagram.root, ...diagram.figures.filter(({ kind }) => kind === 'pool')]) {
    const issue = check(processOf(scope), scope);
    if (issue) return issue;
  }
}

export function inspectCollaboration(diagram) {
  const root = modelOf(diagram.root);
  if (!typeIs(root, 'bpmn:Collaboration')) return;

  const di = Map.groupBy(activeDi(diagram), (entry) => entry.bpmnElement);
  const figures = new Map();
  for (const figure of diagram.figures) {
    const model = modelOf(figure);
    if (!model || figures.has(model)) return failure('graphOwnership', diagram.root, model);
    figures.set(model, figure);
  }
  const rootScope = diagram.root;
  const participants = new Set(root.participants ?? []);
  const participantByProcess = new Map();
  const pools = [];
  for (const participant of participants) {
    const process = participant.processRef;
    const pool = figures.get(participant);
    if (process) {
      if (participantByProcess.has(process)) return failure('graphOwnership', pool ?? rootScope, participant);
      participantByProcess.set(process, participant);
    }
    const shapeDi = di.get(participant);
    if (!pool && !shapeDi?.length) continue;
    if (!pool || shapeDi?.length !== 1 || !isShape(shapeDi[0])) {
      return failure('graphIncomplete', pool ?? rootScope, participant);
    }
    pools.push(pool);
  }
  if (participants.size && !pools.length) return failure('graphNoPools', rootScope, participants.values().next().value);

  function participantOf(model) {
    for (let item = model; item; item = item.$parent) {
      if (participants.has(item)) return item;
      if (participantByProcess.has(item)) return participantByProcess.get(item);
    }
  }

  function hidden(model) {
    const participant = participantOf(model);
    if (participant && !figures.has(participant)) return true;
    for (let parent = model?.$parent; parent; parent = parent.$parent) {
      const figure = figures.get(parent);
      if (typeIs(parent, 'bpmn:SubProcess') && figure && !figure.expanded) return true;
    }
    return false;
  }

  for (const [model, entries] of di) {
    if (!model) return failure('graphIncomplete', rootScope, entries[0]);
    const models = entries.some(isEdge) ? [model, ...endpoints(model)] : [model];
    const owners = models.map(participantOf);
    if (isData(model) && owners[1] && owners[2] && owners[1] !== owners[2]) {
      return failure('graphDataScope', figures.get(owners[1]) ?? rootScope, model);
    }
    const invisible = owners.find((participant) => participant && !figures.has(participant));
    if (invisible) return failure('graphIncomplete', rootScope, model);
    if (typeIs(model, 'bpmn:Group') && model.$parent === root) return failure('graphGroup', rootScope, model);
    if (entries.some(isShape) && !owners[0] && !(typeIs(model, 'bpmn:TextAnnotation') && model.$parent === root)) {
      return failure('graphOwnership', rootScope, model);
    }
  }

  const connections = new Map();
  for (const edge of [...diagram.edges, ...diagram.messageFlows ?? [], ...diagram.auxiliary ?? []]) {
    const model = modelOf(edge);
    if (!model || connections.has(model)) return failure('graphOwnership', rootScope, model);
    connections.set(model, edge);
  }
  const messages = [];
  const diagnostics = [];
  const messageModels = new Set(root.messageFlows ?? []);
  for (const model of messageModels) {
    const [from, to] = endpoints(model);
    const source = figures.get(from);
    const target = figures.get(to);
    const edge = connections.get(model);
    const entries = di.get(model);
    if (!entries?.length && !edge && (hidden(from) || hidden(to)) &&
        (source || hidden(from)) && (target || hidden(to))) {
      diagnostics.push({ kind: 'excludedMessage', elementId: model.id, reason: 'hiddenEndpoint' });
      continue;
    }
    if (!source || !target || !edge || !edgeMatches(entries, edge, source, target, di)) {
      return failure('graphIncomplete', rootScope, model);
    }
    const sourceOwner = participantOf(from);
    const targetOwner = participantOf(to);
    if (!sourceOwner || !targetOwner || sourceOwner === targetOwner ||
        !validMessageEndpoint(from, true) || !validMessageEndpoint(to, false)) {
      return failure('graphMessageEndpoint', rootScope, model);
    }
    messages.push(edge);
  }
  for (const edge of diagram.messageFlows ?? []) {
    if (!messageModels.has(modelOf(edge))) return failure('graphOwnership', rootScope, modelOf(edge));
  }

  const extended = pools.length > 1 || messages.length > 0;
  const owner = new Map();
  const order = new Map();
  const auxiliary = [];
  const seen = new Set(messageModels);
  function shape(model, scope, pool, required = true) {
    const figure = figures.get(model);
    const entries = di.get(model);
    seen.add(model);
    if (!figure && !required && !entries?.length) return;
    if (!figure || entries?.length !== 1 || !isShape(entries[0]) || !validShape(entries[0].bounds) ||
        !validShape(figure.box)) return failure('graphIncomplete', scope, model);
    const expectedParent = scope === rootScope ? root : processOf(scope);
    const parent = typeIs(model, 'bpmn:Lane') ? model.$parent?.$parent : model.$parent;
    const wrongExpansion = typeIs(model, 'bpmn:SubProcess') && Boolean(entries[0].isExpanded) !== figure.expanded;
    if (parent !== expectedParent || figure.scope !== scope || structuralScope(figure) !== scope || wrongExpansion) {
      return failure('graphOwnership', scope, model);
    }
    owner.set(figure, pool);
    order.set(figure, order.size);
  }
  function connection(model, scope) {
    seen.add(model);
    const [from, to] = endpoints(model);
    const source = figures.get(from);
    const target = figures.get(to);
    const edge = connections.get(model);
    const entries = di.get(model);
    if (isData(model) && (!source || !target)) {
      if (edge) return failure('graphDataScope', scope, model);
      return;
    }
    if (typeIs(model, 'bpmn:Association') && [from, to].some((end) =>
      typeIs(end, 'bpmn:SequenceFlow') || typeIs(end, 'bpmn:MessageFlow') || typeIs(end, 'bpmn:Association') || isData(end))) {
      return failure('graphAssociationEndpoint', scope, model);
    }
    if (isData(model) && (!participantOf(from) || participantOf(from) !== participantOf(to) || source.scope !== target.scope)) {
      return failure('graphDataScope', scope, model);
    }
    if (!source || !target || !edge || !edgeMatches(entries, edge, source, target, di)) {
      return failure('graphIncomplete', scope, model);
    }
    if (typeIs(model, 'bpmn:SequenceFlow') && (source.scope !== scope || target.scope !== scope)) {
      return failure('graphOwnership', scope, model);
    }
    if (!typeIs(model, 'bpmn:SequenceFlow')) auxiliary.push(edge);
  }
  function artifacts(model, scope, pool) {
    for (const artifact of model.artifacts ?? []) {
      if (typeIs(artifact, 'bpmn:Group')) return failure('graphGroup', scope, artifact);
      const issue = typeIs(artifact, 'bpmn:Association')
        ? connection(artifact, scope)
        : shape(artifact, scope, pool);
      if (issue) return issue;
    }
  }
  function process(model, scope, pool) {
    const { nodes, lanes, edges } = modelOrder(scope);
    const laneOf = new Map();
    const members = new Set(nodes);
    for (const lane of lanes) {
      const issue = shape(lane, scope, pool);
      if (issue) return issue;
      if (lane.childLaneSet) return failure('graphNestedLanes', scope, lane);
      if ((di.get(lane)[0].isHorizontal !== false) !== (pool.horizontal !== false)) {
        return failure('graphLaneOrientation', scope, lane);
      }
      for (const member of lane.flowNodeRef ?? []) {
        if (!members.has(member) || laneOf.has(member)) return failure('graphOwnership', scope, member);
        laneOf.set(member, figures.get(lane));
      }
    }
    for (const member of nodes) {
      const issue = shape(member, scope, pool, !typeIs(member, 'bpmn:DataObject'));
      if (issue) return issue;
      const figure = figures.get(member);
      if (!figure) continue;
      if (typeIs(member, 'bpmn:BoundaryEvent')) {
        const host = figures.get(member.attachedToRef);
        if (!typeIs(member.attachedToRef, 'bpmn:Activity') || !host || host !== figure.host || host.scope !== scope ||
            (laneOf.has(member) && laneOf.get(member) !== laneOf.get(member.attachedToRef))) {
          return failure('graphOwnership', scope, member);
        }
      } else if (typeIs(member, 'bpmn:FlowNode') && (figure.lane !== laneOf.get(member) ||
          (lanes.length && !laneOf.has(member)))) {
        return failure('graphMissingLane', scope, member);
      }
      for (const association of [...member.dataInputAssociations ?? [], ...member.dataOutputAssociations ?? []]) {
        const issue = connection(association, scope);
        if (issue) return issue;
      }
      if (figure.expanded) {
        const issue = process(member, figure, pool);
        if (issue) return issue;
      }
    }
    for (const sequence of edges) {
      const issue = connection(sequence, scope);
      if (issue) return issue;
    }
    if (model) return artifacts(model, scope, pool);
  }

  if (extended) {
    for (const pool of pools) {
      const model = modelOf(pool);
      const issue = shape(model, rootScope, pool) ?? process(model.processRef, pool, pool);
      if (issue) return issue;
    }
    const issue = artifacts(root, rootScope, undefined);
    if (issue) return issue;
    for (const [model, figure] of figures) {
      if (!seen.has(model)) return failure('graphOwnership', figure.scope ?? rootScope, model);
    }
    for (const [model] of di) {
      if (!seen.has(model) && !hidden(model)) return failure('graphOwnership', rootScope, model);
    }
    for (const [model, edge] of connections) {
      if (!seen.has(model)) return failure('graphOwnership', edge.source?.scope ?? rootScope, model);
    }
  } else {
    // The isolated planner retains its historical auxiliary-edge handling.
    for (const figure of diagram.figures) {
      const model = modelOf(figure);
      const next = figures.get(participantOf(model));
      if (!next && !(typeIs(model, 'bpmn:TextAnnotation') && model.$parent === root)) {
        return failure('graphOwnership', rootScope, model);
      }
      owner.set(figure, next);
    }
    auxiliary.push(...diagram.auxiliary ?? []);
  }
  return { extended, pools, owner, order, messages, auxiliary, diagnostics };
}

function validShape(box) {
  return box && finitePoint(box) && Number.isFinite(box.width) && Number.isFinite(box.height) &&
    box.width > 0 && box.height > 0;
}

function edgeMatches(entries, edge, source, target, di) {
  const data = entries?.[0];
  return entries?.length === 1 && isEdge(data) && data.waypoint?.length >= 2 &&
    data.waypoint.every(finitePoint) &&
    (!data.sourceElement || data.sourceElement === di.get(modelOf(source))?.[0]) &&
    (!data.targetElement || data.targetElement === di.get(modelOf(target))?.[0]) &&
    edge.source === source && edge.target === target;
}
