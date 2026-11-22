import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('../test/fixtures/tight-pool.bpmn', import.meta.url));
const collaborationFixture = fileURLToPath(new URL('../test/fixtures/collaboration.bpmn', import.meta.url));
const loopFixture = fileURLToPath(new URL('../test/fixtures/compact-loop.bpmn', import.meta.url));

const preview = (page) => page.getByRole('dialog', { name: 'Предпросмотр выравнивания' });
const applyPreview = (page) => preview(page).getByRole('button', { name: 'Применить', exact: true }).click();

async function openDiagram(page, path, filename) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#open').click()
  ]);
  await chooser.setFiles(path);
  await expect(page.locator('#document-name')).toHaveAttribute('title', filename);
  await expect(page.locator('#status')).toHaveText('Файл открыт.');
}

async function downloadDiagram(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать BPMN' }).click()
  ]);
  return download;
}

async function readDiagram(page, download) {
  const xml = await readFile(await download.path(), 'utf8');
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    const error = doc.querySelector('parsererror');
    if (error) throw new Error(error.textContent);

    const model = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
    const bpmnDi = 'http://www.omg.org/spec/BPMN/20100524/DI';
    const dc = 'http://www.omg.org/spec/DD/20100524/DC';
    const di = 'http://www.omg.org/spec/DD/20100524/DI';
    const elements = (parent, namespace, name) => [...parent.getElementsByTagNameNS(namespace, name)];
    const byId = (entries, attribute, value) => Object.fromEntries(entries.map((entry) =>
      [entry.getAttribute(attribute), value(entry)]));
    const numbers = (element, names) => Object.fromEntries(names.map((name) => {
      const value = element.getAttribute(name);
      if (value === null || !Number.isFinite(Number(value))) throw new Error(`Invalid BPMN coordinate ${name}`);
      return [name, Number(value)];
    }));
    const bounds = (element) => numbers(element, ['x', 'y', 'width', 'height']);

    const shapes = byId(elements(doc, bpmnDi, 'BPMNShape'), 'bpmnElement', (shape) => bounds(
      [...shape.children].find(({ namespaceURI, localName }) => namespaceURI === dc && localName === 'Bounds')
    ));
    const labels = Object.fromEntries(elements(doc, bpmnDi, 'BPMNLabel').map((label) =>
      [label.parentElement.getAttribute('bpmnElement'), bounds(elements(label, dc, 'Bounds')[0])]));
    const routes = byId(elements(doc, bpmnDi, 'BPMNEdge'), 'bpmnElement', (edge) =>
      elements(edge, di, 'waypoint').map((point) => numbers(point, ['x', 'y'])));
    const lanes = byId(elements(doc, model, 'lane'), 'id', (lane) =>
      elements(lane, model, 'flowNodeRef').map(({ textContent }) => textContent.trim()).sort());
    const connections = (name) => byId(elements(doc, model, name), 'id', (flow) => ({
      sourceRef: flow.getAttribute('sourceRef'),
      targetRef: flow.getAttribute('targetRef')
    }));

    const timers = byId(elements(doc, model, 'boundaryEvent'), 'id', (event) => ({
      attachedTo: event.getAttribute('attachedToRef'),
      duration: elements(event, model, 'timeDuration')[0]?.textContent.trim() ?? null
    }));
    return { shapes, labels, routes, lanes, timers, flows: connections('sequenceFlow'), messages: connections('messageFlow') };
  }, xml);
}

