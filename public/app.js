// AdrrexAI – klientská aplikace. Žádné API klíče: vše jde přes /api/*.
const $ = (s) => document.querySelector(s);
const els = {
  chat: $('#chat'), messages: $('#messages'), hero: $('#hero'), history: $('#history'), crumb: $('#crumbText'),
  form: $('#composer'), input: $('#input'), send: $('#sendBtn'), newChat: $('#newChat'),
  modes: $('#modes'), modesInk: $('#modesInk'), tiers: $('#tiers'), tiersPill: $('#tiersPill'), studioNote: $('#studioNote'),
  modelBtn: $('#modelBtn'), modelLabel: $('#modelLabel'), modelPop: $('#modelPop'),
  attachBtn: $('#attachBtn'), fileInput: $('#fileInput'), attachments: $('#attachments'), dropzone: $('#dropzone'),
  menuBtn: $('#menuBtn'), scrim: $('#scrim'), toast: $('#toast'),
  auth: $('#auth'), googleBtn: $('#googleBtn'), userName: $('#userName'), userMail: $('#userMail'), userAvatar: $('#userAvatar'), logoutBtn: $('#logoutBtn'),
};

const ICON = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>',
};

// ---------- Úložiště (může být zablokované) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plné / zablokované */ } },
};
const KEYS = { chats: 'adrrex.chats.v2', prefs: 'adrrex.prefs.v2' };
const prefs = Object.assign({ mode: 'chat', tier: 'fast', pick: {} }, store.get(KEYS.prefs, {}));
const savePrefs = () => store.set(KEYS.prefs, prefs);

const state = {
  catalog: null,
  chats: store.get(KEYS.chats, []),
  currentId: null,
  busy: false,
  controller: null,
  pending: [], // přílohy k odeslání
};

const LIMIT_VIDEO = 3_800_000; // bajtů (po base64 ~5 MB – limit serverless funkce)
const PLACEHOLDER = {
  chat: 'Zeptej se na cokoliv…',
  agent: 'Na co se mám podívat na webu?',
  image: 'Popiš obrázek – nebo nahraj fotku a napiš, jak ji upravit…',
  video: 'Popiš video – nebo nahraj fotku či krátké video k úpravě…',
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const currentChat = () => state.chats.find((c) => c.id === state.currentId) ?? null;
const strip = (list) => list?.map((x) => (x.url ? { type: x.type, url: x.url } : { type: x.type, lost: true }));
const slim = (c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, media: strip(m.media), attachments: strip(m.attachments) })) });

// ---------- Přihlášení a cloud (Supabase) ----------
const cloud = { sb: null, user: null, timer: 0, dirty: new Set() };

async function authHeaders() {
  if (!cloud.sb) return {};
  const { data } = await cloud.sb.auth.getSession();
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

function renderUser() {
  const u = cloud.user;
  const meta = u?.user_metadata ?? {};
  els.userName.textContent = u ? meta.full_name || meta.name || 'Uživatel' : 'Host';
  els.userMail.textContent = u ? u.email ?? '' : cloud.sb ? 'Nepřihlášen' : 'Chaty se ukládají v prohlížeči';
  els.logoutBtn.hidden = !u;
  const pic = meta.avatar_url || meta.picture;
  els.userAvatar.textContent = pic ? '' : (els.userName.textContent[0] || 'A').toUpperCase();
  els.userAvatar.style.backgroundImage = pic && /^https:\/\//.test(pic) ? `url("${pic.replace(/"/g, '')}")` : '';
  els.auth.hidden = !cloud.sb || Boolean(u);
}

async function loadCloudChats() {
  const { data, error } = await cloud.sb.from('chats').select('id,title,messages,created_at').order('updated_at', { ascending: false }).limit(100);
  if (error) return toast('Chaty se nepodařilo načíst z cloudu.');
  state.chats = data.map((r) => ({ id: r.id, title: r.title, messages: r.messages ?? [], created: Date.parse(r.created_at) }));
  state.currentId = null;
  renderHistory();
  renderMessages();
}

function queueCloudSave(id) {
  if (!cloud.user) return;
  cloud.dirty.add(id);
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(flushCloud, 900);
}

async function flushCloud() {
  const ids = [...cloud.dirty];
  cloud.dirty.clear();
  const rows = state.chats.filter((c) => ids.includes(c.id)).map((c) => {
    const x = slim(c);
    return { id: x.id, title: x.title, messages: x.messages, updated_at: new Date().toISOString() };
  });
  if (!rows.length) return;
  const { error } = await cloud.sb.from('chats').upsert(rows);
  if (error) toast('Uložení do cloudu se nepovedlo.');
}

async function initAuth(config) {
  if (!config?.auth || !window.supabase) return renderUser();
  cloud.sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const { data } = await cloud.sb.auth.getSession();
  cloud.user = data.session?.user ?? null;
  renderUser();
  if (cloud.user) loadCloudChats();
  cloud.sb.auth.onAuthStateChange((event, session) => {
    const prev = cloud.user?.id;
    cloud.user = session?.user ?? null;
    renderUser();
    if (cloud.user && cloud.user.id !== prev) loadCloudChats();
    if (!cloud.user && prev) { state.chats = []; newChat(); }
  });
}

els.googleBtn.addEventListener('click', async () => {
  if (!cloud.sb) return;
  const { error } = await cloud.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
  if (error) toast('Přihlášení přes Google se nepovedlo.');
});
els.logoutBtn.addEventListener('click', async () => { await cloud.sb?.auth.signOut(); });

const saveChats = () => {
  if (cloud.user) { if (state.currentId) queueCloudSave(state.currentId); return; }
  store.set(KEYS.chats, state.chats.slice(0, 100).map(slim));
};

function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (els.toast.hidden = true), 3200);
}

