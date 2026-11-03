'use strict';
/* ============================================================
   CENTRO DE COMANDO — painel principal (roda na aba app.html)
   Seções: util · redes/abas · estado · produtos · IA · tasks · views · ações
   ============================================================ */

/* ---------- util ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const brl = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) { if (comma > dot) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
  else if (comma >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) {
    const parts = s.split('.');
    if (parts.slice(1).every(part => /^\d{3}$/.test(part))) s = parts.join('');
    else { const dec = parts.pop(); s = parts.join('') + '.' + dec; }
  } else if (dot >= 0 && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
let toastT;
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3500); };

/* ---------- redes / abas ---------- */
const NETS = {
  whatsapp: { name: 'WhatsApp', host: 'web.whatsapp.com', url: 'https://web.whatsapp.com/', files: ['common.js', 'whatsapp.js'], kind: 'msg' },
  telegram: { name: 'Telegram', host: 'web.telegram.org', url: 'https://web.telegram.org/k/', files: ['common.js', 'telegram.js'], kind: 'msg' },
  instagram: { name: 'Instagram', host: 'www.instagram.com', url: 'https://www.instagram.com/', files: ['common.js', 'social.js'], kind: 'post' },
  facebook: { name: 'Facebook', host: 'www.facebook.com', url: 'https://www.facebook.com/', files: ['common.js', 'social.js'], kind: 'post' },
  tiktok: { name: 'TikTok', host: 'www.tiktok.com', url: 'https://www.tiktok.com/tiktokstudio/upload', files: ['common.js', 'social.js'], kind: 'post', navigate: true },
  youtube: { name: 'YouTube', host: 'studio.youtube.com', url: 'https://studio.youtube.com/channel/UC/videos/upload', files: ['common.js', 'social.js'], kind: 'post' },
};
const POST_NETS = Object.keys(NETS).filter((k) => NETS[k].kind === 'post');
const MSG_NETS = Object.keys(NETS).filter((k) => NETS[k].kind === 'msg');
let winId;
let notificationCounts = {};
let notificationCountsUpdatedAt = 0;

const waitLoad = (id) => new Promise((res) => {
  const f = (tid, info) => { if (tid === id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); res(); } };
  chrome.tabs.onUpdated.addListener(f);
  setTimeout(() => { chrome.tabs.onUpdated.removeListener(f); res(); }, 30000);
});

async function getNetTab(net, { open = true, navigate = false, mediaType = 'video', destination = 'feed' } = {}) {
  const n = NETS[net];
  // TikTok Studio tem rotas diferentes para publicação de vídeo e de foto.
  const targetUrl = net === 'tiktok'
    ? `https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=${mediaType === 'photo' ? 'photo' : 'video'}`
    : net === 'facebook' && destination === 'marketplace'
      ? 'https://www.facebook.com/marketplace/?ref=bookmark'
    : n.url;
  const tabs = (await chrome.tabs.query(net === 'whatsapp' ? {} : { windowId: winId })).filter((t) => {
    if (!t.url || new URL(t.url).hostname !== n.host) return false;
    if (net !== 'facebook') return true;
    const isMarketplace = new URL(t.url).pathname.startsWith('/marketplace');
    return destination === 'marketplace' ? isMarketplace : !isMarketplace;
  });
  let t = tabs[0];
  if (!t && open) {
    t = await chrome.tabs.create({ windowId: winId, url: targetUrl, active: false });
    await waitLoad(t.id);
    await sleep(1500);
  } else if (t && navigate && (n.navigate || destination === 'marketplace') && t.url !== targetUrl) {
    await chrome.tabs.update(t.id, { url: targetUrl });
    await waitLoad(t.id);
    await sleep(1500);
  }
  return t;
}

async function sendToTab(tabId, net, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: NETS[net].files });
    await sleep(400);
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function callNet(net, msg) {
  const t = await getNetTab(net, { open: false });
  if (!t) throw new Error(`Abra o ${NETS[net].name} nesta mesma janela do Chrome.`);
  return sendToTab(t.id, net, msg);
}


async function refreshNotificationCounts(silent = true) {
  // A fonte preferida é o contador que a própria rede coloca no título da aba:
  // "(3) Facebook", "(41) TikTok" etc. Não somar ícones distintos do DOM, pois isso
  // contava a mesma notificação mais de uma vez.
  const targets = ['instagram', 'facebook', 'tiktok', 'youtube'];
  const next = {};
  for (const net of targets) {
    try {
      const tab = await getNetTab(net, { open: false });
      if (!tab) { next[net] = null; continue; }
      const title = String(tab.title || '').trim();
      const match = title.match(/^\s*\((\d{1,5})\+?\)\s*/);
      next[net] = match ? Number(match[1]) : 0;
    } catch {
      next[net] = notificationCounts[net] ?? null;
    }
  }
  notificationCounts = next;
  notificationCountsUpdatedAt = Date.now();
  if (route !== 'login') {
    for (const net of targets) {
      const value = notificationCounts[net];
      const counter = document.querySelector(`[data-notification-count="${net}"]`);
      if (counter) counter.textContent = value == null ? '—' : value > 0 ? String(value) : '0';
    }
    const updated = document.querySelector('[data-notification-count-updated]');
    if (updated) updated.textContent = 'Atualizado ' + new Date(notificationCountsUpdatedAt).toLocaleTimeString('pt-BR');
  }
  if (!silent) {
    toast('Contadores atualizados pelos títulos das abas das redes.');
  }
}

