# OpenRouter Prompt Lab

Laboratorio educativo en español con Express, JavaScript y Chart.js. Permite usar un modelo o comparar hasta tres con el mismo prompt y las mismas instrucciones; muestra respuestas, métricas, simulación de costos e historial temporal. Requiere Node.js 24 o superior y una clave de [OpenRouter](https://openrouter.ai/settings/keys).

## Instalación y Codespaces

```bash
npm install
# Solo si NO existe .env:
test -f .env || cp .env.example .env
npm run check
npm test
npm run dev
```

Escribe tu clave en el `.env` existente, conservando sus demás valores. Nunca copies la clave a `public/`. Abre el puerto **3000** en la pestaña **Ports / Puertos**, conserva su visibilidad **Private / Privado** y pulsa **Open in Browser**. En local, abre `http://localhost:3000`. [Guía de puertos de Codespaces](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).

Prueba primero un modelo gratuito específico con «¿Cómo funciona una API?» y la tarea **Explicar**; después selecciona hasta tres modelos. Cada modelo supone una solicitud. Los prompts se envían a OpenRouter y sus proveedores. `Ctrl+C` detiene el servidor. Reinícialo si editas `.env` o el respaldo. `npm start` ejecuta sin vigilancia.

| Variable | Valor / función |
| --- | --- |
| `OPENROUTER_API_KEY` | Clave privada; obligatoria para generar, innecesaria para consultar el catálogo. |
| `OPENROUTER_MODEL` | Preferencia inicial si está autorizada y es gratuita. En `/api/chat` es el modelo configurado, sujeto a catálogo y protección de pagos. |
| `ALLOW_PAID_MODELS` | `false` por defecto. Solo el texto exacto `true` habilita pagos; además cada solicitud necesita `allowPaidModels: true`. |
| `PORT` | `3000` por defecto. |

El respaldo se edita en [`config/fallback-models.json`](config/fallback-models.json), con objetos de catálogo `{ "id": "…", "name": "…" }` y, opcionalmente, `context_length`, `architecture` y `pricing` (USD **por token**, como OpenRouter). Reinicia tras editarlo. No inventes precios: omitirlos produce `null`.

La lista inicial incluye `openrouter/free`, `google/gemma-4-31b-it:free` y `google/gemma-4-26b-a4b-it:free`, presentes en el [catálogo consultado el 21 de septiembre de 2026](https://openrouter.ai/api/v1/models). Esto no garantiza disponibilidad futura. Los precios de respaldo permanecen desconocidos. El router es experimental: su selección varía y puede incluir modelos especializados. Nemotron Content Safety y otros modelos identificados explícitamente como moderación no se pueden seleccionar directamente.

## Uso educativo

Se conservan **Prompt libre**, **Explicar**, **Generar cuestionario** (cinco preguntas y soluciones) y **Mejorar texto**. Las instrucciones de tarea preceden al system prompt adicional. Cada generación inicia una conversación nueva; el historial no se envía al modelo. El formulario muestra el número de llamadas antes de enviarlas. Durante la ejecución se bloquean los envíos duplicados y cada tarjeta espera hasta recibir el JSON conjunto.

- **Token:** fragmento procesado por el modelo; no necesariamente una palabra.
- **Entrada:** instrucciones y prompt. **Salida:** tokens generados, incluido razonamiento cuando el proveedor lo contabiliza así.
- **Razonamiento:** desglose interno reportado. **Caché:** entrada reutilizada o escrita; ya está incluida en entrada.
- **Contexto:** capacidad del modelo; no garantiza el máximo de salida.
- **Latencia:** tiempo en el servidor hasta terminar la llamada, sin el viaje navegador-servidor; también se muestra para errores.

**Los modelos pueden usar tokenizadores diferentes, por lo que el mismo texto puede producir distintas cantidades de tokens.**

Las métricas proceden directamente de `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.cache_write_tokens`, `completion_tokens_details.reasoning_tokens` y `cost`. Los valores ausentes o inválidos son `null` / **No disponible**; los ceros se conservan. El costo real procede exclusivamente de `usage.cost`, sin consultar generaciones posteriormente. Una respuesta sin texto puede haber consumido tokens y dinero; se conserva el uso reportado. [Contabilidad de uso](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

Los gráficos muestran tokens apilados, latencia desde cero y costos real/estimado agrupados. Solo se resta razonamiento de salida si está reportado y no supera la salida total. La caché permanece dentro de entrada. Se omiten valores desconocidos y la tabla contiene los datos equivalentes. [Tokens de razonamiento](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Simulador e historial

Se puede usar la instantánea de precios del modelo utilizado (con respaldo claramente identificado al solicitado), los precios de otro modelo del catálogo o precios hipotéticos comunes. Consultar precios pagados no genera llamadas ni exige consentimiento de pago.

```text
estimado = (tokens_entrada × precio_entrada + tokens_salida × precio_salida) / 1.000.000
promedio = suma de estimaciones conocidas / cantidad de estimaciones conocidas
proyección de solicitudes = promedio × solicitudes
proyección de clase = promedio × estudiantes × solicitudes_por_estudiante
```

Los precios son USD por millón. No se suman otra vez razonamiento ni caché. La estimación simple no reproduce descuentos, tarifas adicionales ni variaciones por proveedor. Solo se incluyen resultados con ambos contadores y ambos precios válidos. Los precios deben ser finitos y no negativos; las cantidades, enteros positivos. Valores iniciales: 100 solicitudes, 30 estudiantes y 10 solicitudes por estudiante. Los importes positivos diminutos conservan precisión y no se muestran como cero.

Se guardan **diez comparaciones en memoria de la pestaña**, con fecha, entradas, resultados, ajustes y precios usados. Recuperarlas no envía solicitudes ni incrementa contadores. Los acumulados incluyen toda la sesión, incluso registros descartados: llamadas intentadas confirmadas, tokens totales reportados, costo real conocido, estimaciones guardadas al ejecutar y latencia media de llamadas terminadas (incluidos errores). Los datos incompletos se señalan. Una interrupción navegador-servidor deja hasta N llamadas con consumo no confirmado, separado de los intentos confirmados.

Cambiar una simulación no modifica los acumulados históricos. **Limpiar resultados** destruye los gráficos y la vista, conservando historial y acumulados. **Eliminar historial y reiniciar acumulados** borra ambos y la vista actual. Recargar inicia otra sesión. No se usa `localStorage` ni base de datos.

## API

### `GET /api/models`

Devuelve `models`, `source` (`live`, `cache`, `stale`, `fallback`), `updatedAt`, `ageMs`, `defaultModel` y `paidModelsEnabled`. Cada modelo contiene `id`, `name`, `context`, `pricing: {input, output}` en USD por millón, `free`, `classification`, `selectable` y `warnings`. `selectable` indica compatibilidad; los modelos pagados aún requieren doble autorización. Precio desconocido no significa gratuito: solo se consideran gratuitos los identificadores `:free`, ambos precios de tokens cero o el router gratuito explícito.

Caché en memoria de cinco minutos, timeout de catálogo de diez segundos y consulta compartida entre peticiones concurrentes. En fallos se utiliza el último catálogo válido hasta una hora desde su obtención; después, el respaldo. `ageMs` y `updatedAt` son `null` para respaldo. Un catálogo nuevo sustituye íntegramente al anterior: los modelos retirados dejan de estar autorizados. La selección inicial prefiere `OPENROUTER_MODEL` si es gratuito y válido; luego el primer gratuito específico por nombre y finalmente el router.

### `POST /api/compare`

```json
{
  "prompt": "¿Qué es una API?",
  "models": ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"],
  "task": "explicar",
  "systemPrompt": "Usa una analogía cotidiana.",
  "allowPaidModels": false
}
```

`prompt`: texto no vacío, hasta 10.000 caracteres; se conserva el contenido original, incluidos espacios. `models`: entre uno y tres identificadores distintos del catálogo autorizado. `task`: opcional, `libre` por defecto; las otras tareas son `explicar`, `cuestionario`, `mejorar`. `systemPrompt`: texto opcional, hasta 4.000 caracteres. `allowPaidModels`: booleano, falso por defecto. Cuerpo máximo: 64 KB.

Todo se valida antes de generar. Se usa `Promise.allSettled`, una llamada por modelo, mensajes idénticos y un `AbortController` por llamada con timeout de 60 segundos. No hay reintentos. HTTP 200 indica ejecución, aunque todos los resultados sean errores. Se devuelven juntos y en el orden solicitado:

```json
{
  "attemptedRequests": 1,
  "results": [{
    "status": "success",
    "requestedModel": "google/gemma-4-31b-it:free",
    "model": "google/gemma-4-31b-it:free",
    "answer": "Una API permite…",
    "usage": {
      "prompt_tokens": 20, "completion_tokens": 50, "total_tokens": 70,
      "prompt_tokens_details": { "cached_tokens": null, "cache_write_tokens": null },
      "completion_tokens_details": { "reasoning_tokens": null },
      "cost": 0
    },
    "durationMs": 1250,
    "pricing": { "input": 0, "output": 0, "model": "google/gemma-4-31b-it:free", "source": "used" }
  }]
}
```

Cifras ilustrativas. `pricing.source` es `used` o `requested`. Un resultado fallido lleva `status: "error"` y `error: {status, code, message, retryAfter?}`, además de duración, uso e instantánea de precios. Nunca se devuelven cuerpos crudos de error ni credenciales.

### `POST /api/chat` (compatible)

```bash
curl http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"¿Qué es una API?","task":"explicar"}'
```

Conserva `prompt`, `task` obligatorio y la respuesta directa con `answer`, `model`, `usage`, `durationMs`; añade los nuevos metadatos. El modelo se configura en el servidor; se ignora `model` del cliente. Acepta `systemPrompt` y `allowPaidModels`, aplicando la misma protección de pagos. Los errores conservan `{error: {code, message}}` con metadatos adicionales y el estado HTTP correspondiente. Si el modelo configurado fue retirado, rechaza antes de generar.

| Código | Significado |
| --- | --- |
| `INVALID_*`, `UNAUTHORIZED_MODEL`, `PAID_MODELS_DISABLED` | Entrada o permisos inválidos (400 global). |
| `BODY_TOO_LARGE` | Más de 64 KB (413 global). |
| `MISSING_API_KEY` | Configuración ausente (500 global). |
| `INVALID_API_KEY` | Autenticación rechazada (401). |
| `INSUFFICIENT_BALANCE` | Saldo insuficiente (402). |
| `MODEL_UNAVAILABLE` | Modelo retirado o no disponible (502). |
| `RATE_LIMIT` | Límite de cuenta (429). |
| `PROVIDER_RATE_LIMIT` | Saturación 429 identificada mediante metadatos de proveedor. |
| `PROVIDER_UNAVAILABLE` | Error 5xx del proveedor (503). |
| `INVALID_RESPONSE` | JSON o texto no utilizable (502). |
| `TIMEOUT` | Más de 60 segundos (504). |
| `NETWORK_ERROR` | Conexión fallida (503). |

Solo se conserva `Retry-After` si tiene formato numérico o fecha HTTP. Cuando un 429 no identifica proveedor, se clasifica como límite de cuenta; la información disponible no siempre permite distinguir su origen.

## Archivos y verificación

- `app.js`, `server.js`: rutas y arranque. Solo `public/` y `/vendor/chart.umd.js` son públicos; no se expone `node_modules`.
- `lib/catalog.js`, `normalization.js`, `validation.js`, `openrouter.js`: catálogo, normalización, validación y cliente.
- `public/app.js`, `costs.js`, `charts.js`, `history.js`: interfaz, fórmulas, gráficos e historial. Las respuestas usan `textContent`.
- `config/fallback-models.json`: respaldo editable sin claves.
- `test/chat.test.js`, `test/lab.test.js`: regresión del contrato, tareas, fórmulas, ceros, catálogo, pagos, concurrencia, timeout, errores, historial, gráficos y archivos privados.
- `scripts/check.js`: comprobación de sintaxis de todos los módulos.

`npm test` usa OpenRouter simulado: no necesita ni lee `.env` y no consume solicitudes reales. `npm run check` comprueba sintaxis. La aplicación conserva Express y añade solo Chart.js como dependencia directa (con su dependencia transitiva).

La comprobación opcional `scripts/browser-check.mjs` usa Playwright instalado fuera del proyecto y Chromium. Indica la ruta del módulo con `PLAYWRIGHT_MODULE` y ejecuta `node scripts/browser-check.mjs`. Arranca su propio servidor simulado, verifica escritorio/móvil, teclado, espera, selección, pagos, precios, recuperación y limpieza; guarda capturas en `/tmp/prompt-lab-check/`. Playwright no forma parte de las dependencias npm del proyecto.

Para revisar en navegador: escritorio y 375 px; seleccionar uno y tres modelos con teclado, verificar foco y contador; enviar un prompt, comprobar espera conjunta, tabla desplazable y gráficos; cambiar precios y proyecciones; recuperar historial sin nueva petición; limpiar resultados y reiniciar historial. Prueba errores con respuestas simuladas. Una prueba real de disponibilidad requiere conectividad y una clave válida; los tests no garantizan disponibilidad ni calidad del proveedor.

Es un laboratorio personal sin autenticación propia. Mantén el puerto privado. `.env` se ignora en Git; no registres claves ni prompts en logs. No hay despliegues ni commits automáticos.