// ---------- Markdown ----------
function renderMarkdown(src) {
  const tpl = document.createElement('template');
  tpl.innerHTML = window.DOMPurify.sanitize(window.marked.parse(src, { gfm: true }));
  tpl.content.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  tpl.content.querySelectorAll('pre > code').forEach((code) => {
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
    const hl = window.hljs;
    if (hl) code.innerHTML = lang && hl.getLanguage(lang) ? hl.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value : hl.highlightAuto(code.textContent).value;
    code.classList.add('hljs');
    const wrap = document.createElement('div');
    wrap.className = 'code';
    wrap.innerHTML = `<div class="code-head"><span></span><button type="button" data-copy-code>${ICON.copy}Kopírovat</button></div>`;
    wrap.querySelector('span').textContent = lang || 'kód';
    const pre = code.parentElement;
    pre.replaceWith(wrap);
    wrap.append(pre);
  });
  return tpl.content;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.innerHTML;
    btn.innerHTML = btn.hasAttribute('data-copy-code') ? `${ICON.ok}Zkopírováno` : ICON.ok;
    setTimeout(() => (btn.innerHTML = old), 1500);
  } catch { toast('Kopírování se nepovedlo.'); }
}

// ---------- Katalog a výběr ----------
const slot = () => (prefs.mode === 'chat' ? prefs.tier : prefs.mode);
const slotGroup = () => (state.catalog ? [...state.catalog.groups, ...state.catalog.modes].find((g) => g.id === slot()) : null);

function currentModel() {
  const g = slotGroup();
  if (!g) return null;
  const saved = g.models.find((m) => m.id === prefs.pick[g.id]);
  return (saved?.available ? saved : null) ?? g.models.find((m) => m.available) ?? g.models[0];
}