async function sendFile(tabId, net, file) {
  const id = uid();
  const buf = new Uint8Array(await file.arrayBuffer());
  const CH = 3 * 1024 * 1024;
  const total = Math.max(1, Math.ceil(buf.length / CH));
  for (let i = 0; i < total; i++) {
    const part = buf.subarray(i * CH, (i + 1) * CH);
    let bin = '';
    for (let j = 0; j < part.length; j += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
    await sendToTab(tabId, net, { type: 'FILE_CHUNK', id, idx: i, total, name: file.name, mime: file.type, data: btoa(bin) });
  }
  return id;
}


/* ---------- fotos de produtos no atendimento ---------- */
const photoMax = () => { const v = S.settings.botPhotosMax; return (v === undefined || v === '' || v === null) ? 3 : Math.max(0, Math.min(6, Number(v) || 0)); };
async function productMediaFilesFor(found, text, max, options = {}) {
  const t = String(text || ''), tl = t.toLowerCase();
  const picked = (found || []).filter((p) => (p.url && t.includes(p.url)) || (p.title && tl.includes(String(p.title).toLowerCase().slice(0, 25)))).slice(0, max);
  const mediaUrls = (p) => {
    const data = p.product_data && typeof p.product_data === 'object' ? p.product_data : p;
    const values = (value) => Array.isArray(value) ? value : value ? [value] : [];
    const urls = (value) => values(value).map(item => typeof item === 'string' ? item : item?.url || item?.src || item?.link || '').filter(value => /^https?:\/\//i.test(value));
    const images = options.primaryImageOnly
      ? [...urls(p.image)]
      : [...urls(data.images), ...urls(data.imageUrls), ...urls(data.photos), ...urls(data.image), ...urls(p.image)];
    const videos = [...urls(data.videos), ...urls(data.videoUrls), ...urls(data.video), ...urls(data.media)].filter(url => /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url) || /video/i.test(url));
    return { image: [...new Set(images)][0] || '', video: [...new Set(videos)][0] || '' };
  };
  const files = [];
  for (const p of picked) {
    const media = mediaUrls(p);
    for (const [url, type] of [[media.image, 'image'], [media.video, 'video']]) {
      if (!url) continue;
      try {
        const r = await fetch(url, { referrerPolicy: 'no-referrer' });
        if (!r.ok) continue;
        const blob = await r.blob();
        if (type === 'video') {
          if (!blob.type.startsWith('video/') || blob.size > 50 * 1024 * 1024) continue;
          files.push({ file: new File([blob], `produto-${files.length + 1}.mp4`, { type: blob.type }), type });
          continue;
        }
        if (!blob.type.startsWith('image/') || blob.size > 8 * 1024 * 1024) continue;
        const bmp = await createImageBitmap(blob);
        const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
        const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
        if (out) files.push({ file: new File([out], `produto-${files.length + 1}.jpg`, { type: 'image/jpeg' }), type });
      } catch (e) { console.warn('mídia não baixada', url, e); }
    }
  }
  return files;
}
const photoFilesFor = async (found, text, max) => (await productMediaFilesFor(found, text, max)).filter(item => item.type === 'image').map(item => item.file);

// O WhatsApp só desenha a tela de pré-visualização da foto com a aba visível. Se a aba está oculta (mesma janela do
// Centro de Comando), ela é trazida para frente só durante o envio das fotos e a aba anterior volta depois.
// Se o WhatsApp estiver em janela própria, a aba já é a ativa e nada pisca.
async function withTabVisible(net, fn) {
  const t = await getNetTab(net, { open: false });
  let prev = null;
  if (t && !t.active && S.settings.photoTabSwitch !== false) {
    try {
      [prev] = await chrome.tabs.query({ windowId: t.windowId, active: true });
      await chrome.tabs.update(t.id, { active: true });
      await sleep(700);
    } catch (_) { prev = null; }
  }
  try { return await fn(); }
  finally { if (prev && prev.id !== t.id) { try { await chrome.tabs.update(prev.id, { active: true }); } catch (_) {} } }
}
async function sendPhotos(net, expectedChat, files, caption = '') {
  const t = await getNetTab(net, { open: false });
  if (!t) throw new Error(`Abra o ${NETS[net].name}.`);
  const ids = [];
  for (const f of files) ids.push(await sendFile(t.id, net, f));
  return sendToTab(t.id, net, { type: 'CHAT_SEND_IMAGES', fileIds: ids, expectedChat, caption });
}

/* ---------- estado ---------- */
const DEFAULT_BACKEND_URL = 'https://ttytmrjqjkdqeksyoxts.supabase.co/functions/v1/vizzion-api';
const DEFAULT = () => ({
  users: [],
  settings: { backendUrl: DEFAULT_BACKEND_URL, backendToken: '', mcpUrl: 'http://127.0.0.1:8787', mcpToken: '', geminiKey: '', geminiModel: 'gemini-3.5-flash-lite', stagesPerDay: 2, autoMaxPerHour: 20, botPhotosMax: 3, photoTabSwitch: true },
  offerSendQueue: [],
  general: { stages: [], note: '', messages: [] },
  chat: { channels: [{ id: 'geral', name: 'Geral' }, { id: 'ia', name: 'IA · Migoo', type: 'ia' }], messages: [] },
  projects: [],
  tasks: [],
  postsLog: [],
  scheduledPosts: [],
  activityLog: [],
  lastGen: '',
  insights: null,
  updatedAt: 0,
});
let S, P = [], me = null, AUTH = null, ACTIVITY = [], route = 'hoje', routeChat = 'geral';
const proj = (id) => S.projects.find((p) => p.id === id);
const user = (id) => S.users.find((u) => u.id === id);
const stagesOf = (sc) => (sc === 'general' ? S.general.stages : proj(sc)?.stages || []);
const isMasterAdmin = () => me?.role === 'masteradmin';
const isAdmin = () => me?.role === 'admin' || isMasterAdmin();
const myProjects = () => (isMasterAdmin() ? S.projects : S.projects.filter((p) => p.memberIds?.includes(me.id)));

async function load() {
  const r = await chrome.storage.local.get(['cc_state', 'cc_products', 'cc_auth', 'cc_profile']);
  S = Object.assign(DEFAULT(), r.cc_state || {});
  S.settings = Object.assign(DEFAULT().settings, S.settings);
  S.general = Object.assign(DEFAULT().general, S.general);
  S.general.messages = Array.isArray(S.general.messages) ? S.general.messages : [];
  S.chat = Object.assign(DEFAULT().chat, S.chat || {});
  S.chat.channels = Array.isArray(S.chat.channels) ? S.chat.channels : DEFAULT().chat.channels;
  S.chat.messages = Array.isArray(S.chat.messages) ? S.chat.messages : [];
  const hadLegacyAiSettings = ['apiKey', 'apiUrl', 'provider', 'model'].some((key) => Object.prototype.hasOwnProperty.call(S.settings, key));
  delete S.settings.apiKey;
  delete S.settings.apiUrl;
  delete S.settings.provider;
  delete S.settings.model;
  if (hadLegacyAiSettings) await chrome.storage.local.set({ cc_state: S });
  S.offerSendQueue = Array.isArray(S.offerSendQueue) ? S.offerSendQueue : [];
  S.offerSendQueue.forEach(q => { if (q.status === 'enviando') { q.status = 'erro'; q.error = 'Painel fechado durante o envio; confira a conversa antes de retomar para evitar duplicação.'; } });
  S.settings.backendUrl = DEFAULT_BACKEND_URL;
  P = r.cc_products || [];
  AUTH = r.cc_auth || null;
  me = r.cc_profile || null;
  winId = (await chrome.windows.getCurrent()).id;
}
let saveT, pushT;
function save(push = true) {
  S.updatedAt = Date.now();
  clearTimeout(saveT);
  saveT = setTimeout(() => chrome.storage.local.set({ cc_state: S }), 150);
  if (push) { clearTimeout(pushT); pushT = setTimeout(pushRemote, 1500); }
}
let productPushT;
const saveProducts = async () => {
  await chrome.storage.local.set({ cc_products: P });
  if (S?.settings?.backendUrl) { clearTimeout(productPushT); productPushT = setTimeout(pushProductsRemote, 1800); }
};

function setBound(path, val) {
  const [root, ...r] = path.split('|');
  let o, key;
  if (root === 's') { o = S.settings; key = r[0]; }
  else if (root === 'g') { o = S.general; key = r[0]; }
  else if (root === 'p') { o = proj(r[0]); key = r[1]; }
  if (!o) return;
  const ks = key.split('.');
  const last = ks.pop();
  for (const k of ks) o = o[k] || (o[k] = {});
  o[last] = val;
  save();
}

/* ---------- backend Vizzion com Supabase Auth ---------- */
const base = () => String(S.settings.backendUrl || '').replace(/\/$/, '');
const authHeaders = () => ({ 'content-type': 'application/json', ...(AUTH?.access_token ? { authorization: 'Bearer ' + AUTH.access_token } : {}) });
async function refreshAuth() {
  if (!AUTH?.refresh_token || !base()) return false;
  try {
    const r = await fetch(base() + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: AUTH.refresh_token }) });
    const j = await r.json();
    if (!r.ok || !j.session?.access_token) return false;
    AUTH = j.session; me = j.profile || me;
    await chrome.storage.local.set({ cc_auth: AUTH, cc_profile: me });
    return true;
  } catch (e) { console.warn('auth refresh', e); return false; }
}
async function ensureAuth() {
  if (!AUTH?.access_token || !base()) return false;
  if (AUTH.expires_at && AUTH.expires_at * 1000 < Date.now() + 60000) {
    if (!await refreshAuth()) return false;
  }
  try {
    const r = await fetch(base() + '/auth/me', { headers: authHeaders() });
    if (!r.ok) return false;
    const j = await r.json(); me = j.profile; await chrome.storage.local.set({ cc_profile: me }); return !!me;
  } catch { return false; }
}
async function api(path, options = {}, retry = true) {
  if (!base()) throw new Error('Informe a URL do backend nas configurações de login.');
  if (AUTH?.expires_at && AUTH.expires_at * 1000 < Date.now() + 60000) await refreshAuth();
  const r = await fetch(base() + path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  if (r.status === 401 && retry && await refreshAuth()) return api(path, options, false);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Falha no servidor (${r.status})`);
  return j;
}
const shared = () => ({ general: S.general, projects: S.projects, tasks: S.tasks, postsLog: S.postsLog, lastGen: S.lastGen, updatedAt: S.updatedAt });
async function refreshTeam() {
  const j = await api('/team');
  S.users = Array.isArray(j.users) ? j.users : [];
  me = S.users.find(u => u.id === me?.id) || me;
  await chrome.storage.local.set({ cc_state: S, cc_profile: me });
}

async function pushRemote() {
  if (!AUTH?.access_token || !base()) return false;
  if (!S.projects.length && !S.tasks.length && !S.postsLog.length) {
    console.warn('push state blocked: local shared state is empty');
    return false;
  }
  try { await api('/state', { method: 'PUT', body: JSON.stringify(shared()) }); return true; }
  catch (e) { console.warn('push state', e); return false; }
}
async function pullRemote(force = false) {
  if (!AUTH?.access_token || !base()) return false;
  try {
    const remote = await api('/state');
    if (!remote || !Object.keys(remote).length) return false;
    if (!force && Number(remote.updatedAt || 0) < Number(S.updatedAt || 0)) return false;
    S.general = remote.general && typeof remote.general === 'object' ? remote.general : S.general;
    S.projects = Array.isArray(remote.projects) ? remote.projects : S.projects;
    S.tasks = Array.isArray(remote.tasks) ? remote.tasks : S.tasks;
    S.postsLog = Array.isArray(remote.postsLog) ? remote.postsLog : S.postsLog;
    S.lastGen = remote.lastGen || S.lastGen;
    S.updatedAt = Number(remote.updatedAt || S.updatedAt || 0);
    await chrome.storage.local.set({ cc_state: S });
    return true;
  } catch (e) { console.warn('pull state', e); return false; }
}
async function pushProductsRemote(projectId = '', sourceProducts = null) {
  if (!AUTH?.access_token || !base()) return false;
  try {
    const groups = projectId
      ? [[String(projectId), Array.isArray(sourceProducts) ? sourceProducts : P.filter(p => String(p.projectId || '') === String(projectId))]]
      : [...P.reduce((map, product) => {
        const id = String(product?.projectId || '');
        if (!id) return map;
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(product);
        return map;
      }, new Map())];
    if (!groups.length) return false;
    for (const [id, products] of groups) {
      if (!products.length) continue;
      for (let offset = 0; offset < products.length; offset += 500) {
        const batch = products.slice(offset, offset + 500);
        const final = offset + batch.length >= products.length;
        await api('/products/import', {
          method: 'POST',
          body: JSON.stringify({
            projectId: id,
            products: batch,
            finalize: final,
            productIds: final ? products.map(p => String(p.id)) : undefined,
          }),
        });
        toast(`Sincronizando catálogo: ${Math.min(offset + batch.length, products.length)} de ${products.length} produtos...`);
      }
    }
    return true;
  }
  catch (e) { console.warn('push products', e); return false; }
}
async function pullProductsRemote() {
  if (!AUTH?.access_token || !base()) return false;
  try {
    const j = await api('/products');
    if (Array.isArray(j.products)) {
      P = j.products; IDX.clear(); await chrome.storage.local.set({ cc_products: P }); return true;
    }
    return false;
  } catch (e) { console.warn('pull products', e); return false; }
}
async function audit(action, entity_type = 'general', entity_id = '', details = {}) {
  if (!AUTH?.access_token || !base()) return false;
  try { await api('/activity', { method: 'POST', body: JSON.stringify({ action, entity_type, entity_id, details }) }); return true; }
  catch (e) { console.warn('audit', e); return false; }
}
async function loadActivity() {
  try { const j = await api('/activity?limit=100'); ACTIVITY = Array.isArray(j.activity) ? j.activity : []; render(); }
  catch (e) { toast(e.message || 'Não foi possível carregar o histórico.'); }
}
/* ---------- produtos ---------- */
const ALIAS = {
  id: ['id', 'sku', 'mlb', 'itemid', 'product_id'], title: ['title', 'titulo', 'título', 'nome', 'name', 'product_name'], price: ['sale_price', 'current_price', 'preco_atual', 'preço_atual', 'preco', 'preço', 'valor', 'price'],
  oldPrice: ['oldprice', 'preco_antigo', 'preço_antigo', 'preco_original', 'original_price', 'de', 'price_before_discount', 'originalprice', 'preco_anterior'],
  url: ['url', 'link', 'link_afiliado', 'affiliate_url', 'afiliado', 'product_link', 'product_short link', 'product_short_link'], image: ['imagem url', 'image url', 'imagem_url', 'image_url', 'image', 'imagem', 'img', 'thumbnail', 'image_link', 'image_link_3'],
  category: ['category', 'categoria', 'global_category2', 'global_category3'], store: ['store', 'loja', 'marketplace', 'shop_name'], sales: ['sales', 'vendas', 'sold', 'vendidos', 'historical_sold'], rating: ['rating', 'nota', 'avaliacao', 'avaliação'],
};
function normProduct(r) {
  const low = {};
  for (const k in r) low[k.toLowerCase()] = r[k];
  const o = {};
  for (const f in ALIAS) for (const a of ALIAS[f]) if (low[a] != null && low[a] !== '') { o[f] = low[a]; break; }
  if (low.sale_price != null && low.sale_price !== '') { if ((o.oldPrice == null || o.oldPrice === '') && low.price != null && String(low.price) !== String(low.sale_price)) o.oldPrice = low.price; o.price = low.sale_price; }
  o.price = num(o.price); o.oldPrice = num(o.oldPrice); o.sales = num(o.sales) || 0; o.rating = num(o.rating) || 0; if (o.image != null) o.image = String(o.image).trim(); if (o.url != null) o.url = String(o.url).trim();
  o.id = String(o.id || uid());
  return o.title ? o : null;
}
function parseCSV(t) {
  const first = t.split('\n')[0];
  const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { r.push(c); c = ''; }
    else if (ch === '\n') { r.push(c); rows.push(r); r = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  const [h, ...b] = rows;
  return b.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k.trim(), x[i]])));
}
const IDX = new Map();
const hay = (p) => IDX.get(p) || (IDX.set(p, strip(p.title + ' ' + (p.category || ''))), IDX.get(p));
function localSearch(q, limit = 6) {
  const toks = strip(q).split(/\W+/).filter((t) => t.length > 2);
  if (!toks.length) return [];
  return P.map((p) => {
    const h = hay(p); let s = 0;
    for (const t of toks) if (h.includes(t)) s += 1;
    return { p, s: s ? s + Math.log10(1 + p.sales) * 0.2 + (p.rating || 0) * 0.05 : 0 };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}
async function search(q, limit = 6, projectId = '', options = {}) {
  if (S.settings.backendUrl) {
    try {
      const j = await api('/search', { method: 'POST', body: JSON.stringify({ query: q, limit, projectId, category: options.category || '', titleOnly: options.titleOnly === true, excludeTerms: options.excludeTerms || [] }) });
      return (j.products || []).map(normProduct).filter(Boolean);
    } catch (e) { console.warn('search backend', e); }
  }
  return localSearch(q, limit).filter((p) => (!projectId || String(p.projectId || '') === String(projectId)) &&
    (!options.category || strip(p.category) === strip(options.category)) &&
    (!options.titleOnly || strip(p.title).includes(strip(q))));
}
const pct = (p) => (p.oldPrice && p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);
function offers(n = 5) {
  return P.filter((p) => p.price).map((p) => ({ p, s: Math.max(0, pct(p)) + Math.log10(1 + p.sales) * 8 + (p.rating || 0) * 2 }))
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.p);
}
const offerBlock = (p) => `🔥 ${p.title}\n💰 ${p.oldPrice ? `de ${brl(p.oldPrice)} ` : ''}por ${brl(p.price)}${pct(p) > 0 ? ` (${pct(p)}% OFF)` : ''}\n👉 ${p.url || ''}`;

/* ---------- IA ---------- */
async function ai(system, user, max = 900, projectId = '') {
  const id = projectId || myProjects()[0]?.id;
  if (!id) throw new Error('Selecione um projeto autorizado para usar a IA.');
  const result = await api(`/projects/${encodeURIComponent(id)}/ai/generate`, {
    method: 'POST',
    body: JSON.stringify({ system, user, max, model: proj(id)?.aiModel || '' }),
  });
  return String(result.text || '').trim();
}
const parseJSON = (t) => { const m = t.match(/[\[{][\s\S]*[\]}]/); return JSON.parse(m ? m[0] : t); };
const DEFAULT_SEARCHING = 'Já vou procurar isso pra você, um instante! 🔎 (Os preços podem mudar: vale o valor da página no momento da compra.)';
const productCaption = (p) => [p.title, p.category ? `Categoria: ${p.category}` : '', p.oldPrice && p.price ? `Preço atual: ${brl(p.price)}\nPreço anterior: ${brl(p.oldPrice)}` : `Preço: ${brl(p.price)}`, p.url].filter(Boolean).join('\n');
const DEFAULT_HANDOFF = 'Vou chamar um atendente humano para te ajudar. Só um instante! 🙌';

async function botReply({ project, history, customerMsg, onIntent }) {
  const greeting = /^(oi|ola|olá|bom dia|boa tarde|boa noite|hey|hello| tudo bem[\s!?]*)$/i.test(String(customerMsg || '').trim());
  if (greeting) {
    const bot = project?.bot || {};
    const text = await ai(
      `Você é o atendente inicial de ${bot.brand || 'uma loja de achadinhos'}. ${bot.persona || 'Seja simpático, direto e curto.'}
Responda naturalmente ao cumprimento, apresente-se e pergunte o que a pessoa procura.
Não ofereça atendimento humano, não use o marcador [HUMANO] e não invente produtos.`,
      `Conversa recente:\n${history || '(início da conversa)'}\n\nMensagem do cliente: ${customerMsg}`,
      240,
      project?.id,
    );
    return { text, human: false, found: [], mode: 'conversation' };
  }
  let terms = [customerMsg], budget = null, intent = 'outro', excludeTerms = [];
  let category = '', titleOnly = false;
  const categories = [...new Set(P.filter((p) => !project?.id || String(p.projectId || '') === String(project.id)).map((p) => String(p.category || '').trim()).filter(Boolean))].slice(0, 100);
  try {
    const plan = await ai(
      `Você interpreta pedidos de clientes para buscar produtos. Responda SOMENTE JSON:
{"termos":["..."],"orcamento":numero|null,"intencao":"produtos"|"kit"|"outro","categoria":"...","buscaPrincipal":true|false,"excluir":["..."]}.
Use intencao="produtos" para um item ou uma família de produto; "kit" para montar um conjunto; "outro" para dúvidas, conversa ou pedido de humano.
Para produto principal, buscaPrincipal=true e gere termos específicos de produto (ex.: "celular" -> "smartphone", "iphone", "samsung", quando fizer sentido).
Quando o cliente pedir um produto principal, não trate acessórios, peças, refis ou complementos como o produto pedido. Gere em "excluir" somente palavras que indiquem esses itens secundários para este pedido. Ex.: celular -> capa, cabo, carregador; sofá -> capa, almofada; impressora -> cartucho, toner. Se o cliente pedir explicitamente um acessório ou peça, deixe "excluir" vazio.
Escolha categoria somente desta lista exata, quando houver correspondência: ${JSON.stringify(categories)}.
Para pedidos amplos, liste de 3 a 8 itens/categorias. Para dúvidas sem produto, termos=[] e buscaPrincipal=false.`,
      'Mensagem: ' + customerMsg, 300, project?.id);
    const j = parseJSON(plan);
    terms = Array.isArray(j.termos) ? j.termos : [];
    budget = j.orcamento;
    intent = j.intencao || 'outro';
    category = categories.find((value) => strip(value) === strip(j.categoria || '')) || '';
    titleOnly = j.buscaPrincipal === true;
    excludeTerms = Array.isArray(j.excluir) ? j.excluir.map((term) => String(term).trim()).filter((term) => term.length > 1 && term.length < 50).slice(0, 12) : [];
  } catch (_) {}
  // Modo vitrine: limite configurável por projeto; cada item vira uma mensagem própria no atendimento.
  if (intent === 'produtos' && terms.length) {
    const configuredMax = Number(project?.bot?.productsPerRequest);
    const productsPerRequest = Math.max(1, Math.min(20, Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 5));
    let pool = [];
    for (const t of terms.slice(0, 3)) for (const p of await search(t, 6, project?.id, { category, titleOnly, excludeTerms })) if (!pool.find((f) => f.id === p.id)) pool.push(p);
    if (budget) { const ok = pool.filter((p) => p.price && p.price <= budget); if (ok.length) pool = ok; }
    pool = pool.slice(0, productsPerRequest);
    if (pool.length) {
      try { await onIntent?.('produtos'); } catch (_) {}
      return { text: pool.map(productCaption).join('\n\n'), human: false, found: pool, mode: 'vitrine' };
    }
  }
  const found = [];
  for (const t of terms.slice(0, 8)) for (const p of await search(t, 3, project?.id, { category, titleOnly, excludeTerms })) if (!found.find((f) => f.id === p.id)) found.push(p);
  const catalog = found.slice(0, 20).map((p) => ({ titulo: p.title, preco: p.price, loja: p.store, link: p.url }));
  const bot = project?.bot || {};
  const system = `Você é o assistente de atendimento de ${bot.brand || 'uma loja de achadinhos'} no WhatsApp/Telegram. ${bot.persona || 'Seja simpático, direto e curto.'}
REGRAS:
- Use APENAS os produtos do CATALOGO; nunca invente produto, preço, estoque ou prazo. Se nada servir, diga isso e ofereça atendimento humano.
- Preços mudam: avise que vale o valor da página no momento da compra.
- Somos afiliados: compra, pagamento, entrega e garantia são feitos direto no marketplace (Mercado Livre/Shopee) pelo link; nós não processamos pagamento.
- Pedidos amplos: monte um kit de 3 a 6 itens, some os preços aproximados e respeite o orçamento, se houver.
- Respostas curtas, próprias de chat, sem markdown pesado. Inclua o link de cada item sugerido.
- Se o cliente pedir um humano, reclamar de pedido/pagamento/reembolso ou o assunto fugir do escopo, responda em uma frase e termine com o marcador [HUMANO].`;
  const out = await ai(system,
    `CATALOGO:\n${JSON.stringify(catalog)}\n\nORCAMENTO: ${budget || 'não informado'}\n\nCONVERSA RECENTE:\n${history}\n\nÚLTIMA MENSAGEM DO CLIENTE: ${customerMsg}\n\nEscreva a resposta.`, 700, project?.id);
  return { text: out.replace(/\s*\[HUMANO\]\s*/g, ' ').trim(), human: /\[HUMANO\]/.test(out), found };
}
const histStr = (ms = []) => ms.slice(-8).map((m) => `${m.dir === 'in' ? 'Cliente' : 'Nós'}: ${m.text}`).join('\n');

/* ---------- tasks ---------- */
function pickStages(list = [], n) {
  const open = list.filter((s) => s.status !== 'done');
  return [...open.filter((s) => s.status === 'doing'), ...shuffle(open.filter((s) => s.status !== 'doing'))].slice(0, n);
}
function generateTasks(date = today()) {
  // Remove tasks concluídas de dias anteriores; preserva as pendentes para histórico/continuidade.
  S.tasks = S.tasks.filter(t => !(t.done && t.date && t.date < date));
  let n = 0;
  const add = (t) => { if (!S.tasks.find((x) => x.date === date && x.key === t.key)) { S.tasks.push({ id: uid(), date, done: false, createdBy: me?.id || null, ...t }); n++; } };
  const per = S.settings.stagesPerDay || 2;
  for (const p of S.projects) {
    const m = p.memberIds || [];
    for (let i = 1; i <= (p.dailyPosts || 0); i++)
      add({ key: `post:${p.id}:${i}`, projectId: p.id, userId: m.length ? m[(i - 1) % m.length] : null, kind: 'post', title: `Post ${i}/${p.dailyPosts} do dia` });
    pickStages(p.stages, Math.max(0, Number(p.tasksPerDay ?? per))).forEach((st, i) =>
      add({ key: `stage:${p.id}:${st.id}`, projectId: p.id, userId: m.length ? m[i % m.length] : null, kind: 'stage', stageId: st.id, title: `Etapa: ${st.title}` }));
  }
  const team = S.users;
  pickStages(S.general.stages, per).forEach((st, i) =>
    add({ key: `gen:${st.id}`, projectId: null, userId: team.length ? team[i % team.length].id : null, kind: 'general', stageId: st.id, title: `Agência: ${st.title}` }));
  // Mistura as tarefas recém-geradas para intercalar tarefas gerais com as dos projetos.
  const daily = S.tasks.filter((t) => t.date === date);
  const others = S.tasks.filter((t) => t.date !== date);
  S.tasks = [...others, ...shuffle(daily)];
  S.lastGen = date;
  save();
  return n;
}
function syncPostTasks(pid) {
  const d = today();
  const c = S.postsLog.filter((x) => x.date === d && x.projectId === pid).length;
  S.tasks.filter((t) => t.date === d && t.projectId === pid && t.kind === 'post').sort((a, b) => (a.key > b.key ? 1 : -1))
    .forEach((t, i) => { if (i < c && !t.done) { t.done = true; t.doneAt = Date.now(); } });
}
const postsToday = (pid) => S.postsLog.filter((x) => x.date === today() && x.projectId === pid).length;

/* ============================================================
   TELAS
   ============================================================ */
const pub = { projectId: '', nets: {}, facebookDestinations: { feed: false, marketplace: false }, file: null, productImages: false, text: '', title: '', productId: '', productIds: [], status: {}, mediaType: 'video', autoPost: false, marketplaceLocation: 'Seropédica - Rio de Janeiro', marketplaceGroups: 10, marketplaceDelivery: true, tiktokMode: 'video', postNow: true, scheduleDate: today(), scheduleTime: '12:00' };
const marketplaceVitrineDialog = { open: false, productId: '', marketplaceLocation: 'Seropédica - Rio de Janeiro', postNow: true, scheduleDate: today(), scheduleTime: '12:00', busy: false };
const att = { net: 'whatsapp', projectId: '', history: [], chat: '', group: false, draft: '', human: false, watching: false, mode: 'auto', log: [], sentTimes: [], sim: '', simOut: '', tabOk: null };
const off = { projectId: '', net: 'whatsapp', sel: new Set(), vars: [], sent: {}, busy: false, query: '', message: '', selectedProducts: [], recipientSel: [], sendNow: true, scheduleDate: today(), scheduleTime: '12:00', selectAll: false, paused: false };
function ensureAttProject() {
  const projects = myProjects();
  const current = projects.find((project) => String(project.id) === String(att.projectId));
  if (current) return current;
  att.projectId = projects[0]?.id || '';
  return projects[0] || null;
}
let insightsBusy = false;
let projectTab = 'identidade';
const aiProjectStatus = {};
const STL = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluída' };

const offerCard = (p, extra = '', showProjectLogo = false) => { const project = proj(p.projectId); return `<div class="offer">${showProjectLogo ? (project?.logo ? `<img class="offer-project-logo" src="${esc(project.logo)}" alt="Logo do projeto" title="Identidade visual do projeto">` : `<span class="offer-project-logo offer-project-placeholder" title="Projeto sem logo cadastrado">${esc((project?.name || 'V').slice(0,1).toUpperCase())}</span>`) : ''}${p.image ? `<img src="${esc(p.image)}" alt="Foto de ${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;offer-placeholder&quot;>Imagem indisponível</div>'">` : '<div class="offer-placeholder">Sem foto</div>'}<div class="grow"><b>${esc(p.title)}</b><div>${brl(p.price)} ${p.oldPrice ? `<s class="muted">${brl(p.oldPrice)}</s> <span class="tag ok">${pct(p)}% OFF</span>` : ''} ${p.store ? `<span class="tag">${esc(p.store)}</span>` : ''}</div></div>${extra}</div>`; };

function taskRow(t) {
  const p = proj(t.projectId), u = user(t.userId); const stage = t.stageId ? stagesOf(t.projectId || 'general').find(s => s.id === t.stageId) : null; const urgency = stage?.urgency || t.urgency || 'green';
  return `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-act="toggleTask" data-id="${t.id}" ${t.done ? 'checked' : ''}><span class="t grow">${esc(t.title)}</span><span class="priority ${urgency}">${urgency === 'red' ? 'Urgente' : urgency === 'yellow' ? 'Prioridade média' : 'Normal'}</span><span class="tag">${p ? esc(p.name) : 'Agência'}</span>${u ? `<span class="tag">Responsável: ${esc(u.name)}</span>` : ''}${t.done && t.completedByName ? `<span class="tag">Concluiu: ${esc(t.completedByName)}</span>` : ''}${!t.userId ? '<span class="tag warn">sem responsável</span>' : ''}</label>`;
}
function generalMessages() {
  const messages = Array.isArray(S.general.messages) ? S.general.messages : [];
  const legacy = S.general.note ? [{ id: 'legacy-note', text: S.general.note, authorName: 'Recado anterior', createdAt: 0 }] : [];
  return [...legacy, ...messages].slice(-30);
}

function stagesEditor(scope, canEdit) {
  const list = stagesOf(scope);
  return `<div>${list.map((s) => `<div class="row st"><button class="pill ${s.status || 'todo'}" data-act="cycleStage" data-scope="${scope}" data-id="${s.id}" ${canEdit ? '' : 'disabled'}>${STL[s.status || 'todo']}</button><span class="grow" ${canEdit ? `data-act="renameStage" data-scope="${scope}" data-id="${s.id}" title="Clique para renomear"` : ''}>${esc(s.title)}</span>${canEdit ? `<select class="urgency-select" data-urgency="1" data-scope="${scope}" data-id="${s.id}"><option value="green" ${(s.urgency||'green')==='green'?'selected':''}>🟢 Normal</option><option value="yellow" ${s.urgency==='yellow'?'selected':''}>🟡 Média</option><option value="red" ${s.urgency==='red'?'selected':''}>🔴 Urgente</option></select><button class="x" data-act="delStage" data-scope="${scope}" data-id="${s.id}" title="Excluir">✕</button>` : ''}</div>`).join('') || '<p class="muted">Nenhuma etapa ainda.</p>'}${canEdit ? `<div class="row"><input id="newstage-${scope}" class="grow" placeholder="Nova etapa (ex.: Cadastrar o domínio no painel de afiliados)"><button class="btn" data-act="addStage" data-scope="${scope}">Adicionar</button></div>` : ''}</div>`;
}

const viewSetup = () => viewLogin();
const viewLogin = () => `<div class="login"><h1>Centro de Comando Vizzion</h1><p class="muted">Entre com sua conta individual. Todos os integrantes autorizados usam o mesmo espaço compartilhado.</p><label>E-mail<input id="lg-email" type="email" autocomplete="username" placeholder="voce@empresa.com"></label><label>Senha<input id="lg-password" type="password" autocomplete="current-password" placeholder="Sua senha"></label><div class="row"><button class="btn" data-act="login">Entrar</button></div><p class="muted">Novos integrantes podem ser cadastrados na aba Equipe após entrar.</p></div>`;

const navBtn = (r, l, badge = 0) => `<button class="nav ${route === r ? 'on' : ''}" data-act="nav" data-r="${r}">${l}${badge > 0 ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</button>`;
function sidebar() {
  const pendingTasks = S.tasks.filter(t => t.date === today() && !t.done).length;
  return `<aside><div class="brand-lockup"><img class="brand-logo" src="vizzion-logo.png" alt="Vizzion"><div class="brand-copy"><h1>VIZZION</h1><small>OPEN WAYS · EMBRACE THE WORLD</small></div></div><div class="who">${esc(me.name || me.email || 'Integrante')} · equipe · <a data-act="logout">sair</a></div>
  <div class="nav-h">Interações nas abas abertas</div><div class="interaction-counts">${['instagram','facebook','tiktok','youtube'].map(n=>`<div class="interaction-count"><span>${({instagram:'◎',facebook:'f',tiktok:'♪',youtube:'▶'})[n]} ${NETS[n].name}</span><b data-notification-count="${n}">${notificationCounts[n] == null ? '—' : notificationCounts[n] > 0 ? notificationCounts[n] : '0'}</b></div>`).join('')}<button class="btn ghost" data-act="refreshNotificationCounts">Atualizar contadores</button><small class="muted" data-notification-count-updated>${notificationCountsUpdatedAt ? 'Atualizado '+new Date(notificationCountsUpdatedAt).toLocaleTimeString('pt-BR') : 'Abra as redes na mesma janela do Chrome.'}</small></div>
  ${navBtn('hoje', 'Início', pendingTasks)}${navBtn('agencia', 'Projetos')}${myProjects().map((p) => navBtn('proj:' + p.id, '↳ ' + esc(p.name))).join('')}
  ${navBtn('atendimento', 'Atendimento')}${navBtn('publicar', 'Publicar')}${navBtn('biblioteca', 'Biblioteca')}${navBtn('chat', 'Chat')}${navBtn('usuarios', 'Equipe')}${navBtn('config', 'Configurações')}
  </aside>`;
}

const insightsHtml = () => (S.insights?.items?.length
  ? S.insights.items.map((i) => `<div class="task"><div class="grow"><b>${esc(i.produto)}</b><br>${esc(i.ideia)}<br><span class="muted">${esc(i.gancho)}</span></div><span class="tag">${esc(i.formato)}</span></div>`).join('')
  : '<p class="muted">Gere ideias de post ligadas às ofertas de hoje.</p>');

function viewHoje() {
  const d = today();
  const all = S.tasks.filter((t) => t.date === d);
  const mine = all.filter((t) => t.userId === me.id || !t.userId);
  const others = all.filter((t) => t.userId && t.userId !== me.id);
  const prog = myProjects().filter((p) => p.dailyPosts > 0).map((p) => {
    const c = postsToday(p.id);
    const percent = Math.min(100, Math.round((c / p.dailyPosts) * 100));
    return `<div class="progress-item"><div class="row"><b class="grow">${esc(p.name)}</b><span class="muted">${c}/${p.dailyPosts} posts · ${percent}%</span></div><div class="bar progress-bar"><i style="width:${percent}%"></i></div></div>`;
  }).join('');
  const taskTotal = mine.length;
  const taskDone = mine.filter((t) => t.done).length;
  const taskPercent = taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0;
  return `<h2>Hoje, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><p class="sub">Suas tasks do dia e as ofertas sugeridas pela base de produtos.</p>
  <section><h3>Recados da equipe</h3><div class="general-chat">${generalMessages().map((m) => `<div class="general-message"><div class="row"><b class="grow">${esc(m.authorName || 'Integrante')}</b><span class="muted">${m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : 'recado anterior'}</span></div><div>${esc(m.text)}</div></div>`).join('') || '<p class="muted">Nenhum recado ainda.</p>'}</div><div class="row general-chat-compose"><textarea id="general-message-input" class="grow" placeholder="Escreva um recado para toda a equipe..." rows="2"></textarea><button class="btn" data-act="sendGeneralMessage">Enviar recado</button></div><p class="muted">Os recados ficam compartilhados com a equipe e são sincronizados com o backend.</p></section>
  <section><div class="row"><h3 class="grow">Minhas tasks</h3><button class="btn ghost" data-act="genTasks">Gerar tasks de hoje</button></div>
  ${mine.map(taskRow).join('') || '<p class="muted">Nenhuma task para hoje. As tasks serão geradas automaticamente à meia-noite.</p>'}</section>
  ${others.length ? `<section><h3>Tasks da equipe</h3>${others.map(taskRow).join('')}</section>` : ''}
  ${prog || taskTotal ? `<section><h3>Gráfico de progresso</h3><div class="progress-summary"><div class="progress-card"><b>Tasks do dia</b><strong>${taskDone}/${taskTotal}</strong><span class="muted">${taskPercent}% concluídas</span><div class="bar progress-bar"><i style="width:${taskPercent}%"></i></div></div>${prog ? `<div class="progress-projects"><h4>Posts por projeto</h4>${prog}</div>` : ''}</div></section>` : ''}
  <section><div class="row"><h3 class="grow">Insights de conteúdo</h3><button class="btn ghost" data-act="genInsights" ${P.length ? '' : 'disabled'}>${insightsBusy ? 'Gerando…' : 'Gerar insights'}</button></div>${insightsHtml()}</section>`;
}

function viewAgencia() {
  const ad = isAdmin();
  const generalStages = stagesOf('general');
  return `<h2>Projetos Vizzion</h2><p class="sub">Crie projetos e mantenha as tarefas gerais da agência. Ao gerar a rotina diária, tarefas gerais são sorteadas e intercaladas com as tarefas dos projetos.</p>
  ${ad ? `<section><div class="feed-compose"><b>Criar novo projeto</b><div class="row"><input id="np-name" class="grow" placeholder="Nome do projeto ou marca"><button class="btn" data-act="newProject">Criar projeto</button></div></div></section>
  <section><h3>Projeto geral · tarefas da agência</h3><p class="muted">Cadastre aqui tarefas recorrentes ou pontuais da Vizzion. Elas não são concluídas nesta tela: serão sorteadas para a lista diária junto das tarefas dos projetos.</p>${stagesEditor('general', true)}</section>` : '<section><h3>Projeto geral</h3><p class="muted">As tarefas gerais são distribuídas automaticamente na rotina diária. Somente administradores podem criar ou editar essas tarefas.</p></section>'}
  <div class="project-grid">${myProjects().map((p) => `<article class="social-card">${p.logo ? `<img class="project-logo" src="${esc(p.logo)}" alt="Logo">` : `<div class="project-logo placeholder">${esc((p.name||'V').slice(0,1).toUpperCase())}</div>`}<div class="grow"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.bio || 'Adicione uma bio no perfil do projeto.')}</p><div class="row"><span class="tag">${(p.memberIds || []).length} membros</span><span class="tag">${(p.accounts || []).length} contas</span><span class="tag">${p.tasksPerDay ?? 2} etapas/dia</span></div><button class="btn ghost" data-act="nav" data-r="proj:${p.id}">Abrir projeto</button></div>${ad ? `<button class="x" data-act="delProject" data-id="${p.id}" title="Excluir">✕</button>` : ''}</article>`).join('') || '<p class="muted">Crie o primeiro projeto acima.</p>'}</div>`;
}
function viewUsuarios() {
 const canManage = isAdmin(), canChangeRoles = isMasterAdmin();
 return `<h2>Equipe Vizzion</h2><p class="sub">MASTERADMIN gerencia administradores e membros. ADMIN gerencia apenas membros. MEMBER não gerencia contas.</p>
 ${canManage ? `<section><h3>Adicionar integrante</h3><div class="grid2"><label>Nome completo<input id="team-name" autocomplete="name" placeholder="Nome da pessoa"></label><label>E-mail de login<input id="team-email" type="email" autocomplete="email" placeholder="pessoa@exemplo.com"></label><label>Senha inicial<input id="team-password" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo de 8 caracteres"></label>${canChangeRoles ? '<label>Papel<select id="team-role"><option value="member">MEMBER</option><option value="admin">ADMIN</option></select></label>' : ''}</div><p class="muted">A conta será criada imediatamente. Entregue a senha inicial por um canal privado.</p><button class="btn" data-act="createTeamMember">Criar conta</button></section>` : ''}
 <section><div class="row"><h3 class="grow">Integrantes cadastrados</h3><button class="btn ghost" data-act="refreshTeam">Atualizar lista</button></div>${S.users.map((u) => { const targetRole = u.role || 'member'; const canDelete = u.id !== me.id && (canChangeRoles || targetRole === 'member'); const roleControl = canChangeRoles && u.id !== me.id && targetRole !== 'masteradmin' ? `<select data-act="changeTeamRole" data-id="${esc(u.id)}"><option value="member" ${targetRole === 'member' ? 'selected' : ''}>MEMBER</option><option value="admin" ${targetRole === 'admin' ? 'selected' : ''}>ADMIN</option></select>` : `<span class="tag">${targetRole.toUpperCase()}</span>`; return `<div class="social-card"><div class="avatar">${esc((u.name||'?').slice(0,1).toUpperCase())}</div><div class="grow"><b>${esc(u.name || 'Integrante')}</b><div class="muted">${esc(u.email || '')} · ${u.id === me.id ? 'Você · conectado' : 'Integrante da equipe'}<br>${roleControl}<span class="muted"> · Tasks criadas: ${S.tasks.filter(t => t.createdBy === u.id).length} · concluídas: ${S.tasks.filter(t => t.completedBy === u.id).length}</span></div></div>${canDelete ? `<button class="btn danger" data-act="deleteTeamMember" data-id="${esc(u.id)}" data-name="${esc(u.name || u.email || 'integrante')}">Excluir conta</button>` : ''}</div>`; }).join('') || `<p class="muted">Não foi possível carregar a lista da equipe. Clique em Atualizar lista.</p>`}</section>`;
}
function viewHistorico() {
 return `<h2>Histórico da equipe</h2><p class="sub">Registro compartilhado de entradas, tarefas concluídas, projetos e publicações.</p><section><div class="row"><span class="grow muted">Últimas 100 ações</span><button class="btn ghost" data-act="refreshActivity">Atualizar</button></div>${ACTIVITY.map(a => `<article class="social-card"><div class="avatar">${esc((a.display_name || a.email || '?').slice(0,1).toUpperCase())}</div><div class="grow"><b>${esc(a.display_name || a.email || 'Integrante')}</b><div>${esc(a.action_label || a.action)}</div><div class="muted">${new Date(a.created_at).toLocaleString('pt-BR')}${a.details?.title ? ' · ' + esc(a.details.title) : ''}</div></div></article>`).join('') || '<p class="muted">Ainda não há ações registradas. Clique em Atualizar.</p>'}</section>`;
}
function viewAtividade() {
 const items = (S.activityLog || []).slice(0, 100);
 return `<h2>Histórico de atividade</h2><p class="sub">Registro compartilhado das alterações feitas no painel, com pessoa e horário.</p><section>${items.map(x => `<div class="task"><span class="grow"><b>${esc(x.userName || 'Integrante')}</b> ${esc(x.action || 'atualizou os dados')}</span><span class="muted">${new Date(x.at || Date.now()).toLocaleString('pt-BR')}</span></div>`).join('') || '<p class="muted">Ainda não há atividades registradas. As próximas alterações aparecerão aqui.</p>'}</section>`;
}
function viewBiblioteca() { return `<h2>Biblioteca de posts</h2><p class="sub">Histórico de publicações registradas, organizado como um feed. Posts só entram aqui quando você clicar em “Já publiquei”.</p><section>${[...S.postsLog].sort((a,b)=>(b.ts||0)-(a.ts||0)).map(x=>`<article class="social-card">${x.image ? `<img class="post-media" src="${esc(x.image)}" alt="Mídia do post">` : ''}<div class="grow"><div class="muted">${esc(proj(x.projectId)?.name || 'Projeto removido')} · ${new Date(x.ts || Date.now()).toLocaleString('pt-BR')}</div><p class="post-text">${esc(x.fullText || x.text || '(sem texto)')}</p><div class="row">${(x.nets||[]).map(n=>`<span class="tag">${NETS[n]?.name || n}</span>`).join('')}<button class="btn danger" data-act="deleteLibraryPost" data-id="${esc(x.id || '')}">Excluir da biblioteca</button></div></div></article>`).join('') || '<p class="muted">Nenhum post registrado ainda.</p>'}</section>`; }
function viewFerramentas() { const ps = proj(route.startsWith('ferramentas:') ? route.slice(12) : route.startsWith('proj:') ? route.slice(5) : ''); if (!ps) return `<h2>Ferramentas</h2><p class="sub">Abra um projeto para gerenciar os arquivos e extensões dele.</p>${S.projects.map(p=>`<div class="social-card"><b class="grow">${esc(p.name)}</b><button class="btn ghost" data-act="nav" data-r="proj:${p.id}">Abrir</button></div>`).join('')}`; return `<h2>Ferramentas · ${esc(ps.name)}</h2><p class="sub">Envie extensões, páginas e outros arquivos úteis para este projeto.</p><section><input type="file" data-act="uploadTool" data-pid="${ps.id}" multiple><p class="muted">Os arquivos ficam salvos no armazenamento local da extensão; prefira arquivos pequenos.</p>${(ps.tools||[]).map((t,i)=>`<div class="social-card"><div class="grow"><b>${esc(t.name)}</b><div class="muted">${(t.size/1024).toFixed(1)} KB</div></div><button class="btn ghost" data-act="downloadTool" data-pid="${ps.id}" data-index="${i}">Baixar</button><label class="btn ghost">Substituir<input type="file" hidden data-act="replaceTool" data-pid="${ps.id}" data-index="${i}"></label><button class="x" data-act="deleteTool" data-pid="${ps.id}" data-index="${i}">✕</button></div>`).join('') || '<p class="muted">Nenhuma ferramenta enviada.</p>'}</section>`; }

function viewProjeto(id) {
  const p = proj(id); if (!p) return '<p>Projeto não encontrado.</p>';
  const ad = isAdmin(); const tt = S.tasks.filter((t) => t.date === today() && t.projectId === id);
  const field = (path, label, val, type = 'text', extra = '') => `<label class="row"><span style="width:200px">${label}</span><input class="grow" data-path="${path}" data-type="${type}" type="${type}" value="${esc(val ?? '')}" ${ad ? '' : 'disabled'} ${extra}></label>`;
  const tabs = [['identidade','Identidade'],['vitrine','Vitrine'],['metas','Metas e etapas'],['contas','Redes sociais e atendimento']];
  const tabbar = `<div class="subtabs project-tabs">${tabs.map(([k,l])=>`<button class="btn ${projectTab===k?'':'ghost'}" data-act="projectTab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  const ai = aiProjectStatus[id] || {};
  const aiControls = `<section><h3>IA Gemini do projeto</h3><p class="muted">A chave fica criptografada no backend. Este painel nunca armazena nem recebe a chave original.</p><div class="row"><span class="tag ${ai.configured ? 'ok' : ''}">${ai.configured ? 'CONFIGURADA' : 'NÃO CONFIGURADA'}</span>${ai.maskedKey ? `<span class="tag">${esc(ai.maskedKey)}</span>` : ''}${ai.lastTestStatus ? `<span class="tag ${ai.lastTestStatus === 'success' ? 'ok' : 'err'}">${ai.lastTestStatus === 'success' ? 'conectada' : 'falha no último teste'}</span>` : ''}<button class="btn ghost" data-act="refreshProjectAI" data-pid="${id}">Atualizar status</button></div>${ad ? `<div class="row" style="margin-top:10px"><label>Modelo <select data-path="p|${id}|aiModel"><option value="" ${!p.aiModel?'selected':''}>Automático (recomendado)</option><option value="gemini-3.5-flash-lite" ${p.aiModel==='gemini-3.5-flash-lite'?'selected':''}>Flash Lite</option><option value="gemini-3.8-flash" ${p.aiModel==='gemini-3.8-flash'?'selected':''}>Flash</option></select></label><input id="ai-key-${id}" class="grow" type="password" placeholder="${ai.configured ? 'Cole uma nova chave para substituir' : 'Cole a chave Gemini do projeto'}"><button class="btn" data-act="saveProjectAI" data-pid="${id}">${ai.configured ? 'Substituir chave' : 'Cadastrar chave'}</button>${ai.configured ? `<button class="btn ghost" data-act="testProjectAI" data-pid="${id}">Testar</button><button class="btn danger" data-act="removeProjectAI" data-pid="${id}">Remover</button>` : ''}</div>` : '<p class="muted">Somente administradores podem gerenciar a chave.</p>'}</section>`;
  if (projectTab === 'identidade') body = `<section><h3>Identidade do projeto</h3><div class="profile-head"><div class="profile-upload-wrap"><label class="profile-upload" title="${p.logo ? 'Clique para substituir a imagem' : 'Upload Image'}"><img src="${p.logo ? esc(p.logo) : 'vizzion-logo.png'}" alt="Imagem do perfil">${p.logo ? '' : '<span>＋</span><small>Upload Image</small>'}<input type="file" data-act="projectLogo" data-pid="${id}" accept="image/*" ${ad?'':'disabled'}></label>${p.logo && ad ? `<button class="btn ghost" data-act="deleteProjectLogo" data-pid="${id}">Deletar imagem</button>` : ''}</div><div class="grow"><h3>${esc(p.name)}</h3><p class="muted">Imagem redonda como foto de perfil. Clique para trocar; use “Deletar imagem” para removê-la.</p><textarea data-path="p|${id}|bio" data-type="text" placeholder="Bio curta da marca" ${ad?'':'disabled'}>${esc(p.bio||'')}</textarea></div></div></section>${aiControls}
  <section><h3>Ferramentas do projeto</h3><p class="muted">Extensões, páginas e arquivos usados por esta marca.</p><input type="file" data-act="uploadTool" data-pid="${id}" multiple ${ad?'':'disabled'}><div>${(p.tools||[]).map((t,i)=>`<div class="row"><span class="grow">${esc(t.name)} <span class="muted">(${(t.size/1024).toFixed(1)} KB)</span></span><button class="btn ghost" data-act="downloadTool" data-pid="${id}" data-index="${i}">Baixar</button>${ad?`<label class="btn ghost">Substituir<input type="file" hidden data-act="replaceTool" data-pid="${id}" data-index="${i}"></label><button class="x" data-act="deleteTool" data-pid="${id}" data-index="${i}">✕</button>`:''}</div>`).join('')||'<p class="muted">Nenhuma ferramenta enviada.</p>'}</div></section>
  <section><h3>Catálogo do projeto</h3><p class="muted">Importe os produtos diretamente neste projeto. A lista de produtos fica organizada na aba Vitrine.</p><div class="row"><input type="file" data-act="importProducts" data-pid="${id}" accept=".csv,.json" multiple ${ad?'':'disabled'}><button class="btn ghost" data-act="projectTab" data-tab="vitrine">Abrir vitrine (${P.filter(x=>x.projectId===id).length})</button></div></section>`;
  else if (projectTab === 'vitrine') body = viewVitrine(id);
  else if (projectTab === 'metas') body = `<div class="grid2"><section><h3>Metas diárias</h3>${field(`p|${id}|dailyPosts`,'Posts por dia',p.dailyPosts,'number','min="0"')}${field(`p|${id}|tasksPerDay`,'Etapas sorteadas por dia',p.tasksPerDay ?? 2,'number','min="0" max="30"')}<p class="muted">As tarefas gerais são intercaladas automaticamente com as tasks diárias dos projetos.</p><div class="muted">Responsáveis do projeto</div>${S.users.map(u=>`<label class="row"><input type="checkbox" data-act="toggleMember" data-pid="${id}" data-uid="${u.id}" ${p.memberIds?.includes(u.id)?'checked':''} ${ad?'':'disabled'}> ${esc(u.name)}</label>`).join('')}</section><section><h3>Tasks de hoje</h3>${tt.map(taskRow).join('')||'<p class="muted">Sem tasks geradas para hoje.</p>'}</section></div><section><h3>Etapas do projeto</h3>${stagesEditor(id,ad)}</section>`;
  else body = `<section><h3>Redes sociais e contas</h3><p class="muted">Cadastre perfis sociais e, para WhatsApp/Telegram, grupos separados por linha.</p>${(p.accounts||[]).map(a=>`<div class="row" style="align-items:flex-start"><span class="tag">${NETS[a.type]?.name||a.type}</span><div class="grow"><input id="acl-${a.id}" value="${esc(a.label)}" placeholder="Nome da conta" style="width:100%;margin-bottom:6px" ${ad?'':'disabled'}><textarea id="aci-${a.id}" placeholder="URL, usuário ou grupos (um por linha)" ${ad?'':'disabled'}>${esc(a.items||'')}</textarea></div>${ad?`<div><button class="btn ghost" data-act="saveAccount" data-pid="${id}" data-id="${a.id}">Salvar</button> <button class="x" data-act="delAccount" data-pid="${id}" data-id="${a.id}">✕</button></div>`:''}</div>`).join('')||'<p class="muted">Nenhuma conta cadastrada.</p>'}${ad?`<div class="row"><select id="ac-type">${Object.keys(NETS).map(k=>`<option value="${k}">${NETS[k].name}</option>`).join('')}</select><input id="ac-label" class="grow" placeholder="Nome da conta"><button class="btn" data-act="addAccount" data-pid="${id}">Adicionar conta</button></div>`:''}</section><section><h3>Atendimento · bot do projeto</h3>${field(`p|${id}|bot.brand`,'Nome da loja/marca',p.bot?.brand)}${field(`p|${id}|bot.productsPerRequest`,'Produtos enviados por solicitação (1 a 20)',p.bot?.productsPerRequest ?? 5,'number','min="1" max="20"')}<p class="muted">Define quantos produtos correspondentes serão enviados em cada pedido do cliente. Ex.: 2 = envia 2 opções de tênis, cada uma no formato já usado, com foto (quando disponível), nome, categoria, preço atual e preço anterior. Se o catálogo tiver menos correspondências, envia somente as disponíveis. Esse número controla a quantidade de produtos por solicitação.</p><label class="row"><span style="width:200px">Tom e instruções</span><textarea class="grow" data-path="p|${id}|bot.persona" data-type="text" ${ad?'':'disabled'} placeholder="Ex.: vendedor simpático, respostas curtas.">${esc(p.bot?.persona||'')}</textarea></label>${field(`p|${id}|bot.handoffText`,'Mensagem ao chamar humano',p.bot?.handoffText||'')}</section>`;
  return `<h2>${esc(p.name)}</h2><p class="sub">Perfil do projeto · Hoje: ${postsToday(id)}/${p.dailyPosts||0} posts publicados.</p>${tabbar}${body}`;
}
function viewPublicar() {
  const prj = myProjects();
  if (!pub.projectId && prj[0]) pub.projectId = prj[0].id;
  const st = (n) => { const s = pub.status[n]; return s ? `<span class="tag ${s.s === 'ok' ? 'ok' : s.s === 'err' ? 'err' : 'warn'}">${esc(s.m)}</span>` : ''; };
  return `<h2>Publicar</h2><div class="subtabs"><button class="btn" data-act="nav" data-r="publicar">Várias redes</button><button class="btn ghost" data-act="nav" data-r="ofertas">Ofertas em grupos</button></div><p class="sub">Escolha Foto ou Vídeo, selecione as redes e prepare o conteúdo. Com Publicar automaticamente ativado, a extensão tentará clicar no botão final de publicação; confira os resultados de cada rede.</p>
  <section><div class="row"><label>Projeto <select data-pub="projectId">${prj.map((p) => `<option value="${p.id}" ${p.id === pub.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">(sem projeto)</option>'}</select></label></div>
  <div class="row"><button class="btn ${pub.mediaType==='video'?'':'ghost'}" data-act="mediaType" data-type="video">Vídeo</button><button class="btn ${pub.mediaType==='photo'&&!pub.productImages?'':'ghost'}" data-act="mediaType" data-type="photo">Foto</button><button class="btn ${pub.productImages?'':'ghost'}" data-act="productImagesMode">Mídias do produto${pub.productImages?' ✓':''}</button><input type="file" data-act="pickFile" accept="${pub.mediaType==='photo'?'image/*':'video/*'}"><span class="muted">${pub.productImages ? 'A primeira foto e o primeiro vídeo de cada produto serão usados conforme a rede.' : pub.file ? esc(pub.file.name) + ' (' + (pub.file.size / 1048576).toFixed(1) + ' MB)' : 'Nenhum arquivo escolhido'}</span></div>
  <label class="row"><input type="checkbox" data-pub="autoPost" ${pub.autoPost?'checked':''}> Publicar automaticamente (tentar clicar em Publicar/Compartilhar em cada rede)</label>
  <input data-pub="title" style="width:100%;margin:6px 0" placeholder="Título (opcional; usado apenas no TikTok)" value="${esc(pub.title)}">
  <textarea data-pub="text" placeholder="Corpo do post: legenda, hashtags, link…" style="min-height:130px">${esc(pub.text)}</textarea>
  <div class="row"><div class="grow product-search-wrap"><input id="pub-product-search" class="grow" autocomplete="off" placeholder="Gerar texto a partir de produtos: digite o nome…" value=""><div id="pub-product-results" class="live-results"></div></div><button class="btn ghost" data-act="genPostText" ${pub.productIds?.length || pub.productId ? '' : 'disabled'}>Sugerir texto com IA</button></div>
  <div id="selected-publish-products">${renderSelectedPublishProducts()}</div>
  <div class="row">${POST_NETS.filter(n => pub.productImages || pub.mediaType !== 'photo' || n !== 'youtube').map((n) => n === 'facebook' ? `<div class="facebook-publish-choice"><div class="facebook-publish-title"><span>f</span><b>Facebook</b></div><label><input type="checkbox" data-act="pubFacebookDestination" data-destination="feed" ${pub.facebookDestinations.feed?'checked':''}> Feed</label><label><input type="checkbox" data-act="pubFacebookDestination" data-destination="marketplace" ${pub.facebookDestinations.marketplace?'checked':''}> Marketplace</label></div>` : `<button type="button" class="social-toggle ${pub.nets[n] ? 'selected' : ''} net-${n}" data-act="pubNetButton" data-net="${n}" aria-pressed="${!!pub.nets[n]}" title="${NETS[n].name}"><span>${({instagram:'◎',tiktok:'♪',youtube:'▶',linkedin:'in',x:'𝕏'})[n] || NETS[n].name.slice(0,2)}</span><small>${NETS[n].name}</small></button>`).join('')}<div class="network-status">${pub.facebookDestinations.feed?'<span class="tag">Facebook · Feed</span>':''}${pub.facebookDestinations.marketplace?'<span class="tag">Facebook · Marketplace</span>':''} ${POST_NETS.filter(n=>n!=='facebook'&&pub.nets[n]).map(n=>`<span class="tag">${NETS[n].name}</span>`).join(' ')} ${POST_NETS.map(st).join(' ')}</div></div>
  ${pub.facebookDestinations.marketplace ? `<section><h3>Facebook Marketplace</h3><div class="row"><label>Localização <input data-pub="marketplaceLocation" value="${esc(pub.marketplaceLocation)}"></label><label>Grupos <input data-pub="marketplaceGroups" type="number" min="0" max="10" value="${pub.marketplaceGroups}"></label><label><input data-pub="marketplaceDelivery" type="checkbox" ${pub.marketplaceDelivery?'checked':''}> Entrega disponível</label></div><p class="muted">O anúncio será preenchido com o primeiro produto selecionado/encontrado, condição Novo e descrição sem links de afiliado.</p></section>` : ''}
  <section class="schedule-box"><h3>Quando publicar?</h3><label class="row"><input type="checkbox" data-pub="postNow" ${pub.postNow?'checked':''}> Postar agora</label><div class="row"><label>Data <input type="date" data-pub="scheduleDate" value="${esc(pub.scheduleDate || today())}" min="${today()}" ${pub.postNow?'disabled':''}></label><label>Horário <input type="time" data-pub="scheduleTime" value="${esc(pub.scheduleTime || '12:00')}" ${pub.postNow?'disabled':''}></label></div><p class="muted">Desmarque “Postar agora” para salvar a mídia, os textos e as redes selecionadas na fila. No horário, a Vizzion chamará o mesmo fluxo de publicação existente.</p></section>
  <div class="row"><button class="btn" data-act="submitPublish">${pub.postNow ? (pub.autoPost?'Publicar automaticamente agora':'Preparar nas abas agora') : 'Agendar publicação'}</button>${Object.keys(pub.status).length ? '<button class="btn ghost" data-act="markPublished">Já publiquei (conta como 1 post)</button>' : ''}</div></section>
  <section><h3>Fila de publicações</h3>${(S.scheduledPosts||[]).slice().sort((a,b)=>a.runAt-b.runAt).map((q)=>`<div class="social-card"><div class="grow"><b>${esc(q.title || (q.mediaType==='photo'?'Publicação com foto':'Publicação com vídeo'))}</b><div class="muted">${new Date(q.runAt).toLocaleString('pt-BR')} · ${(q.nets||[]).map(n=>NETS[n]?.name||n).join(', ')}</div><span class="tag ${q.status==='erro'?'err':q.status==='executando'?'warn':q.status==='concluida'?'ok':''}">${esc(q.status || 'agendada')}${q.error ? ': '+esc(q.error) : ''}</span></div>${q.status==='agendada'?`<button class="btn ghost" data-act="cancelScheduled" data-id="${q.id}">Cancelar</button>`:''}</div>`).join('') || '<p class="muted">Nenhuma publicação agendada.</p>'}</section>
  <section><h3>Publicados hoje</h3>${S.postsLog.filter((x) => x.date === today() && (isAdmin() || x.userId === me.id)).map((x) => `<div class="task"><span class="grow">${esc(x.text || '(sem texto)')}</span><span class="tag">${esc(proj(x.projectId)?.name || '')}</span><span class="tag">${(x.nets || []).map((n) => NETS[n]?.name).join(', ')}</span></div>`).join('') || '<p class="muted">Nada ainda.</p>'}</section>`;
}

const projOptions = (sel) => myProjects().map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">(sem projeto)</option>';
function viewAtendimento() {
  ensureAttProject();
  return `<h2>Atendimento automático</h2>
  <p class="sub">Escolha o projeto e a rede. Ao ligar, a Vizzion monitora conversas novas, organiza os atendimentos em fila e responde automaticamente com a IA usando o contexto e o catálogo do projeto. Não usa captura de tela.</p>
  <section><div class="row">
    <label>Projeto <select data-att="projectId">${projOptions(att.projectId)}</select></label>
    <label>Rede <select data-att="net">${MSG_NETS.map((n) => `<option value="${n}" ${att.net === n ? 'selected' : ''}>${NETS[n].name}</option>`).join('')}</select></label>
  </div>
  <div class="row" style="margin-top:12px">
    <button class="btn ${att.watching ? 'danger' : ''}" data-act="attWatch">${att.watching ? '■ Desligar atendimento automático' : '▶ Ligar atendimento automático'}</button>
    <span class="tag ${att.watching ? 'ok' : ''}">${att.watching ? 'MONITORANDO' : 'DESLIGADO'}</span>
    ${att.tabOk != null ? `<span class="tag ${att.tabOk ? 'ok' : 'err'}">${att.tabOk ? 'rede conectada' : 'aba não encontrada'}</span>` : ''}
  </div>
  <p class="muted">Mantenha a aba da rede aberta e conectada no Chrome. O sistema processa uma conversa por vez, ignora grupos e limita envios para evitar duplicações ou excesso de mensagens. Mensagens que exigem intervenção humana são sinalizadas.</p></section>
  <section><div class="row"><h3 class="grow">Atividade recente</h3><button class="btn ghost" data-act="attCheck">Verificar conexão</button><button class="btn ghost" data-act="attFinish">Finalizar atendimento</button></div>
  <div class="log">${att.log.map((l) => `<div><span class="muted">${new Date(l.t).toLocaleTimeString('pt-BR')}</span> <b>${esc(l.chat || '')}</b>: ${esc(l.msg)} <span class="tag ${/humano|erro|limite/.test(l.st) ? 'err' : 'ok'}">${esc(l.st)}</span></div>`).join('') || '<span class="muted">Nenhuma mensagem processada ainda.</span>'}</div></section>`;
}

const groupsFor = (p, net) => (p?.accounts || []).filter((a) => a.type === net).flatMap((a) => (a.items || '').split('\n').map((s) => s.trim()).filter(Boolean));
function viewOfertas() {
  if (!off.projectId && myProjects()[0]) off.projectId = myProjects()[0].id;
  const groups = groupsFor(proj(off.projectId), off.net);
  const query = String(off.query || '').trim().toLowerCase();
  const matches = query ? P.filter(p => (!p.projectId || p.projectId === off.projectId) && String(p.title||'').toLowerCase().includes(query)).slice(0,30) : [];
  const queueItems = (S.offerSendQueue || []).filter(q => q.projectId === off.projectId);
  return `<h2>Publicar · Ofertas em grupos</h2><div class="subtabs"><button class="btn ghost" data-act="nav" data-r="publicar">Várias redes</button><button class="btn" data-act="nav" data-r="ofertas">Ofertas em grupos</button></div><p class="sub">Prepare uma mensagem, selecione destinatários e envie agora ou programe. A fila processa um destino por vez enquanto o painel estiver aberto.</p>
  <section><div class="row"><label>Projeto <select data-off="projectId">${projOptions(off.projectId)}</select></label><label>Rede <select data-off="net">${MSG_NETS.map(n => `<option value="${n}" ${off.net===n?'selected':''}>${NETS[n].name}</option>`).join('')}</select></label></div></section>
  <section><h3>Ofertas do dia / buscar produtos</h3><p class="muted">Selecione um ou mais produtos. No WhatsApp, cada produto será enviado em uma mensagem própria com foto, nome, preço e link.</p><input id="off-product-search" style="width:100%" autocomplete="off" placeholder="Digite o nome do produto para buscar…" value="${esc(off.query||'')}"><div id="off-product-results" class="live-results">${matches.map(p=>`<div class="row"><div class="grow">${p.image?`<img src="${esc(p.image)}" alt="" style="width:48px;height:48px;object-fit:contain;vertical-align:middle;margin-right:10px">`:''}<b>${esc(p.title)}</b><div class="muted">${brl(p.price)}${p.oldPrice?` · de ${brl(p.oldPrice)}`:''}</div></div><button class="btn ${off.selectedProducts.some(x=>x.id===p.id)?'':'ghost'}" data-act="offAddProduct" data-id="${esc(p.id)}">${off.selectedProducts.some(x=>x.id===p.id)?'✓ Selecionado':'Selecionar produto'}</button></div>`).join('') || (query ? '<p class="muted">Nenhum produto correspondente.</p>' : offers(5).map(p=>offerCard(p, `<button class="btn ghost" data-act="offAddProduct" data-id="${esc(p.id)}">${off.selectedProducts.some(x=>x.id===p.id)?'✓ Selecionado':'Selecionar produto'}</button>`, true)).join(''))}</div>
  ${off.selectedProducts.length?`<div class="selected-offers"><h4>Produtos selecionados · ${off.selectedProducts.length}</h4>${off.selectedProducts.map(p=>`<div class="row"><div class="grow"><b>${esc(p.title)}</b><div class="muted">${brl(p.price)} · ${p.image?'com foto':'sem foto — será enviado em texto'}</div></div><button class="btn ghost" data-act="offAddProduct" data-id="${esc(p.id)}">Remover</button></div>`).join('')}</div>`:''}</section>
  <section><h3>Mensagem adicional (opcional)</h3><textarea id="off-message" data-off="message" placeholder="Texto introdutório opcional, enviado antes dos produtos…" style="min-height:110px">${esc(off.message||'')}</textarea><div class="row"><button class="btn ghost" data-act="offGenerateMessage" ${off.selectedProducts.length?'':'disabled'}>✨ Gerar mensagem com IA a partir dos produtos selecionados</button></div><p class="muted">A IA criará uma introdução curta usando somente os produtos selecionados. Cada produto será enviado em mensagem própria com foto, nome, preço e link, quando disponível. O texto adicional será enviado antes dos produtos.</p><div class="row"><label><input type="checkbox" data-off="sendNow" ${off.sendNow!==false?'checked':''}> Enviar agora</label><label>Data <input type="date" data-off="scheduleDate" value="${esc(off.scheduleDate||today())}" min="${today()}" ${off.sendNow!==false?'disabled':''}></label><label>Horário <input type="time" data-off="scheduleTime" value="${esc(off.scheduleTime||'12:00')}" ${off.sendNow!==false?'disabled':''}></label><button class="btn" data-act="offQueueSelected">Adicionar selecionados à fila</button></div></section>
  <section><div class="row"><h3 class="grow">Destinatários · ${groups.length}</h3><button class="btn ghost" data-act="offSelectAll">${off.selectAll?'Desmarcar todos':'Selecionar todos'}</button></div>${groups.map((g,i)=>`<label class="task"><input type="checkbox" data-act="offRecipientToggle" data-g="${i}" ${off.recipientSel?.includes(g)?'checked':''}><span class="grow">${esc(g)}</span><span class="tag">${NETS[off.net].name}</span></label>`).join('') || '<p class="muted">Cadastre grupos e contatos nas contas do projeto, um por linha em Itens. Contatos e números podem ser adicionados nessa mesma lista.</p>'}</section>
  <section><h3>Fila de envios</h3>${queueItems.slice().sort((a,b)=>(a.runAt||0)-(b.runAt||0)).map(q=>`<div class="social-card"><div class="grow"><b>${esc(q.target)}</b><div class="muted">${NETS[q.net]?.name||q.net} · ${new Date(q.runAt||q.createdAt).toLocaleString('pt-BR')}${q.products?.length?` · ${q.products.length} produto(s)`:''}</div><span class="tag ${q.status==='enviado'?'ok':q.status==='erro'?'err':q.status==='enviando'?'warn':''}">${esc(q.status)}${q.error?': '+esc(q.error):''}</span></div>${['pendente','erro'].includes(q.status)?`<button class="btn ghost" data-act="offRetry" data-id="${q.id}">Retomar</button>`:''}${['pendente','erro'].includes(q.status)?`<button class="btn danger" data-act="offCancelQueue" data-id="${q.id}">Cancelar</button>`:''}</div>`).join('') || '<p class="muted">Nenhum envio na fila.</p>'}<div class="row"><button class="btn ghost" data-act="offPause">${off.paused?'Retomar fila':'Pausar fila'}</button></div></section>`;
}

let catProjectId = '';
let catalogPage = 0;
let vitrinePage = 0;
const catMatches = (query, pid = '') => {
  const q = strip(query.trim());
  if (!q) return [];
  return P.filter(p => (!pid || p.projectId === pid) && strip(p.title || '').startsWith(q)).slice(0, 100);
};
function viewCatalogo() {
  const pid = route.startsWith('catalogo:') ? route.slice(9) : catProjectId;
  const items = pid ? P.filter(p => p.projectId === pid) : P;
  return `<h2>Abrir catálogo</h2><p class="sub">${items.length} produto(s) disponíveis. Digite para encontrar produtos pelo início do nome; os resultados são limitados aos primeiros 100 correspondentes.</p><section><label>Projeto <select id="cat-project" data-cat-project="1"><option value="" ${!pid?'selected':''}>Catálogo geral</option>${S.projects.map(p=>`<option value="${p.id}" ${pid===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></section>
  <section><h3>Importar e baixar</h3><p class="muted">CSV/JSON com colunas id, nome, preco, preco_anterior, categoria, imagem url e url.</p><div class="row"><input type="file" data-act="importProducts" accept=".json,.csv" multiple ${isAdmin() && pid ? '' : 'disabled'}><button class="btn" data-act="syncCatalog">Sincronizar catálogo completo</button><button class="btn ghost" data-act="downloadCatalog" data-pid="${pid||''}">Baixar dados (${items.length})</button><button class="btn ghost" data-act="downloadOriginalCatalog">Baixar planilha original da nuvem</button><button class="btn danger" data-act="clearProducts">Limpar catálogo</button></div>${!isAdmin() ? '<p class="muted">MEMBERs podem consultar o catálogo, mas não importar planilhas.</p>' : !pid ? '<p class="muted">Selecione um projeto antes de importar uma planilha.</p>' : ''}</section>
  <section><h3>Buscar produto</h3><input id="cat-q" class="grow" autocomplete="off" placeholder="Comece a digitar o nome do produto…"><p class="muted">Nenhum produto é exibido antes de pesquisar.</p><div id="cat-res"></div></section>`;
}
function viewMarketplaceVitrineDialog() {
  if (!marketplaceVitrineDialog.open) return '';
  const product = P.find(p => String(p.id) === String(marketplaceVitrineDialog.productId));
  if (!product) return '';
  return `<div style="position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px"><section style="width:min(520px,100%);margin:0;background:var(--panel,#fff);box-shadow:0 12px 40px rgba(0,0,0,.3)"><div class="row"><h3 class="grow">Publicar no Marketplace</h3><button class="x" data-act="closeMarketplaceVitrine">×</button></div><p class="muted">Produto: <b>${esc(product.title)}</b>. A imagem principal e o texto gerado pela IA serão usados no anúncio.</p><label class="row">Cidade <input class="grow" data-mkt="marketplaceLocation" value="${esc(marketplaceVitrineDialog.marketplaceLocation)}" placeholder="Cidade - Estado" ${marketplaceVitrineDialog.busy?'disabled':''}></label><label class="row"><input type="checkbox" data-mkt="postNow" ${marketplaceVitrineDialog.postNow?'checked':''} ${marketplaceVitrineDialog.busy?'disabled':''}> Publicar agora</label><div class="row"><label>Dia <input type="date" data-mkt="scheduleDate" value="${esc(marketplaceVitrineDialog.scheduleDate)}" min="${today()}" ${marketplaceVitrineDialog.postNow||marketplaceVitrineDialog.busy?'disabled':''}></label><label>Horário <input type="time" data-mkt="scheduleTime" value="${esc(marketplaceVitrineDialog.scheduleTime)}" ${marketplaceVitrineDialog.postNow||marketplaceVitrineDialog.busy?'disabled':''}></label></div><div class="row"><button class="btn ghost" data-act="closeMarketplaceVitrine" ${marketplaceVitrineDialog.busy?'disabled':''}>Cancelar</button><button class="btn" data-act="confirmMarketplaceVitrine" ${marketplaceVitrineDialog.busy?'disabled':''}>${marketplaceVitrineDialog.busy?'Preparando…':marketplaceVitrineDialog.postNow?'Publicar agora':'Agendar publicação'}</button></div></section></div>`;
}
function decorateVitrineMarketplaceButtons() {
  document.querySelectorAll('#vitrine-results .vitrine-card').forEach((card) => {
    if (card.querySelector('[data-act="openMarketplaceVitrine"]')) return;
    const source = card.querySelector('[data-act="copyOffer"]');
    const row = source?.parentElement;
    if (!source || !row) return;
    const button = document.createElement('button');
    button.className = 'btn';
    button.dataset.act = 'openMarketplaceVitrine';
    button.dataset.id = source.dataset.id || '';
    button.textContent = 'Publicar no Marketplace';
    row.insertBefore(button, row.children[1] || null);
  });
}
function viewVitrine(pid) {
  const items = P.filter(p => p.projectId === pid);
  const cats = [...new Set(items.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const q = window.__vizzionVitrineQuery || '';
  const min = window.__vizzionVitrineMin || '';
  const max = window.__vizzionVitrineMax || '';
  const cat = window.__vizzionVitrineCategory || '';
  const sort = window.__vizzionVitrineSort || '';
  const filtered = items.filter(p => (!q || strip(p.title).includes(strip(q))) && (!cat || p.category===cat) && (min==='' || Number(p.price)>=Number(min)) && (max==='' || Number(p.price)<=Number(max))).sort((a,b) => {
    if (sort === 'priceAsc' || sort === 'priceDesc') {
      const ap = Number.isFinite(Number(a.price)) ? Number(a.price) : null;
      const bp = Number.isFinite(Number(b.price)) ? Number(b.price) : null;
      if (ap === null && bp === null) return 0;
      if (ap === null) return 1;
      if (bp === null) return -1;
      return sort === 'priceAsc' ? ap - bp : bp - ap;
    }
    return sort === 'desc' ? pct(b)-pct(a) : sort === 'asc' ? pct(a)-pct(b) : 0;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length/50)); vitrinePage = Math.min(vitrinePage, pageCount-1);
  const shown = filtered.slice(vitrinePage*50, vitrinePage*50+50);
  return `<section><div class="row"><h3 class="grow">Vitrine de produtos</h3><span class="tag">${filtered.length} produto(s)</span></div><p class="muted">Exibindo até 50 cards por página, com filtros combináveis.</p><div class="vitrine-filters"><label>Buscar nome<input id="vitrine-q" value="${esc(q)}" placeholder="Nome do produto"></label><label>Categoria<select id="vitrine-category"><option value="">Todas as categorias</option>${cats.map(c=>`<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>Preço mínimo (R$)<input id="vitrine-min" type="number" min="0" step="0.01" value="${esc(min)}" placeholder="0,00"></label><label>Preço máximo (R$)<input id="vitrine-max" type="number" min="0" step="0.01" value="${esc(max)}" placeholder="Sem limite"></label>  <label>Ordenar por<select id="vitrine-sort"><option value="" ${sort===''?'selected':''}>Ordem do catálogo</option><option value="priceAsc" ${sort==='priceAsc'?'selected':''}>Menor preço primeiro</option><option value="priceDesc" ${sort==='priceDesc'?'selected':''}>Maior preço primeiro</option><option value="desc" ${sort==='desc'?'selected':''}>Maior desconto primeiro</option><option value="asc" ${sort==='asc'?'selected':''}>Menor desconto primeiro</option></select></label></div><div id="vitrine-results" class="vitrine-grid">${shown.map(p=>`<article class="vitrine-card">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="offer-placeholder">Sem foto</div>'}<div class="vitrine-card-body"><b>${esc(p.title)}</b><div class="vitrine-price">${brl(p.price)} ${p.oldPrice?`<s class="muted">${brl(p.oldPrice)}</s> <span class="tag ok">${pct(p)}% OFF</span>`:''}</div>${p.category?`<span class="tag">${esc(p.category)}</span>`:''}${p.store?`<span class="tag">${esc(p.store)}</span>`:''}<div class="muted">Projeto: ${esc(proj(p.projectId)?.name||'—')}</div><div class="row"><button class="btn" data-act="copyOffer" data-id="${esc(p.id)}">Copiar informações</button><button class="btn danger" data-act="deleteCatalogProduct" data-id="${esc(p.id)}" title="Excluir este produto do catálogo">Excluir do catálogo</button>${p.url?`<button class="btn ghost" data-act="openProduct" data-id="${esc(p.id)}">Abrir oferta</button>`:''}</div></div></article>`).join('')||'<p class="muted">Nenhum produto corresponde aos filtros.</p>'}</div><div id="vitrine-pagination" class="row vitrine-pagination"><span class="grow muted">Página ${vitrinePage+1} de ${pageCount}</span><button class="btn ghost" data-act="vitrinePage" data-page="-1" ${vitrinePage===0?'disabled':''}>Anterior</button><button class="btn ghost" data-act="vitrinePage" data-page="1" ${vitrinePage>=pageCount-1?'disabled':''}>Próxima</button></div></section>`;
}
function renderVitrineResults() {
  if (!route.startsWith('proj:') || projectTab !== 'vitrine') return;
  const root = $('#root'); if (!root) return;
  const id = route.slice(5), items = P.filter(p=>p.projectId===id);
  const q = window.__vizzionVitrineQuery || '', min=window.__vizzionVitrineMin||'', max=window.__vizzionVitrineMax||'', cat=window.__vizzionVitrineCategory||'', sort=window.__vizzionVitrineSort||'';
  const filtered=items.filter(p=>(!q||strip(p.title).includes(strip(q)))&&(!cat||p.category===cat)&&(min===''||Number(p.price)>=Number(min))&&(max===''||Number(p.price)<=Number(max))).sort((a,b)=>{
    if(sort==='priceAsc'||sort==='priceDesc'){
      const ap=Number.isFinite(Number(a.price))?Number(a.price):null,bp=Number.isFinite(Number(b.price))?Number(b.price):null;
      if(ap===null&&bp===null)return 0;
      if(ap===null)return 1;
      if(bp===null)return -1;
      return sort==='priceAsc'?ap-bp:bp-ap;
    }
    return sort==='desc'?pct(b)-pct(a):sort==='asc'?pct(a)-pct(b):0;
  });
  const pageCount=Math.max(1,Math.ceil(filtered.length/50)); vitrinePage=Math.max(0,Math.min(vitrinePage,pageCount-1));
  const cards=filtered.slice(vitrinePage*50,vitrinePage*50+50);
  const results=$('#vitrine-results'); if(results) results.innerHTML=cards.map(p=>`<article class="vitrine-card">${p.image?`<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="offer-placeholder">Sem foto</div>'}<div class="vitrine-card-body"><b>${esc(p.title)}</b><div class="vitrine-price">${brl(p.price)} ${p.oldPrice?`<s class="muted">${brl(p.oldPrice)}</s> <span class="tag ok">${pct(p)}% OFF</span>`:''}</div>${p.category?`<span class="tag">${esc(p.category)}</span>`:''}${p.store?`<span class="tag">${esc(p.store)}</span>`:''}<div class="muted">Projeto: ${esc(proj(p.projectId)?.name||'—')}</div><div class="row"><button class="btn" data-act="copyOffer" data-id="${esc(p.id)}">Copiar informações</button><button class="btn danger" data-act="deleteCatalogProduct" data-id="${esc(p.id)}" title="Excluir este produto do catálogo">Excluir do catálogo</button>${p.url?`<button class="btn ghost" data-act="openProduct" data-id="${esc(p.id)}">Abrir oferta</button>`:''}</div></div></article>`).join('')||'<p class="muted">Nenhum produto corresponde aos filtros.</p>';
  const pag=$('#vitrine-pagination'); if(pag) pag.innerHTML=`<span class="grow muted">${filtered.length} produto(s) · Página ${vitrinePage+1} de ${pageCount}</span><button class="btn ghost" data-act="vitrinePage" data-page="-1" ${vitrinePage===0?'disabled':''}>Anterior</button><button class="btn ghost" data-act="vitrinePage" data-page="1" ${vitrinePage>=pageCount-1?'disabled':''}>Próxima</button>`;
  decorateVitrineMarketplaceButtons();
}
function renderPubProductResults() {
  const input=$('#pub-product-search'), box=$('#pub-product-results'); if(!input||!box) return;
  const q=strip(input.value.trim());
  if(!q){box.innerHTML='';return;}
  const found=P.filter(p=>(!pub.projectId || !p.projectId || p.projectId===pub.projectId) && strip(p.title||'').includes(q)).slice(0,50);
  const selected = new Set(pub.productIds?.length ? pub.productIds : (pub.productId ? [pub.productId] : []));
  box.innerHTML=found.map(p=>`<button type="button" class="live-result ${selected.has(p.id) ? 'selected' : ''}" data-act="selectPubProduct" data-id="${esc(p.id)}"><span>${selected.has(p.id) ? '✓ ' : ''}${esc(p.title)}</span><small>${brl(p.price)}${p.projectId&&proj(p.projectId)?' · '+esc(proj(p.projectId).name):''}</small></button>`).join('')||'<div class="muted live-empty">Nenhum produto encontrado.</div>';
}
function renderSelectedPublishProducts() {
  const ids = pub.productIds?.length ? pub.productIds : (pub.productId ? [pub.productId] : []);
  if (!ids.length) return '';
  return `<div class="selected-publish-products"><span class="muted">Produtos selecionados (${ids.length}):</span>${ids.map(id => { const p = P.find(x => x.id === id); return p ? `<button type="button" class="tag" data-act="selectPubProduct" data-id="${esc(p.id)}">${esc(p.title)} ×</button>` : ''; }).join('')}</div>`;
}
function refreshPublishProductSelection() {
  const selected = $('#selected-publish-products');
  if (selected) selected.innerHTML = renderSelectedPublishProducts();
  const button = document.querySelector('[data-act="genPostText"]');
  if (button) button.disabled = !(pub.productIds?.length || pub.productId);
  renderPubProductResults();
}


function viewConfig() {
  const f = (k, l, t = 'text', ph = '') => `<label class="row"><span style="width:240px">${l}</span><input class="grow" data-path="s|${k}" data-type="${t}" type="${t}" value="${esc(S.settings[k] ?? '')}" placeholder="${ph}"></label>`;
  return `<h2>Configurações</h2><p class="sub">As chaves Gemini são configuradas dentro de cada projeto e nunca ficam salvas neste navegador.</p>
  <section><h3>Bot e tasks</h3>${f('autoMaxPerHour', 'Limite de respostas automáticas por hora', 'number')}${f('botPhotosMax', 'Fotos de produtos por resposta automática (0 = não enviar)', 'number')}${f('stagesPerDay', 'Etapas por projeto nas tasks do dia', 'number')}</section>
  <section><h3>Catálogo no banco de dados</h3><p class="muted">Apaga todos os produtos da tabela compartilhada no backend e limpa o catálogo deste navegador. Use quando quiser começar do zero após importar planilhas antigas. Essa ação não pode ser desfeita; exporte um backup antes.</p><button class="btn danger" data-act="clearAllCatalogDatabase">Excluir todos os catálogos do banco de dados</button></section>
  <section><h3>Conector MCP</h3><p class="muted">Conecte um servidor MCP local ou remoto para compartilhar contexto e ferramentas com uma IA compatível. O token fica somente neste navegador.</p><div class="grid2">${f('mcpUrl', 'URL do servidor MCP', 'url', 'http://127.0.0.1:8787')}<label class="row"><span style="width:240px">Token MCP</span><input class="grow" data-path="s|mcpToken" type="password" value="${esc(S.settings.mcpToken || '')}" placeholder="Bearer token do servidor"></label></div><textarea id="mcp-context-text" placeholder="Texto de teste para enviar ao MCP" style="min-height:90px"></textarea><div class="row"><button class="btn ghost" data-act="grantMcp">Autorizar conexão</button><button class="btn ghost" data-act="testMcp">Testar conexão</button><button class="btn" data-act="sendMcpContext">Enviar contexto</button></div></section>
  <section><h3>IA Gemini (chat do painel)</h3><p class="muted">Configure a chave da Google AI Studio para a IA responder no canal IA · Migoo do Chat. Fica salva somente neste navegador.</p>${f('geminiKey', 'Chave Gemini', 'password', 'AIza...')}${f('geminiModel', 'Modelo', 'text', 'gemini-3.5-flash-lite')}<div class="row"><button class="btn ghost" data-act="testGeminiKey">Testar chave Gemini</button></div></section>
  <section><h3>Equipe e sincronização</h3><p class="muted">Conexão com o backend Vizzion configurada automaticamente.</p><div class="row"><button class="btn ghost" data-act="pull">Baixar da equipe</button><button class="btn ghost" data-act="push">Enviar para a equipe</button><button class="btn ghost" data-act="logout">Sair da conta</button></div></section>
  <section><h3>Backup</h3><div class="row"><button class="btn ghost" data-act="export">Exportar dados (JSON)</button><input type="file" data-act="import" accept=".json"></div></section>`;
}

function viewChat() {
  const channel = S.chat.channels.find((c) => c.id === routeChat) || S.chat.channels[0];
  const isIA = channel?.type === 'ia';
  const msgs = S.chat.messages.filter((m) => m.channelId === (channel?.id || 'geral')).slice(-100);
  const meName = me?.name || me?.email || 'Você';
  return `<div class="chat-view">
    <div class="chat-sidebar">
      <h3>Canais</h3>
      ${S.chat.channels.map((c) => {
        const active = c.id === (routeChat || 'geral');
        const canDelete = c.id !== 'geral';
        return `<div class="chat-channel-row"><a class="chat-channel ${active ? 'on' : ''}" data-act="chatChannel" data-cid="${esc(c.id)}"><span class="dot"></span><span class="name">${esc(c.name)}</span>${c.type === 'ia' ? '<span class="ia-tag">IA</span>' : ''}</a>${canDelete ? `<button class="chat-del" data-act="chatDelChannel" data-cid="${esc(c.id)}" title="Excluir canal">✕</button>` : ''}</div>`;
      }).join('')}
      <div class="chat-new" data-act="chatNewChannel">+ Novo canal</div>
    </div>
    <div class="chat-main">
      <div class="chat-header">
        <h2>${esc(channel?.name || 'Geral')}${isIA ? ' <span class="ia-tag">IA · Migoo</span>' : ''}</h2>
        <p>${isIA ? 'Converse com a IA via servidor MCP configurado em Configurações.' : 'Mensagens compartilhadas com a equipe.'}</p>
      </div>
      <div class="chat-messages" id="chat-msgs">
        ${msgs.length ? msgs.map((m) => {
          const isMe = m.authorId === me?.id;
          const ai = m.ai ? ' <span class="ia-tag">IA</span>' : '';
          return `<div class="chat-msg ${isMe ? 'me' : ''}"><div class="bubble">${esc(m.text)}${ai}</div><div class="who">${esc(m.authorName || 'Integrante')}${ai}</div><span class="time">${m.createdAt ? new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>`;
        }).join('') : '<div class="chat-empty">Nenhuma mensagem ainda.</div>'}
        <div id="chat-typing" class="chat-typing"></div>
      </div>
      <div class="chat-compose">
        <textarea id="chat-input" class="grow" placeholder="${isIA ? 'Escreva para a IA…' : 'Escreva uma mensagem…'}" rows="1"></textarea>
        <button class="btn" data-act="chatSend">Enviar</button>
        ${isIA ? `<button class="btn chat-btn-ia" data-act="chatAskIA">Perguntar à IA</button>` : ''}
      </div>
    </div>
  </div>`;
}

function render() {
  const y = window.scrollY, root = $('#root');
  if (!AUTH || !me) { root.innerHTML = viewLogin(); return; }
  const views = { hoje: viewHoje, agencia: viewAgencia, usuarios: viewUsuarios, historico: viewHistorico, biblioteca: viewBiblioteca, ferramentas: viewFerramentas, publicar: viewPublicar, atendimento: viewAtendimento, ofertas: viewOfertas, catalogo: viewCatalogo, config: viewConfig, chat: viewChat };
  
  if (route === 'chat' && !S.chat.channels.find((c) => c.id === routeChat)) routeChat = S.chat.channels[0]?.id || 'geral';
  const v = route.startsWith('proj:') ? viewProjeto(route.slice(5)) : route.startsWith('ferramentas:') ? viewFerramentas() : route.startsWith('catalogo:') ? viewCatalogo() : (views[route] || viewHoje)();
  root.innerHTML = sidebar() + `<main>${v}</main>`;
  decorateVitrineMarketplaceButtons();
  if (marketplaceVitrineDialog.open) root.insertAdjacentHTML('beforeend', viewMarketplaceVitrineDialog());
  window.scrollTo(0, y);
}

/* ============================================================
   AÇÕES
   ============================================================ */
const cycle = { todo: 'doing', doing: 'done', done: 'todo' };
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); };
const fillMsg = async (net, text, send = false, expectedChat = '') => {
  const r = await callNet(net, { type: 'CHAT_FILL', text, send, expectedChat });
  if (!r?.ok) throw new Error(r?.error || 'Falha ao preencher');
};
async function mcpJsonRequest(body, sessionId = '') {
  const url = `${String(S.settings.mcpUrl || '').replace(/\/$/, '')}/mcp`;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (S.settings.mcpToken) headers.authorization = `Bearer ${S.settings.mcpToken}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const nextSession = response.headers.get('mcp-session-id') || sessionId;
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP respondeu ${response.status}: ${raw.slice(0, 180)}`);
  if (contentType.includes('text/event-stream')) {
    const dataLine = raw.split(/\r?\n/).find(line => line.startsWith('data:'));
    return { data: dataLine ? JSON.parse(dataLine.slice(5).trim()) : {}, sessionId: nextSession };
  }
  return { data: raw ? JSON.parse(raw) : {}, sessionId: nextSession };
}
async function mcpCallTool(name, argumentsValue) {
  const initialized = await mcpJsonRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'vizzion-panel', version: '1.0.0' } } });
  await mcpJsonRequest({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, initialized.sessionId);
  const result = await mcpJsonRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: argumentsValue } }, initialized.sessionId);
  if (result.data.error) throw new Error(result.data.error.message || 'MCP rejeitou a ferramenta.');
  return result.data.result || result.data;
}

async function askGeminiDirect(text, model, apiKey) {
  const systemInstruction = 'Voce é a assistente de IA do painel Vizzion Centro de Comando. Responda em portugues do Brasil, de forma objetiva e curta.';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = Number(response.status);
    const errorCode = String(result?.error?.status || '').slice(0, 80);
    throw new Error(`Gemini (HTTP ${status}): ${errorCode || 'falha na requisicao.'}`);
  }
  const out = (result?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || '').join('').trim();
  if (!out) throw new Error('A Gemini nao retornou conteúdo.');
  return out;
}

const actions = {
  async setup() { return toast('Use a aba Equipe para cadastrar novos integrantes.'); },
  async refreshTeam() { await refreshTeam(); render(); toast('Lista da equipe atualizada.'); },
  async createTeamMember() {
    const name = ($('#team-name')?.value || '').trim();
    const email = ($('#team-email')?.value || '').trim();
    const password = $('#team-password')?.value || '';
    if (name.length < 2 || !email || password.length < 8) return toast('Preencha nome, e-mail e senha inicial com pelo menos 8 caracteres.');
    const role = isMasterAdmin() ? ($('#team-role')?.value || 'member') : 'member';
    const result = await api('/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, password, role }) });
    await refreshTeam();
    render(); toast(result.message || 'Conta criada com sucesso.');
  },
  async changeTeamRole(el) {
    if (!isMasterAdmin()) return toast('Somente o MASTERADMIN pode alterar papéis.');
    const role = el.value;
    try {
      await api('/team/role', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: el.dataset.id, role }) });
      await refreshTeam(); render(); toast('Papel atualizado.');
    } catch (e) {
      toast(e.message || 'Não foi possível alterar o papel.');
      await refreshTeam(); render();
    }
  },
  async grantLoginBackend() {
    try { const url = ($('#lg-backend')?.value || '').trim(); if (!url) return toast('Cole primeiro a URL do backend.'); const origin = new URL(url).origin; const ok = await chrome.permissions.request({ origins: [origin + '/*'] }); toast(ok ? 'Conexão permitida. Agora você pode entrar.' : 'Permissão de conexão não concedida.'); } catch { toast('URL inválida. Use a URL HTTPS do backend.'); }
  },
  async grantMcp() {
    try {
      const url = String(S.settings.mcpUrl || '').trim();
      if (!url) return toast('Informe a URL do servidor MCP.');
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return toast('Use uma URL HTTP ou HTTPS para o MCP.');
      const origin = parsed.origin;
      const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
      toast(ok ? 'Conexão MCP autorizada.' : 'Permissão MCP não concedida.');
    } catch (error) { toast(`Não foi possível autorizar o MCP: ${error.message || error}`); }
  },
  async testMcp() {
    try {
      const url = String(S.settings.mcpUrl || '').replace(/\/$/, '');
      if (!url) return toast('Informe a URL do servidor MCP.');
      const response = await fetch(`${url}/health`, { headers: S.settings.mcpToken ? { authorization: `Bearer ${S.settings.mcpToken}` } : {} });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || `Servidor respondeu ${response.status}.`);
      toast(`MCP conectado: ${result.service || 'servidor respondeu corretamente'}.`);
    } catch (error) { toast(`MCP indisponível: ${error.message || error}`); }
  },
  async sendMcpContext() {
    const text = String($('#mcp-context-text')?.value || '').trim();
    if (!text) return toast('Digite um texto para enviar ao MCP.');
    try {
      const result = await mcpCallTool('receber_texto', { text });
      const message = result.content?.find(item => item.type === 'text')?.text || 'Contexto enviado ao MCP.';
      toast(message);
    } catch (error) { toast(`Falha ao enviar contexto: ${error.message || error}`); }
  },
  async testGeminiKey() {
    const key = String(S.settings.geminiKey || '').trim();
    if (!key) return toast('Informe a chave Gemini.');
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas com OK.' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast('Chave Gemini válida.');
    } catch (e) { toast(`Chave Gemini inválida: ${e.message || e}`); }
  },
  chatChannel(el) { routeChat = el.dataset.cid; render(); },
  async chatDelChannel(el) {
    const cid = el.dataset.cid; if (!cid || cid === 'geral') return;
    if (!confirm('Excluir este canal? As mensagens serão perdidas.')) return;
    S.chat.channels = S.chat.channels.filter((c) => c.id !== cid);
    S.chat.messages = S.chat.messages.filter((m) => m.channelId !== cid);
    if (routeChat === cid) routeChat = S.chat.channels[0]?.id || 'geral';
    save(); render(); toast('Canal excluído.');
  },
  async chatNewChannel() {
    const name = prompt('Nome do novo canal:', 'Canal'); if (!name || !name.trim()) return;
    S.chat.channels.push({ id: 'ch-' + uid(), name: name.trim() });
    save(); render(); toast('Canal criado.');
  },
  async chatSend() {
    const input = $('#chat-input'); const text = String(input?.value || '').trim();
    if (!text) return;
    const channelId = routeChat || 'geral';
    const channel = S.chat.channels.find((c) => c.id === channelId);
    const now = new Date().toISOString();
    S.chat.messages.push({ id: 'msg-' + uid(), channelId, authorId: me?.id, authorName: me?.name || me?.email || 'Você', text, createdAt: now });
    input.value = ''; save(); render();
    const el = $('#chat-msgs'); if (el) el.scrollTop = el.scrollHeight;
  },
  async chatAskIA() {
    const input = $('#chat-input'); const text = String(input?.value || '').trim();
    if (!text) return toast('Digite uma mensagem para a IA.');
    const channelId = routeChat || 'geral';
    const now = new Date().toISOString();
    S.chat.messages.push({ id: 'msg-' + uid(), channelId, authorId: me?.id, authorName: me?.name || me?.email || 'Você', text, createdAt: now });
    S.chat.messages.push({ id: 'msg-' + uid(), channelId, authorId: 'ia', authorName: 'IA · Migoo', text: '…', createdAt: now, ai: true, typing: true });
    input.value = ''; save(); render();
    const el = $('#chat-msgs'); if (el) el.scrollTop = el.scrollHeight;
    try {
      let resposta;
      const mcpUrl = String(S.settings.mcpUrl || '').trim();
      const geminiKey = String(S.settings.geminiKey || '').trim();
      const geminiModel = String(S.settings.geminiModel || 'gemini-3.5-flash-lite').trim();
      if (mcpUrl) {
        const result = await mcpCallTool('responder_mensagem', { mensagem: text, canal: channelId });
        resposta = result.content?.find(item => item.type === 'text')?.text || 'A IA não retornou uma resposta.';
      } else if (geminiKey) {
        resposta = await askGeminiDirect(text, geminiModel, geminiKey);
      } else {
        throw new Error('Configure a URL do MCP ou a chave Gemini em Configurações.');
      }
      const idx = S.chat.messages.findIndex(m => m.ai && m.typing && m.channelId === channelId);
      if (idx >= 0) { S.chat.messages[idx].text = resposta; delete S.chat.messages[idx].typing; }
      else { S.chat.messages.push({ id: 'msg-' + uid(), channelId, authorId: 'ia', authorName: 'IA · Migoo', text: resposta, createdAt: new Date().toISOString(), ai: true }); }
      save(); render();
      const el2 = $('#chat-msgs'); if (el2) el2.scrollTop = el2.scrollHeight;
    } catch (e) {
      const idx = S.chat.messages.findIndex(m => m.ai && m.typing && m.channelId === channelId);
      if (idx >= 0) { S.chat.messages[idx].text = 'Erro: ' + (e.message || 'IA não respondeu'); delete S.chat.messages[idx].typing; }
      save(); render(); toast('Falha ao consultar a IA: ' + (e.message || e));
    }
  },
  async login() {
    const backend = DEFAULT_BACKEND_URL;
    const email = ($('#lg-email')?.value || '').trim();
    const password = $('#lg-password')?.value || '';
    if (!email || !password) return toast('Preencha e-mail e senha.');
    S.settings.backendUrl = DEFAULT_BACKEND_URL;
    await chrome.storage.local.set({ cc_state: S });
    try { const origin = new URL(backend).origin; const granted = await chrome.permissions.request({ origins: [origin + '/*'] }); if (!granted) return toast('Permita a conexão com o backend para entrar.'); } catch { return toast('Não foi possível autorizar a conexão com o backend.'); }
    let response;
    try {
      const r = await fetch(backend + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      response = await r.json();
      if (!r.ok || !response.session?.access_token) throw new Error(response.error || 'Não foi possível entrar. Confira e-mail e senha.');
    } catch (e) { return toast(e.message || 'Falha de conexão com o backend.'); }
    att.projectId = '';
    AUTH = response.session; me = response.profile;
    await chrome.storage.local.set({ cc_auth: AUTH, cc_profile: me });
    try {
      await refreshTeam();
      me = S.users.find(u => u.id === response.profile.id) || response.profile;
      await chrome.storage.local.set({ cc_profile: me });
      await pullRemote(true); await pullProductsRemote();
      await audit('login', 'session', me.id, { title: 'Entrou na Vizzion' });
    } catch (e) { console.warn('initial sync', e); }
    if (S.lastGen !== today()) generateTasks();
    render();
  },
  async logout() { att.projectId = ''; me = null; AUTH = null; await chrome.storage.local.remove(['cc_auth', 'cc_profile', 'cc_session']); render(); },
  nav(el) { route = el.dataset.r; projectTab = 'identidade'; render(); if (route === 'historico') loadActivity(); },
  async refreshNotificationCounts() { await refreshNotificationCounts(false); },
  projectTab(el) { projectTab = el.dataset.tab; render(); },
  deleteProjectLogo(el) { if (!isAdmin()) return; const p=proj(el.dataset.pid); if(p){p.logo='';save();render();} },

  toggleTask(el) {
    const t = S.tasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (!isAdmin() && t.userId !== me.id) { el.checked = !!t.done; return toast('Você só pode concluir tasks atribuídas a você.'); }
    t.done = el.checked; t.doneAt = el.checked ? Date.now() : null; t.completedBy = el.checked ? me.id : null; t.completedByName = el.checked ? (me.name || me.email) : null;
    if (t.done && t.stageId) {
      const st = stagesOf(t.projectId || 'general').find((s) => s.id === t.stageId);
      if (st && (st.status || 'todo') === 'todo') st.status = 'doing';
    }
    save(); audit(el.checked ? 'task.completed' : 'task.reopened', 'task', t.id, { title: t.title }); render();
  },
  sendGeneralMessage() {
    const input = $('#general-message-input');
    const text = String(input?.value || '').trim();
    if (!text) return toast('Escreva um recado antes de enviar.');
    S.general.messages = Array.isArray(S.general.messages) ? S.general.messages : [];
    S.general.messages.push({ id: uid(), text, authorId: me?.id || '', authorName: me?.name || me?.email || 'Integrante', createdAt: Date.now() });
    S.general.messages = S.general.messages.slice(-100);
    save();
    render();
  },
  genTasks() { const n = generateTasks(); if (n) audit('tasks.generated', 'task', '', { title: `${n} tarefas geradas`, count: n }); toast(n ? `${n} task(s) criada(s).` : 'As tasks de hoje já estavam geradas.'); render(); },

  async projectLogo(el) { if (!isAdmin()) return toast('Somente admins podem alterar a identidade.'); const f = el.files?.[0], p = proj(el.dataset.pid); if (!f || !p) return; if (!f.type.startsWith('image/')) return toast('Escolha uma imagem.'); if (f.size > 2*1024*1024) return toast('Logo deve ter até 2 MB.'); p.logo = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(f); }); save(); render(); },
  async refreshProjectAI(el) {
    try { aiProjectStatus[el.dataset.pid] = await api(`/projects/${encodeURIComponent(el.dataset.pid)}/ai-key`); render(); }
    catch (e) { toast(e.message || 'Não foi possível consultar a IA do projeto.'); }
  },
  async saveProjectAI(el) {
    if (!isAdmin()) return toast('Somente admins podem gerenciar a chave do projeto.');
    const input = document.getElementById(`ai-key-${el.dataset.pid}`);
    const apiKey = input?.value?.trim() || '';
    if (!apiKey) return toast('Informe a chave Gemini.');
    try {
      aiProjectStatus[el.dataset.pid] = await api(`/projects/${encodeURIComponent(el.dataset.pid)}/ai-key`, { method: 'PUT', body: JSON.stringify({ apiKey }) });
      if (input) input.value = '';
      render(); toast('Chave Gemini protegida e salva no projeto.');
    } catch (e) { toast(e.message || 'Não foi possível salvar a chave Gemini.'); }
  },
  async testProjectAI(el) {
    try {
      await api(`/projects/${encodeURIComponent(el.dataset.pid)}/ai-key`, { method: 'POST', body: JSON.stringify({ model: proj(el.dataset.pid)?.aiModel || '' }) });
      aiProjectStatus[el.dataset.pid] = await api(`/projects/${encodeURIComponent(el.dataset.pid)}/ai-key`);
      render(); toast('Conexão Gemini confirmada.');
    } catch (e) { toast(e.message || 'Não foi possível testar a conexão Gemini.'); }
  },
  async removeProjectAI(el) {
    if (!isAdmin() || !confirm('Remover a chave Gemini deste projeto?')) return;
    try {
      await api(`/projects/${encodeURIComponent(el.dataset.pid)}/ai-key`, { method: 'DELETE' });
      aiProjectStatus[el.dataset.pid] = { configured: false };
      render(); toast('Chave Gemini removida.');
    } catch (e) { toast(e.message || 'Não foi possível remover a chave Gemini.'); }
  },
  catProject(el) { catProjectId = el.value; route = 'catalogo'; render(); },
  async uploadTool(el) { if (!isAdmin()) return toast('Somente admins podem enviar ferramentas.'); const p = proj(el.dataset.pid); if (!p) return; p.tools = p.tools || []; for (const f of [...(el.files||[])]) { if (f.size > 3*1024*1024) { toast(`${f.name}: limite de 3 MB por arquivo.`); continue; } const data = await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>resolve('');r.readAsDataURL(f);}); if(data) p.tools.push({id:uid(),name:f.name,size:f.size,type:f.type,data}); } save(); toast('Ferramentas adicionadas.'); render(); },
  downloadTool(el) { const t=proj(el.dataset.pid)?.tools?.[+el.dataset.index]; if(!t) return; const a=document.createElement('a'); a.href=t.data; a.download=t.name; a.click(); },
  replaceTool(el) { const p=proj(el.dataset.pid), idx=+el.dataset.index, f=el.files?.[0], old=p?.tools?.[idx]; if(!isAdmin()||!p||!f||!old) return; if(f.size>3*1024*1024) return toast('Limite de 3 MB por arquivo.'); const r=new FileReader(); r.onload=()=>{p.tools[idx]={...old,name:f.name,size:f.size,type:f.type,data:r.result};save();render();toast('Arquivo substituído.');};r.onerror=()=>toast('Não foi possível ler o arquivo.');r.readAsDataURL(f); },
  deleteTool(el) { const p=proj(el.dataset.pid); if(p?.tools) p.tools.splice(+el.dataset.index,1); save(); render(); },
  async downloadCatalog(el) { if (AUTH?.access_token && base()) { try { await pullProductsRemote(); } catch {} } const pid=el.dataset.pid||''; const rows=pid?P.filter(p=>p.projectId===pid):P; const blob=new Blob([JSON.stringify(rows,null,2)],{type:'application/json;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`catalogo-vizzion-${pid||'geral'}-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Catálogo exportado: ${rows.length} produtos.`); },
  async syncCatalog() { const ok = await pullProductsRemote(); render(); toast(ok ? `Catálogo sincronizado: ${P.length} produtos.` : 'Não foi possível sincronizar. Verifique o backend e a sessão.'); },
  async downloadOriginalCatalog() { try { const j=await api('/catalog-file'); if(!j.url) return toast('Ainda não há uma planilha original salva na nuvem. Importe o arquivo original uma vez para guardá-lo.'); const a=document.createElement('a'); a.href=j.url; a.download=j.name||'catalogo-original'; a.target='_blank'; a.rel='noopener'; a.click(); } catch(e) { toast(e.message || 'Não foi possível baixar a planilha original.'); } },
  async deleteTeamMember(el) { const id=el.dataset.id; const name=el.dataset.name||'integrante'; if(!id || id===me?.id) return toast('Não é possível excluir a própria conta por aqui.'); if(!confirm(`Excluir a conta de ${name}? A pessoa perderá acesso à Vizzion. Essa ação não pode ser desfeita.`)) return; await api('/team/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}); await refreshTeam(); render(); toast(`Conta de ${name} excluída.`); },
  deleteLibraryPost(el) { const id=el.dataset.id; const idx=S.postsLog.findIndex(x=>String(x.id||'')===String(id)); if(idx<0) return toast('Não foi possível identificar este post. Atualize a biblioteca e tente novamente.'); if(!confirm('Excluir esta publicação do histórico da biblioteca?')) return; S.postsLog.splice(idx,1); save(); audit('post.deleted','post',id,{title:'Publicação removida da biblioteca'}); render(); toast('Publicação removida da biblioteca.'); },
  async submitPublish() { if(pub.postNow) return actions.runPublish(); const nets=POST_NETS.filter(n=>n==='facebook'?pub.nets.facebook:pub.nets[n]); if(!nets.length) return toast('Escolha ao menos uma rede.'); if(!pub.text.trim()&&!pub.file&&!pub.productImages&&!(pub.facebookDestinations.marketplace&&pub.productIds.length)) return toast('Escreva o texto, escolha um arquivo ou selecione um produto.'); const date=String(pub.scheduleDate||''),time=String(pub.scheduleTime||''); if(!date||!time) return toast('Informe data e horário.'); const runAt=new Date(`${date}T${time}:00`).getTime(); if(!Number.isFinite(runAt)||runAt<=Date.now()) return toast('Escolha um horário futuro.'); let fileData=null,fileName='',fileType=''; if(pub.file){fileData=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(pub.file);});fileName=pub.file.name;fileType=pub.file.type;} S.scheduledPosts=S.scheduledPosts||[]; S.scheduledPosts.push({id:uid(),runAt,createdAt:Date.now(),status:'agendada',projectId:pub.projectId,nets,text:pub.text,title:pub.title,productId:pub.productId,productIds:pub.productIds,productImages:!!pub.productImages,facebookDestinations:pub.facebookDestinations,marketplaceLocation:pub.marketplaceLocation,marketplaceGroups:pub.marketplaceGroups,marketplaceDelivery:pub.marketplaceDelivery,mediaType:pub.productImages?'photo':pub.mediaType,autoPost:!!pub.autoPost,fileData,fileName,fileType,createdBy:me?.id||''});save(false);render();toast('Publicação salva na fila. Mantenha o painel, o Chrome e as sessões abertos.'); },
  cancelScheduled(el) { S.scheduledPosts=(S.scheduledPosts||[]).filter(q=>q.id!==el.dataset.id);save(false);render();toast('Agendamento cancelado.'); },
  addStage(el) {
    if (!isAdmin()) return toast('Somente admins podem criar tarefas.');
    const i = $('#newstage-' + el.dataset.scope), v = i.value.trim();
    if (!v) return;
    const list = stagesOf(el.dataset.scope);
    const stage = { id: uid(), title: v, status: 'todo' }; list.push(stage);
    save(); audit('task.created', 'stage', stage.id, { title: stage.title }); render();
  },
  delStage(el) { const l = stagesOf(el.dataset.scope); const i = l.findIndex((s) => s.id === el.dataset.id); if (i >= 0) l.splice(i, 1); save(); render(); },
  cycleStage(el) { const s = stagesOf(el.dataset.scope).find((x) => x.id === el.dataset.id); if (s) s.status = cycle[s.status || 'todo']; save(); render(); },
  setUrgency(el) { const s = stagesOf(el.dataset.scope).find(x=>x.id===el.dataset.id); if(s) s.urgency=el.value; save(); render(); },
  renameStage(el) {
    const s = stagesOf(el.dataset.scope).find((x) => x.id === el.dataset.id);
    const v = s && prompt('Renomear etapa:', s.title);
    if (v && v.trim()) { s.title = v.trim(); save(); render(); }
  },

  newProject() {
    if (!isAdmin()) return toast('Somente admins podem criar projetos.');
    const name = $('#np-name').value.trim();
    if (!name) return toast('Dê um nome ao projeto.');
    const p = { id: uid(), name, bio: '', logo: '', dailyPosts: 3, tasksPerDay: 2, memberIds: [me.id], stages: [], accounts: [], tools: [], bot: {} };
    S.projects.push(p); save(); audit('project.created', 'project', p.id, { title: p.name }); route = 'proj:' + p.id; render();
  },
  delProject(el) {
    const p = proj(el.dataset.id);
    if (!p || !confirm(`Excluir o projeto "${p.name}" e suas tasks?`)) return;
    S.projects = S.projects.filter((x) => x.id !== p.id);
    S.tasks = S.tasks.filter((t) => t.projectId !== p.id);
    save(); audit('project.deleted', 'project', p.id, { title: p.name }); render();
  },
  toggleMember(el) {
    if (!isMasterAdmin()) return toast('Somente o MASTERADMIN pode alterar os integrantes dos projetos.');
    const p = proj(el.dataset.pid); p.memberIds = p.memberIds || [];
    const i = p.memberIds.indexOf(el.dataset.uid);
    if (el.checked && i < 0) p.memberIds.push(el.dataset.uid);
    if (!el.checked && i >= 0) p.memberIds.splice(i, 1);
    save();
  },
  addAccount(el) {
    const p = proj(el.dataset.pid), label = $('#ac-label').value.trim();
    if (!label) return toast('Dê um nome à conta.');
    (p.accounts = p.accounts || []).push({ id: uid(), type: $('#ac-type').value, label, items: '' });
    save(); render();
  },
  saveAccount(el) {
    const a = proj(el.dataset.pid).accounts.find((x) => x.id === el.dataset.id);
    a.label = $('#acl-' + a.id).value; a.items = $('#aci-' + a.id).value;
    save(); toast('Conta salva.');
  },
  delAccount(el) { const p = proj(el.dataset.pid); p.accounts = p.accounts.filter((x) => x.id !== el.dataset.id); save(); render(); },
  addUser() {
    if (!isAdmin()) return toast('Acesso exclusivo para admins.');
    const name = $('#nu-name').value.trim();
    if (!name) return;
    S.users.push({ id: uid(), name, role: $('#nu-role').value, pin: $('#nu-pin').value });
    save(); render();
  },
  delUser(el) {
    const u = user(el.dataset.id);
    if (!u || !confirm(`Remover ${u.name}?`)) return;
    S.users = S.users.filter((x) => x.id !== u.id);
    S.projects.forEach((p) => (p.memberIds = (p.memberIds || []).filter((i) => i !== u.id)));
    S.tasks.forEach((t) => { if (t.userId === u.id) t.userId = null; });
    save(); render();
  },

  selectPubProduct(el) {
    const p = P.find(x => x.id === el.dataset.id);
    if (!p) return;
    const ids = Array.isArray(pub.productIds) ? pub.productIds : (pub.productId ? [pub.productId] : []);
    const i = ids.indexOf(p.id);
    if (i >= 0) ids.splice(i, 1); else ids.push(p.id);
    pub.productIds = ids;
    pub.productId = ids[0] || '';
    const input = $('#pub-product-search'); if (input) input.value = '';
    refreshPublishProductSelection();
  },
  vitrinePage(el) { vitrinePage=Math.max(0,vitrinePage+(Number(el.dataset.page)||0)); renderVitrineResults(); },
  async deleteCatalogProduct(el) { const product=P.find(x=>String(x.id)===String(el.dataset.id)); if(!product) return toast('Produto não encontrado no catálogo.'); if(!confirm(`Excluir \"${product.title}\" do catálogo? Ele deixará de aparecer nas ofertas e na vitrine deste painel.`)) return; P=P.filter(x=>String(x.id)!==String(product.id)); await saveProducts(); audit('product.deleted','product',product.id,{title:product.title,projectId:product.projectId}); vitrinePage=0; render(); toast('Produto excluído do catálogo.'); },
  openMarketplaceVitrine(el) {
    const product = P.find(x => String(x.id) === String(el.dataset.id));
    if (!product) return toast('Produto não encontrado no catálogo.');
    if (!product.image) return toast('Este produto não possui imagem principal para publicar no Marketplace.');
    Object.assign(marketplaceVitrineDialog, { open: true, productId: product.id, marketplaceLocation: pub.marketplaceLocation || 'Seropédica - Rio de Janeiro', postNow: true, scheduleDate: today(), scheduleTime: '12:00', busy: false });
    render();
  },
  closeMarketplaceVitrine() {
    if (!marketplaceVitrineDialog.busy) { marketplaceVitrineDialog.open = false; render(); }
  },
  async confirmMarketplaceVitrine() {
    if (marketplaceVitrineDialog.busy) return;
    const product = P.find(x => String(x.id) === String(marketplaceVitrineDialog.productId));
    if (!product) return toast('Produto não encontrado no catálogo.');
    if (!product.image) return toast('Este produto não possui imagem principal para publicar no Marketplace.');
    if (!marketplaceVitrineDialog.postNow) {
      const runAt = new Date(`${marketplaceVitrineDialog.scheduleDate}T${marketplaceVitrineDialog.scheduleTime}:00`).getTime();
      if (!Number.isFinite(runAt) || runAt <= Date.now()) return toast('Escolha um dia e horário futuros.');
    }
    marketplaceVitrineDialog.busy = true;
    render();
    try {
      pub.projectId = product.projectId || '';
      pub.nets = { facebook: true };
      pub.facebookDestinations = { feed: false, marketplace: true };
      pub.file = null;
      pub.productImages = false;
      pub.mediaType = 'photo';
      pub.productId = product.id;
      pub.productIds = [product.id];
      pub.marketplaceLocation = marketplaceVitrineDialog.marketplaceLocation.trim() || 'Seropédica - Rio de Janeiro';
      pub.autoPost = true;
      pub.postNow = marketplaceVitrineDialog.postNow;
      pub.scheduleDate = marketplaceVitrineDialog.scheduleDate;
      pub.scheduleTime = marketplaceVitrineDialog.scheduleTime;
      await actions.genPostText();
      if (marketplaceVitrineDialog.postNow) await actions.runPublish();
      else await actions.submitPublish();
      marketplaceVitrineDialog.open = false;
      toast(marketplaceVitrineDialog.postNow ? 'Publicação do Marketplace iniciada.' : 'Publicação adicionada à fila da aba Publicar.');
    } catch (e) {
      toast(e.message || 'Não foi possível preparar a publicação do Marketplace.');
    } finally {
      marketplaceVitrineDialog.busy = false;
      render();
    }
  },
  openProduct(el) { const p=P.find(x=>x.id===el.dataset.id); if(p?.url) chrome.tabs.create({url:p.url,active:true}); },
  copyOffer(el) {
    const p = P.find((x) => x.id === el.dataset.id);
    if (p) { const text=`${offerBlock(p)}\n\n_Link de afiliado • preço e estoque podem mudar._`; navigator.clipboard.writeText(text).then(() => toast('Texto e link de afiliado copiados.')).catch(() => toast('Não foi possível copiar. Verifique a permissão da área de transferência.')); }
  },
  async genInsights() {
    insightsBusy = true; render();
    const top = offers(8); let items;
    try {
      const t = await ai('Você é estrategista de conteúdo para afiliados no Brasil. Responda SOMENTE JSON: [{"produto":"","ideia":"","formato":"","gancho":""}] com 5 ideias de post para Instagram, TikTok, YouTube Shorts ou Facebook ligadas aos produtos. Não invente preços.',
        JSON.stringify(top.map((p) => ({ titulo: p.title, preco: p.price, desconto: pct(p), categoria: p.category }))), 900, top[0]?.projectId || myProjects()[0]?.id);
      items = parseJSON(t);
    } catch (e) {
      items = top.slice(0, 5).map((p) => ({ produto: p.title, ideia: 'Mostre o produto em uso e termine com o preço atual (' + brl(p.price) + ').', formato: 'Reels ou TikTok de 15s', gancho: 'Achei isso por ' + brl(p.price) + '…' }));
      toast('A IA falhou; mostrando sugestões básicas.');
    }
    S.insights = { date: today(), items }; insightsBusy = false; save(false); render();
  },

  pickFile(el) { pub.file = el.files[0] || null; pub.productImages = false; if(pub.file) pub.mediaType = pub.file.type.startsWith('image/') ? 'photo' : 'video'; render(); },
  mediaType(el) { pub.mediaType = el.dataset.type; pub.file = null; pub.productImages = false; pub.nets = {}; render(); },
  productImagesMode() { pub.productImages = !pub.productImages; if(pub.productImages){pub.file=null;pub.mediaType='photo';pub.nets.youtube=false;} render(); },
  pubFacebookDestination(el) { const destination = el.dataset.destination || 'feed'; pub.facebookDestinations[destination] = el.checked; pub.nets.facebook = Object.values(pub.facebookDestinations).some(Boolean); if (destination === 'marketplace' && el.checked) { pub.productImages = false; pub.file = null; pub.mediaType = 'photo'; } render(); },
  pubNet(el) { pub.nets[el.dataset.net] = el.checked; },
  pubNetButton(el) { const n=el.dataset.net; if(!pub.productImages && pub.mediaType==='photo' && n==='youtube') return toast('YouTube não aceita imagem neste fluxo. Escolha outra rede ou Vídeo.'); pub.nets[n]=!pub.nets[n]; render(); },
  async testAI() { try { const result = await ai('Responda apenas com: conexão funcionando.', 'Teste de conexão da Vizzion.', 40, myProjects()[0]?.id); toast('IA respondeu: ' + result.slice(0,100)); } catch(e) { toast('Falha no teste da IA: ' + String(e.message||e).slice(0,180)); } },
  async genPostText() {
    const ids = pub.productIds?.length ? pub.productIds : (pub.productId ? [pub.productId] : []);
    const products = ids.map(id => P.find(x => x.id === id)).filter(Boolean);
    if (!products.length) return toast('Pesquise e selecione ao menos um produto pelo nome.');
    let t;
    try {
      t = await ai('Você escreve somente a legenda final para redes sociais de afiliados, em português do Brasil: gancho na primeira linha, 2 a 3 linhas de benefício, 3 a 5 hashtags. Não invente preço, desconto ou características que não estejam nos dados. Nunca escreva rótulos como "Produto 1", "Produto 2", "Preço", "Categoria" ou explique os dados recebidos. Retorne apenas o texto pronto para publicar, sem markdown de instrução e sem links; os links serão adicionados pelo sistema.',
        products.map((p, i) => `Produto ${i + 1}: ${p.title}\nPreço: ${brl(p.price)}${p.oldPrice ? ' (de ' + brl(p.oldPrice) + ')' : ''}\nCategoria: ${p.category || ''}\nLink: ${p.url || ''}`).join('\n\n'), 700, pub.projectId || products[0].projectId);
      t = t.split(/\r?\n/).filter(line => {
        const value = line.replace(/^Q+\s*/i, '').replace(/[*_`]/g, '').trim();
        return value && !/^(?:produto\s*\d*\s*:|pre[cç]o\s*:|categoria\s*:|link\s*:)/i.test(value) && !/^https?:\/\/\S+$/i.test(value);
      }).join('\n').trim();
      t += `\n\n${products.map(p => `👉 ${p.url || ''}`).join('\n')}\n_Link de afiliado • preço pode mudar._`;
    } catch (e) { t = products.map(offerBlock).join('\n\n'); toast('IA indisponível; usei o texto padrão.'); }
    pub.text = t; render();
  },
  async runPublish() {
    const targets = POST_NETS.flatMap((n) => n === 'facebook'
      ? Object.entries(pub.facebookDestinations).filter(([, selected]) => selected).map(([destination]) => ({ n, destination }))
      : pub.nets[n] ? [{ n, destination: 'feed' }] : []);
    const nets = targets.map((target) => target.n);
    if (!nets.length) return toast('Escolha ao menos uma rede.');
    const facebookMarketplace = pub.facebookDestinations.marketplace;
    if (!pub.text.trim() && !pub.file && !pub.productImages && !(facebookMarketplace && pub.productIds.length)) return toast('Escreva o texto, escolha um arquivo ou selecione um produto.');
    let productFiles = [];
    let related = [];
    if (pub.productImages) {
      const projectProducts = P.filter(p => p.image && (!p.projectId || !pub.projectId || p.projectId === pub.projectId));
      const normalize = v => strip(String(v || '')).replace(/[^a-z0-9]+/g, ' ').trim();
      const body = normalize(pub.text);
      const stop = new Set(['com','para','por','uma','uns','das','dos','que','the','and','com','sem','mais','novo','nova','oferta','produto','produtos','barato','barata']);
      related = projectProducts.map(p => {
        const title = normalize(p.title); if (!title) return false;
        if (body.includes(title) || (title.length >= 18 && body.includes(title.slice(0, 25)))) return { p, score: 100 };
        const tokens = [...new Set(title.split(' ').filter(w => w.length >= 3 && !stop.has(w)))];
        if (tokens.length < 3) return { p, score: 0 };
        const hits = tokens.filter(w => body.split(' ').includes(w)).length;
        return { p, score: hits >= Math.max(3, Math.ceil(tokens.length * 0.6)) ? hits / tokens.length : 0 };
      }).filter(Boolean).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map(x => x.p);
      if (!related.length) return toast('Não encontrei no catálogo produtos mencionados no corpo do texto. Confira os nomes ou desative Imagem do produto.');
      productFiles = await productMediaFilesFor(related, related.map(p => p.title).join(' | '), related.length);
      if (!productFiles.length) return toast('Encontrei produtos mencionados, mas não consegui baixar suas mídias.');
      toast(`${productFiles.length} mídia(s) de produto encontrada(s) para anexar.`);
    }
    pub.status = {};
    for (const { n, destination } of targets) {
      const statusKey = `${n}:${destination}`;
      pub.status[statusKey] = { s: 'run', m: 'abrindo…' }; render();
      try {
        if (pub.productImages && n === 'youtube' && !productFiles.some(item => item.type === 'video')) throw new Error('YouTube exige um vídeo no catálogo do produto.');
        const mediaType = pub.productImages ? (n === 'youtube' || n === 'tiktok' && productFiles.some(item => item.type === 'video') ? 'video' : 'photo') : pub.mediaType;
        const marketplaceProduct = destination === 'marketplace'
          ? (pub.productIds.map(id => P.find(p => String(p.id) === String(id))).find(Boolean) || related[0] || null)
          : null;
        if (destination === 'marketplace' && !marketplaceProduct) throw new Error('Selecione ou mencione um produto do catálogo para criar o classificado.');
        if (destination === 'marketplace') {
          productFiles = await productMediaFilesFor(
            [marketplaceProduct],
            marketplaceProduct.title || '',
            1,
            { primaryImageOnly: true }
          );
          if (!productFiles.some(item => item.type === 'image')) {
            throw new Error('O produto selecionado não possui imagem principal na coluna image do catálogo.');
          }
        }
        const t = await getNetTab(n, { navigate: true, mediaType, destination });
        pub.status[statusKey].m = 'enviando…'; render();
        const filesToSend = pub.productImages
          ? n === 'youtube' ? productFiles.filter(item => item.type === 'video').map(item => item.file).slice(0, 1)
            : n === 'tiktok' ? (productFiles.some(item => item.type === 'video') ? productFiles.filter(item => item.type === 'video').map(item => item.file).slice(0, 1) : productFiles.filter(item => item.type === 'image').map(item => item.file))
            : productFiles.map(item => item.file)
          : destination === 'marketplace' ? productFiles.filter(item => item.type === 'image').map(item => item.file).slice(0, 10)
            : (pub.file ? [pub.file] : []);
        const fileIds = [];
        for (const file of filesToSend) fileIds.push(await sendFile(t.id, n, file));
        const title = n === 'tiktok' ? String(pub.title || '').trim() : '';
        const body = String(pub.text || '').trim();
        const duplicateTitle = title && new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\r?\\n)+`, 'i').test(body);
        const networkText = n === 'tiktok'
          ? duplicateTitle ? body : [title, body].filter(Boolean).join('\n\n')
          : pub.text;
        const r = await sendToTab(t.id, n, { type: 'POST_FILL', fileIds, text: networkText, title: n === 'tiktok' ? pub.title : '', autoPost: !!pub.autoPost, mediaType, destination, marketplaceProduct, marketplaceLocation: pub.marketplaceLocation, marketplaceGroups: Math.max(0, Math.min(10, Number(pub.marketplaceGroups) || 0)), marketplaceDelivery: !!pub.marketplaceDelivery });
        if (!r?.ok) throw new Error(r?.error || 'sem resposta da aba');
        pub.status[statusKey] = { s: 'ok', m: pub.autoPost ? 'comando de publicação automática executado; confirme na plataforma' : 'pronto na aba — revise e publique' };
      } catch (e) { pub.status[statusKey] = { s: 'err', m: String(e.message || e).slice(0, 90) }; }
      render();
    }
  },
  async markPublished() {
    const nets = Object.keys(pub.status).filter((n) => pub.status[n].s === 'ok');
    if (!nets.length) return toast('Nenhuma rede foi preparada com sucesso.');
    let mediaData = ''; if (pub.file && pub.file.type.startsWith('image/') && pub.file.size <= 2 * 1024 * 1024) mediaData = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result||'')); r.onerror = () => resolve(''); r.readAsDataURL(pub.file); });
    S.postsLog.push({ id: uid(), date: today(), projectId: pub.projectId, userId: me.id, nets, text: (pub.text || '').slice(0, 120), fullText: pub.text || '', title: pub.title || '', fileName: pub.file?.name || '', image: mediaData, ts: Date.now() });
    if (pub.projectId) syncPostTasks(pub.projectId);
    Object.assign(pub, { status: {}, text: '', title: '', file: null, productImages: false, nets: {}, productId: '', productIds: [], facebookDestinations: { feed: false, marketplace: false } });
    save(); audit('post.recorded', 'post', S.postsLog[S.postsLog.length - 1]?.id, { title: pub.title || pub.text?.slice(0, 80) || 'Publicação registrada', projectId: pub.projectId, networks: nets }); toast('Post registrado.'); render();
  },

  async attCheck() {
    try { const r = await callNet(att.net, { type: 'CHAT_STATUS' }); att.tabOk = !!r?.ok; att.chat = r?.chat || ''; }
    catch (e) { att.tabOk = false; toast(e.message); }
    render();
  },
  async attRead() {
    const r = await callNet(att.net, { type: 'CHAT_READ' });
    if (!r?.ok) throw new Error(r?.error || 'Falha ao ler a conversa.');
    const messages = r.messages || [];
    toast('Lendo mensagens do chat…');
    Object.assign(att, { history: messages, chat: r.chat, group: r.group, tabOk: true });
    if (!messages.length) toast('Não encontrei mensagens no chat aberto. Verifique se a conversa carregou no WhatsApp Web.');
    render();
  },
  async attGen() {
    await actions.attRead();
    const last = [...att.history].reverse().find((m) => m.dir === 'in');
    if (!last) return toast('Nenhuma mensagem do cliente nesta conversa.');
    toast('Gerando resposta…');
    const project = ensureAttProject();
    if (!project) return toast('Nenhum projeto autorizado está disponível para o atendimento.');
    const r = await botReply({ project, history: histStr(att.history), customerMsg: last.text });
    att.draft = r.text; att.human = r.human; render();
  },
  async attFill() { await fillMsg(att.net, att.draft); toast('Texto no campo. Revise e aperte Enter.'); },
  async attFillSend() {
    if (!att.draft.trim()) return;
    if (!confirm('Enviar esta mensagem agora para a conversa aberta?')) return;
    await fillMsg(att.net, att.draft, true); toast('Mensagem enviada.');
  },
  async attWatch() {
    const on = !att.watching;
    if (on && !ensureAttProject()) return toast('Nenhum projeto autorizado está disponível para iniciar o atendimento.');
    att.mode = 'auto';
    att.watching = on;
    render();
    try {
      const r = await callNet(att.net, { type: 'CHAT_WATCH', on });
      if (!r?.ok) throw new Error(r?.error || 'Não consegui ligar o monitor. Confira se a aba da rede está aberta e conectada.');
      toast(on ? 'Atendimento automático ligado.' : 'Atendimento automático desligado.');
    } catch (e) {
      att.watching = !on;
      render();
      throw e;
    }
  },
  async attSim() {
    if (!att.sim.trim()) return;
    toast('Gerando…');
    const project = ensureAttProject();
    if (!project) return toast('Nenhum projeto autorizado está disponível para o atendimento.');
    const r = await botReply({ project, history: '', customerMsg: att.sim });
    att.simOut = r.text + (r.human ? '\n\n[🔔 Encaminharia para humano]' : ''); render();
  },

  async attFinish() {
    const chat = String(att.chat || '').trim();
    if (!chat || att.group) { att.watching = false; render(); return toast('Atendimento finalizado. A lista de transmissão é destinada a conversas individuais.'); }
    att.watching = false;
    if (confirm(`Atendimento de "${chat}" finalizado. A pessoa aceitou participar da lista de transmissão do WhatsApp?`)) {
      const p = proj(att.projectId);
      const account = (p?.accounts||[]).find(a=>a.type==='whatsapp');
      if (!account) return toast('Atendimento finalizado, mas o projeto não tem uma conta WhatsApp cadastrada para a lista.');
      const old = String(account.items||'').split('\n').map(x=>x.trim()).filter(Boolean);
      const key = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      if (!old.some(x=>key(x)===key(chat))) { account.items = [...old, chat].join('\n'); save(); await audit('broadcast.consent','contact',chat,{projectId:att.projectId,network:'whatsapp',consent:true}); toast(`"${chat}" foi adicionado à lista de envios do WhatsApp.`); }
      else toast(`"${chat}" já está na lista; não foi duplicado.`);
    } else toast('Atendimento finalizado sem adicionar à lista de transmissão.');
    render();
  },
  offAddProduct(el) {
    const p=P.find(x=>x.id===el.dataset.id); if(!p) return;
    off.selectedProducts = Array.isArray(off.selectedProducts) ? off.selectedProducts : [];
    const i=off.selectedProducts.findIndex(x=>x.id===p.id);
    if(i>=0) off.selectedProducts.splice(i,1);
    else off.selectedProducts.push({id:p.id,projectId:p.projectId,title:p.title,price:p.price,oldPrice:p.oldPrice||'',url:p.url||'',image:p.image||'',store:p.store||''});
    render();
  },
  offSelectAll() { const gs=groupsFor(proj(off.projectId),off.net); off.recipientSel = off.recipientSel.length===gs.length ? [] : [...gs]; off.selectAll=off.recipientSel.length===gs.length; render(); },
  offRecipientToggle(el) { const g=groupsFor(proj(off.projectId),off.net)[+el.dataset.g]; if(!g)return; const set=new Set(off.recipientSel||[]); el.checked?set.add(g):set.delete(g); off.recipientSel=[...set]; off.selectAll=off.recipientSel.length===groupsFor(proj(off.projectId),off.net).length; },
  offPause() { off.paused=!off.paused; render(); toast(off.paused?'Fila pausada.':'Fila retomada.'); },
  offCancelQueue(el) { const q=(S.offerSendQueue||[]).find(x=>x.id===el.dataset.id); if(q&&['pendente','erro'].includes(q.status)){q.status='cancelado';save(false);render();} },
  offRetry(el) { const q=(S.offerSendQueue||[]).find(x=>x.id===el.dataset.id); if(q&&['erro','pendente'].includes(q.status)){if(/incerto|confira a conversa|não foi confirmad/i.test(q.error||'')){if(!confirm('Este envio pode ter sido realizado. Confira a conversa no WhatsApp/Telegram. Clique OK somente se confirmou que o item incerto NÃO foi enviado; caso já tenha sido enviado, cancele a fila para evitar duplicação.'))return;for(const k of Object.keys(q.productProgress||{}))if(q.productProgress[k]==='incerto')q.productProgress[k]='pendente';if(q.error&&/mensagem|texto/i.test(q.error))q.introSent=false;}q.status='pendente';q.error='';q.runAt=Math.min(q.runAt||Date.now(),Date.now());save(false);render();} },
  async offGenerateMessage() {
    const products = (off.selectedProducts || []).filter(p => p && p.title);
    if (!products.length) return toast('Selecione pelo menos um produto antes de gerar a mensagem.');
    const button = document.querySelector('[data-act="offGenerateMessage"]');
    if (button) { button.disabled = true; button.textContent = 'Gerando mensagem…'; }
    try {
      const list = products.map((p, i) => `${i + 1}. ${p.title} | preço: ${brl(p.price)}${p.oldPrice ? ` | preço anterior: ${brl(p.oldPrice)}` : ''}${p.store ? ` | loja: ${p.store}` : ''}`).join('\n');
      const generated = await ai(
        'Você é redator de ofertas para grupos brasileiros de WhatsApp/Telegram. Escreva uma única mensagem introdutória curta, natural e atraente em português brasileiro, com 1 a 3 frases e emojis moderados. Use apenas os produtos fornecidos, não invente descontos, urgência, estoque ou características. Não repita links nem liste todos os preços, pois cada produto será enviado separadamente depois. Retorne somente o texto da mensagem.',
        `Crie uma mensagem adicional para acompanhar estes produtos selecionados:\n${list}\n\nProjeto/marca: ${proj(off.projectId)?.bot?.brand || proj(off.projectId)?.name || 'loja de achadinhos'}. Rede: ${NETS[off.net]?.name || off.net}.`, 260, off.projectId);
      if (!generated) throw new Error('A IA não retornou uma mensagem.');
      off.message = generated.trim();
      const textarea = document.querySelector('#off-message');
      if (textarea) textarea.value = off.message;
      toast('Mensagem gerada. Revise o texto antes de adicionar à fila.');
    } catch (e) { toast(`Não foi possível gerar a mensagem: ${e.message || e}`); }
    finally { const b = document.querySelector('[data-act="offGenerateMessage"]'); if (b) { b.disabled = !(off.selectedProducts || []).length; b.textContent = '✨ Gerar mensagem com IA a partir dos produtos selecionados'; } }
  },
  async clearAllCatalogDatabase() {
    if (!isAdmin()) return toast('Entre com uma conta autorizada para limpar o catálogo compartilhado.');
    if (!AUTH?.access_token || !base()) return toast('Faça login na Vizzion antes de excluir os produtos do banco de dados.');
    const typed = prompt('Esta ação apagará TODOS os produtos compartilhados no banco de dados e neste navegador. Para confirmar, digite APAGAR CATALOGO:');
    if (typed !== 'APAGAR CATALOGO') return toast('Operação cancelada.');
    try {
      await api('/products', { method: 'DELETE' });
      clearTimeout(productPushT);
      P = []; IDX.clear();
      await chrome.storage.local.set({ cc_products: [] });
      audit('catalog.cleared', 'catalog', 'all', { title: 'Todos os produtos do catálogo foram apagados' });
      render();
      toast('Catálogo compartilhado e catálogo local apagados. Importe apenas a planilha correta para recomeçar.');
    } catch (e) { toast(`Não foi possível limpar o banco de dados: ${e.message || e}. O catálogo local foi preservado.`); }
  },
  async offQueueSelected() {
    const targets=off.recipientSel||[]; const message=String(off.message||'').trim();
    const products=(off.selectedProducts||[]).map(p=>({...p}));
    if(!targets.length)return toast('Selecione ao menos um destinatário.');
    if(!message&&!products.length)return toast('Escreva uma mensagem ou selecione pelo menos um produto.');
    let runAt=Date.now();
    if(off.sendNow===false){const dt=new Date(`${off.scheduleDate||today()}T${off.scheduleTime||'12:00'}:00`);if(Number.isNaN(dt.getTime())||dt.getTime()<=Date.now())return toast('Escolha uma data e horário futuros.');runAt=dt.getTime();}
    const batch=uid(); const now=Date.now();
    S.offerSendQueue=S.offerSendQueue||[];
    for(const target of targets){S.offerSendQueue.push({id:uid(),batch,projectId:off.projectId,net:off.net,target,message,products,productProgress:{},introSent:false,runAt,createdAt:now,status:'pendente',attempts:0});}
    save(false); toast(`${targets.length} envio(s) adicionado(s) à fila${products.length?` com ${products.length} produto(s) cada`:''}.`); render();
  },
  offToggle(el) { el.checked ? off.sel.add(el.dataset.id) : off.sel.delete(el.dataset.id); },
  async offGen() {
    const items = P.filter((p) => off.sel.has(p.id));
    if (!items.length) return toast('Marque ao menos uma oferta.');
    const groups = groupsFor(proj(off.projectId), off.net);
    const k = Math.max(1, Math.min(5, groups.length || 3));
    off.busy = true; render();
    let pairs = [];
    try {
      pairs = parseJSON(await ai('Você escreve textos curtos de ofertas para grupos de WhatsApp/Telegram em português do Brasil. Responda SOMENTE JSON: [{"intro":"","outro":""}]. intro = 1 linha com emoji; outro = 1 linha de chamada. Cada variação deve usar palavras bem diferentes. Não cite preços nem links.',
        `Gere ${k} variações para: ${items.map((p) => p.title).join(' | ')}`, 700, off.projectId));
    } catch (e) { toast('IA indisponível; usando modelos padrão.'); }
    if (!pairs.length) pairs = [
      { intro: '🔥 Ofertas imperdíveis de hoje!', outro: 'Corre que o estoque acaba rápido!' },
      { intro: '🛍️ Achadinhos selecionados pra você', outro: 'Aproveite enquanto está nesse preço!' },
      { intro: '⚡ Promoção relâmpago no ar', outro: 'Garanta o seu antes que mude!' },
    ];
    off.vars = Array.from({ length: k }, (_, i) => {
      const pr = pairs[i % pairs.length];
      const ord = i % 2 ? [...items].reverse() : items;
      return `${pr.intro}\n\n${ord.map(offerBlock).join('\n\n')}\n\n${pr.outro}\n_Link de afiliado • preços e estoque podem mudar._`;
    });
    off.busy = false; render();
  },
  async offOpen(el) {
    const i = +el.dataset.g, g = groupsFor(proj(off.projectId), off.net)[i], text = off.vars[i % (off.vars.length || 1)];
    if (!text) return toast('Gere as variações primeiro.');
    if (!g) return toast('Grupo não encontrado na lista do projeto.');
    if (!confirm(`Abrir o grupo "${g}" e enviar a mensagem de oferta agora?`)) return;
    const r = await callNet(off.net, { type: 'CHAT_OPEN', name: g });
    if (!r?.ok) { try { await navigator.clipboard.writeText(text); } catch (_) {} return toast((r?.error || 'Não abri o grupo.') + ' Não enviei nada; o texto foi copiado se o navegador permitiu.'); }
    const sent = await callNet(off.net, { type: 'CHAT_FILL', text, send: true, expectedChat: g });
    if (!sent?.ok) return toast((sent?.error || 'O WhatsApp não confirmou o envio.') + ' Não tentei um segundo método para evitar duplicação.');
    off.sent[g] = true;
    toast(`Oferta enviada para "${g}".`);
    render();
  },
  offSent(el) { off.sent[groupsFor(proj(off.projectId), off.net)[+el.dataset.g]] = el.checked; render(); },

  async importProducts(el) {
    const files = [...(el.files || [])];
    if (!files.length) return;
    const targetProject = (el.dataset.pid || (route.startsWith('catalogo:') ? route.slice(9) : route.startsWith('proj:') ? route.slice(5) : catProjectId)) || '';
    if (!isAdmin()) return toast('Apenas administradores podem importar catálogos.');
    if (!targetProject) return toast('Selecione um projeto antes de importar a planilha.');
    if (!myProjects().some((project) => String(project.id) === String(targetProject))) return toast('Você não tem acesso a este projeto.');
    const merged = [];
    let invalid = 0;
    for (const f of files) {
      let rows;
      try {
        const t = await f.text();
        if (f.name.toLowerCase().endsWith('.csv')) rows = parseCSV(t);
        else if (f.name.toLowerCase().endsWith('.json')) { const j = JSON.parse(t); rows = Array.isArray(j) ? j : j.products || []; }
        else { invalid++; continue; }
      } catch { invalid++; continue; }
      if (!Array.isArray(rows) || !rows.some(r => normProduct(r))) { invalid++; continue; }
      merged.push(...rows.map(normProduct).filter(Boolean));
      if (AUTH?.access_token && base() && f.size <= 15*1024*1024) {
        try { const data = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);}); await api('/catalog-file',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:f.name,type:f.type||'text/csv',projectId:targetProject,data})}); }
        catch(e) { console.warn('saving original catalog file',e); }
      }
    }
    if (!merged.length) return toast('Nenhum arquivo válido. Use CSV/JSON com as colunas id, nome, preco, preco_anterior, categoria, imagem url e url.');
    const seen = new Set();
    const imported = merged.map(p => ({...p, projectId: targetProject || p.projectId || ''})).filter(p => seen.has(p.id) ? false : (seen.add(p.id), true));
    P = [...P.filter(p => p.projectId !== targetProject), ...imported];
    IDX.clear(); await saveProducts();
    clearTimeout(productPushT);
    const synced = await pushProductsRemote(targetProject, imported);
    toast(`${imported.length} produtos importados de ${files.length} arquivo(s)${invalid ? `; ${invalid} arquivo(s) ignorado(s)` : ''} para o projeto${synced ? ' e sincronizados' : ''}.`); render();
  },
  async clearProducts() { if (!confirm('Apagar todo o catálogo local?')) return; P = []; IDX.clear(); await saveProducts(); render(); },
  async catSearch() {
    const q=$('#cat-q')?.value||''; const pid=route.startsWith('catalogo:')?route.slice(9):catProjectId;
    const r=catMatches(q,pid);
    $('#cat-res').innerHTML = r.map((p) => offerCard(p, `<button class="btn ghost" data-act="copyOffer" data-id="${esc(p.id)}">Copiar informações</button>`)).join('') || (q.trim() ? '<p class="muted">Nenhum produto cujo nome comece assim.</p>' : '');
  },

  async grantBackend() {
    const ok = await chrome.permissions.request({ origins: [new URL(S.settings.backendUrl).origin + '/*'] });
    toast(ok ? 'Acesso permitido.' : 'Permissão negada.');
  },
  async pull() { const ok = await pullRemote(true); const productsOk = await pullProductsRemote(); try { await refreshTeam(); } catch {} toast(ok || productsOk ? 'Dados da equipe e catálogo sincronizados.' : 'Nada para baixar (ou backend indisponível).'); render(); },
  async refreshActivity() { await loadActivity(); },
  async push() { await pushRemote(); await pushProductsRemote(); toast('Dados e catálogo enviados para a equipe.'); },
  export() { const { backendToken, ...settings } = S.settings; download(`centro-de-comando-${today()}.json`, JSON.stringify({ state: { ...S, settings }, products: P }, null, 1)); },
  async import(el) {
    const f = el.files[0];
    if (!f || !confirm('Importar vai substituir os dados atuais. Continuar?')) return;
    const j = JSON.parse(await f.text());
    const keep = { backendToken: S.settings.backendToken };
    S = Object.assign(DEFAULT(), j.state); S.settings = Object.assign(DEFAULT().settings, S.settings, keep);
    if (j.products) { P = j.products; IDX.clear(); await saveProducts(); }
    me = user(me?.id) || null; save(); render();
  },
};

