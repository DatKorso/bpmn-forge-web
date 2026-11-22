import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('the pinned BPMN libraries expose the signatures used by the editor adapter', async () => {
  // Vite resolves the libraries' extensionless ESM specifiers in the app.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const libraryImport = /^(?:bpmn-js|diagram-js)\/lib\//.test(specifier) ||
          (specifier.startsWith('.') && /\/node_modules\/(?:bpmn-js|diagram-js)\/lib\//.test(context.parentURL));
        if (error.code !== 'ERR_MODULE_NOT_FOUND' || !libraryImport || specifier.endsWith('.js')) throw error;
        return nextResolve(specifier + '.js', context);
      }
    }
  });
  try {
    const adapter = await import('../src/bpmn-internals.js');
    const { default: CommandStack } = await import('diagram-js/lib/command/CommandStack.js');
    const { default: BpmnUpdater } = await import('bpmn-js/lib/features/modeling/BpmnUpdater.js');
    for (const [name, arity] of Object.entries({
      collectLanes: 2, getLanesRoot: 1, getLabelAdjustment: 4,
      isDirectionHorizontal: 2, isExpanded: 2, isHorizontal: 1
    })) {
      assert.equal(typeof adapter[name], 'function', name);
      assert.equal(adapter[name].length, arity, name);
    }
    assert.equal(adapter.LANE_INDENTATION, 30);
    assert.equal(CommandStack.prototype._getUndoAction.length, 0);
    assert.equal(BpmnUpdater.prototype.updateBounds.length, 1);

    const action = {};
    const stack = new CommandStack({ on() {} }, {});
    stack._stack.push(action);
    stack._stackIdx = 0;
    assert.equal(adapter.getUndoAction(stack), action);
    assert.equal(adapter.getUndoAction(undefined), undefined);
  } finally {
    hooks.deregister();
  }
});
