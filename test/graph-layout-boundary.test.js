import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const legacyModules = new Set(['alignment-plan.js', 'alignment-selection.js', 'scope-plan.js', 'selection-plan.js', 'compact-loops.js']);
const legacyExports = /\b(layoutProcess|layoutRegion|compactLoops|adjacentBranches|forwardFlows)\b/;

test('keeps graph layout independent of the legacy planner transitively', async () => {
  const pending = [new URL('../src/graph-layout/index.js', import.meta.url)];
  const visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    const imports = source.matchAll(/(?:\b(import|export)\s*([^;]*?)\s*from\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g);
    for (const [, , names, path] of imports) {
      const dependency = new URL(path, url);
      const filename = dependency.pathname.split('/').at(-1);
      assert.ok(!legacyModules.has(filename), `${url.pathname} reaches ${filename}`);
      if (filename === 'layout.js') {
        assert.ok(names?.trim().startsWith('{'), `${url.pathname} must name the shared primitives it uses`);
        assert.doesNotMatch(names, legacyExports, url.pathname);
      }
      pending.push(dependency);
    }
  }
  assert.ok([...visited].some((url) => url.endsWith('/routing-bounds.js')));
  assert.ok([...visited].some((url) => url.endsWith('/route-flows.js')));
});
