// Serverová proxy: přijme konverzaci, zavolá správného poskytovatele a streamuje
// odpověď ve formátu NDJSON: {"t":"delta"|"think"|"error"|"done","v":"..."}.
// API klíče se čtou výhradně z proměnných prostředí – nikdy nejdou do prohlížeče.

import { findModel, hasKey, PROVIDERS, publicCatalog } from './models.mjs';
import { authEnabled, publicConfig, verifyUser } from './auth.mjs';

const LIMITS = { messages: 80, perMessage: 32_000, total: 240_000, attachments: 4, attachmentBytes: 5_200_000 };
const MIME = { image: /^image\/(png|jpeg|webp)$/, video: /^video\/(mp4|webm|quicktime)$/ };
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export function modelsResponse(env) {
  return json(200, { ...publicCatalog(env), config: publicConfig(env) });
}

function systemPrompt(model) {
  return [
    `Jsi AdrrexAI, prémiový AI asistent platformy AdrrexAI (režim ${model.groupName}).`,
    model.mode === 'agent' ? 'Máš přístup k vyhledávání na webu: aktuální informace vždy dohledej a uveď zdroje.' : '',
    `Běžíš na modelu ${model.label} od poskytovatele ${PROVIDERS[model.provider].label}; pokud se tě někdo zeptá, řekni to pravdivě.`,
    'Odpovídej v jazyce uživatele, věcně a přehledně. Formátuj pomocí Markdownu, kód vždy dávej do bloků s uvedeným jazykem.',
  ].filter(Boolean).join(' ');
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Neplatné tělo požadavku.';
  const { model, messages } = body;
  if (typeof model !== 'string' || !findModel(model)) return 'Neznámý model.';
  if (!Array.isArray(messages) || messages.length === 0) return 'Chybí zprávy.';
  if (messages.length > LIMITS.messages) return 'Konverzace je příliš dlouhá, začni nový chat.';
  let total = 0;
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return 'Neplatná zpráva.';
    if (m.content.length > LIMITS.perMessage) return 'Zpráva je příliš dlouhá.';
    total += m.content.length;
  }
  if (total > LIMITS.total) return 'Konverzace je příliš dlouhá, začni nový chat.';
  if (messages.at(-1).role !== 'user') return 'Poslední zpráva musí být od uživatele.';
  const att = body.attachments ?? [];
  if (!Array.isArray(att) || att.length > LIMITS.attachments) return 'Příliš mnoho příloh.';
  const accepts = findModel(model).mode === 'image' ? ['image'] : findModel(model).mode === 'video' ? ['image', 'video'] : [];
  let bytes = 0;
  for (const a of att) {
    if (!a || !accepts.includes(a.type) || typeof a.mime !== 'string' || !MIME[a.type].test(a.mime)) return 'Nepodporovaná příloha.';
    if (typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(a.data)) return 'Poškozená příloha.';
    bytes += a.data.length;
  }
  if (bytes > LIMITS.attachmentBytes) return 'Přílohy jsou moc velké (max. cca 4 MB).';
  return null;
}

/** Rozparsuje Server-Sent Events z odpovědi poskytovatele. */
async function* sse(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* neúplný nebo nečitelný řádek – přeskočit */
      }
    }
  }
}

async function upstreamError(res, provider) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || data?.message || '';
  } catch {
    /* tělo není JSON */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? 'Zkontroluj API klíč.'
      : res.status === 429
        ? 'Překročen limit požadavků, zkus to za chvíli.'
        : res.status === 404
          ? 'Model není pro tento klíč dostupný.'
          : '';
  return `${PROVIDERS[provider].label} vrátil chybu ${res.status}. ${hint} ${detail}`.trim();
}

// ---------- Poskytovatelé ----------

async function* gemini(model, messages, env, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(model) }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'gemini'));
  for await (const chunk of sse(res)) {
    if (chunk.error) throw new Error(chunk.error.message || 'Chyba Gemini.');
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text) yield { t: part.thought ? 'think' : 'delta', v: part.text };
    }
  }
}

async function* groq(model, messages, env, signal) {
  const body = {
    model: model.id,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt(model) }, ...messages],
  };
  if (model.reasoning === 'parsed') body.reasoning_format = 'parsed';
  if (model.reasoning === 'oss' && model.effort) body.reasoning_effort = model.effort;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'groq'));
  for await (const chunk of sse(res)) {
    if (chunk.error) throw new Error(chunk.error.message || 'Chyba Groq.');
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.reasoning) yield { t: 'think', v: delta.reasoning };
    if (delta?.content) yield { t: 'delta', v: delta.content };
  }
}