/* ---------- fila de publicações agendadas ---------- */
let scheduleTickBusy = false;
async function processScheduledPosts() {
  if (scheduleTickBusy || !AUTH || !me || !Array.isArray(S?.scheduledPosts)) return;
  const item = S.scheduledPosts.find(q => q.status === 'agendada' && Number(q.runAt) <= Date.now());
  if (!item) return;
  scheduleTickBusy = true;
  const previous = { projectId:pub.projectId, nets:pub.nets, file:pub.file, productImages:pub.productImages, text:pub.text, title:pub.title, productId:pub.productId, productIds:pub.productIds, status:pub.status, mediaType:pub.mediaType, autoPost:pub.autoPost };
  try {
    item.status = 'executando'; item.startedAt = Date.now(); save(false); render();
    pub.projectId=item.projectId||''; pub.nets=Object.fromEntries((item.nets||[]).map(n=>[n,true])); pub.facebookDestinations=item.facebookDestinations||{feed:!!item.nets?.includes('facebook'),marketplace:false}; pub.nets.facebook=Object.values(pub.facebookDestinations).some(Boolean); pub.text=item.text||''; pub.title=item.title||''; pub.productId=item.productId||''; pub.productIds=Array.isArray(item.productIds)&&item.productIds.length?item.productIds:(item.productId?[item.productId]:[]); pub.productImages=!!item.productImages; pub.marketplaceLocation=item.marketplaceLocation||'Seropédica - Rio de Janeiro'; pub.marketplaceGroups=item.marketplaceGroups??10; pub.marketplaceDelivery=item.marketplaceDelivery!==false; pub.mediaType=item.mediaType||'video'; pub.autoPost=!!item.autoPost; pub.status={};
    pub.file = item.fileData ? await (async()=>{const r=await fetch(item.fileData);const b=await r.blob();return new File([b],item.fileName||'media', {type:item.fileType||b.type});})() : null;
    await actions.runPublish();
    const failed = (item.nets||[]).filter(n=>pub.status[n]?.s==='err');
    item.status = failed.length ? 'erro' : 'concluida'; item.error = failed.length ? failed.map(n=>`${NETS[n]?.name||n}: ${pub.status[n]?.m||'falha'}`).join(' · ').slice(0,220) : '';
    item.finishedAt=Date.now(); save(false); render();
  } catch(e) { item.status='erro'; item.error=String(e?.message||e).slice(0,220); save(false); render(); }
  finally { Object.assign(pub, previous); scheduleTickBusy=false; }
}

