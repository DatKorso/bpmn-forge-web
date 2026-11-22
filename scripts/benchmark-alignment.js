import os from 'node:os';
import { planAlignment } from '../src/alignment-plan.js';
import { generatedProcess } from './alignment-workload.js';

const gaps = { x: 40, y: 30 };
console.log(`Node ${process.version}, ${os.cpus()[0].model}, ${process.platform} ${process.arch}`);
for (const [name, branchEvery] of [['linear', 0], ['branching', 6]]) {
  for (const size of [50, 200, 500]) {
    const diagram = generatedProcess(size, 42, false, branchEvery);
    function measure() {
      const start = performance.now();
      const plan = planAlignment(diagram, gaps);
      if (plan.reason || plan.skipped.length || plan.routes.size !== diagram.edges.length) {
        throw new Error(`Incomplete ${name} layout at ${size} nodes`);
      }
      return performance.now() - start;
    }
    measure();
    const times = Array.from({ length: 5 }, measure).sort((a, b) => a - b);
    console.log(`${name} ${size}: median ${times[2].toFixed(1)} ms (range ${times[0].toFixed(1)}–${times[4].toFixed(1)} ms)`);
  }
}
