import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/tight-pool.bpmn', import.meta.url));

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
    const flows = byId(elements(doc, model, 'sequenceFlow'), 'id', (flow) => ({
      sourceRef: flow.getAttribute('sourceRef'),
      targetRef: flow.getAttribute('targetRef')
    }));

    return { shapes, labels, routes, lanes, flows };
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
  await expect(max).toHaveAccessibleDescription('Оставьте максимум пустым, чтобы снять верхнее ограничение.');

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
  await expect(page.locator('#alignment-summary')).toHaveText('Выравнивание выполнено');
});
