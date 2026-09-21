export const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function normalizeUsage(usage) {
  return {
    prompt_tokens: count(usage?.prompt_tokens),
    completion_tokens: count(usage?.completion_tokens),
    total_tokens: count(usage?.total_tokens),
    prompt_tokens_details: { cached_tokens: count(usage?.prompt_tokens_details?.cached_tokens), cache_write_tokens: count(usage?.prompt_tokens_details?.cache_write_tokens) },
    completion_tokens_details: { reasoning_tokens: count(usage?.completion_tokens_details?.reasoning_tokens) },
    cost: amount(usage?.cost),
  };
}
export function perMillion(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value) * 1e6;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function normalizeModel(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const input = raw.architecture?.input_modalities;
  const output = raw.architecture?.output_modalities;
  if ((Array.isArray(input) && !input.includes('text')) || (Array.isArray(output) && !output.includes('text'))) return null;
  const modality = raw.architecture?.modality;
  if (typeof modality === 'string' && modality.includes('->') && !modality.split('->').every(side => side.split('+').includes('text'))) return null;
  const pricing = { input: perMillion(raw.pricing?.prompt), output: perMillion(raw.pricing?.completion) };
  const router = raw.id === 'openrouter/free';
  const free = router || raw.id.endsWith(':free') || (pricing.input === 0 && pricing.output === 0);
  const moderation = /content[- _]?safety|moderation|(?:llama[- _]?)?guard/i.test(`${raw.id} ${raw.name ?? ''}`) || /(?:designed for|specialized in) (?:content )?moderation/i.test(raw.description ?? '');
  const warnings = [];
  if (router) warnings.push('Experimental: selección variable; puede elegir modelos especializados, incluida moderación.');
  if (moderation) warnings.push('Modelo de moderación: no seleccionable para conversación.');
  if (pricing.input === null || pricing.output === null) warnings.push('Precios desconocidos; no equivalen a cero.');
  return { id: raw.id, name: typeof raw.name === 'string' ? raw.name : raw.id, context: count(raw.context_length), pricing, free, classification: free ? 'free' : 'paid', selectable: !moderation, warnings };
}
