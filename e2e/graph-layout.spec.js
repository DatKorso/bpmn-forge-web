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

  await reopen(page, after);
  await expectNoChange(page);
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
  await page.screenshot({ path: testInfo.outputPath('graph-result.png') });
});

test('collaboration refusal is atomic and explains the unsupported region', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('collaboration'), 'collaboration.bpmn');
  const before = await readDiagram(page, await downloadDiagram(page));
  await graphButton(page).click();
  await expect(summary(page)).toHaveText('Не удалось выровнять');
  await page.getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.locator('#alignment-result')).toContainText(
    'Экспериментальная раскладка пока не поддерживает несколько участников и потоки сообщений');
  await page.keyboard.press('Escape');
  expect(await readDiagram(page, await downloadDiagram(page))).toEqual(before);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
});

test('accepts invalid maximum gaps and restores focus after cancellation', async ({ page }) => {
  await page.goto('/');
  await openDiagram(page, fixture('vertical-pool'), 'vertical-pool.bpmn');
  await page.locator('#toggle-gaps').click();
  await page.locator('#max-gap-x').fill('1');
  await expect(page.locator('#max-gap-x')).toHaveAttribute('aria-invalid', 'true');
  await graphButton(page).click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
  await expect(graphButton(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
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
  let start;
  let finish;
  const loading = new Promise((resolve) => { start = resolve; });
  const release = new Promise((resolve) => { finish = resolve; });
  await page.route('**/elk.bundled-*.js', async (route) => {
    start();
    await release;
    await route.continue();
  });
  await graphButton(page).click();
  try {
    await loading;
    await page.locator('.djs-container > svg').dispatchEvent('keydown', { key: 'Delete', bubbles: true });
    await expect(page.locator('.djs-element[data-element-id="Review"]')).toHaveCount(0);
  } finally {
    finish();
  }
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('#alignment-result')).toHaveText('Схема изменилась. Запустите выравнивание ещё раз.');
});
