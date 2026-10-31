# AdrrexAI

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/AdamL2014/adrrexai)

Klikni na tlačítko, přihlas se do Netlify a vlož Groq (nebo Gemini) klíč. Hotovo.

Prémiová AI platforma: 4 úrovně chatu + studio (Agent, Obrázky, Video) s modely **Google Gemini** a **Groq**.

| Úroveň | Modely |
|---|---|
| **Low** | Llama 3.1 8B Instant (Groq) · Gemini 3.5 Flash-Lite |
| **Fast** | Gemini 3.8 Flash · Llama 3.3 70B (Groq) · GPT-OSS 20B (Groq) |
| **Pro** | Gemini 3.1 Pro (preview) · GPT-OSS 120B (Groq) · Qwen 3.8 27B (Groq, preview) |
| **MasterCode** | Gemini 4 Argon · MiniMax M2.7 (Groq, preview) |

### 🎨 Kreativní režimy (tlačítka nad polem pro zprávu)
| Režim | Model | Free tier? |
|---|---|---|
| 🤖 **Agent** | GPT-OSS 120B + Browser Search (Groq) | podle limitů Groq |
| 🤖 **Agent** | Gemini 3.8 Flash + Google Search | ❌ jen placený tarif |
| 🎨 **Obrázky** | Gemini 3.1 Flash Image | ❌ jen placený tarif |
| 🎬 **Video** | Gemini Omni 1.1 Flash (~0,10 USD / s videa) | ❌ jen placený tarif |

✏️ **Editace:** nahraj fotku (📎, přetažením nebo Ctrl+V) a napiš úpravu. U vygenerovaného obrázku klikni na *Upravit* nebo *Rozpohybovat* (fotka → video). Video lze nahrát k úpravě do 3,8 MB.

Obrázky a videa se do historie neukládají (jsou velké), stáhni si je tlačítkem Stáhnout.

ID modelů byla ověřena v oficiální dokumentaci 31. 10. 2026. Seznam upravíš na jednom místě: `lib/models.mjs`.

## 🔐 Bezpečnost
API klíče **nikdy nejsou v kódu ani v prohlížeči**. Čte je jen serverová funkce z proměnných prostředí:

```
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

Stačí jen jeden klíč. Modely poskytovatele bez klíče se v nabídce zobrazí jako nedostupné.

> ⚠️ API účty u Google a Groq vyžadují dospělého (Gemini API: 18+). Klíče musí založit rodič nebo jiný dospělý.

## Přihlášení přes Google a ukládání chatů
Volitelné. Když nastavíš `SUPABASE_URL` a `SUPABASE_ANON_KEY`, aplikace vyžaduje přihlášení přes Google a chaty ukládá do Supabase (tabulka ze `supabase/schema.sql`). Bez nich běží bez přihlášení a chaty jsou jen v prohlížeči. Postup krok za krokem je v návodu „AdrrexAI – návod na zprovoznění“.

## 💻 Lokální spuštění (Node.js 20.11+)
```bash
cp .env.example .env      # doplň klíče
npm run dev               # http://localhost:8888
npm run demo              # ukázkový režim bez klíčů
```

## 🚀 Nasazení na Netlify (později)
1. Nahraj složku do GitHub repozitáře a na Netlify zvol **Add new site → Import from Git**.
2. Build command nech prázdný, publish directory je `public` (je v `netlify.toml`).
3. V **Site configuration → Environment variables** přidej klíče výše.
4. Deploy. API běží na `/api/chat` a `/api/models` jako Netlify Functions.

> Pozor: drag & drop nasazení funkce nespustí, je potřeba Git nebo Netlify CLI.

## 📁 Struktura
```
public/            frontend (HTML, CSS, JS, knihovny ve vendor/)
lib/models.mjs     skupiny a modely
lib/chat.mjs       proxy na Gemini / Groq se streamováním
netlify/functions  Netlify Functions (/api/chat, /api/models, /api/file)
lib/auth.mjs       ověření přihlášení (Supabase)
supabase/schema.sql tabulka chatů + bezpečnostní pravidla
server.mjs         lokální server bez závislostí
```