test('aligns an imported BPMN, restores it through undo and redo, and preserves the exported diagram', async ({ page }, testInfo) => {
  const align = page.getByRole('button', { name: 'Выровнять схему' });
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  const redo = page.getByRole('button', { name: 'Повторить', exact: true });
  const summary = page.locator('#alignment-summary');

  await page.goto('/');
  await openDiagram(page, fixture, 'tight-pool.bpmn');
  const original = await readDiagram(page, await downloadDiagram(page));
  expect(Object.keys(original.shapes).sort()).toEqual([
    'Decision', 'End', 'Intake', 'Pool', 'Resolution', 'Review', 'Start', 'Timeout'
  ]);
  expect(original.labels).toHaveProperty('Decision');
  expect(original.lanes).toEqual({
    Intake: ['Review', 'Start', 'Timeout'],
    Resolution: ['Decision', 'End']
  });
  expect(original.flows).toEqual({
    StartToReview: { sourceRef: 'Start', targetRef: 'Review' },
    ReviewToDecision: { sourceRef: 'Review', targetRef: 'Decision' },
    DecisionToEnd: { sourceRef: 'Decision', targetRef: 'End' },
    TimeoutToEnd: { sourceRef: 'Timeout', targetRef: 'End' }
  });
  expect(Object.keys(original.routes).sort()).toEqual(Object.keys(original.flows).sort());

  await align.click();
  await applyPreview(page);
  await expect(summary).toHaveText('Выравнивание выполнено');
  await page.getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.locator('#alignment-result')).toContainText(/Контейнеров с изменённым размером: [1-9]/);
  await page.locator('#messages').getByRole('button', { name: 'Закрыть' }).click();
  const aligned = await readDiagram(page, await downloadDiagram(page));
  expect(Object.keys(aligned.shapes).sort()).toEqual(Object.keys(original.shapes).sort());
  expect(Object.keys(aligned.labels).sort()).toEqual(Object.keys(original.labels).sort());
  expect(Object.keys(aligned.routes).sort()).toEqual(Object.keys(original.routes).sort());
  expect(aligned.shapes.Pool.width).toBeGreaterThan(original.shapes.Pool.width);
  expect(aligned.shapes.Decision).not.toEqual(original.shapes.Decision);
  expect(aligned.routes.ReviewToDecision).not.toEqual(original.routes.ReviewToDecision);
  expect(aligned.lanes).toEqual(original.lanes);
  expect(aligned.flows).toEqual(original.flows);

  await undo.click();
  await expect(redo).toBeEnabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);

  await redo.click();
  await expect(undo).toBeEnabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);

  await align.click();
  await expect(summary).toHaveText('Изменений нет');
  const exported = await downloadDiagram(page);
  expect(await readDiagram(page, exported)).toEqual(aligned);

  const exportedPath = testInfo.outputPath('aligned.bpmn');
  await exported.saveAs(exportedPath);
  await openDiagram(page, exportedPath, 'aligned.bpmn');
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
});

test('moves a task and resizes a pool after applying alignment bounds', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture, 'tight-pool.bpmn');
  await page.getByRole('button', { name: 'Выровнять схему' }).click();
  await applyPreview(page);
  await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание выполнено');
  const snapshot = async () => readDiagram(page, await downloadDiagram(page));
  const aligned = await snapshot();

  async function drag(locator, dx, dy) {
    const { x, y, width, height } = await locator.boundingBox();
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.down();
    await page.mouse.move(x + width / 2 + dx, y + height / 2 + dy, { steps: 8 });
    await page.mouse.up();
  }

  await drag(page.locator('[data-element-id="Review"] .djs-visual'), 25, 0);
  const moved = await snapshot();
  expect(moved.shapes.Review.x).toBeGreaterThan(aligned.shapes.Review.x);
  expect(moved.shapes.Timeout.x - aligned.shapes.Timeout.x)
    .toBe(moved.shapes.Review.x - aligned.shapes.Review.x);

  const pool = await page.locator('[data-element-id="Pool"] .djs-visual').boundingBox();
  await page.mouse.click(pool.x + 12, pool.y + pool.height / 2);
  const handle = page.locator('.djs-resizer-Pool.djs-resizer-e');
  await expect(handle).toBeVisible();
  await drag(handle, 50, 0);
  const resized = await snapshot();
  expect(resized.shapes.Pool.width).toBeGreaterThan(moved.shapes.Pool.width);
  expect(resized.lanes).toEqual(aligned.lanes);
  expect(resized.flows).toEqual(aligned.flows);
});

