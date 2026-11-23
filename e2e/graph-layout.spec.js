import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { readDiagram as loadModel } from '../test/helpers/read-fixture.js';
import { modelOrder } from '../src/graph-layout/model-order.js';
import { applyPreview, downloadDiagram, openDiagram, preview, readDiagram } from './helpers/diagram.js';

const fixture = (name) => fileURLToPath(new URL(`../test/fixtures/${name}.bpmn`, import.meta.url));
const graphButton = (page) => page.getByRole('button', { name: 'Перестроить по графу' });
const summary = (page) => page.locator('#alignment-summary');
const fileContent = async (download) => readFile(await download.path(), 'utf8');
const reopen = async (page, download) => openDiagram(page, {
  name: download.suggestedFilename(), mimeType: 'application/xml', buffer: Buffer.from(await fileContent(download))
}, download.suggestedFilename());
const editorFixture = 'graph-layout/collaboration-editor';
const staleMessage = 'Схема изменилась. Запустите выравнивание ещё раз.';

async function openXml(page, filename, xml) {
  await openDiagram(page, { name: filename, mimeType: 'application/xml', buffer: Buffer.from(xml) }, filename);
}

function innerGeometry({ shapes, routes }) {
  return { first: shapes.InnerA, second: shapes.InnerB, route: routes.Inner };
}

async function renderedLabelBounds(page, id) {
  return page.locator(`.djs-element[data-element-id="${id}_label"]`).evaluate((shape) => {
    const { e: x, f: y } = shape.transform.baseVal.getItem(0).matrix;
    const hit = shape.querySelector('.djs-hit');
    return { x, y, width: Number(hit.getAttribute('width')), height: Number(hit.getAttribute('height')) };
  });
}

function modelRelations(diagram) {
  const { participants, messageFlows, artifacts } = diagram.root.model;
  return {
    participants: participants.map(({ id, processRef }) => [id, processRef?.id]),
    messages: messageFlows.map(({ id, sourceRef, targetRef }) => [id, sourceRef.id, targetRef.id]),
    artifacts: artifacts.map(({ id, sourceRef, targetRef, associationDirection }) =>
      [id, sourceRef?.id, targetRef?.id, associationDirection]),
    defaults: diagram.figures.flatMap(({ model }) => model.default ? [[model.id, model.default.id]] : []),
    processOrder: orderOf(diagram)
  };
}

async function holdElk(page) {
  let start;
  let release;
  const loading = new Promise((resolve) => { start = resolve; });
  const ready = new Promise((resolve) => { release = resolve; });
  await page.route('**/elk.bundled-*.js', async (route) => {
    start();
    await ready;
    await route.continue();
  });
  return { loading, release };
}

async function expectNoChange(page) {
  await graphButton(page).click();
  await expect(summary(page)).toHaveText('Изменений нет');
  await expect(preview(page)).toBeHidden();
}

function orderOf(diagram) {
  return [diagram.root, ...diagram.figures.filter((figure) => figure.kind === 'pool' || figure.expanded)]
    .map((scope) => Object.values(modelOrder(scope)).map((members) => members.map(({ id }) => id)));
}

test('graph preview, atomic undo and redo, model order, and export/reopen', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDiagram(page, fixture('tight-pool'), 'tight-pool.bpmn');
  const before = await downloadDiagram(page);
  const original = await readDiagram(page, before);

  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('graph-preview.png') });
  await applyPreview(page);
  await expect(summary(page)).toHaveText('Выравнивание выполнено');
  await expect(graphButton(page)).toBeFocused();
  const after = await downloadDiagram(page);
  const aligned = await readDiagram(page, after);
  expect(aligned.shapes).not.toEqual(original.shapes);
  expect({ flows: aligned.flows, lanes: aligned.lanes, timers: aligned.timers }).toEqual({
    flows: original.flows, lanes: original.lanes, timers: original.timers
  });
  expect(orderOf(await loadModel(await fileContent(after)))).toEqual(orderOf(await loadModel(await fileContent(before))));

  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);

  await reopen(page, after);
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await page.screenshot({ path: testInfo.outputPath('graph-result.png') });
});