async function loadCatalog() {
  try {
    const res = await fetch('/api/models', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    state.catalog = await res.json();
  } catch {
    els.modelLabel.textContent = 'Offline';
    toast('Nepodařilo se načíst modely. Běží serverová část?');
    return;
  }
  await initAuth(state.catalog.config);
  els.tiers.insertAdjacentHTML('afterbegin', state.catalog.groups.map((g) => `<button type="button" role="radio" data-tier="${g.id}">${g.short}</button>`).join(''));
  applySelection();
}

function moveInk(active, ink) {
  if (!active) return;
  ink.style.left = `${active.offsetLeft}px`;
  ink.style.width = `${active.offsetWidth}px`;
}

function applySelection() {
  if (!state.catalog) return;
  const { mode, tier } = prefs;
  document.body.dataset.mode = mode;
  document.body.dataset.tier = tier;
  els.modes.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  els.tiers.querySelectorAll('[data-tier]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tier === tier)));
  els.tiers.hidden = mode !== 'chat';
  const g = slotGroup();
  els.studioNote.hidden = mode === 'chat';
  els.studioNote.textContent = g.tagline;
  els.modelLabel.textContent = currentModel().label;
  els.crumb.textContent = mode === 'chat' ? g.name : `AdrrexAI ${g.name}`;
  els.input.placeholder = PLACEHOLDER[mode];
  const accepts = g.accepts ?? [];
  els.attachBtn.hidden = accepts.length === 0;
  els.fileInput.accept = accepts.flatMap((t) => (t === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : ['video/mp4', 'video/webm', 'video/quicktime'])).join(',');
  state.pending = state.pending.filter((a) => accepts.includes(a.type));
  renderPending();
  requestAnimationFrame(() => {
    moveInk(els.modes.querySelector('[aria-selected="true"]'), els.modesInk);
    moveInk(els.tiers.querySelector('[aria-checked="true"]'), els.tiersPill);
  });
  renderModelPop();
  updateSendState();
}

function setMode(mode) { prefs.mode = mode; savePrefs(); applySelection(); }
function setTier(tier) { prefs.tier = tier; prefs.mode = 'chat'; savePrefs(); applySelection(); }

function renderModelPop() {
  const g = slotGroup();
  const cur = currentModel();
  els.modelPop.innerHTML = '<div class="pop-head"></div>';
  els.modelPop.firstChild.textContent = g.name;
  for (const m of g.models) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.role = 'option';
    b.dataset.model = m.id;
    b.disabled = !m.available;
    b.setAttribute('aria-selected', String(m.id === cur.id));
    b.innerHTML = `<span class="t"><strong></strong><small></small></span>${m.paid ? '<span class="tag paid">placené</span>' : ''}${m.preview ? '<span class="tag preview">preview</span>' : ''}<svg class="tick" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>`;
    b.querySelector('strong').textContent = m.label;
    b.querySelector('small').textContent = `${m.provider === 'gemini' ? 'Gemini' : 'Groq'} · ${m.note ?? ''}${m.available ? '' : ' · nedostupné'}`;
    els.modelPop.append(b);
  }
}

function togglePop(open = els.modelPop.hidden) {
  els.modelPop.hidden = !open;
  els.modelBtn.setAttribute('aria-expanded', String(open));
}

// ---------- Přílohy ----------
const readAsDataURL = (blob) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  return { type: 'image', mime: 'image/jpeg', data: (await readAsDataURL(blob)).split(',')[1] };
}

async function addFiles(files) {
  const accepts = slotGroup()?.accepts ?? [];
  for (const f of files) {
    const type = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : null;
    if (!type || !accepts.includes(type)) { toast(prefs.mode === 'image' ? 'Sem patří jen obrázky (PNG, JPG, WebP).' : 'Nahraj obrázek nebo video.'); continue; }
    if (state.pending.length >= 3) { toast('Maximálně 3 přílohy.'); break; }
    try {
      if (type === 'image') state.pending.push(await compressImage(f));
      else {
        if (f.size > LIMIT_VIDEO) { toast('Video může mít nejvýš 3,8 MB (krátký klip do 10 s).'); continue; }
        state.pending.push({ type, mime: f.type, data: (await readAsDataURL(f)).split(',')[1] });
      }
    } catch { toast('Soubor se nepodařilo načíst.'); }
  }
  renderPending();
  updateSendState();
}

function renderPending() {
  els.attachments.hidden = state.pending.length === 0;
  els.attachments.replaceChildren(...state.pending.map((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (a.editSrc ? ' edit-src' : '');
    const el = document.createElement(a.type === 'video' ? 'video' : 'img');
    el.src = `data:${a.mime};base64,${a.data}`;
    if (a.type === 'video') el.muted = true;
    chip.append(el);
    chip.insertAdjacentHTML('beforeend', `<button type="button" data-remove="${i}" aria-label="Odebrat přílohu">${ICON.x}</button>`);
    return chip;
  }));
}

// ---------- Historie ----------
function renderHistory() {
  if (!state.chats.length) { els.history.innerHTML = '<div class="history-empty">Zatím žádné konverzace</div>'; return; }
  els.history.replaceChildren(...state.chats.map((c) => {
    const b = document.createElement('div');
    b.className = 'hist-item' + (c.id === state.currentId ? ' active' : '');
    b.role = 'button';
    b.tabIndex = 0;
    b.dataset.chat = c.id;
    b.innerHTML = `<span class="hist-title"></span><button type="button" class="del" aria-label="Smazat konverzaci">${ICON.trash}</button>`;
    b.querySelector('.hist-title').textContent = c.title;
    return b;
  }));
}
function openChat(id) { state.currentId = id; renderHistory(); renderMessages(); document.body.classList.remove('nav-open'); }
function newChat() {
  if (state.busy) state.controller?.abort();
  state.currentId = null;
  state.pending = [];
  renderPending();
  renderHistory();
  renderMessages();
  els.input.focus();
  document.body.classList.remove('nav-open');
}
function deleteChat(id) {
  state.chats = state.chats.filter((c) => c.id !== id);
  if (cloud.user) cloud.sb.from('chats').delete().eq('id', id).then(({ error }) => error && toast('Smazání v cloudu se nepovedlo.'));
  saveChats();
  if (state.currentId === id) newChat(); else renderHistory();
}

