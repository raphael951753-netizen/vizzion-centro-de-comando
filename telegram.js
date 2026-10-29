// Telegram Web (versões K e A). Seletores centralizados no topo.
(() => {
  if (window.__CC_tg) return;
  window.__CC_tg = 1;
  const CC = window.__CC;

  const isK = () => !!document.querySelector('.bubbles-inner');
  const q = (k, a) => document.querySelector(isK() ? k : a);

  const title = () => (q('.chat-info .peer-title', '.MiddleHeader .fullName, .ChatInfo .fullName')?.innerText || '').trim();
  const isGroup = () => /membros|members|inscritos|subscribers/i.test(q('.chat-info .info', '.ChatInfo .status')?.innerText || '');
  const compose = () => q('.input-message-input[contenteditable="true"]', '#editable-message-text');

  const read = () => {
    const list = isK()
      ? [...document.querySelectorAll('.bubbles-inner .bubble[data-mid]')].map((b) => ({
          dir: b.classList.contains('is-out') ? 'out' : 'in',
          text: (b.querySelector('.message')?.innerText || '').trim(),
        }))
      : [...document.querySelectorAll('.messages-container .Message')].map((m) => ({
          dir: m.classList.contains('own') ? 'out' : 'in',
          text: (m.querySelector('.text-content')?.innerText || '').trim(),
        }));
    return list.filter((m) => m.text).slice(-12);
  };

  CC.handlers.CHAT_STATUS = () => ({ ok: true, loggedIn: !!compose() || !!title(), chat: title(), group: isGroup() });
  CC.handlers.CHAT_READ = () => ({ ok: true, chat: title(), group: isGroup(), messages: read() });

  CC.handlers.CHAT_FILL = async ({ text, send, expectedChat }) => {
    const expected = String(expectedChat || '').trim();
    if (expected && norm(title()) !== norm(expected)) return { ok: false, blocked: true, error: `Envio bloqueado: a conversa aberta é "${title()}", não "${expected}".` };
    const box = await CC.waitFor(compose, 5000);
    if (!box) return { ok: false, error: 'Abra uma conversa no Telegram Web primeiro.' };
    if (expected && norm(title()) !== norm(expected)) return { ok: false, blocked: true, error: 'Envio bloqueado porque a conversa mudou.' };
    CC.setText(box, text);
    if (send) {
      await CC.sleep(400);
      if (expected && norm(title()) !== norm(expected)) return { ok: false, blocked: true, error: 'Envio bloqueado porque a conversa mudou antes do clique.' };
      const btn = q('button.btn-send', 'button.Button.send, button[aria-label="Send Message"]');
      if (!btn) return { ok: false, error: 'Botão de enviar não encontrado.' };
      btn.click();
    }
    return { ok: true };
  };

  CC.handlers.CHAT_OPEN = async ({ name }) => {
    const input = document.querySelector('#column-left .input-search-input, #telegram-search-input');
    if (!input) return { ok: false, error: 'Caixa de busca do Telegram não encontrada.' };
    input.focus();
    CC.setText(input, name);
    const want = name.trim().toLowerCase();
    const hit = await CC.waitFor(
      () => [...document.querySelectorAll('.peer-title, .fullName')].find((e) => e.innerText.trim().toLowerCase() === want && e.closest('#column-left, .LeftColumn')),
      5000
    );
    if (!hit) return { ok: false, error: `Conversa "${name}" não encontrada.` };
    CC.click(hit.closest('a, li, .ListItem, .chatlist-chat') || hit);
    await CC.sleep(900);
    return { ok: true, chat: title() };
  };

  let timer = null;
  let scanning = false;
  let last = '';
  const seenByChat = new Map();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sig = () => {
    const ms = read();
    const l = ms[ms.length - 1];
    return l ? `${title()}|${ms.length}|${l.dir}|${l.text}` : '';
  };
  const notifyIncoming = async (chatName, group, ms) => {
    const latest = ms[ms.length - 1];
    if (!latest || latest.dir !== 'in' || !latest.text) return;
    const key = `${chatName}|${latest.text}`;
    if (seenByChat.get(chatName) === key) return;
    seenByChat.set(chatName, key);
    try {
      await chrome.runtime.sendMessage({ type: 'INCOMING', net: 'telegram', chat: chatName, group, text: latest.text, messages: ms, unreadScan: true });
    } catch (_) {}
  };
  const unreadRows = () => {
    const candidates = [...new Set(document.querySelectorAll(
      '#column-left .chatlist-chat, #column-left .ListItem, .LeftColumn .ListItem, .chatlist .chatlist-chat, .chatlist-chat, [data-peer-id], a.ListItem'
    ))];
    const found = [];
    for (const row of candidates) {
      if (!row.getClientRects().length) continue;
      const labels = [...row.querySelectorAll('[aria-label], [title], .badge, .counter, .unread, .UnreadBadge, .unread-count')]
        .map(el => norm([el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText, el.className].filter(Boolean).join(' ')));
      const text = norm(row.innerText || '');
      const unread = labels.some(s => /unread|nao lida|mensagem nova|new message|\bunread\b/.test(s)) ||
        !!row.querySelector('.unread, .UnreadBadge, .unread-count, .badge, .counter') && /\d+/.test(row.innerText || '');
      if (!unread) continue;
      const titleNode = row.querySelector('.peer-title, .fullName, [title], [dir="auto"]');
      const name = (titleNode?.getAttribute('title') || titleNode?.innerText || '').trim();
      if (!name || found.some(x => x.row === row)) continue;
      found.push({ row, name });
    }
    return found;
  };
  const scanUnread = async () => {
    for (const item of unreadRows()) {
      if (!timer) return;
      CC.click(item.row);
      await CC.sleep(900);
      const chatName = title() || item.name;
      const ms = read();
      await notifyIncoming(chatName, isGroup(), ms);
      await CC.sleep(250);
    }
  };
  const tick = async () => {
    if (scanning || !timer) return;
    scanning = true;
    try {
      await scanUnread();
      const ms = read();
      const latest = ms[ms.length - 1];
      if (latest?.dir === 'in' && latest.text) {
        const s = sig();
        if (s !== last) {
          last = s;
          await notifyIncoming(title(), isGroup(), ms);
        }
      }
    } finally { scanning = false; }
  };
  CC.handlers.CHAT_WATCH = ({ on }) => {
    clearInterval(timer);
    timer = null;
    if (on) { last = ''; timer = setInterval(() => tick().catch(() => {}), 2500); tick().catch(() => {}); }
    return { ok: true, monitoring: !!timer, scope: 'conversas não lidas e conversa aberta' };
  };
})();