test('exports the lower shortcut without a reversal and with 16 pixels of clearance', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('graph-layout/two-shortcuts'), 'two-shortcuts.bpmn');
  await graphButton(page).click();
  await applyPreview(page);
  await expect(summary(page)).toHaveText('Выравнивание выполнено');

  const download = await downloadDiagram(page);
  const { shapes, routes } = await readDiagram(page, download);
  const { LastTask, MiddleTask } = shapes;
  const [start, exit, entry, end] = routes.SecondShortcut;
  expect(routes.SecondShortcut).toHaveLength(4);
  expect(start.y).toBe(MiddleTask.y + MiddleTask.height);
  expect(exit).toEqual({ x: start.x, y: LastTask.y + LastTask.height + 16 });
  expect(entry).toEqual({ x: end.x, y: exit.y });
  await reopen(page, download);
  await expectNoChange(page);
});

for (const name of ['collaboration', 'order-fulfilment']) {
  test(`rebuilds and reopens ${name}.bpmn without additional changes`, async ({ page }) => {
    await page.goto('/');
    await openDiagram(page, fixture(name), `${name}.bpmn`);
    const before = await readDiagram(page, await downloadDiagram(page));
    await graphButton(page).click();
    await applyPreview(page);
    await expect(summary(page)).toHaveText('Выравнивание выполнено');
    await expect(page.locator('#alignment-result')).toContainText(/Перестроено потоков сообщений: [1-9]/);
    const after = await downloadDiagram(page);
    const aligned = await readDiagram(page, after);
    expect(aligned.routes).not.toEqual(before.routes);
    expect(aligned.messages).toEqual(before.messages);
    await expectNoChange(page);
    await reopen(page, after);
    await expectNoChange(page);
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  });
}

test('missing message DI refuses atomically and identifies the message', async ({ page }) => {
  await page.goto('/');
  const xml = (await readFile(fixture('collaboration'), 'utf8'))
    .replace(/<bpmndi:BPMNEdge id="Delivery_di"[\s\S]*?<\/bpmndi:BPMNEdge>/, '');
  await openXml(page, 'partial-di.bpmn', xml);
  const before = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(summary(page)).toHaveText('Не удалось выровнять');
  await expect(preview(page)).toBeHidden();
  await page.getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.locator('#alignment-result')).toContainText('Delivery');
  await page.keyboard.press('Escape');
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(before);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
});

test('the collaboration preview applies notes, routes and labels in one history command', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDiagram(page, fixture(editorFixture), 'collaboration-editor.bpmn');
  await expect(graphButton(page)).toHaveAccessibleDescription(/активную плоскость.*потоки сообщений/);
  const before = await downloadDiagram(page);
  const original = await readDiagram(page, before);
  const importedSequenceLabel = await renderedLabelBounds(page, 'Ready');
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  const redo = page.getByRole('button', { name: 'Повторить', exact: true });
  expect(original.labels).not.toHaveProperty('Delivery');

  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
  await expect(graphButton(page)).toBeFocused();
  await expect(undo).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);

  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('collaboration-preview.png') });
  await applyPreview(page);
  await expect(summary(page)).toHaveText('Выравнивание выполнено');
  await expect(page.locator('#alignment-result')).toContainText('Перестроено потоков сообщений: 1');
  const after = await downloadDiagram(page);
  const aligned = await readDiagram(page, after);
  expect(aligned.labels).toHaveProperty('Delivery');
  expect(aligned.labels).toHaveProperty('Split');
  expect(aligned.labels).toHaveProperty('Merge');
  expect(aligned.lanes.SenderLane).toEqual(['End', 'Merge', 'Prepare', 'Send', 'Split']);
  expect(aligned.lanes).toEqual(original.lanes);
  expect(aligned.shapes.SenderLane).not.toEqual(original.shapes.SenderLane);
  expect(aligned.routes.Ready).toHaveLength(2);
  const [oldStart, oldEnd] = original.routes.Ready;
  const [newStart, newEnd] = aligned.routes.Ready;
  expect(newStart.y).toBe(newEnd.y);
  const midX = Math.round(importedSequenceLabel.x + importedSequenceLabel.width / 2);
  const fraction = (midX - oldStart.x) / (oldEnd.x - oldStart.x);
  const dx = Math.round(newStart.x + fraction * (newEnd.x - newStart.x) - midX);
  expect(aligned.labels.Ready).toEqual({
    ...importedSequenceLabel, x: importedSequenceLabel.x + dx, y: importedSequenceLabel.y + newStart.y - oldStart.y
  });
  expect(aligned.routes.Delivery).not.toEqual(original.routes.Delivery);
  expect(aligned.routes.NoteLink).not.toEqual(original.routes.NoteLink);
  expect(aligned.shapes.Note).not.toEqual(original.shapes.Note);
  for (const axis of ['x', 'y']) {
    expect(aligned.shapes.Note[axis] - original.shapes.Note[axis])
      .toBe(aligned.shapes.Send[axis] - original.shapes.Send[axis]);
  }
  expect(innerGeometry(aligned)).toEqual(innerGeometry(original));
  expect(modelRelations(await loadModel(await fileContent(after))))
    .toEqual(modelRelations(await loadModel(await fileContent(before))));

  await expectNoChange(page);
  await undo.click();
  await expect(undo).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
  await redo.click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await reopen(page, after);
  await expectNoChange(page);
  await expect(undo).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await page.screenshot({ path: testInfo.outputPath('collaboration-result.png') });
});