/* ---------- eventos ---------- */
let pendingAuditAction = null;
const run = (fn, el, e) => Promise.resolve().then(() => fn(el, e)).catch((err) => { console.error(err); toast(err.message || String(err)); });
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.type === 'file') return;
  const a = actions[el.dataset.act];
  if (a) { pendingAuditAction = el.dataset.act; run(a, el, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.type === 'file' && el.dataset.act) return run(actions[el.dataset.act], el, e);
  if (el.dataset.mkt) { marketplaceVitrineDialog[el.dataset.mkt] = el.type === 'checkbox' ? el.checked : el.value; render(); return; }
  if (el.dataset.catProject) { catProjectId = el.value; route = 'catalogo'; render(); return; }
  if (el.dataset.urgency) { const st = stagesOf(el.dataset.scope).find(x=>x.id===el.dataset.id); if(st) st.urgency=el.value; save(); render(); return; }
  if (el.dataset.path) return setBound(el.dataset.path, el.dataset.type === 'number' ? Number(el.value || 0) : el.value);
  bindField(el, true);
});
document.addEventListener('input', (e) => {
  const el=e.target;
  if(el.id==='cat-q') { actions.catSearch(); return; }
  if(el.id==='pub-product-search') { renderPubProductResults(); return; }
  if(el.id==='off-product-search') { off.query=el.value; const q=String(off.query||'').trim().toLowerCase(); const ms=q?P.filter(p=>(!p.projectId||p.projectId===off.projectId)&&String(p.title||'').toLowerCase().includes(q)).slice(0,30):[]; const box=$('#off-product-results'); if(box)box.innerHTML=ms.map(p=>`<div class="row"><div class="grow">${p.image?`<img src="${esc(p.image)}" alt="" style="width:48px;height:48px;object-fit:contain;vertical-align:middle;margin-right:10px">`:''}<b>${esc(p.title)}</b><div class="muted">${brl(p.price)}${p.oldPrice?` · de ${brl(p.oldPrice)}`:''}</div></div><button class="btn ${off.selectedProducts.some(x=>x.id===p.id)?'':'ghost'}" data-act="offAddProduct" data-id="${esc(p.id)}">${off.selectedProducts.some(x=>x.id===p.id)?'✓ Selecionado':'Selecionar produto'}</button></div>`).join('')||(q?'<p class="muted">Nenhum produto correspondente.</p>':''); return; }
  if(el.id==='vitrine-q') { window.__vizzionVitrineQuery=el.value; vitrinePage=0; renderVitrineResults(); return; }
  if(el.id==='vitrine-min') { window.__vizzionVitrineMin=el.value; vitrinePage=0; renderVitrineResults(); return; }
  if(el.id==='vitrine-max') { window.__vizzionVitrineMax=el.value; vitrinePage=0; renderVitrineResults(); return; }
  bindField(el, false);
});
document.addEventListener('change', (e) => { if(e.target.id==='vitrine-category'){window.__vizzionVitrineCategory=e.target.value;vitrinePage=0;renderVitrineResults();} if(e.target.id==='vitrine-sort'){window.__vizzionVitrineSort=e.target.value;vitrinePage=0;renderVitrineResults();} });
function bindField(el, isChange) {
  const map = { pub, att, off };
  for (const k of ['pub', 'att', 'off']) {
    if (el.dataset[k] !== undefined) {
      const previous = map[k][el.dataset[k]];
      map[k][el.dataset[k]] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'pub' && isChange && el.dataset[k] === 'projectId' && previous !== map[k][el.dataset[k]]) { pub.productId = ''; pub.productIds = []; }
      if (k === 'off' && isChange && ['net','projectId'].includes(el.dataset[k]) && previous !== map[k][el.dataset[k]]) { off.recipientSel = []; off.selectAll = false; if (el.dataset[k] === 'projectId') off.selectedProducts = []; }
      if (isChange && k === 'att' && el.dataset.att === 'net' && previous !== el.value && att.watching) {
        att.watching = false;
        callNet(previous, { type: 'CHAT_WATCH', on: false }).catch(() => {});
        toast('Rede alterada. Ligue novamente o atendimento automático para iniciar o monitor na nova rede.');
      }
      if (isChange && ((el.tagName === 'SELECT' && ['net', 'projectId'].includes(el.dataset[k])) || (el.type === 'checkbox' && k === 'pub' && el.dataset.pub === 'postNow') || (k==='off' && ['sendNow','net','projectId'].includes(el.dataset[k])))) render();
    }
  }
}

