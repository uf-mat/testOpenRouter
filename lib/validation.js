export const instructions = {
  libre: null,
  explicar: 'Responde en español. Explica el tema para principiantes, paso a paso y con un ejemplo sencillo.',
  cuestionario: 'Responde en español. Crea cinco preguntas sobre el tema, cada una con cuatro opciones A, B, C y D y una sola respuesta correcta. Coloca las soluciones con una breve explicación al final. Usa texto plano.',
  mejorar: 'Mejora la claridad, gramática y estilo del texto conservando su significado e idioma. Devuelve el texto mejorado sin inventar información.',
};

export function validateInput(body, chat = false) {
  const { prompt, task = chat ? undefined : 'libre', systemPrompt, allowPaidModels } = body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000)
    return { code: 'INVALID_PROMPT', message: 'Escribe un prompt de entre 1 y 10.000 caracteres, no solo espacios.' };
  if (typeof task !== 'string' || !Object.hasOwn(instructions, task))
    return { code: 'INVALID_TASK', message: 'Selecciona un tipo de tarea válido.' };
  if (systemPrompt !== undefined && (typeof systemPrompt !== 'string' || systemPrompt.length > 4000))
    return { code: 'INVALID_SYSTEM_PROMPT', message: 'El system prompt debe ser texto de hasta 4.000 caracteres.' };
  if (allowPaidModels !== undefined && typeof allowPaidModels !== 'boolean')
    return { code: 'INVALID_CONSENT', message: 'La autorización de pago debe ser un booleano.' };
  if (!chat && (!Array.isArray(body.models) || body.models.length < 1 || body.models.length > 3 ||
      body.models.some(id => typeof id !== 'string') || new Set(body.models).size !== body.models.length))
    return { code: 'INVALID_MODELS', message: 'Selecciona entre uno y tres modelos distintos.' };
  return null;
}

export function buildMessages({ prompt, task = 'libre', systemPrompt }) {
  const messages = [];
  if (instructions[task]) messages.push({ role: 'system', content: instructions[task] });
  if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  return messages;
}

export function validateModels(ids, catalog, paidEnabled, consent) {
  for (const id of ids) {
    const model = catalog.find(model => model.id === id);
    if (!model || !model.selectable) return { code: 'UNAUTHORIZED_MODEL', message: 'Un modelo no está autorizado o no es compatible con conversación. Actualiza el catálogo.' };
    if (!model.free && !(paidEnabled && consent === true))
      return { code: 'PAID_MODELS_DISABLED', message: 'Los modelos pagados o de precio desconocido requieren habilitación del servidor y consentimiento para esta ejecución.' };
  }
  return null;
}