test('rebuilds identical geometry despite old message paths through a gateway label', async ({ page }) => {
  await page.goto('/');
  const xml = await readFile(fixture(editorFixture), 'utf8');
  const alternative = xml.replace(/(<bpmndi:BPMNEdge id="Delivery_di"[^>]*>)[\s\S]*?(<\/bpmndi:BPMNEdge>)/,
    '$1<di:waypoint x="435" y="150" /><di:waypoint x="280" y="150" />' +
    '<di:waypoint x="280" y="525" /><di:waypoint x="235" y="525" />$2');
  expect(alternative).not.toBe(xml);
  const results = [];
  for (const [index, source] of [xml, alternative].entries()) {
    await openXml(page, `old-message-${index}.bpmn`, source);
    await graphButton(page).click();
    await applyPreview(page);
    results.push(await readDiagram(page, await downloadDiagram(page)));
  }
  expect(results[1]).toEqual(results[0]);
});

test('aligns the drilled-down subprocess even when its outer collaboration DI is incomplete', async ({ page }) => {
  await page.goto('/');
  const xml = (await readFile(fixture(editorFixture), 'utf8'))
    .replace(/<bpmndi:BPMNEdge id="Delivery_di"[\s\S]*?<\/bpmndi:BPMNEdge>/, '');
  await openXml(page, 'outer-defect.bpmn', xml);
  const before = await readDiagram(page, await downloadDiagram(page));
  await page.locator('.bjs-drilldown').click();
  await expect(page.locator('.bjs-breadcrumbs')).toContainText('Обработка');
  await graphButton(page).click();
  await applyPreview(page);
  await expect(summary(page)).toHaveText('Выравнивание выполнено');
  const after = await downloadDiagram(page);
  const aligned = await readDiagram(page, after);
  expect(innerGeometry(aligned)).not.toEqual(innerGeometry(before));
  expect(aligned.shapes).toEqual({ ...before.shapes, InnerA: aligned.shapes.InnerA, InnerB: aligned.shapes.InnerB });
  expect(aligned.routes).toEqual({ ...before.routes, Inner: aligned.routes.Inner });
  expect(aligned.labels).toEqual(before.labels);
  await expectNoChange(page);
  await reopen(page, after);
  await page.locator('.bjs-drilldown').click();
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
});

test('accepts invalid maximum gaps and restores focus after cancellation', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('vertical-pool'), 'vertical-pool.bpmn');
  const original = await readDiagram(page, await downloadDiagram(page));
  await page.locator('#toggle-gaps').click();
  await page.locator('#max-gap-x').fill('1');
  await expect(page.locator('#max-gap-x')).toHaveAttribute('aria-invalid', 'true');
  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
  await expect(graphButton(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
});