// Ukázkový režim pro lokální vývoj bez klíčů (ADRREX_DEMO=1).
async function* demo(model, messages) {
  if (model.mode === 'image') {
    yield { t: 'status', v: messages.at(-1).attachments.length ? 'Upravuji obrázek…' : 'Maluji obrázek…' };
    await new Promise((r) => setTimeout(r, 600));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#8b5cf6"/><stop offset=".6" stop-color="#22d3ee"/><stop offset="1" stop-color="#f5c26b"/></linearGradient></defs><rect width="768" height="512" fill="url(#g)"/><text x="384" y="270" font-size="44" text-anchor="middle" fill="#0b0b12" font-family="sans-serif">AdrrexAI demo</text></svg>`;
    yield { t: 'delta', v: 'Tady je ukázkový obrázek' };
    yield { t: 'image', mime: 'image/svg+xml', data: Buffer.from(svg).toString('base64') };
    return;
  }
  if (model.mode === 'video') {
    yield { t: 'status', v: 'Natáčím video… může to trvat i minutu' };
    await new Promise((r) => setTimeout(r, 900));
    throw new Error('Ukázkový režim video negeneruje – potřebuje Gemini klíč s placeným tarifem.');
  }
  if (model.mode === 'agent') {
    yield { t: 'status', v: 'Hledám na webu…' };
    await new Promise((r) => setTimeout(r, 700));
  }
  const text = `Ahoj! Tohle je **ukázkový režim** modelu *${model.label}*.\n\nNapsal jsi: „${messages.at(-1).content.slice(0, 200)}“\n\n\`\`\`js\nconst adrrex = 'premium';\nconsole.log(\`AdrrexAI je \${adrrex}\`);\n\`\`\`\n\n| Skupina | Účel |\n|---|---|\n| Low | rychlé dotazy |\n| MasterCode | kód |\n`;
  yield { t: 'think', v: 'Analyzuji dotaz a připravuji odpověď…' };
  for (const piece of text.match(/.{1,6}/gs)) {
    await new Promise((r) => setTimeout(r, 12));
    yield { t: 'delta', v: piece };
  }
}

const RUNNERS = { gemini, groq };

// ---------- Kreativní režimy ----------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const geminiContents = (messages, withMedia = false) =>
  messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(withMedia ? (m.attachments ?? []).map((a) => ({ inlineData: { mimeType: a.mime, data: a.data } })) : []),
      { text: m.content },
    ],
  }));

async function* agentGroq(model, messages, env, signal) {
  yield { t: 'status', v: 'Hledám na webu…' };
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: model.apiModel,
      messages: [{ role: 'system', content: systemPrompt(model) }, ...messages],
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      reasoning_effort: 'low',
    }),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'groq'));
  const msg = (await res.json()).choices?.[0]?.message ?? {};
  if (msg.reasoning) yield { t: 'think', v: msg.reasoning };
  // Odstranění interních značek citací typu 【2†L6-L10】
  const text = (msg.content ?? '').replace(/【[^】]*】/g, '');
  if (text) yield { t: 'delta', v: text };
}

async function* agentGemini(model, messages, env, signal) {
  yield { t: 'status', v: 'Hledám na Googlu…' };
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model.apiModel)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(model) }] },
      contents: geminiContents(messages),
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'gemini'));
  const sources = new Map();
  for await (const chunk of sse(res)) {
    if (chunk.error) throw new Error(chunk.error.message || 'Chyba Gemini.');
    const cand = chunk.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) if (part.text && !part.thought) yield { t: 'delta', v: part.text };
    for (const c of cand?.groundingMetadata?.groundingChunks ?? []) if (c.web?.uri) sources.set(c.web.uri, c.web.title || c.web.uri);
  }
  if (sources.size) {
    const list = [...sources].slice(0, 8).map(([uri, title], i) => `${i + 1}. [${title.replace(/[[\]]/g, '')}](${uri})`).join('\n');
    yield { t: 'delta', v: `\n\n**Zdroje:**\n${list}` };
  }
}

