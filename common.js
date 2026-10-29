// Utilitários compartilhados pelos content scripts (rodam dentro das abas das redes).
(() => {
  if (window.__CC) return;
  const CC = (window.__CC = { handlers: {}, parts: {}, files: {} });

  // Em aba oculta o Chrome limita setTimeout (1x/s e até 1x/min). Para esperas longas
  // o relógio vem do service worker, que não sofre essa limitação.
  CC.sleep = (ms) => new Promise((resolve) => {
    if (!document.hidden || ms < 120) return setTimeout(resolve, ms);
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { chrome.runtime.sendMessage({ type: 'CC_SLEEP', ms }, () => { void chrome.runtime.lastError; fin(); }); }
    catch (_) { setTimeout(fin, ms); }
    setTimeout(fin, ms + 15000);
  });

  CC.waitFor = async (fn, timeout = 15000, step = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v;
      try { v = fn(); } catch (_) {}
      if (v) return v;
      await CC.sleep(step);
    }
    return null;
  };

  // Escreve texto em <input>, <textarea> ou campo contenteditable (editores React/Lexical/Draft).
  CC.setText = (el, text) => {
    el.focus();
    if (!el.isContentEditable) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const probe = text.trim().slice(0, 12);
    if (probe && !el.innerText.includes(probe)) {
      text.split('\n').forEach((line, i) => {
        if (i) document.execCommand('insertLineBreak');
        if (line) document.execCommand('insertText', false, line);
      });
    }
  };

  CC.click = (el) => {
    ['mousedown', 'mouseup', 'click'].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
    );
  };

  // Clique completo (pointer + mouse) no elemento mais interno: o evento sobe (bubbles) por todos
  // os ancestrais, então qualquer handler do React na cadeia é acionado.
  CC.clickDeep = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: r.left + Math.min(r.width / 2, 40), clientY: r.top + r.height / 2 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => {
      const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(t, o));
    });
  };

  CC.findByText = (selector, regex) =>
    [...document.querySelectorAll(selector)].find((e) =>
      regex.test(((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim())
    );

  CC.attach = (input, fileOrFiles) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const dt = new DataTransfer();
    files.filter(Boolean).forEach(file => dt.items.add(file));
    if (files.filter(Boolean).length > 1) input.multiple = true;
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  CC.banner = (msg) => {
    let b = document.getElementById('__cc_banner');
    if (!b) {
      b = document.createElement('div');
      b.id = '__cc_banner';
      b.style.cssText =
        'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#14222b;color:#fff;padding:10px 16px;border-radius:8px;font:14px system-ui;box-shadow:0 4px 20px rgba(0,0,0,.35);cursor:pointer';
      b.title = 'Clique para fechar';
      b.onclick = () => b.remove();
      document.body.appendChild(b);
    }
    b.textContent = msg;
  };

  chrome.runtime.onMessage.addListener((m, _sender, send) => {
    if (m.type === 'PING') { send({ ok: true }); return; }
    if (m.type === 'FILE_CHUNK') {
      const arr = (CC.parts[m.id] = CC.parts[m.id] || []);
      arr[m.idx] = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
      if (arr.filter(Boolean).length === m.total) {
        CC.files[m.id] = new File(arr, m.name, { type: m.mime || 'application/octet-stream' });
        delete CC.parts[m.id];
      }
      send({ ok: true });
      return;
    }
    const h = CC.handlers[m.type];
    if (!h) return;
    Promise.resolve(h(m)).then(send).catch((e) => send({ ok: false, error: String((e && e.message) || e) }));
    return true;
  });
})();