/* ---------- mensagens que chegam dos monitores ---------- */
let queue = Promise.resolve();
const incomingInFlight = new Set();
const incomingCompleted = new Set();
chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m?.type !== 'INCOMING') return;
  const key = `${m.net || ''}|${m.chat || ''}|${m.messageId || ''}|${String(m.text || '').trim()}`;
  if (incomingInFlight.has(key) || incomingCompleted.has(key)) {
    try { sendResponse({ ok: true, duplicate: true }); } catch (_) {}
    return;
  }
  incomingInFlight.add(key);
  queue = queue.then(async () => {
    await onIncoming(m);
    incomingCompleted.add(key);
    if (incomingCompleted.size > 1500) incomingCompleted.clear();
    incomingInFlight.delete(key);
    try { sendResponse({ ok: true }); } catch (_) {}
  }).catch((e) => {
    incomingInFlight.delete(key);
    console.warn(e);
    try { sendResponse({ ok: false, error: String(e?.message || e) }); } catch (_) {}
  });
  return true;
});
async function onIncoming(m) {
  if (!att.watching || m.net !== att.net) return;
  const entry = { t: Date.now(), chat: m.chat, msg: String(m.text || '').slice(0, 80), st: 'gerando…' };
  att.log.unshift(entry); att.log = att.log.slice(0, 30);
  if (route === 'atendimento') render();
  try {
    let messages = Array.isArray(m.messages) ? m.messages : [];
    let customerMsg = String(m.text || '').trim();
    if (!customerMsg) customerMsg = [...messages].reverse().find(x => x.dir === 'in')?.text || '';
    if (!customerMsg) { entry.st = 'não foi possível ler a mensagem'; if (route === 'atendimento') render(); return; }
    // Atualiza o texto do evento depois do OCR e não responde em grupos.
    entry.msg = customerMsg.slice(0, 80);
    const project = ensureAttProject();
    if (!project) {
      entry.st = 'nenhum projeto autorizado para o atendimento';
      if (route === 'atendimento') render();
      return;
    }
    const auto = att.mode === 'auto' && !m.group;
    const trySend = async (text) => {
      const now = Date.now();
      att.sentTimes = att.sentTimes.filter((t) => now - t < 3600000);
      if (att.sentTimes.length >= (S.settings.autoMaxPerHour || 20)) return { ok: false, blocked: true, error: 'Limite de envios por hora atingido.' };
      // A conversa-alvo é obrigatória: o content script bloqueia se o chat mudou.
      const x = await callNet(att.net, { type: 'CHAT_FILL', text, send: true, expectedChat: m.chat, expectedMessageId: m.messageId });
      if (x?.ok) att.sentTimes.push(now);
      return x || { ok: false, error: 'Sem confirmação do WhatsApp.' };
    };
    let intro = null;
    const r = await botReply({ project, history: histStr(messages), customerMsg,
      // avisa o cliente que vai procurar assim que se sabe que a pergunta é sobre produtos
      onIntent: async () => { if (auto) { entry.st = 'procurando produtos…'; if (route === 'atendimento') render(); intro = await trySend(project?.bot?.searchText || DEFAULT_SEARCHING); } } });
    if (r.mode === 'vitrine' && auto) {
      if (intro && !intro.ok) { entry.st = `vitrine cancelada: ${intro.error || 'aviso de busca não enviado'}`; if (route === 'atendimento') render(); return; }
      // cada produto = 1 mensagem: foto + legenda (nome, preço, link). Sem foto/legenda, vai texto puro.
      let ok = 0, comFoto = 0, falhasFoto = 0, abort = null;
      const sendText = (txt) => callNet(att.net, { type: 'CHAT_FILL', text: txt, send: true, expectedChat: m.chat });
      await withTabVisible(att.net, async () => {
        for (const p of r.found) {
          const caption = productCaption(p);
          let done = false;
          if (p.image && falhasFoto < 2) { // Na vitrine, cada produto selecionado tenta enviar sua própria foto; não usar o limite geral de fotos da resposta textual.
            try {
              const files = await photoFilesFor([p], caption, 1);
              if (files.length) {
                const x = await sendPhotos(att.net, m.chat, files, caption);
                if (x?.ok) { done = true; comFoto++; falhasFoto = 0; if (!x.captionSent) { const y = await sendText(caption); if (!y?.ok) entry.st = `foto enviada, texto falhou: ${y?.error || ''}`; } }
                else if (x?.blocked) { abort = x.error; return; }
                else { falhasFoto++; entry.st = `foto falhou (${x?.error || 'sem confirmação'}); enviando só texto`; if (route === 'atendimento') render(); }
              }
            } catch (e) { falhasFoto++; console.warn('foto do produto', e); }
          }
          // foto indisponível ou falhou: o produto vai em texto, e a vitrine continua
          if (!done) { const y = await sendText(caption); if (!y?.ok) { abort = y?.error || 'sem confirmação'; return; } }
          ok++;
          await sleep(1500);
        }
      });
      if (abort) { entry.st = `vitrine interrompida: ${abort}`; if (route === 'atendimento') render(); return; }
      entry.st = `vitrine: ${ok} produto(s) enviados, ${comFoto} com foto${falhasFoto ? ' (algumas fotos falharam: enviadas em texto)' : ''}`;
      if (route === 'atendimento') render();
      return;
    }
    if (r.human) {
      entry.st = '🔔 precisa de humano';
      document.title = '🔔 Humano! — Centro de Comando';
      if (auto) {
        const sent = await trySend(project?.bot?.handoffText || DEFAULT_HANDOFF);
        entry.st = sent.ok ? 'resposta de encaminhamento enviada' : `envio bloqueado: ${sent.error || 'sem confirmação'}`;
      } else await fillMsg(att.net, r.text, false, m.chat);
    } else if (auto) {
      const sent = await trySend(r.text);
      if (sent.ok) {
        entry.st = 'respondido automaticamente';
        const max = photoMax();
        if (max > 0 && r.found?.length) {
          try {
            entry.st += ' · baixando fotos…'; if (route === 'atendimento') render();
            const files = await photoFilesFor(r.found, r.text, max);
            if (!files.length) entry.st = 'respondido (sem foto disponível para os itens citados)';
            else {
              const x = await withTabVisible(att.net, () => sendPhotos(att.net, m.chat, files));
              entry.st = x?.ok ? `respondido + ${files.length} foto(s)` : `respondido; fotos NÃO enviadas: ${x?.error || 'sem confirmação'}`;
            }
          } catch (e) { entry.st = `respondido; fotos NÃO enviadas: ${e.message || e}`; }
        }
      } else entry.st = `NÃO enviado (segurança): ${sent.error || 'conversa não confirmada'}`;
    } else if (!m.group) {
      await fillMsg(att.net, r.text, false, m.chat); entry.st = 'rascunho no campo — aperte Enter';
    } else { entry.st = 'grupo ignorado'; }
  } catch (e) { entry.st = 'erro: ' + (e.message || e); }
  if (route === 'atendimento') render();
}

