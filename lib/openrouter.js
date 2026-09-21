import { normalizeUsage } from './normalization.js';

// Race also bounds providers/mocks that fail to observe the abort signal.
export async function withTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Timeout', 'TimeoutError');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}
export function providerError(status, providerLimited = false) {
  if (status === 401) return { status: 401, code: 'INVALID_API_KEY', message: 'OpenRouter rechazó la clave. Revisa OPENROUTER_API_KEY en el servidor.' };
  if (status === 402) return { status: 402, code: 'INSUFFICIENT_BALANCE', message: 'Saldo insuficiente en OpenRouter.' };
  if (status === 404 || status === 410) return { status: 502, code: 'MODEL_UNAVAILABLE', message: 'Modelo no disponible. Revisa OPENROUTER_MODEL y actualiza el catálogo.' };
  if (status === 429) return { status: 429, code: providerLimited ? 'PROVIDER_RATE_LIMIT' : 'RATE_LIMIT', message: providerLimited ? 'El proveedor está saturado. Espera antes de volver a generar.' : 'Se alcanzó el límite de solicitudes de la cuenta. Espera antes de volver a generar.' };
  if (status >= 500) return { status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'El proveedor no está disponible temporalmente.' };
  return { status: 502, code: 'PROVIDER_ERROR', message: 'OpenRouter rechazó la solicitud. Revisa la configuración de tu cuenta.' };
}
export async function generate({ model, messages, catalog, apiKey, fetchImpl, timeoutMs }) {
  const started = performance.now();
  const requested = catalog.find(m => m.id === model);
  const result = { requestedModel: model, model: null, usage: normalizeUsage(), pricing: { ...requested.pricing, model, source: 'requested' } };
  try {
    await withTimeout(async signal => {
      const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }), signal,
      });
      let data;
      try { data = await response.json(); }
      catch (error) { if (['AbortError', 'TimeoutError'].includes(error.name)) throw error; }
      result.usage = normalizeUsage(data?.usage);
      result.model = typeof data?.model === 'string' && data.model.trim() ? data.model : null;
      const used = catalog.find(m => m.id === result.model);
      if (used && used.pricing.input !== null && used.pricing.output !== null)
        result.pricing = { ...used.pricing, model: used.id, source: 'used' };
      if (!response.ok || data?.error) {
        const error = providerError(response.ok ? Number(data.error.code) : response.status, Boolean(data?.error?.metadata?.provider_name));
        const retry = response.headers?.get('retry-after');
        if (retry && (/^\d{1,10}$/.test(retry) || /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry))) error.retryAfter = retry;
        result.error = error;
      } else {
        const answer = data?.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || !answer.trim()) result.error = { status: 502, code: 'INVALID_RESPONSE', message: 'OpenRouter devolvió una respuesta vacía o inválida.' };
        else result.answer = answer;
      }
    }, timeoutMs);
  } catch (error) {
    result.error = ['TimeoutError', 'AbortError'].includes(error.name)
      ? { status: 504, code: 'TIMEOUT', message: 'El proveedor tardó demasiado en responder.' }
      : { status: 503, code: 'NETWORK_ERROR', message: 'No se pudo conectar con OpenRouter.' };
  }
  return { ...result, status: result.error ? 'error' : 'success', durationMs: Math.round(performance.now() - started) };
}
