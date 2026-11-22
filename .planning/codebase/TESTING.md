---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# Testing Patterns

**Analysis Date:** 2026-11-22

## Test Framework

**Runner:**
- Node.js built-in `node:test`; test files import `test` from `node:test` (`test/layout.test.js`).
- Config: Not applicable; no Jest/Vitest config is present.

**Assertion Library:**
- Node built-in `node:assert/strict`, used for `equal`, `deepEqual`, `ok`, `throws`, and `notDeepEqual` throughout `test/*.test.js`.

**Run Commands:**

```bash
npm test                 # Run all test files through node --test
npm test -- --watch      # Node test watch mode, when interactive watch is needed
npm run build            # Production build check; CI runs it after tests
```

## Test File Organization

**Location:**
- Tests are separate from implementation in `test/`, with one feature-oriented file per area: `test/layout.test.js`, `test/alignment-plan.test.js`, `test/gateway-label-layout.test.js`, and `test/build-metadata.test.js`.

**Naming:**
- Use `*.test.js`; test names are descriptive behavior statements, usually starting with a verb (`test('routes around an obstacle ...')`).

**Structure:**

```text
test/
├── alignment-plan.test.js
├── build-metadata.test.js
├── gateway-label-layout.test.js
└── layout.test.js
```

## Test Structure

**Suite Organization:**

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { placeGatewayLabel } from '../src/gateway-label-layout.js';

test('places a gateway label next to its original side clear of a straight segment', () => {
  const moved = placeGatewayLabel(label, gateway, [], [path], []);
  assert.deepEqual(moved, { ...label, y: 54 });
});
```

This pattern is used in `test/gateway-label-layout.test.js` and applies to all test modules.

**Patterns:**
- Define compact fixtures and builders at module scope (`box`, `point`, `diagram`, `repository`) in `test/alignment-plan.test.js` and `test/build-metadata.test.js`.
- Group related parameter variants with `for` loops and nested `test` calls, as in orientation and spacing coverage in `test/alignment-plan.test.js`.
- Assert exact geometry with `deepEqual` where determinism matters, and use `ok` for invariant checks such as clearance, ordering, and route shape.
- For repeat-run stability, apply a plan, run planning again, and assert no additional boxes plus equal routes (`test/alignment-plan.test.js`).

## Mocking

**Framework:** No mocking library is configured.

**Patterns:**

```javascript
function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), 'bpmn-forge-git-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Build a temporary Git fixture with real git commands.
}
```

`test/build-metadata.test.js` uses temporary repositories and real `git` subprocesses instead of mocks.

**What to Mock:**
- Not applicable for current pure geometry tests. Prefer lightweight in-memory diagram fixtures over browser or bpmn-js mocks.

**What NOT to Mock:**
- Do not replace the Git history behavior in `test/build-metadata.test.js`; its merge, squash, shallow-clone, and strict-mode cases depend on real repository semantics.

## Fixtures and Factories

**Test Data:**

```javascript
const box = (x, y, width = 100, height = 60) => ({ x, y, width, height });
const point = (x, y) => ({ x, y });
```

Use small plain-object fixtures and local builders (`diagram`, `add`, `connect`) as established in `test/alignment-plan.test.js`.

**Location:**
- Fixtures are colocated at the top of each relevant test file. No shared fixture directory is present.

## Coverage

**Requirements:** No coverage threshold or coverage configuration is enforced.

**View Coverage:** Not configured. Use focused tests plus `npm test`; inspect CI build success through `.github/workflows/ci-cd.yml`.

## Test Types

**Unit Tests:**
- The suite is predominantly unit-level, testing pure geometry, routing, label placement, alignment planning, and build metadata in `test/layout.test.js`, `test/alignment-plan.test.js`, `test/gateway-label-layout.test.js`, and `test/build-metadata.test.js`.

**Integration Tests:**
- `test/build-metadata.test.js` is an integration-style test around filesystem, temporary Git repositories, and `scripts/build-metadata.js`.

**E2E Tests:**
- Not detected. Browser workflows (opening, aligning, undoing, downloading) require manual browser verification; `src/main.js` is not exercised by Node tests.

## Common Patterns

**Async Testing:**

```javascript
test('async behavior', async () => {
  const result = await operation();
  assert.equal(result, expected);
});
```

No current test requires async callbacks; use async test functions when exercising browser/build APIs rather than manually wrapping promises.

**Error Testing:**

```javascript
assert.throws(() => readBuildMetadata({ cwd, strict: true }), /baseline/);
```

Match expected error text with a regular expression, as in `test/build-metadata.test.js`, and verify fallback values separately for non-strict operation.

**Cleanup:**
- Register temporary-resource cleanup with `t.after` (`test/build-metadata.test.js`); do not leave generated repositories or files in the project tree.

---

*Testing analysis: 2026-11-22*