test('preserves a compact gateway loop through alignment, history, and reopening', async ({ page }, testInfo) => {
  const align = page.getByRole('button', { name: 'Выровнять схему' });
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  const redo = page.getByRole('button', { name: 'Повторить', exact: true });
  const summary = page.locator('#alignment-summary');
  const snapshot = async () => readDiagram(page, await downloadDiagram(page));

  await page.goto('/');
  await openDiagram(page, loopFixture, 'compact-loop.bpmn');
  const original = await snapshot();
  await page.getByRole('button', { name: 'Отступы' }).click();
  await page.getByRole('checkbox', { name: 'Единый отступ' }).check();
  await align.click();
  await applyPreview(page);
  await expect(summary).toHaveText('Выравнивание выполнено');

  const aligned = await snapshot();
  const point = (x, y) => ({ x, y });
  expect(aligned.shapes.Pool).toEqual(original.shapes.Pool);
  expect(aligned.shapes.Rework).toEqual({ x: 1210, y: 1950, width: 100, height: 80 });
  expect(aligned.routes).toEqual({
    Across: [point(1285, 2150), point(1365, 2150)],
    BackToTask: [point(1390, 2125), point(1390, 1990), point(1310, 1990)],
    CloseLoop: [point(1260, 2030), point(1260, 2125)],
    Enter: [point(1150, 2150), point(1235, 2150)],
    Proceed: [point(1415, 2150), point(1500, 2150)]
  });
  expect(aligned.flows).toEqual(original.flows);

  await undo.click();
  expect(await snapshot()).toEqual(original);
  await redo.click();
  expect(await snapshot()).toEqual(aligned);
  await align.click();
  await expect(summary).toHaveText('Изменений нет');

  const exported = await downloadDiagram(page);
  const exportedPath = testInfo.outputPath('compact-loop-aligned.bpmn');
  await exported.saveAs(exportedPath);
  await openDiagram(page, exportedPath, 'compact-loop-aligned.bpmn');
  expect(await snapshot()).toEqual(aligned);
});

test('keeps message flow endpoints through collaboration alignment, undo, redo and reopening', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDiagram(page, collaborationFixture, 'collaboration.bpmn');
  const snapshot = async () => readDiagram(page, await downloadDiagram(page));
  const original = await snapshot();

  await page.getByRole('button', { name: 'Выровнять схему' }).click();
  await applyPreview(page);
  await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание выполнено');
  const aligned = await snapshot();
  expect(aligned.shapes.Sender).not.toEqual(original.shapes.Sender);
  expect(aligned.routes.Delivery).not.toEqual(original.routes.Delivery);
  expect(aligned.messages).toEqual({ Delivery: { sourceRef: 'Send', targetRef: 'Receive' } });
  expect(aligned.flows).toEqual(original.flows);

  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(await snapshot()).toEqual(original);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  expect(await snapshot()).toEqual(aligned);
  const exportPath = testInfo.outputPath('aligned-collaboration.bpmn');
  await (await downloadDiagram(page)).saveAs(exportPath);
  await openDiagram(page, exportPath, 'aligned-collaboration.bpmn');
  expect(await snapshot()).toEqual(aligned);
});

test('opens BPMN from the empty canvas and reports spacing errors below the fields', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  const align = page.getByRole('button', { name: 'Выровнять схему' });
  const selection = page.getByRole('button', { name: 'Выровнять выделение' });
  await expect(align).toBeDisabled();
  await expect(selection).toBeDisabled();
  await expect(selection).toHaveAccessibleDescription(/Выберите пул, дорожку/);
  const open = page.locator('#empty').getByRole('button', { name: 'Открыть BPMN' });
  await expect(open).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty-canvas.png') });
  const chooserPromise = page.waitForEvent('filechooser');
  await open.click();
  await (await chooserPromise).setFiles(fixture);
  await expect(page.locator('#document-name')).toHaveAttribute('title', 'tight-pool.bpmn');

  await page.getByRole('button', { name: 'Отступы' }).click();
  const horizontal = page.getByRole('group', { name: 'По горизонтали' });
  const vertical = page.getByRole('group', { name: 'По вертикали' });
  const max = horizontal.getByRole('spinbutton', { name: 'Максимум' });
  const min = horizontal.getByRole('spinbutton', { name: 'Минимум' });
  const minBox = await min.boundingBox();
  const maxBox = await max.boundingBox();
  expect(minBox.y).toBeCloseTo(maxBox.y);
  expect(maxBox.x).toBeGreaterThan(minBox.x + minBox.width);
  await expect(max).toHaveAccessibleDescription(/Оставьте поле пустым для выравнивания без верхнего ограничения/);

  await max.fill('20');
  const verticalMin = vertical.getByRole('spinbutton', { name: 'Минимум' });
  await verticalMin.fill('-1');
  await align.click();
  await expect(max).toBeFocused();
  await expect(max).toHaveAttribute('aria-invalid', 'true');
  const error = page.locator('#max-gap-x-error');
  await expect(error).toHaveText('Введите целое число не меньше минимума.');
  expect((await error.boundingBox()).y).toBeGreaterThan(maxBox.y + maxBox.height);
  await page.screenshot({ path: testInfo.outputPath('gap-errors.png') });

  await max.fill('');
  await expect(error).toBeHidden();
  await align.click();
  await expect(verticalMin).toBeFocused();
  await verticalMin.fill('40');
  await align.click();
  await applyPreview(page);
  await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание выполнено');
});

