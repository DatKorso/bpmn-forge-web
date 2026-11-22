export const modelOf = (entry) => entry.model ?? entry.element?.businessObject ?? entry.connection?.businessObject;
export const processOf = (scope) => modelOf(scope)?.processRef ?? modelOf(scope);
export const typeIs = (model, type) => model?.$instanceOf(type);
export const keyAt = (index) => `k${String(index + 1).padStart(8, '0')}`;

export function modelOrder(scope) {
  const model = processOf(scope);
  const nodes = [];
  const outgoing = new Map();
  for (const member of model?.flowElements ?? []) {
    if (typeIs(member, 'bpmn:SequenceFlow')) {
      if (!outgoing.has(member.sourceRef)) outgoing.set(member.sourceRef, []);
      outgoing.get(member.sourceRef).push(member);
    } else {
      nodes.push(member);
    }
  }
  const edges = nodes.flatMap((node) => {
    const flows = outgoing.get(node) ?? [];
    const explicit = new Map((node.outgoing ?? []).map((flow, index) => [flow, index]));
    return flows.toSorted((a, b) => Number(b === node.default) - Number(a === node.default) ||
      (explicit.get(a) ?? Infinity) - (explicit.get(b) ?? Infinity));
  });
  // Preserve unmatched flows so the planner can reject an incomplete scope.
  const sources = new Set(nodes);
  for (const [source, flows] of outgoing) if (!sources.has(source)) edges.push(...flows);
  return { nodes, edges, lanes: (model?.laneSets ?? []).flatMap((set) => set.lanes) };
}

function components(nodes, outgoing) {
  const index = new Map();
  const low = new Map();
  const active = new Set();
  const stack = [];
  const groups = new Map();
  function visit(node) {
    index.set(node, index.size);
    low.set(node, index.get(node));
    stack.push(node);
    active.add(node);
    for (const { target } of outgoing.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (active.has(target)) {
        low.set(node, Math.min(low.get(node), index.get(target)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      groups.set(member, node);
    } while (member !== node);
  }
  for (const node of nodes) if (!index.has(node)) visit(node);
  return groups;
}

export function orderGraph(nodes, edges, dataEdges, laneRank = () => 0) {
  const graph = edges.filter(({ source, target }) => source !== target);
  const outgoing = Map.groupBy(graph, ({ source }) => source);
  for (const flows of outgoing.values()) flows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const groups = components(nodes, outgoing);
  const entries = new Set(graph.filter(({ source, target }) => groups.get(source) !== groups.get(target))
    .map(({ target }) => target));
  const seen = new Set();
  const active = new Set();
  const back = new Set();
  function visit(node) {
    seen.add(node);
    active.add(node);
    for (const edge of outgoing.get(node) ?? []) {
      const { target } = edge;
      if (groups.get(node) !== groups.get(target)) continue;
      if (active.has(target)) back.add(edge);
      else if (!seen.has(target)) visit(target);
    }
    active.delete(node);
  }
  for (const node of [...nodes.filter((node) => entries.has(node)), ...nodes]) if (!seen.has(node)) visit(node);
  const dag = graph.map((edge) => back.has(edge)
    ? { ...edge, source: edge.target, target: edge.source }
    : edge).concat(dataEdges);
  const successors = Map.groupBy(dag, ({ source }) => source);
  const incoming = new Map(nodes.map((node) => [node, 0]));
  for (const { target } of dag) incoming.set(target, incoming.get(target) + 1);
  const ordered = [];
  const ready = nodes.filter((node) => !incoming.get(node));
  const keys = new Map(nodes.map((node, index) => [node, index]));
  const preferred = new Set();
  while (ready.length) {
    ready.sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a)) ||
      laneRank(a) - laneRank(b) || keys.get(a) - keys.get(b));
    const node = ready.shift();
    ordered.push(node);
    for (const { target, isDefault } of successors.get(node) ?? []) {
      if (isDefault) preferred.add(target);
      incoming.set(target, incoming.get(target) - 1);
      if (!incoming.get(target)) ready.push(target);
    }
  }
  if (ordered.length !== nodes.length) throw new Error('Expected acyclic ELK input');
  return { ordered, back, dag };
}

