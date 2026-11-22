import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('../test/fixtures/tight-pool.bpmn', import.meta.url));
const workspace = (page) => page.locator('#workspace');
const palette = (page) => page.getByRole('toolbar', { name: 'Палитра BPMN' });
const taskTool = (page) => palette(page).getByRole('button', { name: 'Создать задачу', exact: true });
const marker = (page) => page.locator('.placement-marker');
const task = (page) => page.locator('.djs-shape[data-element-id^="Activity_"] > .djs-visual');
const undo = (page) => page.locator('#undo');
const fit = (page) => page.getByRole('button', { name: 'Показать всю схему' });

async function enterPalette(page) {
  await page.locator('.djs-container > svg').focus();
  await page.keyboard.press('Tab');
  await expect(palette(page).locator('[tabindex="0"]')).toBeFocused();
}

async function focusWithArrows(page, entry) {
  const tabStop = palette(page).locator('[tabindex="0"]');
  const action = await entry.getAttribute('data-action');
  const count = await palette(page).getByRole('button').count();
  for (let step = 0; step < count && await tabStop.getAttribute('data-action') !== action; step++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(entry).toBeFocused();
}

test('creates, names and undoes a task using just the keyboard', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#empty')).toBeVisible();
  await enterPalette(page);
  await focusWithArrows(page, taskTool(page));
  await expect(palette(page).locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(palette(page).locator(':focus')).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(taskTool(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(marker(page)).toBeVisible();
  const initial = await marker(page).boundingBox();
  const bounds = await workspace(page).boundingBox();
  expect(initial.x).toBeGreaterThan(bounds.x + bounds.width / 2);
  await page.keyboard.press('ArrowRight');
  expect((await marker(page).boundingBox()).x - initial.x).toBeCloseTo(10);
  await page.keyboard.press('Escape');
  await expect(marker(page)).toBeHidden();
  await expect(taskTool(page)).toBeFocused();
  await expect(undo(page)).toBeDisabled();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: testInfo.outputPath('keyboard-placement.png') });
  await page.keyboard.press('Enter');
  await expect(task(page)).toBeVisible();
  const textbox = page.locator('.djs-direct-editing-content');
  await expect(textbox).toBeFocused();
  await page.keyboard.insertText('Проверить заявку');
  await page.keyboard.press('Enter');
  await expect(task(page)).toContainText('Проверить заявку');
  await expect(page.locator('#property-name')).toHaveValue('Проверить заявку');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(task(page)).not.toContainText('Проверить заявку');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(task(page)).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
});

test('preserves mouse placement, rejects an invalid keyboard target, and undoes a whole subprocess', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty')).toBeVisible();
  await taskTool(page).click();
  await expect(page.locator('#empty-open')).toBeHidden();
  const bounds = await workspace(page).boundingBox();
  const paletteBounds = await palette(page).boundingBox();
  await page.mouse.click((paletteBounds.x + paletteBounds.width + bounds.x + bounds.width) / 2, bounds.y + bounds.height / 2 - 24);
  await expect(task(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await enterPalette(page);
  await focusWithArrows(page, taskTool(page));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.placement-hint')).toContainText('Здесь нельзя разместить фигуру.');
  await expect(task(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await undo(page).click();

  await enterPalette(page);
  await focusWithArrows(page, palette(page).getByRole('button', { name: 'Создать раскрытый подпроцесс' }));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(task(page)).toHaveCount(1);
  await expect(page.locator('.djs-shape[data-element-id^="Event_"] > .djs-visual')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await undo(page).click();
  await expect(task(page)).toHaveCount(0);
  await expect(page.locator('.djs-shape[data-element-id^="Event_"]')).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
});

async function expectPoolFits(page) {
  const pool = await page.locator('[data-element-id="Pool"] > .djs-visual').boundingBox();
  const tools = await palette(page).boundingBox();
  const controls = await page.locator('#viewport-controls').boundingBox();
  const bounds = await workspace(page).boundingBox();
  expect(pool.x).toBeGreaterThan(tools.x + tools.width);
  expect(pool.x + pool.width).toBeLessThan(bounds.x + bounds.width);
  expect(pool.y).toBeGreaterThan(bounds.y);
  expect(pool.y + pool.height).toBeLessThan(controls.y);
}

for (const [width, height] of [[1024, 600], [1280, 800], [1440, 900]]) {
  test(`fits the pool and keeps properties usable at ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.locator('#file').setInputFiles(fixture);
    await expect(page.locator('#document-name')).toHaveAttribute('title', 'tight-pool.bpmn');
    await expectPoolFits(page);
    const panel = page.locator('#properties');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('border-inline-start-width', '1px');

    if (height === 600) {
      const close = palette(page).getByRole('button', { name: 'Свернуть палитру' });
      await close.click();
      await enterPalette(page);
      await expect(palette(page).getByRole('button', { name: 'Развернуть палитру' })).toBeFocused();
      await page.keyboard.press('Enter');
      await focusWithArrows(page, taskTool(page));
      await expect(taskTool(page)).toBeInViewport({ ratio: 1 });
    }

    await page.getByRole('button', { name: 'Закрыть свойства' }).click();
    const end = page.locator('[data-element-id="End"] > .djs-visual');
    await page.locator('[data-element-id="End"] > .djs-hit').click();
    const view = await workspace(page).boundingBox();
    const box = await end.boundingBox();
    const pan = view.x + view.width - 32 - (box.x + box.width);
    await page.mouse.move(view.x + 110, view.y + view.height - 70);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(view.x + 110 + pan, view.y + view.height - 70, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    const beforeOpen = await end.boundingBox();

    await page.getByRole('button', { name: 'Свойства', exact: true }).click();
    await expect(page.locator('#property-id')).toHaveText('End');
    const panelBox = await panel.boundingBox();
    const revealed = await end.boundingBox();
    expect(beforeOpen.x + beforeOpen.width).toBeGreaterThan(panelBox.x);
    expect(revealed.x + revealed.width).toBeLessThan(panelBox.x);

    await fit(page).click();
    const original = await end.boundingBox();
    await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
    expect((await end.boundingBox()).width).toBeGreaterThan(original.width);
    await page.getByRole('button', { name: 'Уменьшить', exact: true }).click();
    expect((await end.boundingBox()).width).toBeCloseTo(original.width);
    await fit(page).click();
    await expectPoolFits(page);

    if (height === 600) {
      const add = page.getByRole('button', { name: 'Добавить описание' });
      for (let i = 0; i < 4; i++) await add.click();
      const content = panel.locator('.properties-content');
      expect(await content.evaluate((node) => node.scrollHeight > node.clientHeight && node.scrollTop > 0)).toBe(true);
    }
    const zoomIn = page.getByRole('button', { name: 'Увеличить', exact: true });
    for (let i = 0; i < 3; i++) await zoomIn.click();
    const beforeAlignment = await end.boundingBox();
    await page.getByRole('button', { name: 'Выровнять схему' }).click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    const summary = page.locator('#alignment-summary');
    await expect(summary).toHaveText('Выравнивание выполнено');
    await expect(summary).toBeInViewport({ ratio: 1 });
    expect(await summary.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await end.boundingBox()).width).toBeCloseTo(beforeAlignment.width);
    await fit(page).click();
    await expectPoolFits(page);
    await page.screenshot({ path: testInfo.outputPath(`viewport-${width}x${height}.png`) });
  });
}
