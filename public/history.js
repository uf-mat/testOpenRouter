export function createHistory() {
  let entries = [];
  let nextId = 1;
  const empty = () => ({ attemptedRequests: 0, tokens: 0, realCost: 0, estimatedCost: 0, durationMs: 0, finished: 0, incomplete: false, unconfirmedRequests: 0 });
  let totals = empty();
  return {
    add(entry) {
      const saved = structuredClone({ ...entry, id: nextId++ });
      entries.unshift(saved);
      entries = entries.slice(0, 10);
      totals.attemptedRequests += entry.attemptedRequests;
      for (const [index, result] of entry.results.entries()) {
        const tokens = result.usage?.total_tokens;
        const cost = result.usage?.cost;
        const estimated = entry.estimates[index];
        if (tokens != null) totals.tokens += tokens; else totals.incomplete = true;
        if (cost != null) totals.realCost += cost; else totals.incomplete = true;
        if (estimated != null) totals.estimatedCost += estimated; else totals.incomplete = true;
        if (result.durationMs != null) { totals.durationMs += result.durationMs; totals.finished++; }
        else totals.incomplete = true;
      }
      return structuredClone(saved);
    },
    unconfirmed(count) { totals.unconfirmedRequests += count; totals.incomplete = true; },
    list: () => structuredClone(entries),
    get: id => structuredClone(entries.find(entry => entry.id === id)),
    totals: () => ({ ...totals, averageLatencyMs: totals.finished ? totals.durationMs / totals.finished : null }),
    clear() { entries = []; totals = empty(); },
  };
}
