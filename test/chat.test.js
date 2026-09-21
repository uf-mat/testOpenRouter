import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { normalizeModel } from '../lib/normalization.js';

const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;
const fakeKey = 'test-key-never-expose';
before(() => {
  process.env.OPENROUTER_API_KEY = fakeKey;
  delete process.env.OPENROUTER_MODEL;
});
after(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalModel;
});

const completion = {
  model: 'example/actual-free-model',
  choices: [{ message: { content: 'Una API permite comunicar aplicaciones.' } }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
};

async function serve(t, fetchImpl, options = {}) {
  const catalog = { get: async () => ({ models: [normalizeModel({ id: 'google/gemma-4-31b-it:free', name: 'Gemma' }), normalizeModel({ id: 'openrouter/free' })] }) };
  const server = createApp({ fetchImpl, catalog, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function chat(url, body = { prompt: '¿Qué es una API?', task: 'libre' }) {
  const response = await fetch(`${url}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(!JSON.stringify(data).includes(fakeKey), 'Nunca exponer la clave');
  return { response, data };
}

test('las cuatro tareas usan un modelo conversacional gratuito y devuelven métricas reales', async (t) => {
  const requests = [];
  const url = await serve(t, async (target, options) => {
    assert.equal(target, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    requests.push(JSON.parse(options.body));
    return Response.json(completion);
  });
  for (const task of ['libre', 'explicar', 'cuestionario', 'mejorar']) {
    const { response, data } = await chat(url, { prompt: '  Una API  ', task });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(data.answer, completion.choices[0].message.content);
    assert.equal(data.model, completion.model);
    for (const [key, value] of Object.entries(completion.usage)) assert.equal(data.usage[key], value);
    assert.ok(Number.isInteger(data.durationMs) && data.durationMs >= 0);
    const request = requests.at(-1);
    assert.equal(request.model, 'google/gemma-4-31b-it:free');
    assert.equal(request.stream, false);
    assert.deepEqual(request.messages.at(-1), { role: 'user', content: '  Una API  ' });
    assert.equal(request.messages.length, task === 'libre' ? 1 : 2);
    if (task !== 'libre') assert.equal(request.messages[0].role, 'system');
  }
  assert.match(requests[2].messages[0].content, /cinco preguntas/);
  assert.match(requests[2].messages[0].content, /soluciones/);
});

test('el modelo se configura en el servidor, no desde el cliente', async (t) => {
  const requests = [];
  const url = await serve(t, async (target, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json(completion);
  });
  try {
    process.env.OPENROUTER_MODEL = ' openrouter/free ';
    const { response, data } = await chat(url, { prompt: 'hola', task: 'libre', model: 'cliente/modelo' });
    assert.equal(response.status, 200);
    assert.equal(requests[0].model, 'openrouter/free');
    assert.equal(data.model, completion.model);

    process.env.OPENROUTER_MODEL = '   ';
    await chat(url);
    assert.equal(requests[1].model, 'google/gemma-4-31b-it:free');
  } finally { delete process.env.OPENROUTER_MODEL; }
});

test('rechaza datos inválidos sin llamar al proveedor', async (t) => {
  const url = await serve(t, () => { assert.fail('No debe llamar a OpenRouter'); });
  for (const body of [
    {}, { prompt: '', task: 'libre' }, { prompt: '   ', task: 'libre' },
    { prompt: 123, task: 'libre' }, { prompt: 'x'.repeat(10001), task: 'libre' },
    { prompt: 'hola' }, { prompt: 'hola', task: 'otra' },
    { prompt: 'hola', task: 'toString' }, { prompt: 'hola', task: {} },
  ]) {
    const { response, data } = await chat(url, body);
    assert.equal(response.status, 400);
    assert.ok(data.error.message);
  }
  const oversized = await chat(url, { prompt: 'x'.repeat(70_000), task: 'libre' });
  assert.equal(oversized.response.status, 413);
  const malformed = await fetch(`${url}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
});

test('clave ausente: error de configuración, no acepta una clave del cliente', async (t) => {
  const url = await serve(t, () => { assert.fail('No debe llamar a OpenRouter'); });
  delete process.env.OPENROUTER_API_KEY;
  try {
    const { response, data } = await chat(url, { prompt: 'hola', task: 'libre', apiKey: fakeKey });
    assert.equal(response.status, 500);
    assert.equal(data.error.code, 'MISSING_API_KEY');
  } finally { process.env.OPENROUTER_API_KEY = fakeKey; }
});

test('clasifica errores HTTP aunque el cuerpo sea HTML y oculta detalles', async (t) => {
  for (const [upstreamStatus, expected] of [[401, 401], [429, 429], [500, 503], [502, 503], [503, 503], [403, 502]]) {
    await t.test(`HTTP ${upstreamStatus}`, async (t) => {
      const url = await serve(t, async () => new Response(`<html>${fakeKey}</html>`, { status: upstreamStatus }));
      const { response, data } = await chat(url);
      assert.equal(response.status, expected);
      assert.ok(data.error.code);
    });
  }
});

test('detecta errores encapsulados en HTTP 200', async (t) => {
  const url = await serve(t, async () => Response.json({ error: { code: 429, message: fakeKey } }));
  const { response, data } = await chat(url);
  assert.equal(response.status, 429);
  assert.equal(data.error.code, 'RATE_LIMIT');
});

test('modelo retirado devuelve instrucciones para cambiar la configuración', async (t) => {
  const url = await serve(t, async () => Response.json({ error: { code: 404 } }, { status: 404 }));
  const { response, data } = await chat(url);
  assert.equal(response.status, 502);
  assert.equal(data.error.code, 'MODEL_UNAVAILABLE');
  assert.match(data.error.message, /OPENROUTER_MODEL/);
});

test('rechaza respuestas inválidas o vacías', async (t) => {
  for (const value of ['<html>invalid</html>', 'null', '{}', '{"choices":[]}', '{"choices":[{"message":{"content":"  "}}]}']) {
    await t.test(value, async (t) => {
      const url = await serve(t, async () => new Response(value));
      const { response, data } = await chat(url);
      assert.equal(response.status, 502);
      assert.equal(data.error.code, 'INVALID_RESPONSE');
    });
  }
});

test('metadatos ausentes o incorrectos son null, los tokens cero se conservan', async (t) => {
  const url = await serve(t, async () => Response.json({
    choices: completion.choices, usage: { prompt_tokens: 0, completion_tokens: -1, total_tokens: '20' },
  }));
  const { response, data } = await chat(url);
  assert.equal(response.status, 200);
  assert.equal(data.model, null);
  assert.equal(data.usage.prompt_tokens, 0);
  assert.equal(data.usage.completion_tokens, null);
  assert.equal(data.usage.total_tokens, null);
  assert.equal(data.usage.cost, null);
});

test('fallo de red devuelve 503 y no expone la excepción', async (t) => {
  const url = await serve(t, async () => { throw new TypeError(fakeKey); });
  const { response, data } = await chat(url);
  assert.equal(response.status, 503);
  assert.equal(data.error.code, 'NETWORK_ERROR');
});

test('aborta una petición lenta y devuelve 504', async (t) => {
  const url = await serve(t, async (target, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), { timeoutMs: 15 });
  const { response, data } = await chat(url);
  assert.equal(response.status, 504);
  assert.equal(data.error.code, 'TIMEOUT');
});

test('timeout durante la lectura de la respuesta devuelve 504', async (t) => {
  const url = await serve(t, async () => ({ ok: true, json: async () => { throw new DOMException('Timeout', 'TimeoutError'); } }));
  assert.equal((await chat(url)).response.status, 504);
});

test('sirve el frontend y bloquea archivos privados', async (t) => {
  const url = await serve(t, () => { assert.fail('No debe llamar a OpenRouter'); });
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /OpenRouter Prompt Lab/);
  for (const path of ['/styles.css', '/app.js']) assert.equal((await fetch(url + path)).status, 200);
  for (const path of ['/.env', '/.env.example', '/server.js', '/package.json', '/.git/config']) {
    assert.equal((await fetch(url + path)).status, 404);
  }
});