test('preserves data association directions and stable DI on repeat and reopen', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('shared-data'), 'shared-data.bpmn');
  const data = async (download) => (await loadModel(await fileContent(download))).auxiliary
    .map(({ id, source, target, type }) => [id, source.id, target.id, type]).sort();
  const before = await downloadDiagram(page);
  expect(await data(before)).toHaveLength(3);
  await graphButton(page).click();
  await applyPreview(page);
  const after = await downloadDiagram(page);
  const aligned = await readDiagram(page, after);
  expect(await data(after)).toEqual(await data(before));
  await expectNoChange(page);
  await reopen(page, after);
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
});

test('keeps neighboring visible gateway labels stable after exporting and reopening', async ({ page }) => {
  await page.goto('/');
  let xml = await readFile(fixture('compact-loop'), 'utf8');
  for (const [id, name] of [['Split', 'Продолжить обработку?'], ['Verify', 'Нужна повторная проверка?']]) {
    xml = xml.replace(`<bpmn:exclusiveGateway id="${id}">`, `<bpmn:exclusiveGateway id="${id}" name="${name}">`)
      .replace(new RegExp(`(bpmnElement="${id}"[^>]*>\\s*<dc:Bounds[^>]*/>)`),
        '$1<bpmndi:BPMNLabel><dc:Bounds x="1360" y="2090" width="85" height="42" /></bpmndi:BPMNLabel>');
  }
  await openDiagram(page, { name: 'close-labels.bpmn', mimeType: 'application/xml', buffer: Buffer.from(xml) }, 'close-labels.bpmn');
  const before = await downloadDiagram(page);
  await graphButton(page).click();
  await applyPreview(page);
  const exported = await downloadDiagram(page);
  const aligned = await readDiagram(page, exported);
  expect(aligned.labels).toHaveProperty('Split');
  expect(aligned.labels).toHaveProperty('Verify');
  expect(orderOf(await loadModel(await fileContent(exported)))).toEqual(orderOf(await loadModel(await fileContent(before))));
  await expectNoChange(page);
  await reopen(page, exported);
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
});

test('a command changing the diagram while ELK loads prevents preview', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('tight-pool'), 'tight-pool.bpmn');
  const { x, y, width, height } = await page.locator('[data-element-id="Review"] .djs-visual').boundingBox();
  await page.mouse.click(x + width / 2, y + height / 2);
  await expect(page.locator('.djs-element[data-element-id="Review"]')).toHaveClass(/selected/);
  const { loading, release } = await holdElk(page);
  await graphButton(page).click();
  try {
    await loading;
    await page.locator('.djs-container > svg').dispatchEvent('keydown', { key: 'Delete', bubbles: true });
    await expect(page.locator('.djs-element[data-element-id="Review"]')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('#alignment-result')).toHaveText(staleMessage);
});

test('switching away from the active plane and back during planning invalidates the result', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture(editorFixture), 'collaboration-editor.bpmn');
  const before = await readDiagram(page, await downloadDiagram(page));
  const { loading, release } = await holdElk(page);
  await graphButton(page).click();
  try {
    await loading;
    // Dispatch beneath the busy overlay to simulate a root change during planning.
    await page.locator('.bjs-drilldown').dispatchEvent('click');
    await expect(page.locator('.bjs-breadcrumbs')).toContainText('Обработка');
    await page.locator('.bjs-breadcrumbs a').dispatchEvent('click');
  } finally {
    release();
  }
  await expect(page.locator('#alignment-result')).toHaveText(staleMessage);
  await expect(preview(page)).toBeHidden();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(before);
});

test('returning to the same history command while confirming invalidates the result', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('tight-pool'), 'tight-pool.bpmn');
  const review = page.locator('[data-element-id="Review"] .djs-visual');
  const { x, y, width, height } = await review.boundingBox();
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2 + 32, y + height / 2 + 27, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#undo')).toBeEnabled();
  const before = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.locator('#undo').dispatchEvent('click');
  await page.locator('#redo').dispatchEvent('click');
  await applyPreview(page);
  await expect(page.locator('#alignment-result')).toHaveText(staleMessage);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(before);
});
