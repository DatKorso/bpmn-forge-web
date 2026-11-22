export function generatedProcess(size, seed, withLane = false, branchEvery = 0) {
  let state = seed;
  function next(limit) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state % limit;
  }

  const root = { id: 'Process', kind: 'root', horizontal: true };
  const lane = withLane ? {
    id: 'Lane', kind: 'lane', scope: root, parent: root, header: 30,
    box: { x: 0, y: 0, width: size * 210, height: 420 }
  } : undefined;
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `Task_${index}`, kind: 'node', type: 'bpmn:Task', scope: root, parent: root, lane,
    box: { x: 80 + index * 160 + next(40), y: 70 + next(240), width: 80 + next(40), height: 50 + next(30) }
  }));
  const edges = nodes.slice(1).map((target, index) => ({ id: `Flow_${index}`, source: nodes[index], target }));
  if (branchEvery) {
    for (let index = 0; index + 3 < size; index += branchEvery) {
      edges.push({ id: `Branch_${index}`, source: nodes[index], target: nodes[index + 3] });
    }
  }
  return { root, figures: lane ? [lane, ...nodes] : nodes, edges };
}
