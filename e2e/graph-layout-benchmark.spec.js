import { expect, test } from '@playwright/test';
import { collaborationBenchmarkXml, graphBenchmarkWorkload } from '../scripts/graph-benchmark-workload.js';
import { openDiagram, preview } from './helpers/diagram.js';

async function measureAlignment(page, lateRefusal) {
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
      await page.keyboard.press('Escape');
      await expect(preview(page)).toBeHidden();
    }
  }
  return timings;
}

for (const name of ['process', 'collaboration', 'late-refusal']) {
  test(`measures graph layout on the 200-node ${name} benchmark`, async ({ page, browser }) => {
    test.skip(process.env.BPMN_GRAPH_BENCHMARK !== '1', 'Run on idle, fixed hardware.');
    test.setTimeout(120_000);
    const lateRefusal = name === 'late-refusal';
    const xml = await (name === 'process' ? graphBenchmarkWorkload().xml() : collaborationBenchmarkXml({ lateRefusal }));
    const filename = `graph-benchmark-${name}.bpmn`;
    await page.goto('/');
    await openDiagram(page, { name: filename, mimeType: 'application/xml', buffer: Buffer.from(xml) }, filename);
    const [cold, ...warm] = await measureAlignment(page, lateRefusal);
    console.log(JSON.stringify({
      name, chromium: browser.version(), target: lateRefusal ? 'refusal' : 'preview', cold, warm,
      medianWarm: warm.map(({ elapsed }) => elapsed).toSorted((a, b) => a - b)[2],
      overThreshold: warm.filter(({ longestTask }) => longestTask >= 200).length
    }));
  });
}