test('previews alignment from the keyboard, restores focus on cancel, and remembers spacing', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDiagram(page, fixture, 'tight-pool.bpmn');
  const original = await readDiagram(page, await downloadDiagram(page));
  const settings = page.getByRole('button', { name: 'Отступы' });
  const uniform = page.getByRole('checkbox', { name: 'Единый отступ' });
  const gap = page.getByRole('spinbutton', { name: 'Отступ по обеим осям' });
  const align = page.getByRole('button', { name: 'Выровнять схему' });

  await settings.click();
  await uniform.check();
  await gap.fill('70');
  await gap.press('Alt+Enter');
  await expect(preview(page)).toBeHidden();
  await gap.press('Tab');
  await align.focus();
  await expect(align).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter');
  await page.evaluate(() => {
    const progress = document.getElementById('alignment-progress');
    window.observedAlignmentBusy = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (progress.hidden) return;
        observer.disconnect();
        resolve(document.getElementById('align').disabled &&
          document.getElementById('workspace').getAttribute('aria-busy') === 'true');
      });
      observer.observe(progress, { attributes: true, attributeFilter: ['hidden'] });
    });
  });

  await page.keyboard.press('Alt+Enter');
  await expect(preview(page)).toHaveAccessibleDescription(/Переместится фигур: [1-9]/);
  expect(await page.evaluate(() => window.observedAlignmentBusy)).toBe(true);
  await expect(preview(page).getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await expect(page.locator('#unsaved-changes')).toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('alignment-preview.png') });
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
  await expect(align).toBeFocused();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(original);

  const pool = await page.locator('[data-element-id="Pool"] .djs-visual').boundingBox();
  await page.mouse.click(pool.x + 12, pool.y + pool.height / 2);
  const selection = page.getByRole('button', { name: 'Выровнять выделение' });
  await expect(selection).toBeEnabled();
  await expect(selection).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+Enter');
  await selection.focus();
  await page.keyboard.press('Alt+Shift+Enter');
  await expect(preview(page)).toBeVisible();
  await preview(page).getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(selection).toBeFocused();

  await page.reload();
  await settings.click();
  await expect(uniform).toBeChecked();
  await expect(gap).toHaveValue('70');
});

test('explains a skipped pool and reveals it on the canvas', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDiagram(page, fixture, 'tight-pool.bpmn');
  await page.getByRole('button', { name: 'Отступы' }).click();
  await page.getByRole('checkbox', { name: 'Единый отступ' }).check();
  await page.getByRole('spinbutton', { name: 'Отступ по обеим осям' }).fill(String(Number.MAX_SAFE_INTEGER));
  await page.getByRole('button', { name: 'Выровнять схему' }).click();

  await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание с пропусками');
  await page.getByRole('button', { name: 'Подробнее' }).click();
  const skips = page.locator('#alignment-skips');
  await expect(skips).toContainText('Уменьшите минимальные отступы.');
  await skips.getByRole('button', { name: /Показать на схеме.*Заявки/ }).click();
  const outlined = page.locator('[data-element-id="Pool"].alignment-skipped > .djs-outline');
  await expect(outlined).toBeVisible();
  await expect(page.locator('#workspace .djs-container > svg')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('alignment-skipped-pool.png') });
  await page.keyboard.press('Escape');
  await expect(outlined).toHaveCount(0);
});

for (const scenario of ['invoice-approval', 'order-fulfilment', 'incident-escalation', 'supplier-onboarding', 'special-shapes']) {
  test(`aligns and exports ${scenario} with its BPMN relations intact`, async ({ page }) => {
    const path = fileURLToPath(new URL(`../test/fixtures/${scenario}.bpmn`, import.meta.url));
    await page.goto('/');
    await openDiagram(page, path, `${scenario}.bpmn`);
    const snapshot = async () => readDiagram(page, await downloadDiagram(page));
    const before = await snapshot();

    await page.getByRole('button', { name: 'Выровнять схему' }).click();
    await applyPreview(page);
    await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание выполнено');
    const after = await snapshot();
    expect(after.shapes).not.toEqual(before.shapes);
    expect(after.lanes).toEqual(before.lanes);
    expect(after.timers).toEqual(before.timers);
    expect(after.flows).toEqual(before.flows);
    expect(after.messages).toEqual(before.messages);
  });
}
