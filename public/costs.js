export const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const validQuantity = value => Number.isSafeInteger(value) && value > 0;
export function estimate(usage, prices) {
  if (![usage?.prompt_tokens, usage?.completion_tokens, prices?.input, prices?.output].every(validPrice)) return null;
  const cost = (usage.prompt_tokens * prices.input + usage.completion_tokens * prices.output) / 1e6;
  return Number.isFinite(cost) ? cost : null;
}
export function projections(estimates, requests, students, perStudent) {
  if (![requests, students, perStudent].every(validQuantity)) return null;
  const known = estimates.filter(validPrice);
  if (!known.length) return { average: null, requests: null, classroom: null, count: 0 };
  const average = known.reduce((sum, cost) => sum + cost / known.length, 0);
  const finite = n => Number.isFinite(n) ? n : null;
  return { average, requests: finite(average * requests), classroom: finite(average * students * perStudent), count: known.length };
}
export function usd(value) {
  if (!validPrice(value)) return 'No disponible';
  if (value === 0) return '$0.00 USD';
  if (value < 0.000001) return `$${value.toExponential(4)} USD`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 ? 9 : 6 })} USD`;
}
