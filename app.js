import express from 'express';
import { fileURLToPath } from 'node:url';
import { createCatalog, defaultModel } from './lib/catalog.js';
import { validateInput, validateModels, buildMessages } from './lib/validation.js';
import { generate } from './lib/openrouter.js';

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
export function createApp({ fetchImpl = fetch, timeoutMs = 60000, catalog: injectedCatalog, catalogOptions = {}, env = process.env } = {}) {
  const app = express();
  const catalog = injectedCatalog ?? createCatalog({ fetchImpl, ...catalogOptions });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/models', async (req, res) => {
    const snapshot = await catalog.get();
    res.json({ ...snapshot, paidModelsEnabled: env.ALLOW_PAID_MODELS === 'true', defaultModel: defaultModel(snapshot.models, env.OPENROUTER_MODEL) });
  });
  const handle = chat => async (req, res) => {
    const invalid = validateInput(req.body, chat);
    if (invalid) return fail(res, 400, invalid.code, invalid.message);
    if (!env.OPENROUTER_API_KEY?.trim()) return fail(res, 500, 'MISSING_API_KEY', 'Configura OPENROUTER_API_KEY en el servidor y reinícialo.');
    const { models } = await catalog.get();
    const ids = chat ? [env.OPENROUTER_MODEL?.trim() || defaultModel(models)] : req.body.models;
    const denied = validateModels(ids, models, env.ALLOW_PAID_MODELS === 'true', req.body.allowPaidModels);
    if (denied) return fail(res, 400, denied.code, denied.message);
    const messages = buildMessages(req.body);
    const settled = await Promise.allSettled(ids.map(model => generate({ model, messages, catalog: models, apiKey: env.OPENROUTER_API_KEY, fetchImpl, timeoutMs })));
    const results = settled.map((entry, index) => entry.status === 'fulfilled' ? entry.value : {
      requestedModel: ids[index], status: 'error', model: null, durationMs: null,
      error: { status: 500, code: 'INTERNAL_ERROR', message: 'No se pudo procesar la respuesta.' },
    });
    if (chat) return res.status(results[0].error?.status ?? 200).json(results[0]);
    return res.json({ results, attemptedRequests: ids.length });
  };
  app.post('/api/chat', handle(true));
  app.post('/api/compare', handle(false));
  app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(fileURLToPath(new URL('./node_modules/chart.js/dist/chart.umd.js', import.meta.url))));
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
  app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Ruta no encontrada.'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return fail(res, 413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.');
    if (error.type === 'entity.parse.failed') return fail(res, 400, 'INVALID_JSON', 'El cuerpo de la solicitud debe ser JSON válido.');
    return fail(res, 500, 'INTERNAL_ERROR', 'Se produjo un error interno.');
  });
  return app;
}
