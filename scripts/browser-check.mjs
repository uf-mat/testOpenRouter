// Optional browser verification. Supply an installed Playwright module URL/path;
// Playwright is intentionally not a project dependency. All generation is mocked.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../app.js';
import { normalizeModel } from '../lib/normalization.js';
const { chromium } = await import(process.argv[2] || process.env.PLAYWRIGHT_MODULE || 'playwright');
let calls = 0;
const models = [
  { id: 'a:free', name: 'Alpha', pricing: { prompt: 0, completion: 0 } },
  { id: 'b:free', name: 'Beta', pricing: { prompt: 0, completion: 0 } },
  { id: 'c:free', name: 'Charlie', pricing: { prompt: 0, completion: 0 } },
  { id: 'paid', name: 'Paid reference', pricing: { prompt: 0.000001, completion: 0.000003 } },
  { id: 'openrouter/free', name: 'Router' },
].map(normalizeModel);
const server = createApp({
  env: { OPENROUTER_API_KEY: 'mock', ALLOW_PAID_MODELS: 'true' },
  catalog: { get: async () => ({ models, source: 'live', ageMs: 0 }) },
  fetchImpl: async (_, options) => {
    calls++;
    const { model } = JSON.parse(options.body);
    await new Promise(resolve => setTimeout(resolve, 150));
    return Response.json({ model, choices: [{ message: { content: '<img src=x onerror="window.unsafe=true"> Respuesta segura.' } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, cost: 0, completion_tokens_details: { reasoning_tokens: 3 } } });
  },
}).listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !document.getElementById('generate').disabled);
  assert.equal(await page.locator('#model-selector input:checked').count(), 1);
  await page.locator('#prompt').fill('Explica una API');
  // Keyboard selection and visible focus, followed by a single free request.
  await page.locator('#model-search').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.type), 'checkbox');
  await page.locator('#generate').click();
  assert.equal(await page.locator('#generate').isDisabled(), true);
  assert.equal(await page.locator('.response .loading').count(), 1);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Comparación terminada'));
  assert.equal(calls, 1); assert.equal(await page.locator('#answers img').count(), 0);
  assert.equal(await page.evaluate(() => window.unsafe), undefined);
  assert.equal(await page.evaluate(() => Chart.getChart('tokens-chart').data.datasets[1].data[0]), 5);
  assert.equal(await page.locator('#metric-body tr').count(), 1);
  await page.locator('#price-source').selectOption('manual');
  await page.locator('#input-price').fill('1'); await page.locator('#output-price').fill('3');
  assert.match(await page.locator('#projection').textContent(), /0.000036/);
  await page.locator('#requests').fill('0');
  assert.equal(await page.locator('#simulation-error').isVisible(), true);
  await page.locator('#requests').fill('100');
  const totals = await page.locator('#totals').textContent();
  await page.locator('#price-source').selectOption('catalog');
  await page.locator('#price-model').selectOption('paid');
  assert.equal(calls, 1); assert.equal(await page.locator('#totals').textContent(), totals);
  await page.locator('#model-selector input[value="b:free"]').check();
  await page.locator('#model-selector input[value="c:free"]').check();
  assert.equal(await page.locator('#model-selector input[value="paid"]').isDisabled(), true);
  assert.match(await page.locator('#request-count').textContent(), /3 solicitudes/);
  await page.locator('#generate').click();
  assert.equal(await page.locator('.response .loading').count(), 3);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Comparación terminada'));
  assert.equal(calls, 4); assert.equal(await page.locator('#metric-body tr').count(), 3);
  assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 3);
  await mkdir('/tmp/prompt-lab-check', { recursive: true });
  await page.screenshot({ path: '/tmp/prompt-lab-check/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '/tmp/prompt-lab-check/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth && !el.closest('table')).map(el => ({ tag: el.tagName, id: el.id, width: el.getBoundingClientRect().width })))));
  assert.equal(await page.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
  await page.screenshot({ path: '/tmp/prompt-lab-check/mobile.png', fullPage: true });
  await page.locator('#clear-results').click();
  assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 0);
  assert.equal(await page.locator('#history button').count(), 2);
  await page.locator('#history button').first().click();
  assert.equal(calls, 4); assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 3);
  assert.match(await page.locator('#totals').textContent(), /confirmadas: 4/);
  // Paid generation requires fresh UI consent and resets it afterwards.
  await page.locator('#model-selector input[value="b:free"]').uncheck();
  await page.locator('#model-selector input[value="c:free"]').uncheck();
  await page.locator('#model-selector input[value="paid"]').check();
  await page.locator('#generate').click();
  assert.equal(calls, 4); assert.equal(await page.locator('#error').isVisible(), true);
  await page.locator('summary').click(); await page.locator('#allow-paid').check();
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Comparación terminada'));
  assert.equal(calls, 6); assert.equal(await page.locator('#allow-paid').isChecked(), false);
  await page.locator('#reset-history').click();
  assert.equal(await page.locator('#history button').count(), 0);
  assert.match(await page.locator('#totals').textContent(), /confirmadas: 0/);
  assert.equal(await page.evaluate(() => Object.keys(Chart.instances).length), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.locator('#model-selector input[value="paid"]').uncheck();
  await page.route('**/api/compare', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Rechazo simulado' } }) }));
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.getElementById('error').textContent === 'Rechazo simulado');
  assert.match(await page.locator('#totals').textContent(), /confirmadas: 0/);
  assert.doesNotMatch(await page.locator('#totals').textContent(), /Consumo no confirmado/);
  await page.unroute('**/api/compare');
  await page.route('**/api/compare', route => route.abort());
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.getElementById('totals').textContent.includes('Consumo no confirmado'));
  assert.match(await page.locator('#totals').textContent(), /hasta 1 llamadas adicionales/);
  assert.equal(await page.locator('#generate').isDisabled(), false);
  await page.unroute('**/api/compare');
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('generate').disabled);
  assert.match(await page.locator('#totals').textContent(), /confirmadas: 0/);
  assert.doesNotMatch(await page.locator('#totals').textContent(), /Consumo no confirmado/);
  assert.equal(calls, 6);
  assert.deepEqual(errors, []);
  console.log('Navegador OK: escritorio, móvil, teclado, espera, 1/3 modelos, pagos, costos, gráficos, historial y limpieza. Sin solicitudes reales. Capturas: /tmp/prompt-lab-check/');
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
