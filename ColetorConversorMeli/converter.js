(() => {
  if (window.__meliPipelineConverterV3) return;
  window.__meliPipelineConverterV3 = true;

  const BATCH = 30;
  const FLUSH_AFTER_MS = 5 * 60 * 1000; // converte um lote incompleto se a coleta ficar parada por 5 min
  let working = false;

  // A espera passa pelo service worker: em aba de segundo plano o Chrome atrasa setTimeout
  // (até 1 min por ciclo), mas a resposta de uma mensagem chega sem esse atraso.
  const sleep = ms => chrome.runtime.sendMessage({type: 'sleep', ms}).catch(() => new Promise(r => setTimeout(r, ms)));

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };

  function labelText(el) {
    let a = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name')];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) a.push(l.innerText); }
    if (el.closest('label')) a.push(el.closest('label').innerText);
    if (el.previousElementSibling) a.push(el.previousElementSibling.innerText);
    return norm(a.filter(Boolean).join(' '));
  }
  function findInput() {
    const c = [...document.querySelectorAll('textarea,input:not([type="hidden"]):not([type="button"]):not([type="submit"])')].filter(visible).filter(e => !e.readOnly && !e.disabled);
    const scored = c.map(el => { const t = labelText(el); let score = 0; if (/produto|link|url/.test(t)) score += 5; if (/cole|digite|insira/.test(t)) score += 3; if (/busca|pesquisa|email|senha/.test(t)) score -= 8; if (el.tagName === 'TEXTAREA') score += 2; return {el, score}; }).sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].el : c.find(e => e.tagName === 'TEXTAREA') || null;
  }
  function findButton() {
    const a = [...document.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(visible);
    return a.find(e => /^(gerar|gerar link|gerar links|criar link|converter)$/i.test(norm(e.innerText || e.value || e.getAttribute('aria-label')))) || a.find(e => /gerar/.test(norm(e.innerText || e.value || e.getAttribute('aria-label'))));
  }
  function outputCandidates(input) {
    const els = [...document.querySelectorAll('textarea,input,[contenteditable="true"],a[href]')].filter(visible), out = [];
    for (const el of els) {
      if (el === input) continue;
      const val = String(el.value ?? el.innerText ?? el.getAttribute('href') ?? '').trim();
      if (!val) continue;
      const urls = val.match(/https?:\/\/[^\s"'<>]+/g) || [];
      const lab = labelText(el);
      let score = 0;
      if (/saida|gerado|resultado|afiliado|copiar/.test(lab)) score += 8;
      if (urls.length) score += Math.min(urls.length, 40);
      if (/affiliat|tracking|utm_source|meli\.la|mercadolivre\.com\/sec\//i.test(val)) score += 4;
      if (el.tagName === 'TEXTAREA') score += 2;
      if (score > 0) out.push({val, urls, score, label: lab});
    }
    return out.sort((a, b) => b.score - a.score);
  }
  const ERR_RE = /erro|falha|nao elegivel|não elegível|nao participa|não participa|não foi possível|nao foi possivel|inválido|invalido|indisponivel|indisponível/i;
  // Cada linha da saída (link ou mensagem de erro) ocupa a posição do produto de entrada.
  function getOutputEntries(input) {
    const a = outputCandidates(input);
    if (!a.length) return [];
    const multi = a.filter(x => x.urls.length > 1).sort((x, y) => y.score - x.score)[0];
    const chosen = multi || a.sort((x, y) => y.score - x.score)[0];
    const raw = String(chosen?.val || '').trim();
    if (!raw) return [];
    const entries = [];
    for (const line of raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      const m = line.match(/https?:\/\/[^\s"'<>]+/i);
      if (m) entries.push({value: m[0].replace(/[),.;]+$/, ''), ok: true});
      else if (ERR_RE.test(line) || /afiliado/i.test(line)) entries.push({value: line, ok: false});
    }
    if (entries.length < 2) {
      const separate = [];
      for (const x of a) {
        const line = String(x.val || '').trim();
        if (!line) continue;
        const m = line.match(/https?:\/\/[^\s"'<>]+/i);
        if (m) separate.push({value: m[0].replace(/[),.;]+$/, ''), ok: true});
        else if (ERR_RE.test(line)) separate.push({value: line, ok: false});
      }
      if (separate.length > entries.length) return separate;
    }
    return entries;
  }
  function getErrorText() {
    const selectors = '[role="alert"],[aria-live="assertive"],[aria-live="polite"],.andes-message,.andes-snackbar,[class*="error"],[class*="Error"],[class*="alert"],[class*="Alert"]';
    return [...document.querySelectorAll(selectors)].filter(visible).map(e => (e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 1200);
  }
  function classifyError(t) {
    const x = norm(t);
    if (!x) return '';
    if (/captcha|nao sou um robo|verifique que voce e humano|atividade suspeita|muitas solicitacoes|limite de solicitacoes|tente novamente mais tarde|temporariamente bloquead/.test(x)) return 'GLOBAL';
    if (/nao participa|nao elegivel|nao e elegivel|nao pode ser convertido|link invalido|produto indisponivel para afiliado|nao disponivel para afiliado/.test(x)) return 'ITEM';
    return '';
  }
  function setValue(el, v) {
    const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(p, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }

  async function waitBatchResult(input, beforeSig, expected, isCurrent, timeout = 25000) {
    const start = Date.now();
    let lastSig = '', stable = 0;
    while (Date.now() - start < timeout) {
      await sleep(250);
      if (!(await isCurrent())) return {kind: 'ABORT'};
      const err = getErrorText(), kind = classifyError(err);
      if (kind === 'GLOBAL') return {kind: 'GLOBAL', error: err};
      const entries = getOutputEntries(input), sig = entries.map(e => e.value).join('\n');
      if (entries.length >= expected && sig !== beforeSig) {
        if (sig === lastSig) stable++; else stable = 0;
        lastSig = sig;
        if (stable >= 1) return {kind: 'OK', entries, error: err};
      } else if (entries.length && sig !== beforeSig) {
        if (sig === lastSig) stable++; else stable = 0;
        lastSig = sig;
        if (stable >= 5) return {kind: kind || 'PARTIAL', entries, error: err};
      }
      if (kind === 'ITEM' && Date.now() - start > 3500) return {kind: 'ITEM', error: err, entries};
    }
    return {kind: 'TIMEOUT', entries: getOutputEntries(input)};
  }

  async function control() {
    const d = await chrome.storage.local.get(['pipelineRunId', 'pipelineRunning', 'pipelineCollectionDone', 'pipelineChunkCount']);
    return {runId: d.pipelineRunId || 0, running: !!d.pipelineRunning, done: !!d.pipelineCollectionDone, chunks: d.pipelineChunkCount || 0};
  }
  function computeStats(s) {
    let ok = 0, err = 0, pending = 0;
    for (const r of s.rows) { if (r.status === 'OK') ok++; else if (r.status === 'Pendente') pending++; else err++; }
    s.stats = {total: s.rows.length, ok, err, pending};
  }
  async function save(s) {
    computeStats(s);
    await chrome.storage.local.set({converterState: s, converterStats: {...s.stats, message: s.message || '', finalized: !!s.finalized, runId: s.runId, time: Date.now()}});
  }
  async function setMessage(s, message) { s.message = message; await save(s); }
  async function pauseRun(s, message) {
    s.message = message;
    await save(s);
    await chrome.storage.local.set({pipelineRunning: false});
  }

  async function loop() {
    if (working) return;
    working = true;
    try {
      while (true) {
        let c = await control();
        if (!c.runId || !c.running) break;
        const isCurrent = async () => { const x = await control(); return x.runId === c.runId && x.running; };

        let s = (await chrome.storage.local.get('converterState')).converterState;
        if (!s || s.runId !== c.runId) s = {...(s || {}), runId: c.runId, rows: s?.rows || [], taken: 0, lastGrowth: Date.now(), message: 'Aguardando os primeiros produtos da coleta...', finalized: false};
        if (!s.marketplace) s.marketplace = (await chrome.storage.local.get('pipelineSettings')).pipelineSettings?.marketplace || 'mercadolivre';
        if (s.finalized) break;
        computeStats(s);

        // 1) Traz os blocos novos entregues pelo coletor.
        if (s.taken < c.chunks) {
          const keys = []; for (let i = s.taken; i < c.chunks; i++) keys.push('pipelineChunk_' + i);
          const got = await chrome.storage.local.get(keys);
          const have = new Map(s.rows.map((r, i) => [r.original, i]));
          for (const k of keys) for (const cells of (got[k] || [])) {
            const original = String(cells[8] || '').trim();
            const index = have.get(original);
            if (index !== undefined) {
              const row = s.rows[index];
              row.cells = row.cells.map((value, i) => cells[i] || value || '');
              if (row.status !== 'OK') row.status = original ? 'Pendente' : 'Erro real: produto sem URL';
              continue;
            }
            have.set(original, s.rows.length);
            s.rows.push({cells, original, affiliate: '', status: original ? 'Pendente' : 'Erro real: produto sem URL', retryCount: 0});
          }
          s.taken = c.chunks; s.lastGrowth = Date.now();
          await save(s);
        }

        // 2) Produtos repetidos (mesma URL em cupons diferentes) reaproveitam o link já gerado.
        const done = new Map();
        for (const r of s.rows) if (r.status === 'OK' && r.affiliate) done.set(r.original, r.affiliate);
        let reused = 0;
        for (const r of s.rows) if (r.status === 'Pendente' && done.has(r.original)) { r.affiliate = done.get(r.original); r.status = 'OK'; reused++; }
        if (reused) await save(s);

        const now = Date.now();
        const delayed = s.rows.some(r => r.status === 'Pendente' && r.nextRetryAt && r.nextRetryAt > now);
        const pending = s.rows.map((r, i) => ({r, i})).filter(x => x.r.status === 'Pendente' && (!x.r.nextRetryAt || x.r.nextRetryAt <= now));
        const allTaken = s.taken >= c.chunks; // c.done foi lido antes de c.chunks: se done, chunks é final

        if (!pending.length) {
          if (delayed) {
            await setMessage(s, `Aguardando reteste de ${s.rows.filter(r => r.status === 'Pendente').length} produto(s)...`);
            await sleep(1000);
            continue;
          }
          if (c.done && allTaken) {
            s.finalized = true;
            if (!s.rows.length) { await setMessage(s, 'Coleta terminou sem nenhum produto. Nada para exportar.'); }
            else {
              await setMessage(s, 'Concluído. Baixando a planilha final...');
              const res = await chrome.runtime.sendMessage({type: 'exportFinal'}).catch(e => ({ok: false, error: String(e)}));
              await setMessage(s, res?.ok ? `Concluído: planilha final baixada com ${res.rows} produtos (${s.stats.ok} com link de afiliado, ${s.stats.err} com erro).` : `Concluído, mas o download falhou (${res?.error || 'erro'}). Use "Exportar planilha agora".`);
            }
            await chrome.storage.local.set({pipelineRunning: false});
            break;
          }
          await setMessage(s, `Aguardando coleta... ${s.stats.ok}/${s.stats.total} convertidos.`);
          await sleep(2000);
          continue;
        }

        // 3) Monta o lote com até 30 URLs únicas.
        const seen = new Set(), group = [];
        for (const {r, i} of pending) { if (!seen.has(r.original)) { seen.add(r.original); group.push(i); if (group.length === BATCH) break; } }
        const flush = c.done || (Date.now() - s.lastGrowth > FLUSH_AFTER_MS);
        if (group.length < BATCH && !flush) {
          await setMessage(s, `Aguardando lote completo: ${group.length}/${BATCH} prontos. ${s.stats.ok}/${s.stats.total} convertidos.`);
          await sleep(2000);
          continue;
        }

        const input = findInput(), button = findButton();
        if (!input || !button) { await pauseRun(s, 'Não encontrei o campo de link ou o botão Gerar no Linkbuilder. Confirme que a página terminou de carregar e clique em Continuar.'); break; }

        const beforeSig = getOutputEntries(input).map(e => e.value).join('\n');
        setValue(input, group.map(i => s.rows[i].original).join('\n'));
        await sleep(300);
        button.click();
        await setMessage(s, `Convertendo lote de ${group.length} links... ${s.stats.ok}/${s.stats.total} convertidos.`);

        const result = await waitBatchResult(input, beforeSig, group.length, isCurrent, 25000);
        if (result.kind === 'ABORT') break;
        if (!(await isCurrent())) break;
        // Relê o estado (o usuário pode ter zerado) antes de gravar.
        const latest = (await chrome.storage.local.get('converterState')).converterState;
        if (!latest || latest.runId !== c.runId) break;
        s = latest;

        if (result.kind === 'GLOBAL') { await pauseRun(s, 'Pausa de segurança: CAPTCHA, bloqueio ou limite de solicitações no Linkbuilder. Resolva na aba dele e clique em Continuar.'); break; }

        const entries = result.entries || [];
        if (entries.length === group.length) {
          let ok = 0, bad = 0;
          group.forEach((idx, pos) => {
            const row = s.rows[idx], e = entries[pos];
            if (e.ok) { row.affiliate = e.value; row.status = 'OK'; row.nextRetryAt = 0; ok++; }
            else if (classifyError(e.value) === 'ITEM') { row.affiliate = ''; row.status = 'Erro real: ' + e.value; row.nextRetryAt = 0; bad++; }
            else {
              row.affiliate = '';
              row.retryCount = (row.retryCount || 0) + 1;
              row.nextRetryAt = Date.now() + Math.min(30000, 2000 * row.retryCount);
              row.status = 'Pendente';
            }
          });
          await setMessage(s, `Lote convertido: ${ok} links e ${bad} erro(s) registrados na linha de cada produto.`);
        } else {
          // Quantidade diferente da enviada: não dá para saber quais linhas faltaram, então não
          // associa links por posição (evita afiliado na linha errada).
          const msg = (result.error || '').trim();
          for (const idx of group) {
            const row = s.rows[idx];
            row.retryCount = (row.retryCount || 0) + 1;
            row.nextRetryAt = Date.now() + Math.min(30000, 2000 * row.retryCount);
            row.status = 'Pendente';
          }
          await setMessage(s, `Lote incompleto (${entries.length} de ${group.length}); os produtos permaneceram pendentes e serão retestados.`);
        }
        await sleep(300);
      }
    } catch (e) {
      try {
        const s = (await chrome.storage.local.get('converterState')).converterState;
        if (s) await pauseRun(s, 'Erro inesperado no conversor: ' + (e?.message || String(e)) + '. Clique em Continuar.');
      } catch (_) {}
    } finally { working = false; }
  }

  chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (m?.action === 'START') { sendResponse({ok: true}); loop(); return; }
    if (m?.action === 'PING') { sendResponse({ok: true}); return; }
  });

  // Se a aba do Linkbuilder for recarregada no meio do fluxo, retoma sozinha.
  setTimeout(async () => { const c = await control(); if (c.runId && c.running) loop(); }, 1500);
})();
