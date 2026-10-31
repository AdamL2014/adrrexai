// Jediný zdroj pravdy pro modely AdrrexAI.
// ID modelů ověřena v oficiální dokumentaci (31. 10. 2026):
//   Gemini – https://ai.google.dev/gemini-api/docs/models
//   Groq   – https://console.groq.com/docs/models

export const PROVIDERS = {
  gemini: { label: 'Gemini', env: 'GEMINI_API_KEY' },
  groq: { label: 'Groq', env: 'GROQ_API_KEY' },
};

/** Chatové úrovně. První model ve skupině je doporučený (výchozí). */
export const GROUPS = [
  {
    id: 'low',
    name: 'AdrrexAI-Low',
    short: 'Low',
    tagline: 'Bleskové odpovědi na běžné otázky',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', provider: 'groq', note: 'nejrychlejší' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'gemini', note: 'úsporný' },
    ],
  },
  {
    id: 'fast',
    name: 'AdrrexAI-Fast',
    short: 'Fast',
    tagline: 'Rychlost a kvalita v rovnováze',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', note: 'všestranný' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'groq', note: 'svižný' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', provider: 'groq', reasoning: 'oss', effort: 'low', note: 'přemýšlí' },
    ],
  },
  {
    id: 'pro',
    name: 'AdrrexAI-Pro',
    short: 'Pro',
    tagline: 'Hluboké uvažování pro náročné úlohy',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'gemini', preview: true, note: 'nejchytřejší' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq', reasoning: 'oss', effort: 'medium', note: 'logika' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', provider: 'groq', reasoning: 'parsed', preview: true, note: 'analytik' },
    ],
  },
  {
    id: 'mastercode',
    name: 'AdrrexAI-MasterCode',
    short: 'MasterCode',
    tagline: 'Špičkové modely pro programování',
    models: [
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', provider: 'gemini', note: 'vlajková loď' },
      { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7', provider: 'groq', reasoning: 'parsed', preview: true, note: 'kódér' },
    ],
  },
];

// Studio: Agent, Obrázky, Video. Obrázky, video i Google Search jsou u Gemini jen v placeném tarifu.
export const MODES = [
  {
    id: 'agent',
    name: 'Agent',
    tagline: 'Hledá na webu a odpovídá s aktuálními zdroji',
    models: [
      { id: 'agent:groq-gpt-oss-120b', apiModel: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B · Web', provider: 'groq', note: 'browser search' },
      { id: 'agent:gemini-3.8-flash', apiModel: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash · Google', provider: 'gemini', paid: true, note: 'google search' },
    ],
  },
  {
    id: 'image',
    name: 'Obrázky',
    tagline: 'Vytvoř nebo uprav obrázek – nahraj fotku a popiš úpravu',
    accepts: ['image'],
    models: [{ id: 'image:gemini-3.1-flash-image', apiModel: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', provider: 'gemini', paid: true, note: 'tvorba i editace' }],
  },
  {
    id: 'video',
    name: 'Video',
    tagline: 'Video z textu, z fotky nebo úprava krátkého videa',
    accepts: ['image', 'video'],
    models: [{ id: 'video:gemini-omni-1.1-flash', apiModel: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash', provider: 'gemini', paid: true, note: 'text · foto · edit' }],
  },
];

const INDEX = new Map([
  ...GROUPS.flatMap((g) => g.models.map((m) => [m.id, { ...m, group: g.id, groupName: g.name }])),
  ...MODES.flatMap((g) => g.models.map((m) => [m.id, { ...m, mode: g.id, group: g.id, groupName: `AdrrexAI ${g.name}` }])),
]);

export const findModel = (id) => INDEX.get(id) ?? null;

export const hasKey = (provider, env) => Boolean(env[PROVIDERS[provider]?.env]);

const pub = (env) => ({ id, label, provider, preview, paid, note }) => ({
  id, label, provider, note, preview: Boolean(preview), paid: Boolean(paid), available: hasKey(provider, env),
});

/** Veřejný katalog pro frontend – bez interních parametrů. */
export function publicCatalog(env) {
  return {
    groups: GROUPS.map((g) => ({ id: g.id, name: g.name, short: g.short, tagline: g.tagline, models: g.models.map(pub(env)) })),
    modes: MODES.map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, accepts: m.accepts ?? [], models: m.models.map(pub(env)) })),
  };
}
