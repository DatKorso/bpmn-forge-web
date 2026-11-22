import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(new URL('./fixtures/tight-pool.bpmn', import.meta.url));
const invalidFile = { name: 'invalid.bpmn', mimeType: 'application/xml', buffer: Buffer.from('<invalid/>') };
const dirty = (page) => page.locator('#unsaved-changes');
const confirmation = (page) => page.locator('#confirm-replace');
const undo = (page) => page.getByRole('button', { name: 'Отменить', exact: true });
const redo = (page) => page.getByRole('button', { name: 'Повторить', exact: true });

async function chooseFile(page, file) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  await (await chooserPromise).setFiles(file);
}

async function alignImportedDiagram(page) {
  await page.goto('/');
  await chooseFile(page, fixture);
  await expect(page.locator('#document-name')).toHaveAttribute('title', 'tight-pool.bpmn');
  await expect(dirty(page)).toBeEmpty();
  await page.locator('#align').click();
  await expect(dirty(page)).toHaveText('Есть несохранённые изменения');
}

async function downloadFrom(page, button) {
  const download = page.waitForEvent('download');
  await button.click();
  return download;
}

test('tracks the download checkpoint through undo, redo, and a new history branch', async ({ page }) => {
  await alignImportedDiagram(page);
  await undo(page).click();
  await expect(dirty(page)).toBeEmpty();
  await redo(page).click();
  await expect(dirty(page)).not.toBeEmpty();

  await downloadFrom(page, page.locator('#download'));
  await expect(dirty(page)).toBeEmpty();
  await undo(page).click();
  await expect(dirty(page)).not.toBeEmpty();
  await redo(page).click();
  await expect(dirty(page)).toBeEmpty();
  await undo(page).click();
  await page.locator('#align').click();
  await expect(redo(page)).toBeDisabled();
  await expect(dirty(page)).not.toBeEmpty();
  const beforeUnload = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await beforeUnload;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(dirty(page)).not.toBeEmpty();
});

test('protects the current diagram when creating a new one', async ({ page }, testInfo) => {
  await alignImportedDiagram(page);
  await page.locator('#new').click();
  await expect(confirmation(page)).toHaveAccessibleName('Создать схему');
  await expect(confirmation(page).getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('unsaved-confirmation.png') });
  await page.keyboard.press('Escape');
  await expect(confirmation(page)).toBeHidden();
  await expect(page.locator('#new')).toBeFocused();
  await expect(dirty(page)).not.toBeEmpty();
  await expect(undo(page)).toBeEnabled();

  await page.locator('#new').click();
  const download = await downloadFrom(page, confirmation(page).getByRole('button', { name: 'Скачать BPMN и продолжить' }));
  expect(download.suggestedFilename()).toBe('tight-pool.bpmn');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(dirty(page)).toBeEmpty();
  await expect(undo(page)).toBeDisabled();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
});

test('confirms opening after file selection and retains the diagram on a failed import', async ({ page }, testInfo) => {
  await alignImportedDiagram(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  const chooser = await chooserPromise;
  await expect(confirmation(page)).toBeHidden();
  await chooser.setFiles(invalidFile);
  await expect(confirmation(page)).toHaveAccessibleName('Открыть BPMN');
  await confirmation(page).getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(dirty(page)).not.toBeEmpty();

  await chooseFile(page, invalidFile);
  await confirmation(page).getByRole('button', { name: 'Продолжить без скачивания' }).click();
  const error = 'Не удалось открыть BPMN. Проверьте формат файла.';
  await expect(page.getByRole('alert')).toHaveText(error);
  await expect(page.locator('#document-name')).toHaveAttribute('title', 'tight-pool.bpmn');
  await expect(undo(page)).toBeEnabled();
  await expect(dirty(page)).not.toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('import-error.png') });

  await page.locator('#operation-alerts').getByRole('button').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сообщения редактора' }).click();
  await expect(page.locator('#messages')).toContainText(error);
  await page.locator('#messages').getByRole('button', { name: 'Закрыть' }).click();

  await chooseFile(page, fixture);
  await confirmation(page).getByRole('button', { name: 'Продолжить без скачивания' }).click();
  await expect(dirty(page)).toBeEmpty();
  await expect(undo(page)).toBeDisabled();
  await expect(page.locator('#operation-errors')).toBeEmpty();
});

test('keeps the current diagram and history if download before replacement fails', async ({ page }) => {
  await alignImportedDiagram(page);
  await page.evaluate(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = () => {
      URL.createObjectURL = create;
      throw new Error('Download unavailable');
    };
  });
  await page.locator('#new').click();
  await confirmation(page).getByRole('button', { name: 'Скачать BPMN и продолжить' }).click();
  await expect(page.getByRole('alert')).toHaveText('Не удалось сохранить файл BPMN.');
  await expect(page.locator('#document-name')).toHaveAttribute('title', 'tight-pool.bpmn');
  await expect(dirty(page)).not.toBeEmpty();
  await expect(undo(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Сообщения редактора' }).click();
  await expect(page.locator('#messages')).toContainText('Не удалось сохранить файл BPMN.');
  await page.locator('#messages').getByRole('button', { name: 'Закрыть' }).click();

  await downloadFrom(page, page.locator('#download'));
  await expect(dirty(page)).toBeEmpty();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#operation-errors')).toBeEmpty();
});
