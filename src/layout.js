const GRID = 10;
const TOLERANCE = 20;
const EPSILON = 1e-7;

const floorGrid = (value) => Math.floor((value + EPSILON) / GRID) * GRID;
export const ceilGrid = (value) => Math.ceil((value - EPSILON) / GRID) * GRID;
export const snap = (value) => Math.round(value / GRID) * GRID;

export const center = (rect, axis) =>
  rect[axis] + rect[axis === 'x' ? 'width' : 'height'] / 2;

const right = (rect) => rect.x + rect.width;
const bottom = (rect) => rect.y + rect.height;

export function intersects(a, b) {
  return a.x < right(b) && b.x < right(a) &&
    a.y < bottom(b) && b.y < bottom(a);
}

export function translate(rect, delta) {
  return { x: rect.x + delta.x, y: rect.y + delta.y, width: rect.width, height: rect.height };
}

export function translateWaypoints(points, delta) {
  const shift = (point) => ({ x: point.x + delta.x, y: point.y + delta.y });
  return points.map((point) => point.original ? { ...shift(point), original: shift(point.original) } : shift(point));
}

export function boundsOf(rects) {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));

  return {
    x, y,
    width: Math.max(...rects.map(right)) - x,
    height: Math.max(...rects.map(bottom)) - y
  };
}

