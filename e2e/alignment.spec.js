import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/tight-pool.bpmn', import.meta.url));

async function openDiagram(page, path, filename) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Открыть BPMN' }).click()
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
  const align = page.getByRole('button', { name: 'Автовыровнять' });
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
  await expect(summary).toContainText('Контейнеры');
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
