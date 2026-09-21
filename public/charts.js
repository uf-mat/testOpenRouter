export function tokenParts(usage) {
  const output = usage?.completion_tokens ?? null;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens;
  const valid = output !== null && reasoning != null && reasoning <= output;
  return { input: usage?.prompt_tokens ?? null, output: valid ? output - reasoning : output, reasoning: valid ? reasoning : null };
}
export function chartData(results, estimates) {
  const parts = results.map(r => tokenParts(r.usage));
  return {
    tokens: [
      { label: 'Entrada (incluye caché)', data: parts.map(p => p.input), backgroundColor: '#21745b' },
      { label: 'Salida (sin razonamiento si hay desglose)', data: parts.map(p => p.output), backgroundColor: '#79bda4' },
      { label: 'Razonamiento desglosado', data: parts.map(p => p.reasoning), backgroundColor: '#d49a45' },
    ],
    latency: [{ label: 'Latencia (ms)', data: results.map(r => r.durationMs ?? null), backgroundColor: '#517da3' }],
    costs: [
      { label: 'Costo real (USD)', data: results.map(r => r.usage?.cost ?? null), backgroundColor: '#21745b' },
      { label: 'Costo estimado (USD)', data: estimates, backgroundColor: '#d49a45' },
    ],
    allZero: results.length > 0 && results.every(r => r.usage?.cost === 0),
  };
}
export function createCharts(ChartClass = globalThis.Chart) {
  let instances = [];
  const destroy = () => { instances.forEach(chart => chart.destroy()); instances = []; };
  return {
    destroy,
    draw(results, estimates) {
      destroy();
      if (!ChartClass) return;
      const data = chartData(results, estimates);
      for (const name of ['tokens', 'latency', 'costs']) {
        instances.push(new ChartClass(document.getElementById(`${name}-chart`), {
          type: 'bar', data: { labels: results.map(r => r.requestedModel), datasets: data[name] },
          options: { responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x: { stacked: name === 'tokens' }, y: { beginAtZero: true, stacked: name === 'tokens' } },
            plugins: { legend: { position: 'bottom' } },
          },
        }));
      }
    },
  };
}
