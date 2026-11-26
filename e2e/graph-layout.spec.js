import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { readDiagram as loadModel } from '../test/helpers/read-fixture.js';
import { cutsInterior, expandObstacle } from '../src/route-flows.js';
import { modelOrder } from '../src/graph-layout/model-order.js';
import { compactBenchmarkXml } from '../scripts/graph-benchmark-workload.js';
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
const shape = (page, id) => page.locator(`[data-element-id="${id}"]`);
const undoButton = (page) => page.getByRole('button', { name: 'Отменить', exact: true });
const redoButton = (page) => page.getByRole('button', { name: 'Повторить', exact: true });

function pathCutsBox(path, box) {
  return path.slice(1).some((point, index) => cutsInterior(path[index], point, box));
}

async function drag(page, id, dx, dy, offsetX) {
  const { x, y, width, height } = await shape(page, id).locator('.djs-visual').boundingBox();
  const start = { x: x + (offsetX ?? width / 2), y: y + height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

function delta(before, after, id) {
  return [after.shapes[id].x - before.shapes[id].x, after.shapes[id].y - before.shapes[id].y];
}

async function semantics(download) {
  const { figures, edges, auxiliary, messageFlows } = await loadModel(await fileContent(download));
  return {
    shapes: figures.map(({ model }) => [model.id, model.$type, model.$parent.id, model.default?.id]).sort(),
    connections: [...edges, ...auxiliary, ...messageFlows].map(({ model, source, target }) =>
      [model.id, model.$type, model.$parent.id, source?.id, target?.id, model.associationDirection,
        model.conditionExpression?.body]).sort()
  };
}

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
  const scopes = [diagram.root, ...diagram.figures.filter((figure) => figure.kind === 'pool' || figure.expanded)];
  return Object.fromEntries(scopes.map((scope) => [scope.id, Object.values(modelOrder(scope))
    .map((members) => members.map(({ id }) => id))]));
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

test('exports both shortcuts with 16 pixels of clearance from foreign tasks', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('graph-layout/two-shortcuts'), 'two-shortcuts.bpmn');
  await graphButton(page).click();
  await applyPreview(page);
  await expect(summary(page)).toHaveText('Выравнивание выполнено');

  const download = await downloadDiagram(page);
  const { shapes, routes } = await readDiagram(page, download);
  const { LastTask, MiddleTask } = shapes;
  const [start, exit, entry, end] = routes.SecondShortcut;
  for (const [id, obstacle] of [['FirstShortcut', shapes.FirstTask], ['SecondShortcut', shapes.LastTask]]) {
    expect(pathCutsBox(routes[id], expandObstacle(obstacle, 16)), id).toBe(false);
  }
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

for (const axis of ['x', 'y']) {
  test(`applies mixed-orientation pools along ${axis} with one undo and a stable export`, async ({ page }) => {
    test.skip(process.env.BPMN_GRAPH_MIXED_VERIFICATION !== '1', 'Build in graph-mixed-verification mode.');
    const source = await compactBenchmarkXml(axis);
    await page.goto('/');
    await openXml(page, `mixed-${axis}.bpmn`, source);
    const before = await downloadDiagram(page);
    const original = await readDiagram(page, before);
    const undo = page.locator('#undo');
    expect(original.labels).not.toHaveProperty('Delivery');

    await graphButton(page).click();
    await expect(preview(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(undo).toBeDisabled();
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);

    await graphButton(page).click();
    await applyPreview(page);
    const after = await downloadDiagram(page);
    const aligned = await readDiagram(page, after);
    const { Sender, Receiver, Carrier, SenderLane, ReceiverLane, Note, Send } = aligned.shapes;
    const cross = axis === 'x' ? 'y' : 'x';
    const span = axis === 'x' ? 'width' : 'height';
    expect([Sender.x, Sender.y]).toEqual([40.25, 45.5]);
    expect([Receiver[cross], Carrier[cross]]).toEqual([Sender[cross], Sender[cross]]);
    expect(Receiver[axis] - Sender[axis] - Sender[span]).toBe(80);
    expect(Carrier.width).toBe(140.25);
    expect(Carrier.height).toBe(180.5);
    expect(SenderLane.x - Sender.x).toBe(30);
    expect(ReceiverLane.y - Receiver.y).toBe(30);
    for (const [id, expected] of [
      ['Sender', [[30, 0], [30, Sender.height]]], ['Receiver', [[0, 30], [Receiver.width, 30]]]
    ]) {
      const line = page.locator(`[data-element-id="${id}"] .djs-visual > path`).first();
      await expect(line).toBeAttached();
      expect(await line.evaluate((path) => [0, path.getTotalLength()].map((distance) => {
        const { x, y } = path.getPointAtLength(distance);
        return [x, y];
      }))).toEqual(expected);
    }
    for (const [id, rotated] of [['SenderLane', true], ['ReceiverLane', false]]) {
      const label = page.locator(`[data-element-id="${id}"] .djs-visual text`).first();
      expect(await label.evaluate((text) => Math.abs(text.transform.baseVal.consolidate()?.matrix.b ?? 0))).toBe(Number(rotated));
    }
    expect(aligned.routes.Inner).toHaveLength(2);
    expect(aligned.routes.Inner[0].x).toBe(aligned.routes.Inner[1].x);
    expect(aligned.routes.Inner[1].y).toBeGreaterThan(aligned.routes.Inner[0].y);
    expect(aligned.labels).toHaveProperty('Delivery');
    for (const coordinate of ['x', 'y']) {
      expect(Note[coordinate] - original.shapes.Note[coordinate]).toBe(Send[coordinate] - original.shapes.Send[coordinate]);
    }
    const initialModel = await loadModel(source);
    const finalModel = await loadModel(await fileContent(after));
    const flags = ({ diElements }) => Object.fromEntries(diElements.filter(({ bpmnElement }) =>
      bpmnElement.$instanceOf('bpmn:Participant') || bpmnElement.$instanceOf('bpmn:Lane'))
      .map((di) => [di.bpmnElement.id, Object.hasOwn(di, 'isHorizontal') ? di.isHorizontal : null]));
    expect(flags(finalModel)).toEqual(flags(initialModel));
    expect(modelRelations(finalModel)).toEqual(modelRelations(initialModel));
    await expectNoChange(page);
    await undo.click();
    await expect(undo).toBeDisabled();
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
    await page.locator('#redo').click();
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
    await reopen(page, after);
    await expectNoChange(page);
    await expect(undo).toBeDisabled();
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  });
}

test('the public beta delays mixed pools while preserving their DI', async ({ page }) => {
  test.skip(process.env.BPMN_GRAPH_MIXED_VERIFICATION === '1', 'The verification build enables mixed pools.');
  await page.goto('/');
  await openXml(page, 'mixed-public.bpmn', await compactBenchmarkXml('y'));
  const original = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(summary(page)).toHaveText('Не удалось выровнять');
  await expect(page.locator('#alignment-result')).toContainText('Пулы на активной плоскости имеют разную ориентацию');
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
});

test('refuses a mismatched lane by ID without changing mixed collaboration DI', async ({ page }) => {
  const xml = (await compactBenchmarkXml('y')).replace('bpmnElement="ReceiverLane" isHorizontal="false"',
    'bpmnElement="ReceiverLane"');
  await page.goto('/');
  await openXml(page, 'lane-mismatch.bpmn', xml);
  const original = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(summary(page)).toHaveText('Не удалось выровнять');
  await expect(page.locator('#alignment-result')).toContainText(/ReceiverLane.*isHorizontal.*false/);
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);
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
  let xml = (await readFile(fixture('compact-loop'), 'utf8'))
    .replace('<bpmn:definitions ', '<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ')
    .replace('<bpmn:sequenceFlow id="BackToTask" sourceRef="Split" targetRef="Rework" />',
      `<bpmn:sequenceFlow id="BackToTask" sourceRef="Split" targetRef="Rework">
        <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">retry = true</bpmn:conditionExpression>
      </bpmn:sequenceFlow>`);
  for (const [id, name] of [['Split', 'Продолжить обработку?'], ['Verify', 'Нужна повторная проверка?']]) {
    const defaultBranch = id === 'Split' ? ' default="Proceed"' : '';
    xml = xml.replace(`<bpmn:exclusiveGateway id="${id}">`,
      `<bpmn:exclusiveGateway id="${id}" name="${name}"${defaultBranch}>`)
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
  for (const [id, path] of Object.entries(aligned.routes)) {
    for (const label of [aligned.labels.Split, aligned.labels.Verify]) {
      expect(pathCutsBox(path, expandObstacle(label, 8)), id).toBe(false);
    }
  }
  expect(await semantics(exported)).toEqual(await semantics(before));
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

test('exports long XOR, parallel and inclusive gateway labels clear of branches in a vertical lane', async ({ page }) => {
  await page.goto('/');
  const xml = (await readFile(fixture('tight-pool'), 'utf8')).replaceAll('isHorizontal="true"', 'isHorizontal="false"');
  const long = 'Длинная подпись шлюза для проверки маршрутов согласования и обработки';
  const base = await loadModel(xml);
  const gateway = base.figures.find(({ type }) => type === 'bpmn:ExclusiveGateway');
  expect(gateway).toBeTruthy();
  for (const type of ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway']) {
    const start = new RegExp(`<bpmn:exclusiveGateway id="${gateway.id}"[^>]*>`);
    const end = '</bpmn:exclusiveGateway>';
    const input = xml.replace(start, `<bpmn:${type} id="${gateway.id}" name="${long}">`)
      .replace(end, `</bpmn:${type}>`)
      .replace(new RegExp(`(bpmnElement="${gateway.id}"[^>]*>\\s*<dc:Bounds[^>]*/>)`),
        '$1<bpmndi:BPMNLabel><dc:Bounds x="240" y="270" width="100" height="60" /></bpmndi:BPMNLabel>');
    await openXml(page, `${type}.bpmn`, input);
    const before = await downloadDiagram(page);
    await graphButton(page).click();
    await applyPreview(page);
    const download = await downloadDiagram(page);
    const aligned = await readDiagram(page, download);
    const label = aligned.labels[gateway.id];
    expect(label.height).toBeGreaterThan(20);
    for (const [id, path] of Object.entries(aligned.routes)) {
      expect(pathCutsBox(path, expandObstacle(label, 8)), id).toBe(false);
    }
    expect(await semantics(download)).toEqual(await semantics(before));
    await reopen(page, download);
    await expectNoChange(page);
    expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  }
});

test('dragging a task or an explicitly selected task and note moves the association in one undo', async ({ page }) => {
  await page.goto('/');
  const snapshot = async () => readDiagram(page, await downloadDiagram(page));
  for (const explicit of [false, true]) {
    await openDiagram(page, fixture('annotation'), 'annotation.bpmn');
    const before = await downloadDiagram(page);
    const original = await readDiagram(page, before);
    if (explicit) {
      await shape(page, 'Work').locator('.djs-hit').click();
      await shape(page, 'Note').locator('.djs-hit').click({ modifiers: ['Shift'] });
    }
    await drag(page, 'Work', 46, 25);
    const movedDownload = await downloadDiagram(page);
    const moved = await readDiagram(page, movedDownload);
    expect(delta(original, moved, 'Work')).not.toEqual([0, 0]);
    expect(delta(original, moved, 'Note')).toEqual(delta(original, moved, 'Work'));
    expect(moved.routes.Comment).not.toEqual(original.routes.Comment);
    expect(await semantics(movedDownload)).toEqual(await semantics(before));

    await undoButton(page).click();
    expect(await snapshot()).toEqual(original);
    await redoButton(page).click();
    expect(await snapshot()).toEqual(moved);
    await reopen(page, movedDownload);
    expect(await snapshot()).toEqual(moved);
    await drag(page, 'Note', 30, 0);
    const noteOnly = await snapshot();
    expect(delta(moved, noteOnly, 'Work')).toEqual([0, 0]);
    expect(delta(moved, noteOnly, 'Note')).not.toEqual([0, 0]);
  }
});

test('a shared note follows only when both anchors move together', async ({ page }) => {
  await page.goto('/');
  const xml = (await readFile(fixture('annotation'), 'utf8'))
    .replace('</bpmn:process>', '<bpmn:association id="Shared" sourceRef="Note" targetRef="Next" /></bpmn:process>')
    .replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNEdge id="Shared_di" bpmnElement="Shared">
      <di:waypoint x="230" y="40" /><di:waypoint x="330" y="40" /><di:waypoint x="330" y="200" />
      </bpmndi:BPMNEdge></bpmndi:BPMNPlane>`);
  await openXml(page, 'shared-note.bpmn', xml);
  const snapshot = async () => readDiagram(page, await downloadDiagram(page));
  const original = await snapshot();
  await drag(page, 'Work', 45, 20);
  const one = await snapshot();
  expect(delta(original, one, 'Work')).not.toEqual([0, 0]);
  expect(one.shapes.Note).toEqual(original.shapes.Note);
  await shape(page, 'Next').locator('.djs-hit').click({ modifiers: ['Shift'] });
  await drag(page, 'Work', 30, 35);
  const both = await snapshot();
  expect(delta(one, both, 'Work')).not.toEqual([0, 0]);
  expect(delta(one, both, 'Note')).toEqual(delta(one, both, 'Work'));
  expect(delta(one, both, 'Next')).toEqual(delta(one, both, 'Work'));
  expect(both.routes.Shared).not.toEqual(one.routes.Shared);
  await undoButton(page).click();
  expect(await snapshot()).toEqual(one);
  await redoButton(page).click();
  expect(await snapshot()).toEqual(both);
});

test('a dragged pool carries its note, subprocess and association once', async ({ page }) => {
  await page.goto('/');
  const xml = (await readFile(fixture('pool-subprocess'), 'utf8'))
    .replace('</bpmn:subProcess>', `<bpmn:textAnnotation id="Note"><bpmn:text>Review</bpmn:text></bpmn:textAnnotation>
      <bpmn:association id="Comment" sourceRef="Note" targetRef="InsideB" /></bpmn:subProcess>`)
    .replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNShape id="Note_di" bpmnElement="Note">
      <dc:Bounds x="104" y="165" width="110" height="22" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Comment_di" bpmnElement="Comment">
      <di:waypoint x="159" y="187" /><di:waypoint x="373" y="187" /><di:waypoint x="373" y="204" />
      </bpmndi:BPMNEdge></bpmndi:BPMNPlane>`);
  await openXml(page, 'subprocess-note.bpmn', xml);
  const before = await downloadDiagram(page);
  const original = await readDiagram(page, before);
  await graphButton(page).click();
  await applyPreview(page);
  const layout = await readDiagram(page, await downloadDiagram(page));
  expect(delta(original, layout, 'Note')).toEqual(delta(original, layout, 'InsideB'));
  await expectNoChange(page);
  await drag(page, 'Pool', 55, 45, 14);
  const download = await downloadDiagram(page);
  const moved = await readDiagram(page, download);
  expect(delta(layout, moved, 'Pool')).not.toEqual([0, 0]);
  for (const id of ['Sub', 'InsideA', 'Note']) {
    expect(delta(layout, moved, id)).toEqual(delta(layout, moved, 'Pool'));
  }
  expect(moved.routes.Comment).not.toEqual(layout.routes.Comment);
  expect(await semantics(download)).toEqual(await semantics(before));
  await undoButton(page).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(layout);
  await redoButton(page).click();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(moved);
  await undoButton(page).click();

  const { width } = await shape(page, 'InsideB').locator('.djs-visual').boundingBox();
  await drag(page, 'InsideB', -30 * width / layout.shapes.InsideB.width, 0, width / 4);
  const bounded = await readDiagram(page, await downloadDiagram(page));
  expect(delta(layout, bounded, 'InsideB')[0]).toBeLessThan(0);
  expect(bounded.shapes.Note).toEqual(layout.shapes.Note);
});

test('shows the blocked gateway in the preview and preserves the input diagram', async ({ page }) => {
  await page.goto('/');
  const long = 'Проверка условий и ограничений маршрута '.repeat(120);
  const xml = (await readFile(fixture('tight-pool'), 'utf8')).replace('Заявка принята?', long);
  await openXml(page, 'blocked-gateway.bpmn', xml);
  const before = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(preview(page)).toContainText('Decision');
  await expect(preview(page)).toContainText('Не удалось разместить подпись шлюза');
  await expect(preview(page).getByRole('button', { name: 'Применить' })).toBeHidden();
  await preview(page).getByRole('button', { name: 'Закрыть' }).click();
  await expect(undoButton(page)).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(before);
});