// ---------- Zprávy ----------
const ACCENT = { low: '#cfd6df', fast: '#8fd3ff', pro: '#c7a6ff', mastercode: '#ffd36b', agent: '#7ee2b8', image: '#ff9ec7', video: '#ffb36b' };

function userNode(msg) {
  const el = document.createElement('div');
  el.className = 'msg user';
  const shown = (msg.attachments ?? []).filter((a) => !a.lost);
  if (shown.length) {
    const t = document.createElement('div');
    t.className = 'thumbs';
    for (const a of shown) {
      const m = document.createElement(a.type === 'video' ? 'video' : 'img');
      m.src = a.url ?? `data:${a.mime};base64,${a.data}`;
      t.append(m);
    }
    el.append(t);
  }
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = msg.content;
  el.append(b);
  return el;
}

function aiNode(msg) {
  const el = document.createElement('div');
  el.className = 'msg ai';
  el.style.setProperty('--msg-accent', ACCENT[msg.tier] ?? '#e2b86b');
  el.innerHTML = `<div class="meta"><span class="seal">✦</span><b></b><span class="model"></span></div>
    <details class="think" hidden><summary>Myšlenkový postup</summary><div class="think-text"></div></details>
    <div class="content"></div><div class="media-list"></div>
    <div class="actions">
      <button type="button" data-act="copy" aria-label="Kopírovat odpověď" title="Kopírovat">${ICON.copy}</button>
      <button type="button" data-act="retry" aria-label="Vygenerovat znovu" title="Vygenerovat znovu">${ICON.retry}</button>
    </div>`;
  el.querySelector('.meta b').textContent = msg.groupName || 'AdrrexAI';
  el.querySelector('.meta .model').textContent = msg.modelLabel || '';
  paintAi(el, msg, false);
  return el;
}

function paintAi(el, msg, streaming) {
  if (msg.think) {
    const d = el.querySelector('.think');
    d.hidden = false;
    d.querySelector('.think-text').textContent = msg.think;
  }
  const content = el.querySelector('.content');
  if (msg.error) {
    content.innerHTML = '<div class="error"></div>';
    content.firstChild.textContent = msg.error;
  } else if (!msg.content && streaming) {
    content.innerHTML = '<div class="status"><span class="orbit"></span><span class="shimmer"></span></div>';
    content.querySelector('.shimmer').textContent = msg.status || 'Přemýšlím…';
  } else {
    content.replaceChildren(renderMarkdown(msg.content));
  }
  content.classList.toggle('cursor', streaming && Boolean(msg.content));
  const list = el.querySelector('.media-list');
  const media = msg.media ?? [];
  if (list.childElementCount !== media.length) list.replaceChildren(...media.map(mediaNode));
}

function mediaNode(item, i) {
  const fig = document.createElement('figure');
  fig.className = 'media';
  if (item.lost) { fig.innerHTML = '<div class="media-lost">✦ Vygenerovaný soubor se do historie neukládá – stáhni si ho hned po vytvoření.</div>'; return fig; }
  const src = item.url ?? `data:${item.mime};base64,${item.data}`;
  const media = document.createElement(item.type === 'video' ? 'video' : 'img');
  if (item.url) {
    // Soubor ze serveru potřebuje přihlášení → stáhnout s tokenem a zobrazit jako blob.
    authHeaders().then((h) => fetch(item.url, { headers: h })).then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { const u = URL.createObjectURL(b); media.src = u; fig.querySelector('a').href = u; })
      .catch(() => { fig.innerHTML = '<div class="media-lost">Video už není dostupné.</div>'; });
  } else media.src = src;
  if (item.type === 'video') Object.assign(media, { controls: true, playsInline: true, loop: true });
  else media.alt = 'Vygenerovaný obrázek';
  const bar = document.createElement('div');
  bar.className = 'media-bar';
  if (item.type === 'image' && item.data) {
    bar.insertAdjacentHTML('beforeend', `<button type="button" data-edit="${i}">${ICON.edit}Upravit</button><button type="button" data-animate="${i}">${ICON.film}Rozpohybovat</button>`);
  }
  const a = document.createElement('a');
  a.href = src;
  const ext = item.type === 'video' ? 'mp4' : (item.mime?.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  a.download = `adrrexai-${Date.now()}.${ext}`;
  a.innerHTML = `${ICON.dl}Stáhnout`;
  bar.append(a);
  fig.append(media, bar);
  return fig;
}

