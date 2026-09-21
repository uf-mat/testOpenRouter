import { readFileSync } from 'node:fs';
import { normalizeModel } from './normalization.js';
import { withTimeout } from './openrouter.js';

export function createCatalog({ fetchImpl = fetch, now = Date.now, timeoutMs = 10000, fallbackModels } = {}) {
  const fallback = (fallbackModels ?? JSON.parse(readFileSync(new URL('../config/fallback-models.json', import.meta.url), 'utf8'))).map(normalizeModel).filter(Boolean);
  if (!fallback.some(m => m.id === 'openrouter/free')) fallback.push(normalizeModel({ id: 'openrouter/free', name: 'Free Models Router' }));
  let cached = null;
  let updatedAt = null;
  let pending = null;
  const snapshot = (models, source) => ({ models, source, updatedAt: source === 'fallback' ? null : new Date(updatedAt).toISOString(), ageMs: source === 'fallback' ? null : Math.max(0, now() - updatedAt) });
  return {
    async get() {
      if (cached && now() - updatedAt < 300000) return snapshot(cached, 'cache');
      if (pending) return pending;
      pending = (async () => {
        try {
          const data = await withTimeout(async signal => {
            const response = await fetchImpl('https://openrouter.ai/api/v1/models', { signal });
            if (!response.ok) throw new Error('catalog');
            return response.json();
          }, timeoutMs);
          if (!Array.isArray(data?.data)) throw new Error('catalog');
          const models = [...new Map(data.data.map(normalizeModel).filter(Boolean).map(m => [m.id, m])).values()];
          if (data.data.length && !models.length) throw new Error('catalog');
          if (!models.some(m => m.id === 'openrouter/free')) models.push(normalizeModel({ id: 'openrouter/free', name: 'Free Models Router' }));
          cached = models;
          updatedAt = now();
          return snapshot(cached, 'live');
        } catch {
          return cached && now() - updatedAt <= 3600000 ? snapshot(cached, 'stale') : snapshot(fallback, 'fallback');
        } finally { pending = null; }
      })();
      return pending;
    },
  };
}
export function defaultModel(models, configured) {
  return models.find(m => m.id === configured?.trim() && m.free && m.selectable)?.id
    ?? models.filter(m => m.free && m.selectable && m.id !== 'openrouter/free').sort((a, b) => a.name.localeCompare(b.name))[0]?.id
    ?? 'openrouter/free';
}