/* ---------- fila sequencial de ofertas (ativa somente com painel aberto) ---------- */
let offerQueueBusy = false;
async function processOfferQueue() {
  if (offerQueueBusy || !AUTH || !me || off.paused || !Array.isArray(S?.offerSendQueue)) return;
  const item=S.offerSendQueue.find(q=>q.status==='pendente' && Number(q.runAt||0)<=Date.now());
  if(!item)return;
  offerQueueBusy=true; item.status='enviando'; item.attempts=(item.attempts||0)+1; item.startedAt=Date.now();
  item.productProgress=item.productProgress||{}; save(false); if(route==='ofertas')render();
  try {
    let opened;
    const digits=String(item.target||'').replace(/\D/g,'');
    const looksLikePhone=item.net==='whatsapp' && digits.length>=8 && !/[A-Za-zÀ-ÿ]/.test(String(item.target||''));
    if(looksLikePhone) {
      const tab=await getNetTab('whatsapp',{open:false});
      if(!tab) throw new Error('Abra o WhatsApp Web e mantenha a sessão conectada.');
      await chrome.tabs.update(tab.id,{url:`https://web.whatsapp.com/send?phone=${digits}`,active:false});
      await waitLoad(tab.id); await sleep(1400);
      opened=await callNet('whatsapp',{type:'CHAT_STATUS'});
      if(!opened?.ok || !opened.chat) throw new Error('O WhatsApp não confirmou a abertura do número. Verifique o código do país e se o número possui WhatsApp.');
    } else {
      opened=await callNet(item.net,{type:'CHAT_OPEN',name:item.target});
      if(!opened?.ok) throw new Error(opened?.error||'Não foi possível confirmar a conversa.');
    }
    const expected=looksLikePhone ? opened.chat : (opened.chat || item.target);
    const sendText=async(text)=>{
      const r=await callNet(item.net,{type:'CHAT_FILL',text,send:true,expectedChat:expected});
      if(!r?.ok) throw new Error(r?.error||'O envio de texto não foi confirmado.');
      if(r.uncertain) throw new Error(r.error||'Envio incerto; confira a conversa antes de retomar.');
      return r;
    };
    if(item.message && !item.introSent){
      await sendText(item.message);
      item.introSent=true; save(false);
    }
    const products=Array.isArray(item.products)?item.products:[];
    if(item.net==='whatsapp' && products.length){
      for(const p of products){
        const pid=String(p.id||p.url||p.title);
        const state=item.productProgress[pid]||'pendente';
        const caption=offerBlock(p);
        if(state==='enviado') continue;
        if(state==='foto_enviada_legenda_pendente'){
          await sendText(caption); item.productProgress[pid]='enviado'; save(false); continue;
        }
        if(state==='incerto') throw new Error(`Envio do produto "${p.title}" ficou incerto. Confira a conversa antes de retomar esse item.`);
        let photoSent=false;
        if(p.image){
          let files=[];
          try { files=await photoFilesFor([p],caption,1); }
          catch(e){ console.warn('Falha ao baixar/preparar foto; usando texto:',e); }
          if(files.length){
            let result;
            try { result=await withTabVisible('whatsapp',()=>sendPhotos('whatsapp',expected,files,caption)); }
            catch(e){ item.productProgress[pid]='incerto'; save(false); throw new Error(`Não foi possível confirmar o envio da foto de "${p.title}". Confira a conversa antes de retomar.`); }
            if(result?.ok){
              photoSent=true;
              if(result.captionSent){ item.productProgress[pid]='enviado'; save(false); continue; }
              item.productProgress[pid]='foto_enviada_legenda_pendente'; save(false);
              await sendText(caption); item.productProgress[pid]='enviado'; save(false); continue;
            }
            if(result?.uncertain || result?.blocked){ item.productProgress[pid]='incerto'; save(false); throw new Error(result.error||`Envio da foto de "${p.title}" incerto; confira a conversa antes de retomar.`); }
            console.warn('Foto do produto não enviada; usando texto:',result?.error);
          }
        }
        if(!photoSent){ await sendText(caption); item.productProgress[pid]='enviado'; save(false); }
      }
    } else if(products.length){
      // Telegram mantém os produtos como mensagens separadas de texto; o envio de foto é solicitado para WhatsApp.
      for(const p of products){
        const pid=String(p.id||p.url||p.title);
        if(item.productProgress[pid]==='enviado') continue;
        await sendText(offerBlock(p)); item.productProgress[pid]='enviado'; save(false);
      }
    } else if(!item.message) throw new Error('O envio não tem texto nem produtos selecionados.');
    item.status='enviado'; item.sentAt=Date.now(); item.error=''; item.finishedAt=Date.now();
  } catch(e) { item.status='erro'; item.error=String(e?.message||e).slice(0,300); item.finishedAt=Date.now(); }
  finally { save(false); offerQueueBusy=false; if(route==='ofertas')render(); }
}