async function* imageGemini(model, messages, env, signal) {
  yield { t: 'status', v: 'Maluji obrázek…' };
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model.apiModel)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: geminiContents(messages, true), generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'gemini'));
  const data = await res.json();
  let images = 0;
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.thought) continue;
    if (part.inlineData?.data) { images++; yield { t: 'image', mime: part.inlineData.mimeType || 'image/png', data: part.inlineData.data }; }
    else if (part.text) yield { t: 'delta', v: part.text };
  }
  if (!images) throw new Error('Model nevrátil žádný obrázek. Zkus popis upravit.');
}

const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function* videoGemini(model, messages, env, signal) {
  yield { t: 'status', v: 'Natáčím video… může to trvat i minutu' };
  const last = messages.at(-1);
  const input = last.attachments.length
    ? [...last.attachments.map((a) => ({ type: a.type, mime_type: a.mime, data: a.data })), { type: 'text', text: last.content }]
    : last.content;
  const res = await fetch(`${GEMINI_BASE}/interactions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      model: model.apiModel,
      input,
      response_format: { type: 'video', aspect_ratio: '16:9', resolution: '720p', delivery: 'uri' },
      store: false,
    }),
  });
  if (!res.ok) throw new Error(await upstreamError(res, 'gemini'));
  const data = await res.json();
  const video = (data.steps ?? []).flatMap((s) => (s.type === 'model_output' ? s.content ?? [] : [])).find((c) => c.type === 'video');
  if (!video) throw new Error('Model nevrátil žádné video. Zkus popis upravit.');
  if (video.data) return void (yield { t: 'video', mime: video.mime_type || 'video/mp4', data: video.data });
  const id = video.uri?.match(/\/files\/([^/:?]+)/)?.[1];
  if (!id || !FILE_ID.test(id)) throw new Error('Neplatná odpověď s videem.');
  for (let i = 0; i < 30; i++) {
    const st = await fetch(`${GEMINI_BASE}/files/${id}`, { signal, headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    const state = st.ok ? (await st.json()).state : 'FAILED';
    if (state === 'ACTIVE') return void (yield { t: 'video', url: `/api/file?id=${id}` });
    if (state === 'FAILED') throw new Error('Zpracování videa selhalo.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Video se nestihlo zpracovat, zkus to znovu.');
}

const MODE_RUNNERS = {
  'agent:groq': agentGroq,
  'agent:gemini': agentGemini,
  'image:gemini': imageGemini,
  'video:gemini': videoGemini,
};

/** Bezpečný proxy download vygenerovaného videa (klíč zůstává na serveru). */
export async function fileResponse(request, env) {
  if (authEnabled(env) && !(await verifyUser(request, env))) return json(401, { error: 'Přihlas se prosím.' });
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!FILE_ID.test(id)) return json(400, { error: 'Neplatné ID souboru.' });
  if (!env.GEMINI_API_KEY) return json(503, { error: 'Gemini není nastaven.' });
  const res = await fetch(`${GEMINI_BASE}/files/${id}:download?alt=media`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  if (!res.ok) return json(res.status, { error: 'Soubor není dostupný.' });
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') || 'video/mp4', 'cache-control': 'private, max-age=3600' },
  });
}

export async function chatResponse(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Použij POST.' });
  if (authEnabled(env) && !(await verifyUser(request, env))) return json(401, { error: 'Přihlas se prosím.' });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Neplatný JSON.' });
  }
  const problem = validate(body);
  if (problem) return json(400, { error: problem });

  const model = findModel(body.model);
  const isDemo = env.ADRREX_DEMO === '1';
  if (!isDemo && !hasKey(model.provider, env)) {
    return json(503, { error: `Poskytovatel ${PROVIDERS[model.provider].label} není nastaven (chybí ${PROVIDERS[model.provider].env}).` });
  }

  const messages = body.messages.map(({ role, content }) => ({ role, content }));
  messages.at(-1).attachments = (body.attachments ?? []).map(({ type, mime, data }) => ({ type, mime, data }));
  const run = isDemo ? demo : model.mode ? MODE_RUNNERS[`${model.mode}:${model.provider}`] : RUNNERS[model.provider];
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  request.signal?.addEventListener('abort', () => upstream.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      // Udržovací signál – generování videa může trvat desítky sekund.
      const ping = setInterval(() => { try { send({ t: 'ping' }); } catch { /* zavřeno */ } }, 8000);
      try {
        for await (const ev of run(model, messages, env, upstream.signal)) send(ev);
        send({ t: 'done' });
      } catch (err) {
        if (!upstream.signal.aborted) send({ t: 'error', v: err?.message || 'Neznámá chyba.' });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* klient se odpojil */
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
