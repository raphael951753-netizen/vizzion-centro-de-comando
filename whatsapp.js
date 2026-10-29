// WhatsApp Web — v1.4.0. Seletores validados contra o HTML real do WhatsApp Web (out/2026).
// Se o layout mudar, ajuste só o bloco SEL e as funções msgInfo / rowInfo.
(() => {
  if (window.__CC_wa) return;
  window.__CC_wa = 1;
  const CC = window.__CC;
  const log = (...a) => console.debug('[Vizzion/WA]', ...a);

  const SEL = {
    compose: '#main footer [data-testid="conversation-compose-box-input"], #main footer div[contenteditable="true"]',
    sendButton: '#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"], #main footer [data-testid="send"], #main footer [data-testid="compose-btn-send"], #main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"]',
    // A busca do WhatsApp atual é um <input>, não um contenteditable.
    search: '#side input[role="textbox"], #side input[type="text"], #side div[contenteditable="true"]',
    results: '#pane-side span[title], [aria-label="Lista de conversas"] span[title]',
    conversationPanel: '[data-testid="conversation-panel-messages"]',
    chatList: '[aria-label="Lista de conversas"][role="grid"]',
    headerTitle: '#main header [data-testid="conversation-info-header-chat-title"] span[dir="auto"], #main header span[dir="auto"]',
    headerSub: '#main header span[title]',
  };

  // ---------- utilidades ----------
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // chave de comparação: ignora emojis, espaços e pontuação (o título do cabeçalho não traz os emojis do nome).
  const keyOf = (s) => norm(s).replace(/[^a-z0-9]/g, '');
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const clean = (s) => String(s || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  const nodeText = (n) => {
    let out = '';
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += c.data;
      else if (c.nodeName === 'IMG') out += c.getAttribute('alt') || '';
      else if (c.nodeName === 'BR') out += '\n';
      else out += nodeText(c);
    });
    return out;
  };
  // Mensagens enviadas por versões antigas saíram com o texto duplicado (X+X); colapsa na leitura.
  const undouble = (t) => {
    const s = String(t || '').trim();
    for (let i = Math.floor(s.length * 0.4); i <= Math.ceil(s.length * 0.6); i++) {
      const a = collapse(s.slice(0, i)), b = collapse(s.slice(i));
      if (a.length > 3 && a === b) return s.slice(0, i).trim();
    }
    return s;
  };

  const title = () => clean(document.querySelector(SEL.headerTitle)?.textContent || '');

  // ---------- leitura da conversa aberta ----------
  // Direção: o WhatsApp só desenha o "rabinho" (tail) na 1ª mensagem de cada sequência, então ele
  // sozinho perde mensagens. Cada mensagem traz um rótulo "Nome:" (ou "Você:") e só as enviadas
  // por nós têm ícone de status (Lida/Entregue/Enviada) no msg-meta.
  const msgInfo = (el) => {
    const id = el.getAttribute('data-id') || (el.getAttribute('data-testid') || '').replace('conv-msg-', '');
    const labelEl = [...el.querySelectorAll('span[aria-label]')].find((x) => /:$/.test(x.getAttribute('aria-label') || ''));
    const sender = clean((labelEl?.getAttribute('aria-label') || '').replace(/:$/, ''));
    const mine = /^(voce|you|vc)$/.test(norm(sender));
    const tailOut = !!el.querySelector('[data-testid="tail-out"], [data-icon="tail-out"]');
    const tailIn = !!el.querySelector('[data-testid="tail-in"], [data-icon="tail-in"]');
    const status = [...el.querySelectorAll('[data-testid="msg-meta"] [aria-label]')]
      .some((x) => /\b(lida|entregue|enviada|pendente|read|delivered|sent|pending)\b/.test(norm(x.getAttribute('aria-label'))));
    let dir = null;
    if (mine || tailOut || status) dir = 'out';
    else if (sender || tailIn) dir = 'in';
    if (!dir) return null; // avisos do sistema, separadores de data etc.
    const chunks = [...el.querySelectorAll('[data-testid="selectable-text"], span.selectable-text')]
      .map((n) => clean(nodeText(n))).filter(Boolean);
    const text = undouble([...new Set(chunks)].join('\n'));
    return { id, dir, sender, text, media: !text };
  };
  const read = () => {
    const panel = document.querySelector(SEL.conversationPanel);
    if (!panel) return [];
    return [...panel.querySelectorAll('[data-testid^="conv-msg-"]')].slice(-14).map(msgInfo).filter(Boolean);
  };

  const isGroup = (msgs, chatName) => {
    const subtitleLooksLikeGroup = [...document.querySelectorAll(SEL.headerSub)].some((s) => {
      const t = s.getAttribute('title') || '';
      return t.includes(',') && !/online|visto|last seen|digitando|typing/i.test(t);
    });
    if (subtitleLooksLikeGroup) return true;
    const senders = (msgs || []).filter((m) => m.dir === 'in' && m.sender).map((m) => keyOf(m.sender));
    if (new Set(senders).size > 1) return true;
    const tk = keyOf(chatName || title());
    if (senders.length && tk && senders.some((k) => k && k !== tk && !tk.includes(k) && !k.includes(tk))) return true;
    return false;
  };

  CC.handlers.CHAT_STATUS = () => ({
    ok: true,
    loggedIn: !!document.querySelector(SEL.chatList) || !!document.querySelector('#pane-side'),
    chat: title(),
    group: isGroup(read(), title()),
  });
  CC.handlers.CHAT_READ = () => {
    const ms = read();
    return { ok: true, chat: title(), group: isGroup(ms, title()), messages: ms.filter((m) => m.text) };
  };

  // ---------- escrita / envio ----------
  const setComposer = async (box, text) => {
    box.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // O editor (Lexical) atualiza de forma assíncrona: espera antes de concluir que o paste falhou.
    // Antes o código testava na hora, achava que falhou e inseria o texto de novo (mensagem duplicada).
    const probe = collapse(text).slice(0, 12);
    const ok = await CC.waitFor(() => collapse(box.innerText).includes(probe), 2000, 100);
    if (!ok && !collapse(box.innerText)) {
      text.split('\n').forEach((line, i) => {
        if (i) document.execCommand('insertLineBreak');
        if (line) document.execCommand('insertText', false, line);
      });
      await CC.sleep(300);
    }
  };

  CC.handlers.CHAT_FILL = async ({ text, send, expectedChat }) => {
    const expected = String(expectedChat || '').trim();
    const sameChat = () => !expected || keyOf(title()) === keyOf(expected);
    if (!sameChat()) return { ok: false, blocked: true, error: `Envio bloqueado: a conversa aberta é "${title()}", mas a mensagem pertence a "${expected}".` };
    const box = await CC.waitFor(() => document.querySelector(SEL.compose), 8000);
    if (!box) return { ok: false, error: 'Abra uma conversa no WhatsApp Web primeiro.' };
    const message = String(text || '').trim();
    if (!message) return { ok: false, error: 'A mensagem está vazia.' };
    if (send && collapse(box.innerText) === collapse(message)) {
      return { ok: false, duplicatePrevented: true, error: 'A mesma mensagem já está no campo; envio cancelado para evitar duplicação.' };
    }
    await setComposer(box, message);
    await CC.sleep(400);
    // Trava anti-duplicação: se o campo ficou bem maior que a mensagem, não envia.
    if (collapse(box.innerText).length > collapse(message).length * 1.4 + 10) {
      return { ok: false, filled: true, sent: false, error: 'O campo ficou com texto a mais (possível duplicação); envio cancelado. Limpe o campo e tente de novo.' };
    }
    if (!send) return { ok: true, filled: true, msg: 'Mensagem colocada no campo. Revise antes de enviar.' };
    if (!sameChat()) return { ok: false, filled: true, sent: false, blocked: true, error: 'Envio bloqueado: a conversa mudou antes do envio.' };

    const btn = await CC.waitFor(() => [...document.querySelectorAll(SEL.sendButton)]
      .map((el) => el.closest('button,[role="button"]') || el)
      .find((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true'), 4000, 250);
    // UM único gesto de envio: botão se existir; senão Enter. Nunca os dois.
    if (btn) CC.clickDeep(btn);
    else {
      const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      box.focus();
      box.dispatchEvent(new KeyboardEvent('keydown', k));
      box.dispatchEvent(new KeyboardEvent('keyup', k));
    }
    const cleared = await CC.waitFor(() => !(box.isConnected && collapse(box.innerText)), 4000, 150);
    if (cleared) return { ok: true, sent: true, msg: 'Mensagem enviada.' };
    return { ok: false, filled: true, sent: false, uncertain: true, error: 'Envio executado, mas o campo não confirmou a limpeza. Não repeti o envio; confira a conversa.' };
  };

  // Envia imagens coladas no campo de mensagem: o WhatsApp abre a pré-visualização e aí enviamos.
  // Como a marcação dessa tela não estava no HTML enviado, o botão é achado por diferença: são os
  // botões que NÃO existiam antes do paste. Entre eles vale o de rótulo/ícone "enviar" ou, na falta,
  // o mais ao canto inferior direito (posição padrão do botão verde de enviar).
  CC.handlers.CHAT_SEND_IMAGES = async ({ fileIds, expectedChat, caption }) => {
    const expected = String(expectedChat || '').trim();
    const sameChat = () => !expected || keyOf(title()) === keyOf(expected);
    if (!sameChat()) return { ok: false, blocked: true, error: `Fotos bloqueadas: a conversa aberta é "${title()}", não "${expected}".` };
    const files = (fileIds || []).map((id) => CC.files[id]).filter(Boolean);
    if (!files.length) return { ok: false, error: 'As fotos não chegaram à aba do WhatsApp.' };
    const box = await CC.waitFor(() => document.querySelector(SEL.compose), 8000);
    if (!box) return { ok: false, error: 'Campo de mensagem não encontrado.' };

    const CLICKABLE = 'button, [role="button"]';
    const before = new Set(document.querySelectorAll(CLICKABLE));
    const beforeCE = new Set(document.querySelectorAll('[contenteditable="true"]'));
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const describe = (el) => [el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.querySelector('[data-icon]')?.getAttribute('data-icon'), el.querySelector('svg title')?.textContent].filter(Boolean).join('/') || el.tagName;
    // cabeçalho, lista lateral e rodapé do chat se redesenham sozinhos (ligação, pesquisar...): nunca são a pré-visualização
    const inChrome = (el) => !!el.closest('#main header, #side, #pane-side, #main footer, header');
    const newButtons = () => [...document.querySelectorAll(CLICKABLE)].filter((el) => !before.has(el) && visible(el) && !inChrome(el));
    // fecha a pré-visualização com Esc para não deixar a tela presa e bloquear as próximas mensagens
    const dismiss = async () => {
      const k = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      for (let i = 0; i < 2; i++) {
        (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', k));
        document.dispatchEvent(new KeyboardEvent('keyup', k));
        await CC.sleep(700);
        if (!newButtons().length) return true;
      }
      return false;
    };
    const findSend = () => {
      const list = newButtons();
      if (!list.length) return null;
      const byLabel = list.filter((el) => /enviar|send/i.test(describe(el)) && !/(mensagem de voz|voice)/i.test(describe(el)));
      if (byLabel.length) return byLabel.at(-1);
      return list.map((el) => ({ el, r: el.getBoundingClientRect() })).sort((x, y) => (y.r.left + y.r.top) - (x.r.left + x.r.top))[0].el;
    };
    // clica no elemento mais interno sob o centro do botão, para o evento passar por toda a cadeia de handlers
    const press = (btn) => {
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const inner = document.elementFromPoint(x, y);
      CC.clickDeep(inner && btn.contains(inner) ? inner : btn);
    };

    box.focus();
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const btn = await CC.waitFor(findSend, 12000, 250);
    fileIds.forEach((id) => { delete CC.files[id]; });
    const seen = newButtons().map(describe).slice(0, 8).join(' | ');
    log('botões novos após o paste:', seen);
    if (!btn) { await dismiss(); return { ok: false, error: `A tela de pré-visualização da foto não apareceu (aba oculta? botões novos: ${seen || 'nenhum'}).` }; }

    await CC.sleep(1200); // deixa a imagem carregar na pré-visualização
    if (!sameChat()) { await dismiss(); return { ok: false, blocked: true, error: 'Fotos bloqueadas: a conversa mudou antes do envio.' }; }
    const gone = () => !btn.isConnected || !visible(btn);

    // 1º gesto: clique no botão. Só se a tela continuar aberta, 2º gesto: Enter no campo de legenda.
    // Legenda (nome, preço e link) na própria foto: usa o campo editável novo da pré-visualização.
    let captionSent = false;
    const cap = String(caption || '').trim();
    if (cap && files.length === 1) {
      const capBox = await CC.waitFor(() => [...document.querySelectorAll('[contenteditable="true"]')].find((el) => !beforeCE.has(el) && visible(el)), 3000, 200);
      if (capBox) {
        await setComposer(capBox, cap);
        const txt = collapse(capBox.innerText);
        if (txt.length > collapse(cap).length * 1.4 + 10) { await dismiss(); return { ok: false, uncertain: true, error: 'Legenda ficou com texto a mais (possível duplicação); foto não enviada. Confira a conversa.' }; }
        captionSent = txt.includes(collapse(cap).slice(0, 12));
      }
      log('legenda na foto:', captionSent ? 'ok' : 'campo não encontrado — texto irá em mensagem separada');
    }
    log('clicando em enviar foto:', describe(btn));
    press(btn);
    if (await CC.waitFor(gone, 4000, 250)) return { ok: true, sent: files.length, captionSent };
    const enterTarget = document.activeElement && document.activeElement !== document.body ? document.activeElement : box;
    const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    log('clique não fechou a tela; tentando Enter');
    enterTarget.dispatchEvent(new KeyboardEvent('keydown', k));
    enterTarget.dispatchEvent(new KeyboardEvent('keyup', k));
    if (await CC.waitFor(gone, 5000, 250)) return { ok: true, sent: files.length, captionSent };
    await dismiss();
    return { ok: false, uncertain: true, error: `Cliquei em "${describe(btn)}" e tentei Enter, mas a tela de fotos não fechou. Confira a conversa (botões novos: ${seen}).` };
  };

  CC.handlers.CHAT_OPEN = async ({ name }) => {
    const box = document.querySelector(SEL.search);
    if (!box) return { ok: false, error: 'Caixa de busca do WhatsApp não encontrada.' };
    const want = String(name || '').trim();
    if (!want) return { ok: false, error: 'Nome do contato/grupo vazio.' };
    CC.setText(box, want);
    const hit = await CC.waitFor(() => [...document.querySelectorAll(SEL.results)].find((s) => keyOf(s.getAttribute('title') || s.textContent) === keyOf(want)), 7000);
    if (!hit) return { ok: false, error: `Conversa/grupo "${want}" não encontrado na busca do WhatsApp.` };
    CC.clickDeep(hit);
    const opened = await CC.waitFor(() => keyOf(title()) === keyOf(want), 7000, 150);
    if (!opened) return { ok: false, error: `Cliquei no resultado, mas o WhatsApp não confirmou a abertura de "${want}". Nada foi preenchido.` };
    await CC.sleep(500);
    return { ok: true, chat: title() };
  };

  // ---------- lista de conversas ----------
  const OUT_ICON = /read|check|delivered|msg-time|msg-sent|pending|schedule/i;
  const rowInfo = (row) => {
    const t = row.querySelector('[data-testid="cell-frame-title"] span[title], [data-testid="cell-frame-title"] [dir="auto"]');
    const name = clean(t?.getAttribute('title') || t?.textContent || '');
    if (!name) return null;
    const prev = row.querySelector('[data-testid="last-msg-status"]');
    const preview = undouble(clean(prev?.getAttribute('title') || prev?.textContent || ''));
    const time = clean(row.querySelector('[data-testid="chat-list-timestamp"]')?.textContent || '');
    const outgoing = !!prev && [...prev.querySelectorAll('svg title')].some((x) => OUT_ICON.test(x.textContent) && !/expand/i.test(x.textContent));
    return { row, name, key: keyOf(name) || name, time, preview, outgoing, badge: hasBadge(row), sig: `${time}|${preview}`, y: row.getBoundingClientRect().top };
  };
  // O HTML enviado não tinha nenhuma conversa não lida, então a marcação exata do contador não pôde ser
  // confirmada. Por isso a detecção NÃO depende só dele: veja também a mudança de prévia em detectNew().
  const hasBadge = (row) => {
    for (const el of row.querySelectorAll('[aria-label],[data-testid],[data-icon]')) {
      const s = norm([el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-icon')].join(' '));
      if (/nao lid|unread/.test(s)) return true;
    }
    const col = row.querySelector('[data-testid="cell-frame-secondary"] [role="gridcell"][aria-colindex="1"]');
    return !!col && [...col.querySelectorAll('span')].some((el) => !el.children.length && /^\d{1,4}\+?$/.test((el.textContent || '').trim()));
  };
  const chatRows = () => {
    const pane = document.querySelector(SEL.chatList) || document.querySelector('#pane-side');
    if (!pane) return [];
    let rows = [...pane.querySelectorAll('[data-testid^="list-item-"]')];
    if (!rows.length) rows = [...pane.querySelectorAll('[role="row"]')];
    return rows.map(rowInfo).filter(Boolean);
  };

  // ---------- monitor ----------
  let running = false, runId = 0, busy = false, baselineDone = false;
  const sigs = new Map();      // chave da conversa -> última assinatura (hora|prévia) vista
  const handled = new Map();   // chave -> assinatura já tratada
  const answered = new Map();  // chave -> id da última mensagem do cliente já enviada ao bot
  const pending = [];          // fila FIFO por ordem de chegada: { key, name, at }

  const detectNew = () => {
    const rows = chatRows();
    const fresh = [];
    for (const r of rows) {
      const prev = sigs.get(r.key);
      sigs.set(r.key, r.sig);
      const changed = baselineDone && prev !== r.sig;           // prévia/hora mudou (ou conversa nova)
      if ((r.badge || (changed && !r.outgoing)) && handled.get(r.key) !== r.sig && !pending.some((p) => p.key === r.key)) fresh.push(r);
    }
    baselineDone = true;
    // A lista fica ordenada da mais recente (topo) para a mais antiga (base): quem chegou primeiro está mais embaixo.
    fresh.sort((a, b) => b.y - a.y);
    const now = Date.now();
    fresh.forEach((r, i) => { pending.push({ key: r.key, name: r.name, at: now + i }); log('nova interação', r.name, r.badge ? '(contador)' : '(prévia mudou)'); });
  };

  const respondIfNeeded = async () => {
    const name = title();
    if (!name) return false;
    const ms = read();
    const latest = ms.at(-1);
    if (!latest || latest.dir !== 'in' || !latest.text) return false;
    if (isGroup(ms, name)) { log('grupo ignorado', name); return false; }
    const k = keyOf(name);
    if (answered.get(k) === latest.id) return false;
    answered.set(k, latest.id); // reserva antes de emitir: nunca reenvia em caso de falha/timeout
    log('enviando ao bot', name, latest.text.slice(0, 40));
    try {
      await chrome.runtime.sendMessage({
        type: 'INCOMING', net: 'whatsapp', chat: name, group: false, text: latest.text, messageId: latest.id,
        messages: ms.filter((m) => m.text).map(({ id, dir, text }) => ({ id, dir, text })), unreadScan: true,
      });
    } catch (_) {}
    return true;
  };

  const openChat = async (key) => {
    const find = () => chatRows().find((r) => r.key === key);
    if (keyOf(title()) === key && document.querySelector(SEL.conversationPanel)) return true;
    for (const mode of ['title', 'container']) {
      const r = find();
      if (!r) return false;
      const target = mode === 'title'
        ? (r.row.querySelector('[data-testid="cell-frame-title"] span[title]') || r.row)
        : (r.row.querySelector('[data-testid="cell-frame-container"]') || r.row);
      CC.clickDeep(target);
      const ok = await CC.waitFor(() => {
        const cur = find();
        return (keyOf(title()) === key || !!cur?.row.querySelector('[aria-selected="true"]')) && document.querySelector(SEL.conversationPanel);
      }, 5000, 150);
      if (ok) {
        await CC.waitFor(() => read().length, 5000, 150);
        await CC.sleep(500);
        return true;
      }
    }
    return false;
  };

  const processQueue = async (id) => {
    while (pending.length && running && id === runId) {
      pending.sort((a, b) => a.at - b.at);
      const item = pending.shift();
      if (!(await openChat(item.key))) { log('não consegui abrir', item.name); continue; }
      await respondIfNeeded();
      const after = chatRows().find((r) => r.key === item.key);
      if (after) { handled.set(item.key, after.sig); sigs.set(item.key, after.sig); }
    }
  };

  const tick = async () => {
    if (busy || !running) return;
    busy = true;
    const id = runId;
    try {
      detectNew();
      await processQueue(id);
      if (running && id === runId && !pending.length) await respondIfNeeded(); // conversa que já está aberta
    } catch (e) { log('erro no ciclo', e); }
    finally { busy = false; }
  };

  const loop = async (id) => {
    while (running && id === runId) {
      await tick();
      await CC.sleep(2500);
    }
  };

  // Reage rápido a mudanças do DOM e ao contador "(1) WhatsApp" do título, sem esperar o ciclo.
  let kicked = false;
  const kick = () => {
    if (!running || kicked || busy) return;
    kicked = true;
    CC.sleep(300).then(() => { kicked = false; tick().catch(() => {}); });
  };
  new MutationObserver(kick).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const titleNode = document.querySelector('title');
  if (titleNode) new MutationObserver(kick).observe(titleNode, { childList: true, characterData: true, subtree: true });

  CC.handlers.CHAT_WATCH = ({ on }) => {
    running = false;
    runId++;
    if (on) {
      sigs.clear(); handled.clear(); answered.clear(); pending.length = 0; baselineDone = false;
      running = true;
      loop(runId);
    }
    return { ok: true, monitoring: running, scope: 'todas as conversas individuais, por ordem de chegada' };
  };
})();
