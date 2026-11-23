import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { collaborationBenchmarkXml, compactBenchmarkProfiles, compactBenchmarkXml, graphBenchmarkWorkload,
  mixedBenchmarkProfiles } from '../scripts/graph-benchmark-workload.js';
import { applyPreview, downloadDiagram, openDiagram, preview, readDiagram } from './helpers/diagram.js';

async function measureAlignment(page, lateRefusal, applyLast) {
  await page.evaluate((expectsRefusal) => {
    const dialog = document.querySelector('#alignment-preview');
    const button = document.querySelector('#align-graph');
    const summary = document.querySelector('#alignment-summary');
    let start;
    let resolve;
    const tasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask' });
    button.addEventListener('click', () => {
      start = performance.now();
      window.previewTiming = new Promise((done) => { resolve = done; });
    }, { capture: true });
    const finish = () => {
      if (!resolve || (expectsRefusal ? summary.textContent !== 'Не удалось выровнять' : !dialog.open)) return;
      const end = performance.now();
      const done = resolve;
      resolve = undefined;
      const stages = Object.fromEntries(performance.getEntriesByType('measure')
        .filter(({ name, startTime }) => name.startsWith('bpmn:graph:') && startTime >= start)
        .map(({ name, duration }) => [name.split(':').at(-1), Math.round(duration * 10) / 10]));
      requestAnimationFrame(() => requestAnimationFrame(() => done({
        elapsed: Math.round(end - start),
        stages,
        longestTask: Math.max(0, ...tasks.filter((task) => task.start < end && task.start + task.duration >= start)
          .map(({ duration }) => duration))
      })));
    };
    const observer = new MutationObserver(finish);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    observer.observe(summary, { childList: true });
  }, lateRefusal);
  const timings = [];
  for (let i = 0; i < 6; i++) {
    await page.locator('#align-graph').click();
    if (lateRefusal) {
      await expect(page.locator('#alignment-summary')).toHaveText('Не удалось выровнять', { timeout: 15_000 });
      await expect(page.locator('#alignment-result')).toContainText('Note_3_1');
      await expect(preview(page)).toBeHidden();
      await expect(page.locator('#undo')).toBeDisabled();
    } else {
      await expect(preview(page)).toBeVisible({ timeout: 15_000 });
    }
    timings.push(await page.evaluate(() => window.previewTiming));
    if (!lateRefusal) {
      if (applyLast && i === 5) await applyPreview(page);
      else await page.keyboard.press('Escape');
      await expect(preview(page)).toBeHidden();
    }
  }
  return timings;
}

for (const name of ['process', 'collaboration', 'late-refusal', ...compactBenchmarkProfiles, ...Object.keys(mixedBenchmarkProfiles)]) {
  test(`measures graph layout on the ${name} benchmark`, async ({ page, browser }) => {
    test.skip(process.env.BPMN_GRAPH_BENCHMARK !== '1', 'Run on idle, fixed hardware.');
    test.setTimeout(120_000);
    const lateRefusal = name === 'late-refusal';
    const size = Number(process.env.BPMN_GRAPH_BENCHMARK_SIZE ?? 50);
    const mixed = compactBenchmarkProfiles.includes(name) || Object.hasOwn(mixedBenchmarkProfiles, name);
    test.skip(mixed && process.env.BPMN_GRAPH_MIXED_VERIFICATION !== '1', 'Build in graph-mixed-verification mode.');
    const verifyRepeat = Object.hasOwn(mixedBenchmarkProfiles, name) && size === 50;
    const xml = await (name === 'process' ? graphBenchmarkWorkload().xml() : compactBenchmarkProfiles.includes(name)
      ? compactBenchmarkXml(name.at(-1)) : collaborationBenchmarkXml({ lateRefusal, orientations: mixedBenchmarkProfiles[name], size }));
    const filename = `graph-benchmark-${name}.bpmn`;
    await page.goto('/');
    await openDiagram(page, { name: filename, mimeType: 'application/xml', buffer: Buffer.from(xml) }, filename);
    const [cold, ...warm] = await measureAlignment(page, lateRefusal, verifyRepeat);
    console.log(JSON.stringify({
      name, size, chromium: browser.version(), target: lateRefusal ? 'refusal' : 'preview', cold, warm,
      medianWarm: warm.map(({ elapsed }) => elapsed).toSorted((a, b) => a - b)[2],
      overThreshold: warm.filter(({ longestTask }) => longestTask >= 200).length
    }));
    if (verifyRepeat) {
      const download = await downloadDiagram(page);
      const aligned = await readDiagram(page, download);
      const repeat = async () => {
        await page.locator('#align-graph').click();
        await expect(page.locator('#alignment-summary')).toHaveText('Изменений нет', { timeout: 15_000 });
        await expect(preview(page)).toBeHidden();
        expect(await readDiagram(page, await downloadDiagram(page))).toEqual(aligned);
      };
      await repeat();
      await openDiagram(page, { name: filename, mimeType: 'application/xml', buffer: await readFile(await download.path()) }, filename);
      await repeat();
      await expect(page.locator('#undo')).toBeDisabled();
    }
  });
}