function renderMessages() {
  const chat = currentChat();
  els.hero.hidden = Boolean(chat?.messages.length);
  els.messages.replaceChildren(...(chat?.messages ?? []).map((m) => (m.role === 'user' ? userNode(m) : aiNode(m))));
  if (chat?.messages.length) scrollDown(true); else els.chat.scrollTop = 0;
}

function scrollDown(force) {
  const c = els.chat;
  if (force || c.scrollHeight - c.scrollTop - c.clientHeight < 160) c.scrollTop = c.scrollHeight;
}

// ---------- Odesílání ----------
function setBusy(b) {
  state.busy = b;
  els.form.classList.toggle('busy', b);
  els.send.setAttribute('aria-label', b ? 'Zastavit' : 'Odeslat');
  updateSendState();
}
function updateSendState() {
  els.send.disabled = !state.busy && (!els.input.value.trim() || !currentModel()?.available);
}

async function submit(text) {
  const model = currentModel();
  if (!model?.available) return toast('Tento model teď není dostupný (chybí API klíč).');
  let chat = currentChat();
  if (!chat) {
    chat = { id: uid(), title: text.replace(/\s+/g, ' ').slice(0, 48), messages: [], created: Date.now() };
    state.chats.unshift(chat);
    state.currentId = chat.id;
    renderHistory();
  }
  const attachments = state.pending.map(({ type, mime, data }) => ({ type, mime, data }));
  state.pending = [];
  renderPending();
  const userMsg = { role: 'user', content: text, attachments };
  chat.messages.push(userMsg);
  saveChats();
  els.hero.hidden = true;
  els.messages.append(userNode(userMsg));
  await generate(chat, model, attachments);
}

async function generate(chat, model, attachments = []) {
  const g = slotGroup();
  const history = chat.messages
    .filter((m) => !m.error && (m.role === 'user' || m.content || m.media?.length))
    .map(({ role, content, media }) => ({ role, content: content || (media?.length ? `[Vygenerováno: ${media.map((x) => (x.type === 'video' ? 'video' : 'obrázek')).join(', ')}]` : '') }));
  const msg = { role: 'assistant', content: '', think: '', media: [], tier: g.id, groupName: prefs.mode === 'chat' ? g.name : `AdrrexAI ${g.name}`, modelLabel: model.label };
  chat.messages.push(msg);
  const node = aiNode(msg);
  paintAi(node, msg, true);
  els.messages.append(node);
  scrollDown(true);
  setBusy(true);
  state.controller = new AbortController();
  let frame = 0;
  const repaint = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paintAi(node, msg, true); scrollDown(); }); };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ model: model.id, messages: history, attachments }),
      signal: state.controller.signal,
    });
    if (res.status === 401) { renderUser(); els.auth.hidden = !cloud.sb; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Chyba serveru (${res.status}).`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.t === 'delta') msg.content += ev.v;
        else if (ev.t === 'think') msg.think += ev.v;
        else if (ev.t === 'status') msg.status = ev.v;
        else if (ev.t === 'image' || ev.t === 'video') msg.media.push({ type: ev.t, mime: ev.mime, data: ev.data, url: ev.url });
        else if (ev.t === 'error') throw new Error(ev.v);
      }
      repaint();
    }
    if (!msg.content && !msg.media.length) msg.error = 'Model nevrátil žádnou odpověď.';
  } catch (err) {
    const partial = msg.content || msg.media.length;
    if (err.name === 'AbortError') { if (!partial) msg.error = 'Generování zastaveno.'; }
    else if (partial) msg.content += `\n\n> ${err.message} (odpověď je neúplná)`;
    else msg.error = err.message || 'Spojení selhalo.';
  } finally {
    cancelAnimationFrame(frame);
    delete msg.status;
    paintAi(node, msg, false);
    state.controller = null;
    setBusy(false);
    saveChats();
    scrollDown();
  }
}

function regenerate() {
  const chat = currentChat();
  if (!chat || state.busy) return;
  while (chat.messages.length && chat.messages.at(-1).role === 'assistant') chat.messages.pop();
  const last = chat.messages.at(-1);
  if (!last) return;
  renderMessages();
  generate(chat, currentModel(), (last.attachments ?? []).filter((a) => a.data));
}

/** Použije vygenerovaný obrázek jako podklad pro další úpravu nebo pro video. */
function useAsSource(msgIndex, mediaIndex, mode) {
  const item = currentChat()?.messages[msgIndex]?.media?.[mediaIndex];
  if (!item?.data) return;
  setMode(mode);
  state.pending = [{ type: 'image', mime: item.mime, data: item.data, editSrc: true }];
  renderPending();
  els.input.focus();
  toast(mode === 'image' ? 'Napiš, jak má AI obrázek upravit ✦' : 'Popiš, jak se má obrázek rozpohybovat ✦');
}

// ---------- Události ----------
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 240)}px`;
  updateSendState();
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.busy) return state.controller?.abort();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  autoGrow();
  submit(text);
});
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!state.busy) els.form.requestSubmit(); }
});
els.input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length && slotGroup()?.accepts?.length) { e.preventDefault(); addFiles(files); }
});