export function nearestFreeBox(preferred, obstacles, limits, clearance, diagonals = []) {
  const { width, height } = preferred;
  const minX = limits?.x ?? -Infinity;
  const minY = limits?.y ?? -Infinity;
  const maxX = limits ? right(limits) - width : Infinity;
  const maxY = limits ? bottom(limits) - height : Infinity;
  if (minX > maxX || minY > maxY) return null;

  // Expand each obstacle into the range of top-left positions it blocks.
  const blocked = obstacles.map((box) => ({
    left: box.x - clearance - width, right: right(box) + clearance,
    top: box.y - clearance - height, bottom: bottom(box) + clearance
  }));
  const xEdges = blocked.flatMap(({ left, right }) => [left, right]);
  const yEdges = blocked.flatMap(({ top, bottom }) => [top, bottom]);
  const polygons = diagonals.map(([a, b]) => sweptBox(a, b, width, height, clearance));
  const slanted = (x, y) => polygons.some((edges) => edges.every(([a, b]) =>
    (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >
      EPSILON * Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
  const candidates = (value, min, max, edges) => [...new Set([
    Math.max(min, Math.min(value, max)), ...edges
  ])].filter((coordinate) => coordinate >= min && coordinate <= max)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b);

  let best = null;
  let distance = Infinity;
  for (const x of candidates(preferred.x, minX, maxX, xEdges)) {
    const dx = (x - preferred.x) ** 2;
    if (dx >= distance) break;
    const active = blocked.filter(({ left, right }) => x > left && x < right);
    for (const y of candidates(preferred.y, minY, maxY, active.flatMap(({ top, bottom }) => [top, bottom]))) {
      const cost = dx + (y - preferred.y) ** 2;
      if (cost >= distance) break;
      if (active.some(({ top, bottom }) => y > top && y < bottom) || slanted(x, y)) continue;
      best = { x, y, width, height };
      distance = cost;
      break;
    }
  }

  if (polygons.length && distance > 0) {
    const edges = polygons.flat();
    function consider(x, y) {
      const cost = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
      if (cost >= distance || x < minX || x > maxX || y < minY || y > maxY || slanted(x, y) ||
          blocked.some(({ left, right, top, bottom }) => x > left && x < right && y > top && y < bottom)) return;
      best = { x, y, width, height };
      distance = cost;
    }
    // A minimum on a blocked boundary is its projection, a vertex, or an intersection.
    for (const [index, [a, b]] of edges.entries()) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const at = (t) => {
        if (t >= 0 && t <= 1) consider(a.x + dx * t, a.y + dy * t);
      };
      consider(a.x, a.y);
      at(((preferred.x - a.x) * dx + (preferred.y - a.y) * dy) / (dx ** 2 + dy ** 2));
      if (dx) for (const x of [...xEdges, minX, maxX]) at((x - a.x) / dx);
      if (dy) for (const y of [...yEdges, minY, maxY]) at((y - a.y) / dy);
      for (const [c, d] of edges.slice(index + 1)) {
        const ux = d.x - c.x;
        const uy = d.y - c.y;
        const determinant = dx * uy - dy * ux;
        if (!determinant) continue;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
        if (u >= 0 && u <= 1) at(((c.x - a.x) * uy - (c.y - a.y) * ux) / determinant);
      }
    }
  }
  return best;
}

function sweptBox(first, second, width, height, margin) {
  const [a, b] = first.x < second.x ? [first, second] : [second, first];
  const corners = ({ x, y }) => [
    { x: x - width - margin, y: y - height - margin }, { x: x + margin, y: y - height - margin },
    { x: x + margin, y: y + margin }, { x: x - width - margin, y: y + margin }
  ];
  const [aTL, aTR, aBR, aBL] = corners(a);
  const [bTL, bTR, bBR, bBL] = corners(b);
  const points = a.y < b.y ? [aTL, aTR, bTR, bBR, bBL, aBL] : [aTL, bTL, bTR, bBR, aBR, aBL];
  return points.map((point, i) => [point, points[(i + 1) % points.length]]);
}

const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function clusterColumns(units, rows) {
  const sorted = [...units].sort((a, b) =>
    center(a.shape, 'x') - center(b.shape, 'x') || compareIds(a.shape.id, b.shape.id)
  );
  const groups = [];
  let group;

  for (const unit of sorted) {
    const position = center(unit.shape, 'x');
    const row = rows.get(unit);

    if (!group || position - group.first > TOLERANCE || group.rows.has(row)) {
      group = { first: position, last: position, units: [], rows: new Set() };
      groups.push(group);
    }

    group.last = position;
    group.units.push(unit);
    group.rows.add(row);
  }

  return groups;
}

export function forwardFlows(units, flows) {
  const outgoing = new Map(units.map((unit) => [unit, []]));
  const hasIncoming = new Set();
  for (const flow of [...flows].sort((a, b) => compareIds(a.id, b.id))) {
    outgoing.get(flow.source).push(flow);
    if (flow.source !== flow.target) hasIncoming.add(flow.target);
  }

  const starts = [...units].sort((a, b) =>
    Number(hasIncoming.has(a)) - Number(hasIncoming.has(b)) || compareIds(a.shape.id, b.shape.id)
  );
  const visited = new Set();
  const active = new Set();
  const forward = [];

  // Edges to a node on the current DFS path close a cycle, including self-loops.
  for (const start of starts) {
    if (visited.has(start)) continue;
    visited.add(start);
    active.add(start);
    const stack = [{ unit: start, index: 0 }];
    while (stack.length) {
      const frame = stack.at(-1);
      const flow = outgoing.get(frame.unit)[frame.index++];
      if (!flow) {
        active.delete(frame.unit);
        stack.pop();
      } else if (!active.has(flow.target)) {
        forward.push(flow);
        if (!visited.has(flow.target)) {
          visited.add(flow.target);
          active.add(flow.target);
          stack.push({ unit: flow.target, index: 0 });
        }
      }
    }
  }
  return forward;
}

function columnOrder(groups, edges, preferOriginal = true) {
  const incoming = new Map([...groups].map((group) => [group, 0]));
  const outgoing = new Map([...groups].map((group) => [group, []]));
  for (const [source, target] of edges) {
    outgoing.get(source).push(target);
    incoming.set(target, incoming.get(target) + 1);
  }

  const ready = [...groups].filter((group) => !incoming.get(group));
  const order = [];
  while (ready.length) {
    if (preferOriginal) {
      ready.sort((a, b) => b.anchor - a.anchor || compareIds(b.units[0].shape.id, a.units[0].shape.id));
    }
    const next = ready.pop();
    order.push(next);
    for (const target of outgoing.get(next)) {
      const count = incoming.get(target) - 1;
      incoming.set(target, count);
      if (!count) ready.push(target);
    }
  }
  return order.length === groups.size ? order : null;
}

function describeColumn(units) {
  const positions = units.map(({ shape }) => center(shape, 'x'));
  return { units, anchor: (Math.min(...positions) + Math.max(...positions)) / 2 };
}

function verticalColumns(units, flows, joinAcrossLanes) {
  const originalVertical = ({ source, target }) =>
    Math.abs(center(source.shape, 'x') - center(target.shape, 'x')) <= TOLERANCE &&
    Math.abs(center(source.shape, 'y') - center(target.shape, 'y')) > TOLERANCE;
  const crossesLanes = ({ source, target }) => joinAcrossLanes && source.lane && target.lane && source.lane !== target.lane;
  const vertical = (flow) => originalVertical(flow) || crossesLanes(flow);
  const horizontalTargets = new Set(flows.filter((flow) => !vertical(flow)).map((flow) => flow.target));
  const candidates = new Set(flows.filter((flow) =>
    vertical(flow) &&
    !(flow.target.shape.type === 'bpmn:EndEvent' && horizontalTargets.has(flow.source))
  ));
  const columns = new Map(units.map((unit) => [unit, describeColumn([unit])]));
  const edges = () => flows.map(({ source, target }) => [columns.get(source), columns.get(target)]);

  for (const { source, target } of [...candidates].sort((a, b) => compareIds(a.id, b.id))) {
    const first = columns.get(source);
    const second = columns.get(target);
    if (first === second) continue;
    const members = [...first.units, ...second.units];
    const lanes = new Set(members.map((unit) => unit.lane));
    if (lanes.size > 1 && lanes.size !== members.length) continue;
    const merged = describeColumn(members);
    for (const unit of merged.units) columns.set(unit, merged);

    // Contract the vertical link only if every strict edge can still go right.
    const pairs = edges();
    const collapsesStrictEdge = pairs.some(([from, to], index) => from === to && !candidates.has(flows[index]));
    if (collapsesStrictEdge || !columnOrder(new Set(columns.values()), pairs.filter(([a, b]) => a !== b), false)) {
      for (const group of [first, second]) {
        for (const unit of group.units) columns.set(unit, group);
      }
    }
  }

  return columns;
}

function findBranchCandidates(flows) {
  const outgoing = new Map();
  const incoming = new Map();

  for (const { source, target } of flows) {
    if (!outgoing.has(source)) outgoing.set(source, []);
    outgoing.get(source).push(target);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  const branches = [];
  for (const [split, targets] of outgoing) {
    if (targets.length < 2) continue;

    for (const target of targets) {
      const units = [];
      let node = target;
      // A side path can be moved as a unit when its internal nodes have
      // a single predecessor and successor.
      while (incoming.get(node) === 1 && outgoing.get(node)?.length === 1) {
        units.push(node);
        [node] = outgoing.get(node);
      }
      if (units.length && node !== split && incoming.get(node) > 1) {
        branches.push({ split, merge: node, units });
      }
    }
  }

  return branches;
}

function clusterRows(units, flows, candidates, columns) {
  const next = new Map();
  const previous = new Set();
  const straightSources = new Set();
  const straightTargets = new Set();
  const alternatives = new Map();
  const forward = flows.filter(({ source, target }) => columns.get(source) !== columns.get(target));
  const incoming = new Map();
  const outgoing = new Map();
  for (const { source, target } of flows) {
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
    if (!outgoing.has(source)) outgoing.set(source, []);
    outgoing.get(source).push(target);
  }
  function bypassesPath({ source, target }) {
    if (outgoing.get(source).length < 2 || incoming.get(target) < 2) return false;
    const pending = outgoing.get(source).filter((next) => next !== target);
    const visited = new Set(pending);
    while (pending.length) {
      for (const next of outgoing.get(pending.pop()) ?? []) {
        if (next === target) return true;
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    return false;
  }
  const rise = ({ source, target }) => Math.abs(center(target.shape, 'y') - center(source.shape, 'y'));
  const straightContinuations = new Set(forward.filter((flow) =>
    rise(flow) === 0 && center(flow.source.shape, 'x') < center(flow.target.shape, 'x'))
    .map(({ source }) => source));
  // Give bypasses priority when choosing a row for staggered branches.
  // An existing straight continuation already establishes the split's row.
  const bypasses = new Set(forward.filter((flow) =>
    (rise(flow) === 0 || !straightContinuations.has(flow.source)) && bypassesPath(flow)));
  forward.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) ||
    Number(bypasses.has(b)) - Number(bypasses.has(a)) || rise(a) - rise(b) ||
    compareIds(a.id, b.id)
  );

  // Each node has at most one continuation and one predecessor on the same row.
  for (const flow of forward) {
    const { source, target } = flow;
    const straight = rise(flow) === 0;
    const leavesRow = !straight && (straightSources.has(source) || straightTargets.has(target));
    if (!next.has(source) && !previous.has(target) && !leavesRow) {
      next.set(source, target);
      previous.add(target);
      if (straight) {
        straightSources.add(source);
        straightTargets.add(target);
      }
    } else {
      // A shortcut can lose to another link on the same row. Keep its
      // endpoints on that row ahead of later, lower-ranked links.
      if (straight && (straightSources.has(source) || straightTargets.has(target))) {
        if (!next.has(source)) straightSources.add(source);
        if (!previous.has(target)) straightTargets.add(target);
      }
      if (!alternatives.has(source)) alternatives.set(source, new Set());
      if (!alternatives.has(target)) alternatives.set(target, new Set());
      alternatives.get(source).add(target);
      alternatives.get(target).add(source);
    }
  }

  const branches = candidates.filter(({ split, merge, units }) => {
    if (next.get(split) === units[0] || units.some((unit) => columns.get(unit).units.length > 1)) return false;
    for (let node = next.get(split); node; node = next.get(node)) {
      if (node === merge) return true;
    }
    return false;
  });
  const branchUnits = new Set(branches.flatMap((branch) => branch.units));
  const paths = branches.map((branch) => describeRow(branch.units, true));

  for (const start of units) {
    if (previous.has(start) || branchUnits.has(start)) continue;

    const path = [];
    for (let unit = start; unit; unit = next.get(unit)) path.push(unit);
    paths.push(describeRow(path, false));
  }

  const rows = [];
  for (const path of paths.sort((a, b) => a.anchor - b.anchor || compareIds(a.id, b.id))) {
    const row = rows.at(-1);
    if (row && !row.branch && !path.branch &&
        Math.max(row.last, path.last) - Math.min(row.first, path.first) <= TOLERANCE &&
        !path.units.some((unit) => row.units.some((other) =>
          columns.get(unit) === columns.get(other) ||
          (alternatives.get(unit)?.has(other) && center(unit.shape, 'y') !== center(other.shape, 'y'))
        ))) {
      row.first = Math.min(row.first, path.first);
      row.last = Math.max(row.last, path.last);
      row.anchor = (row.first + row.last) / 2;
      row.units.push(...path.units);
    } else {
      rows.push(path);
    }
  }

  return { rows, branches, branchUnits };
}

function describeRow(units, branch) {
  const centers = units.map((unit) => center(unit.shape, 'y')).sort((a, b) => a - b);
  const middle = Math.floor(centers.length / 2);
  const anchor = (centers[middle] + centers[Math.floor((centers.length - 1) / 2)]) / 2;
  return { units, first: centers[0], last: centers.at(-1), anchor, id: units[0].shape.id, branch };
}

function indexGroups(groups) {
  return new Map(groups.flatMap((group, index) => group.units.map((unit) => [unit, index])));
}

function extent(units, axis) {
  const size = axis === 'x' ? 'width' : 'height';
  return {
    start: Math.min(...units.map(({ area }) => area[axis])),
    end: Math.max(...units.map(({ area }) => area[axis] + area[size])),
    before: Math.min(...units.map(({ area, shape }) => area[axis] - center(shape, axis))),
    after: Math.max(...units.map(({ area, shape }) => area[axis] + area[size] - center(shape, axis)))
  };
}

function distance(previous, next, { minimum, maximum, compact }) {
  const padding = previous.after - next.before;
  const lower = ceilGrid(padding + minimum);
  return compact ? lower : Math.max(lower, Math.min(ceilGrid(padding + next.start - previous.end),
    floorGrid(padding + (maximum ?? Infinity))));
}

function upperDistance(previous, next, maximum) {
  return floorGrid(previous.after - next.before + (maximum ?? Infinity));
}

function placeAxis(groups, axis, crossAxis, spacing) {
  const { compact, maximum, minimum, neighbors } = spacing;
  const positions = new Map();
  const previousByLine = new Map();
  let previous;

  for (const group of groups) {
    const edges = extent(group.units, axis);
    const anchor = snap(group.anchor ?? (group.first + group.last) / 2);
    let lower = -Infinity;
    let upper = Infinity;

    function constrain(last, units, edges) {
      const near = maximum !== undefined && last.units.some((a) => units.some((b) => a.lane === b.lane));
      lower = Math.max(lower,
        last.position + distance(last.edges, edges,
          maximum === undefined || near ? spacing : { minimum, compact: true }),
        // Keep distinct rows or columns distinct on subsequent runs.
        last.position + ceilGrid(TOLERANCE + 1)
      );
      if (near) {
        upper = Math.min(upper, last.position + upperDistance(last.edges, edges, maximum));
        neighbors?.(last.units, units);
      }
    }

    if (previous) constrain(previous, group.units, edges);

    const lines = new Map();
    for (const unit of group.units) {
      const line = crossAxis.get(unit);
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push(unit);
    }
    const lineEdges = new Map();

    for (const [line, units] of lines) {
      const edges = extent(units, axis);
      const last = previousByLine.get(line);
      if (last) constrain(last, units, edges);
      lineEdges.set(line, edges);
    }

    const position = Math.max(lower, Math.min(compact && previous ? -Infinity : anchor, upper));
    for (const [line, edges] of lineEdges) {
      previousByLine.set(line, { position, edges, units: lines.get(line) });
    }
    for (const unit of group.units) positions.set(unit, position);
    previous = { position, edges, units: group.units };
  }

  return positions;
}

function placeColumns(rows, branches, branchUnits, columns, flows, spacing) {
  const { compact, minimum, maximum, neighbors } = spacing;
  const groups = new Set([...columns].filter(([unit]) => !branchUnits.has(unit)).map(([, group]) => group));
  const incoming = new Map([...groups].map((group) => [group, []]));
  const edges = [];
  const edgesByUnit = new Map([...columns.keys()].map((unit) => [unit, extent([unit], 'x')]));
  const between = (source, target, rules) =>
    Math.max(ceilGrid(TOLERANCE + 1), distance(edgesByUnit.get(source), edgesByUnit.get(target), rules));
  const branchDistance = (source, target) => between(source, target,
    source.lane === target.lane ? spacing : { minimum, compact });
  function constrain(source, target, span, adjacent = false) {
    const from = columns.get(source);
    const to = columns.get(target);
    if (from === to) return;
    edges.push([from, to]);
    incoming.get(to).push({ from, source, target, span, adjacent });
  }

  for (const { source, target } of flows) {
    if (!branchUnits.has(source) && !branchUnits.has(target)) {
      constrain(source, target);
    }
  }

  const placements = branches.map(({ split, merge, units }) => {
    const offsets = [0];
    for (let index = 1; index < units.length; index++) {
      const source = units[index - 1];
      const target = units[index];
      offsets.push(offsets.at(-1) + branchDistance(source, target));
      if (source.lane === target.lane) neighbors?.([source], [target]);
    }

    const left = Math.min(...units.map((unit, index) => offsets[index] + edgesByUnit.get(unit).before));
    const right = Math.max(...units.map((unit, index) => offsets[index] + edgesByUnit.get(unit).after));
    const midpoint = (left + right) / 2;
    const startGap = branchDistance(split, units[0]);
    const endGap = offsets.at(-1) + branchDistance(units.at(-1), merge);
    // Use the smallest span whose snapped midpoint meets both edge gaps.
    let span = ceilGrid(2 * Math.max(startGap + midpoint, endGap - midpoint) - GRID);
    const start = snap(span / 2 - midpoint);
    if (start < startGap || span - start < endGap) span += GRID;
    constrain(split, merge, span);
    return { split, merge, units, offsets, midpoint };
  });

  // Order neighbors by a topological traversal, with their original columns as
  // preferences whenever there is no flow requiring a different order.
  const preferred = columnOrder(groups, edges);
  const rank = new Map(preferred.map((group, index) => [group, index]));
  for (const row of rows) {
    if (row.branch) continue;
    const neighbors = [...row.units].sort((a, b) => rank.get(columns.get(a)) - rank.get(columns.get(b)));
    for (let index = 1; index < neighbors.length; index++) {
      const source = neighbors[index - 1];
      const target = neighbors[index];
      constrain(source, target, undefined, true);
    }
  }

  const positions = new Map();
  const x = new Map();
  const anchor = compact ? Math.min(...preferred.map((column) => column.anchor)) : null;
  for (const group of preferred) {
    let lower = -Infinity;
    let upper = Infinity;
    for (const { from, source, target, span, adjacent } of incoming.get(group)) {
      const near = source.lane === target.lane && (adjacent || rank.get(group) === rank.get(from) + 1);
      // A link spanning other columns or crossing lanes sets a lower bound.
      const rules = maximum === undefined || near ? spacing : { minimum, compact: true };
      lower = Math.max(lower, positions.get(from) + (span ?? between(source, target, rules)));
      if (span === undefined && near && maximum !== undefined) {
        upper = Math.min(upper, positions.get(from) +
          upperDistance(edgesByUnit.get(source), edgesByUnit.get(target), maximum));
        neighbors?.([source], [target]);
      }
    }
    const position = Math.max(lower, Math.min(snap(anchor ?? group.anchor), upper));
    positions.set(group, position);
    for (const unit of group.units) x.set(unit, position);
  }

  for (const { split, merge, units, offsets, midpoint } of placements) {
    const start = snap((x.get(split) + x.get(merge)) / 2 - midpoint);
    units.forEach((unit, index) => x.set(unit, start + offsets[index]));
  }
  return x;
}

function reuseBranchRows(rows, branches, x, gap) {
  if (!branches.length) return rows;

  const packed = [...rows];
  const rowByUnit = new Map(rows.flatMap((row) => row.units.map((unit) => [unit, row])));
  const branchesByFirst = new Map(branches.map((branch) => [branch.units[0], branch]));
  for (const row of rows) {
    if (!row.branch) continue;
    const index = packed.indexOf(row);
    if (index < 0) continue;

    const { split, merge, units } = branchesByFirst.get(row.units[0]);
    const splitRow = packed.indexOf(rowByUnit.get(split));
    const mergeRow = packed.indexOf(rowByUnit.get(merge));
    const lane = units[0].lane;
    if ([split, ...units, merge].some((unit) => unit.lane !== lane)) continue;

    // Keep the bypass on the same side of both endpoints. Include the
    // endpoints in its horizontal span to make room for the connecting lines.
    const span = boundsOf([split, ...units, merge].map((unit) =>
      translate(unit.area, { x: x.get(unit) - center(unit.shape, 'x'), y: 0 })));
    const neighbors = [index - 1, index + 1].filter((neighbor) => {
      if (!packed[neighbor] || [splitRow, mergeRow].some((end) =>
        (index < end) !== (neighbor < end) || neighbor === end)) return false;
      return packed[neighbor].units.every((unit) => {
        const left = unit.area.x + x.get(unit) - center(unit.shape, 'x');
        return unit.lane === lane && (left - right(span) >= gap || span.x - left - unit.area.width >= gap);
      });
    });
    if (!neighbors.length) continue;

    const [neighbor] = neighbors.sort((a, b) =>
      Math.abs(packed[a].anchor - row.anchor) - Math.abs(packed[b].anchor - row.anchor));
    const shared = packed[neighbor];
    const combined = { ...shared, units: [...shared.units, ...row.units], branch: false };
    packed[neighbor] = combined;
    packed.splice(index, 1);
    for (const unit of combined.units) rowByUnit.set(unit, combined);
  }
  return packed;
}

function fitAxis(start, end, min, max) {
  const low = ceilGrid(min - start);
  const high = floorGrid(max - end);
  return low <= high ? Math.max(low, Math.min(0, high)) : null;
}

export function layoutRegion(units, limits, gaps, flows = [], options = {}) {
  if (!units.length) return new Map();
  const { compact, joinAcrossLanes, sharedColumns, neighbors } = options;
  const horizontal = { minimum: gaps.x, maximum: gaps.maxX, compact: compact && gaps.maxX === undefined,
    neighbors: neighbors?.x };
  const vertical = { minimum: gaps.y, maximum: gaps.maxY, compact: compact && gaps.maxY === undefined,
    neighbors: neighbors?.y };
  const forward = forwardFlows(units, flows);
  const columns = verticalColumns(units, forward, joinAcrossLanes);
  const { rows, branches, branchUnits } = clusterRows(units, forward, findBranchCandidates(forward), columns);
  const rowIndex = indexGroups(rows);
  const x = forward.length
    ? placeColumns(rows, branches, branchUnits, columns, forward, horizontal)
    : placeAxis(clusterColumns(units, rowIndex), 'x', rowIndex, horizontal);
  const packed = options.reuseBranchRows ? reuseBranchRows(rows, branches, sharedColumns ?? x, gaps.x) : rows;
  const y = placeAxis(packed, 'y', x, vertical);
  const deltas = new Map(units.map((unit) => [unit, {
    x: x.get(unit) - center(unit.shape, 'x'),
    y: y.get(unit) - center(unit.shape, 'y')
  }]));
  const area = boundsOf(units.map((unit) => translate(unit.area, deltas.get(unit))));
  const dx = fitAxis(area.x, right(area), limits.left, limits.right);
  const dy = fitAxis(area.y, bottom(area), limits.top, limits.bottom);

  if (dx === null || dy === null) {
    return null;
  }
  const edges = [area.x + dx, right(area) + dx, area.y + dy, bottom(area) + dy];
  if (edges.some((edge) => !Number.isFinite(edge) || Math.abs(edge) > Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  for (const delta of deltas.values()) {
    delta.x += dx;
    delta.y += dy;
    if (Math.abs(delta.x) < EPSILON) delta.x = 0;
    if (Math.abs(delta.y) < EPSILON) delta.y = 0;
  }
  return deltas;
}

const unbounded = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };

export function layoutProcess(units, flows, gaps, options = {}) {
  const byLane = Map.groupBy(units, (unit) => unit.lane);
  const horizontal = layoutRegion(units, unbounded, byLane.size <= 1 ? gaps : { ...gaps, maxY: undefined }, flows,
    { ...options, joinAcrossLanes: true, neighbors: byLane.size <= 1 ? options.neighbors : { x: options.neighbors?.x } });
  if (!horizontal) return null;

  if (byLane.size <= 1) return horizontal;

  // Columns come from the whole graph. A lane has its own row ordering and spacing.
  const deltas = new Map();
  const sharedColumns = options.reuseBranchRows
    ? new Map(units.map((unit) => [unit, center(unit.shape, 'x') + horizontal.get(unit).x]))
    : undefined;
  for (const [lane, members] of byLane) {
    const local = flows.filter(({ source, target }) => source.lane === lane && target.lane === lane);
    const rows = layoutRegion(members, unbounded, gaps, local,
      { ...options, sharedColumns, neighbors: { y: options.neighbors?.y } });
    if (!rows) return null;
    for (const unit of members) deltas.set(unit, { x: horizontal.get(unit).x, y: rows.get(unit).y });
  }
  return deltas;
}

export function adjacentBranches(units, flows, positions) {
  const branches = findBranchCandidates(forwardFlows(units, flows));
  const pairs = [];
  for (const [split, outgoing] of Map.groupBy(branches, (branch) => branch.split)) {
    for (const related of Map.groupBy(outgoing, (branch) => branch.merge).values()) {
      for (const siblings of Map.groupBy(related, (branch) => branch.units[0].lane).values()) {
        const ordered = siblings.filter(({ units }) => {
          const row = center(positions.get(units[0]), 'y');
          return units.every((unit) => unit.lane === units[0].lane && center(positions.get(unit), 'y') === row);
        })
          .sort((a, b) => center(positions.get(a.units[0]), 'y') - center(positions.get(b.units[0]), 'y') ||
            compareIds(a.units[0].shape.id, b.units[0].shape.id));
        for (let index = 1; index < ordered.length; index++) {
          const first = ordered[index - 1];
          const second = ordered[index];
          const a = center(positions.get(first.units[0]), 'y');
          const b = center(positions.get(second.units[0]), 'y');
          const mainRow = center(positions.get(split), 'y');
          const mainIsStraight = mainRow === center(positions.get(first.merge), 'y');
          const hasDefault = [first, second].some(({ units }) => flows.some((flow) =>
            flow.source === split && flow.target === units[0] && flow.isDefault));
          if (a !== b && !hasDefault && !(mainIsStraight && (a === mainRow || b === mainRow))) {
            pairs.push(new Map([
              ...first.units.map((unit) => [unit, b - a]),
              ...second.units.map((unit) => [unit, a - b])
            ]));
          }
        }
      }
    }
  }
  return pairs;
}