/* ---------- início ---------- */
(async () => {
  await load();
  if (AUTH && S.settings.backendUrl) {
    const valid = await ensureAuth();
    if (valid) {
      try {
        await refreshTeam();
        const localStateLooksEmpty = !S.projects.length && !S.tasks.length && !S.postsLog.length;
        await pullRemote(localStateLooksEmpty);
        await pullProductsRemote();
      } catch (e) { console.warn('initial backend sync', e); }
      me = S.users.find(u => u.id === me?.id) || me;
      if (me && S.lastGen !== today()) generateTasks();
    } else { AUTH = null; me = null; await chrome.storage.local.remove(['cc_auth', 'cc_profile']); }
  } else { AUTH = null; me = null; }
  window.addEventListener('focus', () => { if (document.title.startsWith('🔔')) document.title = 'Vizzion · Centro de Comando'; });
  render();
  refreshNotificationCounts(true).catch(e=>console.warn('notification counters',e));
  setInterval(() => { processScheduledPosts().catch(e=>console.warn('scheduled posts',e)); processOfferQueue().catch(e=>console.warn('offer queue',e)); }, 1000);
  // Gera tasks automaticamente na virada do dia local (horário do computador, normalmente Brasília).
  setInterval(() => { if (AUTH && me && S.lastGen !== today()) { const n = generateTasks(); audit('tasks.generated', 'task', '', { title: `${n} tarefas geradas automaticamente`, count: n }); render(); } }, 15000);
  setInterval(() => { if (AUTH && me) refreshNotificationCounts(true).catch(e=>console.warn('notification counters',e)); }, 30000);
})();
