import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { createCatalog, defaultModel } from '../lib/catalog.js';
import { normalizeModel, normalizeUsage, perMillion } from '../lib/normalization.js';
import { estimate, projections, usd } from '../public/costs.js';
import { createHistory } from '../public/history.js';
import { chartData, tokenParts, createCharts } from '../public/charts.js';

const rawModels = [
  { id: 'a:free', name: 'Alpha', pricing: { prompt: '0', completion: '0' } },
  { id: 'b:free', name: 'Beta', pricing: { prompt: '0', completion: '0' } },
  { id: 'c:free', name: 'Charlie', pricing: { prompt: '0', completion: '0' } },
  { id: 'paid', pricing: { prompt: '0.000001', completion: '0.000003' } },
  { id: 'unknown' }, { id: 'nvidia/nemotron-content-safety:free' },
];
const models = rawModels.map(normalizeModel);
const completion = { model: 'a:free', choices: [{ message: { content: 'Respuesta' } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0, completion_tokens_details: { reasoning_tokens: 5 } } };
async function serve(t, options = {}) {
  const server = createApp({ env: { OPENROUTER_API_KEY: 'secret' }, catalog: { get: async () => ({ models }) }, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(url, body, path = '/api/compare') {
  const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(!JSON.stringify(data).includes('secret'));
  return { status: response.status, data };
}
test('precios, fórmulas, proyecciones, ceros y precisión', () => {
  assert.equal(perMillion('0.0000025'), 2.5);
  assert.equal(perMillion('0'), 0);
  for (const v of [null, undefined, '', ' ', 'NaN', Infinity, -1, true, [], {}]) assert.equal(perMillion(v), null);
  assert.equal(estimate(completion.usage, { input: 1, output: 3 }), 0.00007);
  assert.equal(estimate(completion.usage, { input: null, output: 3 }), null);
  assert.equal(estimate({ prompt_tokens: 0, completion_tokens: 0 }, { input: 1, output: 1 }), 0);
  assert.deepEqual(projections([1, null, 3], 100, 30, 10), { average: 2, requests: 200, classroom: 600, count: 2 });
  for (const q of [0, -1, 1.5, Infinity, NaN]) assert.equal(projections([1], q, 30, 10), null);
  assert.equal(projections([null], 100, 30, 10).average, null);
  assert.equal(estimate(completion.usage, { input: Infinity, output: 0 }), null);
  assert.equal(projections([Number.MAX_VALUE], 100, 30, 10).requests, null);
  assert.match(usd(1e-12), /e-12/);
  assert.notEqual(usd(0.000001), '$0.00 USD');
  assert.equal(usd(null), 'No disponible');
});
test('normalización y gráficos sin doble conteo ni ceros inventados', () => {
  const usage = normalizeUsage({ ...completion.usage, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 3 } });
  assert.equal(usage.cost, 0); assert.equal(usage.prompt_tokens_details.cached_tokens, 0);
  assert.deepEqual(tokenParts(usage), { input: 10, output: 15, reasoning: 5 });
  assert.deepEqual(tokenParts({ completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 5 } }), { input: null, output: 3, reasoning: null });
  const empty = normalizeUsage({ total_tokens: '30', cost: '0' });
  assert.equal(empty.total_tokens, null); assert.equal(empty.cost, null);
  const data = chartData([{ usage }, { error: {}, usage: empty }], [0, null]);
  assert.deepEqual(data.costs[0].data, [0, null]); assert.equal(data.allZero, false);
  assert.deepEqual(data.latency[0].data, [null, null]);
  assert.equal(chartData([{ usage }], [0]).allZero, true);
});
test('clasificación conservadora, texto, moderación y selección inicial', () => {
  assert.equal(normalizeModel({ id: 'unknown' }).free, false);
  assert.equal(normalizeModel({ id: 'specific:free' }).pricing.input, null);
  assert.equal(normalizeModel({ id: 'zero', pricing: { prompt: 0, completion: 0 } }).free, true);
  assert.equal(normalizeModel({ id: 'image', architecture: { output_modalities: ['image'] } }), null);
  assert.equal(models.at(-1).selectable, false);
  assert.equal(defaultModel(models, 'b:free'), 'b:free');
  assert.equal(defaultModel(models, 'paid'), 'a:free');
  assert.equal(defaultModel([]), 'openrouter/free');
});
test('catálogo comparte consultas, caché cinco minutos, última copia una hora, sustitución y respaldo', async () => {
  let now = 0; let calls = 0; let release;
  const catalog = createCatalog({ now: () => now, fetchImpl: async () => {
    calls++;
    if (calls === 1) { await new Promise(resolve => { release = resolve; }); return Response.json({ data: rawModels }); }
    if (calls === 2) return Response.json({ data: [rawModels[1]] });
    throw new Error('secret');
  } });
  const first = catalog.get(); const second = catalog.get(); release();
  assert.deepEqual(await first, await second); assert.equal(calls, 1);
  now = 299999; assert.equal((await catalog.get()).source, 'cache'); assert.equal(calls, 1);
  now = 300000; const refreshed = await catalog.get(); assert.equal(refreshed.source, 'live');
  assert.ok(!refreshed.models.some(m => m.id === 'a:free'));
  now = 600000; assert.equal((await catalog.get()).source, 'stale');
  now = 3900001; const fallback = await catalog.get(); assert.equal(fallback.source, 'fallback');
  assert.equal(fallback.ageMs, null); assert.ok(fallback.models.every(m => m.pricing.input === null));
});
test('timeout de catálogo y respaldo configurable', async () => {
  let signal;
  const catalog = createCatalog({ timeoutMs: 5, fallbackModels: [{ id: 'mine:free' }], fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  const value = await catalog.get(); assert.equal(value.source, 'fallback'); assert.equal(value.models[0].id, 'mine:free'); assert.equal(signal.aborted, true);
});
test('validaciones completas no generan solicitudes', async t => {
  let calls = 0;
  const url = await serve(t, { fetchImpl: async () => { calls++; return Response.json(completion); } });
  for (const body of [
    { prompt: ' ' }, { prompt: 'x'.repeat(10001) }, { prompt: 'x', systemPrompt: 'x'.repeat(4001) },
    { prompt: 'x', models: [] }, { prompt: 'x', models: ['a:free', 'a:free'] },
    { prompt: 'x', models: ['a:free', 'b:free', 'c:free', 'paid'] },
    { prompt: 'x', models: ['removed'] }, { prompt: 'x', models: ['nvidia/nemotron-content-safety:free'] },
    { prompt: 'x', models: ['paid'], allowPaidModels: true }, { prompt: 'x', models: ['unknown'] },
    { prompt: 'x', models: ['a:free'], allowPaidModels: 'true' }, { prompt: 'x', models: ['a:free'], task: 'toString' },
  ]) assert.equal((await post(url, { models: ['a:free'], ...body })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await post(url, { prompt: 'x'.repeat(70000), models: ['a:free'] })).status, 413);
  const invalid = await fetch(url + '/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
});
test('doble autorización de pago también protege chat', async t => {
  for (const enabled of [false, true]) for (const consent of [false, true]) {
    let calls = 0;
    const url = await serve(t, { env: { OPENROUTER_API_KEY: 'secret', OPENROUTER_MODEL: 'paid', ALLOW_PAID_MODELS: String(enabled) }, fetchImpl: async () => { calls++; return Response.json(completion); } });
    for (const path of ['/api/compare', '/api/chat']) {
      const result = await post(url, { prompt: 'x', task: 'libre', models: ['paid'], allowPaidModels: consent }, path);
      assert.equal(result.status, enabled && consent ? 200 : 400);
    }
    assert.equal(calls, enabled && consent ? 2 : 0);
  }
});
test('concurrencia real, mensajes idénticos, orden y timeout independiente', async t => {
  const requests = []; const signals = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const url = await serve(t, { timeoutMs: 40, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body); signals.push(options.signal);
    if (requests.length === 3) release();
    await gate;
    if (body.model === 'b:free') return new Promise(() => {});
    return Response.json({ ...completion, model: body.model });
  } });
  const { status, data } = await post(url, { prompt: '  x  ', systemPrompt: '  extra  ', task: 'explicar', models: ['a:free', 'b:free', 'c:free'] });
  assert.equal(status, 200); assert.equal(data.attemptedRequests, 3);
  assert.deepEqual(data.results.map(r => r.requestedModel), ['a:free', 'b:free', 'c:free']);
  assert.equal(data.results[1].error.code, 'TIMEOUT');
  assert.equal(data.results[0].answer, 'Respuesta'); assert.equal(data.results[2].answer, 'Respuesta');
  assert.deepEqual(requests[0].messages, requests[2].messages);
  assert.equal(requests[0].messages[1].content, '  extra  '); assert.equal(requests[0].messages[2].content, '  x  ');
  assert.equal(new Set(signals).size, 3); assert.equal(signals[1].aborted, true); assert.equal(signals[0].aborted, false);
});
test('errores normalizados, Retry-After permitido y consumo incluso sin respuesta', async t => {
  for (const [status, code] of [[401, 'INVALID_API_KEY'], [402, 'INSUFFICIENT_BALANCE'], [404, 'MODEL_UNAVAILABLE'], [429, 'RATE_LIMIT'], [502, 'PROVIDER_UNAVAILABLE'], [503, 'PROVIDER_UNAVAILABLE']]) {
    const url = await serve(t, { fetchImpl: async () => Response.json({ error: { message: 'secret' }, usage: completion.usage }, { status, headers: { 'Retry-After': '10' } }) });
    const result = (await post(url, { prompt: 'x', models: ['a:free'] })).data.results[0];
    assert.equal(result.error.code, code); assert.equal(result.error.retryAfter, '10'); assert.equal(result.usage.total_tokens, 30); assert.ok(result.durationMs >= 0);
  }
  const url = await serve(t, { fetchImpl: async () => Response.json({ usage: { ...completion.usage, cost: 0.0003 } }) });
  const r = (await post(url, { prompt: 'x', models: ['a:free'] })).data.results[0];
  assert.equal(r.error.code, 'INVALID_RESPONSE'); assert.equal(r.usage.cost, 0.0003);
  const provider = await serve(t, { fetchImpl: async () => Response.json({ error: { code: 429, message: 'secret', metadata: { provider_name: 'provider' } } }) });
  assert.equal((await post(provider, { prompt: 'x', models: ['a:free'] })).data.results[0].error.code, 'PROVIDER_RATE_LIMIT');
});
test('instantánea de precio utilizado y respaldo al solicitado', async t => {
  const url = await serve(t, { fetchImpl: async () => Response.json({ ...completion, model: 'paid' }) });
  const r = (await post(url, { prompt: 'x', models: ['a:free'] })).data.results[0];
  assert.deepEqual(r.pricing, { input: 1, output: 3, model: 'paid', source: 'used' });
  const other = await serve(t, { fetchImpl: async () => Response.json({ ...completion, model: 'not-listed' }) });
  assert.equal((await post(other, { prompt: 'x', models: ['a:free'] })).data.results[0].pricing.source, 'requested');
});
test('historial limitado, recuperación aislada y acumulados de toda la sesión', () => {
  const history = createHistory();
  for (let i = 0; i < 12; i++) history.add({ attemptedRequests: 1, results: [{ usage: completion.usage, durationMs: 10 }], estimates: [0.5], prices: [{ input: 1, output: 3 }] });
  assert.equal(history.list().length, 10);
  const totals = history.totals(); assert.equal(totals.attemptedRequests, 12); assert.equal(totals.tokens, 360); assert.equal(totals.estimatedCost, 6); assert.equal(totals.averageLatencyMs, 10);
  const restored = history.get(12); restored.estimates[0] = 200;
  assert.equal(history.get(12).estimates[0], 0.5); assert.deepEqual(history.totals(), totals);
  history.add({ attemptedRequests: 1, results: [{ error: {}, usage: {} }], estimates: [null] });
  history.unconfirmed(3); assert.equal(history.totals().unconfirmedRequests, 3); assert.equal(history.totals().incomplete, true);
  history.clear(); assert.equal(history.list().length, 0); assert.equal(history.totals().attemptedRequests, 0); assert.equal(history.totals().incomplete, false);
});
test('recreación de gráficos destruye instancias anteriores', () => {
  const previous = globalThis.document; let created = 0; let destroyed = 0;
  globalThis.document = { getElementById: id => id };
  try {
    const charts = createCharts(class { constructor() { created++; } destroy() { destroyed++; } });
    charts.draw([{ usage: completion.usage }], [0]); charts.draw([], []);
    assert.equal(created, 6); assert.equal(destroyed, 3);
    charts.destroy(); charts.destroy(); assert.equal(destroyed, 6);
  } finally { globalThis.document = previous; }
});
test('catálogo público y ruta exclusiva de Chart.js, sin archivos privados', async t => {
  const url = await serve(t);
  assert.equal((await fetch(url + '/api/models')).status, 200);
  assert.equal((await fetch(url + '/vendor/chart.umd.js')).status, 200);
  for (const path of ['/config/fallback-models.json', '/lib/catalog.js', '/node_modules/chart.js/package.json', '/vendor/package.json']) assert.equal((await fetch(url + path)).status, 404);
});
test('catálogo vacío actualizado retira los modelos específicos anteriores', async () => {
  let now = 0;
  const catalog = createCatalog({ now: () => now, fetchImpl: async () => Response.json({ data: now ? [] : rawModels }) });
  assert.ok((await catalog.get()).models.some(m => m.id === 'a:free'));
  now = 300001;
  const result = await catalog.get();
  assert.equal(result.source, 'live');
  assert.deepEqual(result.models.map(m => m.id), ['openrouter/free']);
});
test('chat rechaza modelo configurado retirado sin llamadas', async t => {
  const url = await serve(t, { env: { OPENROUTER_API_KEY: 'secret', OPENROUTER_MODEL: 'retired' }, fetchImpl: () => assert.fail('No generar') });
  assert.equal((await post(url, { prompt: 'x', task: 'libre' }, '/api/chat')).data.error.code, 'UNAUTHORIZED_MODEL');
});
