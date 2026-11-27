import { processOf, typeIs } from './model-order.js';

export function readLaneTree(scope, nodes) {
  const lanes = [];
  const children = new Map();
  const parents = new Map();
  const memberships = new Map();
  const nodeSet = new Set(nodes.filter((node) => typeIs(node, 'bpmn:FlowNode')));
  const failure = (reason, model) => ({ reason, scope, elementId: model.id });

  function visit(sets, parent) {
    const siblings = sets.flatMap((set) => set.lanes ?? []);
    children.set(parent, siblings);
    for (const lane of siblings) {
      if (parents.has(lane)) return failure('graphOwnership', lane);
      lanes.push(lane);
      parents.set(lane, parent);
      for (const member of lane.flowNodeRef ?? []) {
        if (!nodeSet.has(member)) return failure('graphOwnership', member);
        const previous = memberships.get(member);
        // Preorder guarantees that a previous compatible reference is an ancestor.
        if (previous && !includesAncestor(parent, previous)) return failure('graphOwnership', member);
        memberships.set(member, lane);
      }
      const issue = visit(lane.childLaneSet ? [lane.childLaneSet] : [], lane);
      if (issue) return issue;
    }
  }

  function includesAncestor(lane, ancestor) {
    for (let current = lane; current; current = parents.get(current)) {
      if (current === ancestor) return true;
    }
    return false;
  }

  function assignBoundaryEvents() {
    for (const node of nodeSet) {
      if (!typeIs(node, 'bpmn:BoundaryEvent')) continue;
      const hostLane = memberships.get(node.attachedToRef);
      const explicit = memberships.get(node);
      if (explicit && !includesAncestor(hostLane, explicit)) return failure('graphOwnership', node);
      if (hostLane) memberships.set(node, hostLane);
    }
  }

  const issue = visit(processOf(scope)?.laneSets ?? [], undefined) ?? assignBoundaryEvents();
  return { lanes, parents, children, memberships, issue, nested: lanes.find((lane) => lane.childLaneSet) };
}
