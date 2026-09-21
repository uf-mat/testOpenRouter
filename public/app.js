import { estimate, projections, usd, validPrice } from './costs.js';
import { createHistory } from './history.js';
import { createCharts, chartData, tokenParts } from './charts.js';

const $ = id => document.getElementById(id);
const history = createHistory();
const charts = createCharts();
let catalog = [];
let selected = new Set();
let loading = false;
let current = null;
const show = value => value ?? 'No disponible';
const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
const text = (tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
};
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function updateSelection() {
  $('request-count').textContent = `Esta comparación realizará ${selected.size} solicitudes a OpenRouter.`;
  $('generate').disabled = loading || selected.size === 0;
  $('model-selector').querySelectorAll('input').forEach(input => {
    input.disabled = loading || !catalog.find(m => m.id === input.value).selectable || (selected.size >= 3 && !input.checked);
  });
}
function renderModels() {
  const query = $('model-search').value.toLocaleLowerCase();
  $('model-selector').replaceChildren();
  for (const [title, match] of [
    ['Router experimental', m => m.id === 'openrouter/free'],
    ['Gratuitos específicos', m => m.free && m.id !== 'openrouter/free'],
    ['Pagados / precio desconocido', m => !m.free],
  ]) {
    const models = catalog.filter(m => match(m) && (selected.has(m.id) || `${m.id} ${m.name}`.toLocaleLowerCase().includes(query)));
    if (!models.length) continue;
    $('model-selector').append(text('h3', title));
    for (const model of models) {
      const label = text('label', '', 'check');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = model.id; input.checked = selected.has(model.id);
      input.addEventListener('change', () => {
        if (input.checked) selected.add(model.id); else selected.delete(model.id);
        updateSelection();
      });
      const description = text('span', model.name);
      description.append(text('small', `${model.id} · Contexto: ${show(model.context)} · Entrada/salida por millón: ${usd(model.pricing.input)} / ${usd(model.pricing.output)}. ${model.warnings.join(' ')}`));
      label.append(input, description); $('model-selector').append(label);
    }
  }
  updateSelection();
}
function simulation() {
  const source = $('price-source').value;
  const reference = catalog.find(m => m.id === $('price-model').value);
  const common = source === 'manual' ? { input: number('input-price'), output: number('output-price') } : reference?.pricing;
  const samePrices = current.prices && ['price-source', 'price-model', 'input-price', 'output-price'].every(id => current.settings[id] === $(id).value);
  const prices = samePrices ? current.prices : current.results.map(result => source === 'used' ? result.pricing : { ...common, model: source === 'manual' ? 'Hipotético' : reference?.id, source });
  const estimates = current.results.map((result, index) => estimate(result.usage, prices[index]));
  const projection = projections(estimates, number('requests'), number('students'), number('per-student'));
  const invalid = !projection || (source === 'manual' && ![common.input, common.output].every(validPrice));
  return { prices, estimates, projection, invalid };
}
const headers = ['Modelo solicitado', 'Modelo utilizado', 'Estado', 'Entrada', 'Salida total', 'Total reportado', 'Razonamiento', 'Entrada en caché', 'Escritura de caché', 'Salida sin razonamiento (si válido)', 'Latencia (ms)', 'Costo real USD', 'Costo estimado USD', 'Origen de precios', 'Precio entrada / millón', 'Precio salida / millón'];
headers.forEach(header => { const th = text('th', header); th.scope = 'col'; $('metric-head').append(th); });
function renderMetrics() {
  if (!current) return;
  const { prices, estimates, projection, invalid } = simulation();
  $('catalog-price-fields').hidden = $('price-source').value !== 'catalog';
  $('manual-price-fields').hidden = $('price-source').value !== 'manual';
  $('simulation-error').hidden = !invalid;
  $('simulation-error').textContent = 'Usa precios finitos no negativos y cantidades enteras positivas. Los resultados fuera del rango numérico no están disponibles.';
  $('projection').textContent = invalid ? '' : `Promedio por solicitud: ${usd(projection.average)} (${projection.count}/${current.results.length} resultados con datos suficientes). Promedio × ${$('requests').value} solicitudes: ${usd(projection.requests)}. Promedio × ${$('students').value} estudiantes × ${$('per-student').value} solicitudes: ${usd(projection.classroom)}.`;
  $('metric-body').replaceChildren();
  current.results.forEach((r, index) => {
    const u = r.usage;
    const p = prices[index];
    const reasoning = u?.completion_tokens_details?.reasoning_tokens;
    const validReasoning = reasoning != null && u?.completion_tokens != null && reasoning <= u.completion_tokens;
    const row = document.createElement('tr');
    [r.requestedModel, r.model, r.error ? `${r.error.code}: ${r.error.message}${r.error.retryAfter ? ` Retry-After: ${r.error.retryAfter}` : ''}` : 'Completada',
      u?.prompt_tokens, u?.completion_tokens, u?.total_tokens, reasoning, u?.prompt_tokens_details?.cached_tokens, u?.prompt_tokens_details?.cache_write_tokens,
      validReasoning ? tokenParts(u).output : null, r.durationMs, usd(u?.cost), usd(estimates[index]),
      `${p?.source === 'used' ? 'Utilizado' : p?.source === 'requested' ? 'Respaldo al solicitado' : p?.source === 'manual' ? 'Hipotético' : 'Catálogo'}: ${p?.model ?? 'No disponible'}`, usd(p?.input), usd(p?.output),
    ].forEach(value => row.append(text('td', show(value))));
    $('metric-body').append(row);
  });
  $('zero-cost').hidden = !chartData(current.results, estimates).allZero;
  charts.draw(current.results, estimates);
}
function renderResults() {
  charts.destroy();
  $('answers').replaceChildren();
  $('analysis').hidden = !current;
  if (!current) return;
  for (const result of current.results) {
    const article = text('article', '', 'response');
    article.append(text('h3', result.requestedModel), text('p', `Modelo utilizado: ${show(result.model)}`), text('div', result.answer ?? result.error?.message ?? 'No disponible', result.error ? 'error' : 'answer'));
    $('answers').append(article);
  }
  renderMetrics();
}
function settings() {
  return Object.fromEntries(['price-source', 'price-model', 'input-price', 'output-price', 'requests', 'students', 'per-student'].map(id => [id, $(id).value]));
}
function restoreSettings(values) {
  for (const [id, value] of Object.entries(values)) {
    if (id === 'price-model' && ![...$(id).options].some(option => option.value === value)) $(id).add(new Option(`${value} (histórico)`, value));
    $(id).value = value;
  }
}
function renderHistory() {
  $('history').replaceChildren();
  for (const entry of history.list()) {
    const button = text('button', `${new Date(entry.date).toLocaleString('es')} · ${entry.inputs.models.length} modelo(s) · ${entry.inputs.prompt.slice(0, 70)}`, 'secondary');
    button.type = 'button'; button.disabled = loading;
    button.addEventListener('click', () => {
      current = history.get(entry.id);
      $('prompt').value = current.inputs.prompt; $('task').value = current.inputs.task;
      $('system-prompt').value = current.inputs.systemPrompt;
      $('allow-paid').checked = false;
      selected = new Set(current.inputs.models.filter(id => catalog.some(m => m.id === id && m.selectable)));
      restoreSettings(current.settings);
      renderModels(); renderResults();
      // Restore the exact saved price snapshot, even if a reference model disappeared.
      $('status').textContent = 'Comparación recuperada; no se han enviado solicitudes. Las métricas originales están conservadas.';
      error();
    });
    $('history').append(button);
  }
  const totals = history.totals();
  $('totals').textContent = `Solicitudes intentadas confirmadas: ${totals.attemptedRequests}. Tokens totales reportados: ${totals.tokens}. Costo real conocido: ${usd(totals.realCost)}. Estimaciones guardadas: ${usd(totals.estimatedCost)}. Latencia media de llamadas terminadas: ${show(totals.averageLatencyMs === null ? null : `${Math.round(totals.averageLatencyMs)} ms`)}. ${totals.incomplete ? 'Datos incompletos.' : ''} ${totals.unconfirmedRequests ? `Consumo no confirmado por interrupción: hasta ${totals.unconfirmedRequests} llamadas adicionales.` : ''}`;
}
$('prompt-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (loading) return;
  error();
  if (!$('prompt').value.trim()) { error('Escribe un prompt, no solo espacios.'); $('prompt').focus(); return; }
  if (selected.size < 1 || selected.size > 3) { error('Selecciona entre uno y tres modelos.'); return; }
  if ([...selected].some(id => !catalog.find(m => m.id === id).free) && (!$('allow-paid').checked || $('allow-paid').disabled)) {
    error('Los modelos pagados requieren habilitación del servidor y consentimiento para esta ejecución.'); return;
  }
  const inputs = { prompt: $('prompt').value, task: $('task').value, systemPrompt: $('system-prompt').value, models: [...selected], allowPaidModels: $('allow-paid').checked };
  const savedSettings = settings();
  loading = true; current = null; renderResults(); updateSelection();
  $('clear-results').disabled = true; $('reset-history').disabled = true;
  $('prompt-form').querySelectorAll('textarea, select, input').forEach(input => { input.dataset.wasDisabled = String(input.disabled); input.disabled = true; });
  $('analysis').querySelectorAll('input, select').forEach(input => { input.disabled = true; });
  renderHistory();
  $('result').setAttribute('aria-busy', 'true');
  $('status').textContent = `Esperando ${inputs.models.length} respuestas… Se mostrarán juntas al terminar (hasta 60 segundos por modelo).`;
  for (const model of inputs.models) {
    const card = text('article', '', 'response');
    card.append(text('h3', model), text('p', 'Esperando respuesta…', 'loading')); $('answers').append(card);
  }
  let globalFailure = false;
  try {
    const response = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs), signal: AbortSignal.timeout(80000) });
    const data = await response.json();
    if (!response.ok) { globalFailure = true; throw new Error(data?.error?.message ?? 'La solicitud fue rechazada.'); }
    if (!Array.isArray(data.results) || data.results.length !== inputs.models.length || data.attemptedRequests !== inputs.models.length) throw new Error('Respuesta del servidor incompleta.');
    current = { date: new Date().toISOString(), inputs, results: data.results, attemptedRequests: data.attemptedRequests, settings: savedSettings };
    const simulated = simulation();
    current.prices = simulated.prices; current.estimates = simulated.estimates;
    current = history.add(current);
    renderResults();
    $('status').textContent = `Comparación terminada: ${data.results.filter(r => !r.error).length}/${data.results.length} respuestas válidas.`;
  } catch (failure) {
    current = null; renderResults();
    if (!globalFailure) history.unconfirmed(inputs.models.length);
    error(globalFailure ? failure.message : 'Se interrumpió la comunicación o la respuesta fue inválida. El consumo no está confirmado; no se reintenta automáticamente.');
    $('status').textContent = 'No se pudo completar la comparación.';
  } finally {
    loading = false;
    $('prompt-form').querySelectorAll('textarea, select, input').forEach(input => { input.disabled = input.dataset.wasDisabled === 'true'; });
    $('analysis').querySelectorAll('input, select').forEach(input => { input.disabled = false; });
    $('allow-paid').checked = false;
    $('clear-results').disabled = false; $('reset-history').disabled = false;
    $('result').setAttribute('aria-busy', 'false'); updateSelection(); renderHistory();
  }
});
$('model-search').addEventListener('input', renderModels);
$('analysis').addEventListener('input', event => { if (event.target.matches('input, select')) renderMetrics(); });
$('clear-results').addEventListener('click', () => { current = null; renderResults(); $('status').textContent = 'Resultados limpiados. Historial y acumulados conservados.'; error(); });
$('reset-history').addEventListener('click', () => { history.clear(); renderHistory(); current = null; renderResults(); $('status').textContent = 'Historial y acumulados reiniciados.'; error(); });
renderHistory();
try {
  const response = await fetch('/api/models');
  if (!response.ok) throw new Error('No se pudo cargar el catálogo. Recarga la página.');
  const data = await response.json(); catalog = data.models.sort((a, b) => a.name.localeCompare(b.name));
  selected = new Set([data.defaultModel]);
  $('catalog-status').textContent = `Origen: ${data.source}. Antigüedad: ${data.ageMs === null ? 'desconocida' : `${Math.floor(data.ageMs / 1000)} s`}. ${['stale', 'fallback'].includes(data.source) ? 'Catálogo no actualizado; disponibilidad no garantizada.' : 'La disponibilidad puede cambiar.'}`;
  $('allow-paid').disabled = !data.paidModelsEnabled;
  $('paid-help').textContent = data.paidModelsEnabled ? 'Pagos habilitados en el servidor. El consentimiento se borra después de cada ejecución.' : 'Pagos deshabilitados en el servidor (ALLOW_PAID_MODELS=false). Puedes consultar sus precios para simular.';
  catalog.forEach(model => $('price-model').add(new Option(model.name, model.id)));
  renderModels();
} catch (failure) { error(failure.message); $('catalog-status').textContent = 'Catálogo no disponible.'; }