els.modes.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && state.catalog) setMode(b.dataset.mode); });
els.tiers.addEventListener('click', (e) => { const b = e.target.closest('[data-tier]'); if (b) setTier(b.dataset.tier); });
els.modelBtn.addEventListener('click', () => state.catalog && togglePop());
els.modelPop.addEventListener('click', (e) => {
  const b = e.target.closest('[data-model]');
  if (!b || b.disabled) return;
  prefs.pick[slot()] = b.dataset.model;
  savePrefs();
  togglePop(false);
  applySelection();
});
document.addEventListener('click', (e) => { if (!els.modelPop.hidden && !e.target.closest('.model-menu')) togglePop(false); });

els.fileInput.addEventListener('change', () => { addFiles([...els.fileInput.files]); els.fileInput.value = ''; });
els.attachments.addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  state.pending.splice(Number(b.dataset.remove), 1);
  renderPending();
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (slotGroup()?.accepts?.length && e.dataTransfer?.types.includes('Files')) { dragDepth++; els.dropzone.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.dropzone.hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropzone.hidden = true;
  if (e.dataTransfer?.files.length && slotGroup()?.accepts?.length) addFiles([...e.dataTransfer.files]);
});

els.history.addEventListener('click', (e) => {
  const item = e.target.closest('[data-chat]');
  if (!item) return;
  if (e.target.closest('.del')) return deleteChat(item.dataset.chat);
  openChat(item.dataset.chat);
});
els.history.addEventListener('keydown', (e) => {
  const item = e.target.closest('[data-chat]');
  if (item && e.target === item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openChat(item.dataset.chat); }
});

els.messages.addEventListener('click', (e) => {
  const codeBtn = e.target.closest('[data-copy-code]');
  if (codeBtn) return copyText(codeBtn.closest('.code').querySelector('code').textContent, codeBtn);
  const idx = [...els.messages.children].indexOf(e.target.closest('.msg'));
  const ed = e.target.closest('[data-edit],[data-animate]');
  if (ed) return useAsSource(idx, Number(ed.dataset.edit ?? ed.dataset.animate), ed.dataset.edit !== undefined ? 'image' : 'video');
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'retry') return regenerate();
  const m = currentChat()?.messages[idx];
  if (m) copyText(m.content, act);
});

$('#ideas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prompt]');
  if (!b || state.busy || !state.catalog) return;
  if (b.dataset.group) setTier(b.dataset.group);
  if (b.dataset.mode) setMode(b.dataset.mode);
  if (!currentModel()?.available) return toast('Tento režim zatím není dostupný – chybí API klíč.');
  submit(b.dataset.prompt);
});

els.newChat.addEventListener('click', newChat);
els.menuBtn.addEventListener('click', () => document.body.classList.add('nav-open'));
els.scrim.addEventListener('click', () => document.body.classList.remove('nav-open'));
window.addEventListener('resize', () => applySelection());
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); }
  if (e.key === 'Escape') { togglePop(false); document.body.classList.remove('nav-open'); }
});

// ---------- Start ----------
renderHistory();
renderMessages();
updateSendState();
loadCatalog();
