// Background do Coletor Meli: testes de cupom sequenciais e uma única aba de produto ativa.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitTabComplete(tabId, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return tab;
    } catch (_) { throw new Error('A aba auxiliar foi fechada.'); }
    await sleep(200);
  }
  return await chrome.tabs.get(tabId);
}

async function getBatch() {
  const data = await chrome.storage.local.get('meliBatchWorkflow');
  return data.meliBatchWorkflow || null;
}
async function saveBatch(batch) {
  await chrome.storage.local.set({meliBatchWorkflow: batch});
}
async function setStatus(message, extra = {}) {
  await chrome.storage.local.set({meliCollectorStatus: {message, time: Date.now(), ...extra}});
}

async function probeOne(sourceUrl, index) {
  let tab;
  const spawnedTabIds = new Set();
  try {
    const source = new URL(sourceUrl);
    const probeUrl = new URL(sourceUrl);
    probeUrl.searchParams.set('__meli_probe', '1');
    tab = await chrome.tabs.create({url: probeUrl.href, active: false});
    await waitTabComplete(tab.id, 15000);
    await sleep(500);
    const before = (await chrome.tabs.get(tab.id)).url || probeUrl.href;
    const beforeIds = new Set((await chrome.tabs.query({})).map(t => t.id));
    // Clicking may navigate the probe tab immediately, unloading its content script
    // before sendMessage can return. Treat that specific failure as expected and still
    // observe the tab URL / any newly opened tab below.
    let response = null;
    try { response = await chrome.tabs.sendMessage(tab.id, {type: 'probeCouponButton', index}); }
    catch (_) { /* navigation may have interrupted the reply */ }
    if (response && response.ok === false) return null;

    const start = Date.now();
    let foundUrl = null;
    let candidateId = null;
    let lastCandidateUrl = '';
    let stableSince = 0;
    // Observe both possible behaviors: navigation in the probe tab or window.open/new tab.
    while (Date.now() - start < 14000) {
      await sleep(250);
      let tabs = [];
      try { tabs = await chrome.tabs.query({}); } catch (_) {}
      const spawned = tabs.filter(t => !beforeIds.has(t.id) && t.id !== tab.id);
      for (const t of spawned) {
        spawnedTabIds.add(t.id);
        if (!t.url || !/^https?:/i.test(t.url) || t.url === 'about:blank') continue;
        if (t.url !== lastCandidateUrl || candidateId !== t.id) {
          lastCandidateUrl = t.url;
          candidateId = t.id;
          stableSince = Date.now();
        }
        // Wait for redirects to settle and the destination document to finish loading.
        if (Date.now() - stableSince >= 900 && t.status === 'complete' && isUsableDestination(t.url, sourceUrl, probeUrl.href)) {
          foundUrl = t.url;
          break;
        }
      }
      if (foundUrl) break;
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.url && current.url !== before && current.url !== 'about:blank' && isUsableDestination(current.url, sourceUrl, probeUrl.href)) {
          if (current.url !== lastCandidateUrl || candidateId !== tab.id) {
            lastCandidateUrl = current.url;
            candidateId = tab.id;
            stableSince = Date.now();
          }
          if (Date.now() - stableSince >= 900 && current.status === 'complete') {
            foundUrl = current.url;
            break;
          }
        }
      } catch (_) { break; }
    }
    if (foundUrl) {
      try { const u = new URL(foundUrl); u.searchParams.delete('__meli_probe'); foundUrl = u.href; } catch (_) {}
    }
    return foundUrl;
  } catch (_) {
    return null;
  } finally {
    for (const id of spawnedTabIds) { try { await chrome.tabs.remove(id); } catch (_) {} }
    if (tab?.id != null) { try { await chrome.tabs.remove(tab.id); } catch (_) {} }
  }
}

function isUsableDestination(candidate, sourceUrl, probeUrl) {
  try {
    const u = new URL(candidate);
    const source = new URL(sourceUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (candidate === sourceUrl || candidate === probeUrl) return false;
    // Do not mistake the coupon list itself (or its tracking-only variant) for a destination.
    if (u.origin === source.origin && u.pathname === source.pathname) return false;
    // Mercado Livre sometimes opens a generic homepage when a destination was not captured.
    if (u.hostname === 'hp.mercadolibre.com' && (u.pathname === '/' || u.pathname === '')) return false;
    return true;
  } catch (_) { return false; }
}

async function openProductTab(batch) {
  if (!batch?.active || batch.stage !== 'products') return;
  const rawLink = batch.links?.[batch.linkIndex];
  const link = typeof rawLink === 'string' ? {url: rawLink, couponName: 'Cupom sem nome'} : rawLink;
  const url = link?.url;
  if (!url) {
    batch.active = false;
    batch.stage = 'done';
    batch.finishedAt = new Date().toISOString();
    batch.productTabId = null;
    await saveBatch(batch);
    await setStatus(`Fluxo concluído. ${batch.links?.length || 0} links processados.`, {batch: true, stage: 'done'});
    return;
  }
  // A lista temporária é isolada por destino; meliCatalog permanece como histórico local.
  await chrome.storage.local.set({meliItems: []});
  batch.currentCouponName = link.couponName || 'Cupom sem nome';
  batch.currentCouponPart = 1;
  batch.currentCouponHadParts = false;
  batch.currentCouponExportedCount = 0;
  await saveBatch(batch);
  // Só existe uma aba de produto por vez; ela é fechada antes da próxima ser criada.
  const tab = await chrome.tabs.create({url, active: true});
  batch.productTabId = tab.id;
  await saveBatch(batch);
  await setStatus(`Abrindo link ${batch.linkIndex + 1}/${batch.links.length} — cupom ${batch.currentCouponName}: coletando páginas deste destino.`, {
    batch: true, stage: 'products', linkIndex: batch.linkIndex + 1, totalLinks: batch.links.length, pageIndex: batch.pageIndex || 1
  });
}

async function downloadCsv(csv, filename) {
  if (!chrome.offscreen) throw new Error('Este Chrome não oferece suporte ao documento auxiliar de download.');
  const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
  if (!contexts.length) {
    await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Criar o arquivo CSV para exportação.'});
  }
  const blobResult = await chrome.runtime.sendMessage({target: 'offscreen', type: 'createCsvBlobUrl', csv});
  if (!blobResult?.ok || !blobResult.url) throw new Error('Não consegui preparar o arquivo CSV.');
  const downloadId = await chrome.downloads.download({url: blobResult.url, filename, saveAs: false, conflictAction: 'uniquify'});
  setTimeout(() => chrome.runtime.sendMessage({target: 'offscreen', type: 'revokeBlobUrl', url: blobResult.url}).catch(() => {}), 60000);
  return downloadId;
}
function finalCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
async function exportFinal() {
  const d = await chrome.storage.local.get('converterState');
  const s = d.converterState;
  if (!s?.rows?.length) return {ok: false, error: 'Ainda não há produtos na planilha.'};
  const headers = ['marketplace', 'cupom', 'id', 'nome', 'preco', 'preco_anterior', 'preco_com_desconto', 'categoria', 'imagem url', 'url', 'link_afiliado', 'status_conversao'];
  const marketplace = s.marketplace || (await chrome.storage.local.get('pipelineSettings')).pipelineSettings?.marketplace || 'mercadolivre';
  const rows = s.rows.map(r => {
    const base = Array.from({length: 9}, (_, i) => r.cells?.[i] ?? '');
    const ok = r.status === 'OK';
    return [marketplace, ...base, ok ? r.affiliate : '', ok ? 'OK' : (r.status || 'Pendente')];
  });
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(finalCell).join(';')).join('\r\n');
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}_${p2(t.getHours())}${p2(t.getMinutes())}`;
  const downloadId = await downloadCsv(csv, `Coletor_${marketplace}_convertido_${stamp}.csv`);
  return {ok: true, downloadId, rows: rows.length};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Espera feita aqui (service worker): timers de abas em segundo plano são reduzidos
  // pelo Chrome, mas a resposta de uma mensagem não sofre essa limitação.
  if (msg?.type === 'sleep') {
    setTimeout(() => { try { sendResponse({ok: true}); } catch (_) {} }, Math.min(Math.max(Number(msg.ms) || 0, 0), 10000));
    return true;
  }
  if (msg?.type === 'exportFinal') {
    exportFinal().then(sendResponse).catch(e => sendResponse({ok: false, error: String(e?.message || e)}));
    return true;
  }
  (async () => {
    if (msg?.type === 'downloadCouponCsv') {
      if (typeof msg.csv !== 'string' || typeof msg.filename !== 'string') {
        sendResponse({ok: false, error: 'CSV ou nome do arquivo ausente.'}); return;
      }
      if (!chrome.offscreen) { sendResponse({ok: false, error: 'Este Chrome não oferece suporte ao documento auxiliar de download.'}); return; }
      const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
      if (!contexts.length) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['BLOBS'],
          justification: 'Criar um arquivo CSV grande para exportação automática por cupom.'
        });
      }
      const blobResult = await chrome.runtime.sendMessage({target: 'offscreen', type: 'createCsvBlobUrl', csv: msg.csv});
      if (!blobResult?.ok || !blobResult.url) { sendResponse({ok: false, error: 'Não consegui preparar o arquivo CSV.'}); return; }
      const downloadId = await chrome.downloads.download({url: blobResult.url, filename: msg.filename, saveAs: false, conflictAction: 'uniquify'});
      setTimeout(() => chrome.runtime.sendMessage({target: 'offscreen', type: 'revokeBlobUrl', url: blobResult.url}).catch(() => {}), 60000);
      sendResponse({ok: true, downloadId});
      return;
    }
    if (msg?.type === 'registerBatchController') {
      sendResponse({ok: true, tabId: sender.tab?.id ?? null});
      return;
    }
    if (msg?.type === 'getBatchRole') {
      const batch = await getBatch();
      const tabId = sender.tab?.id;
      let role = 'none';
      if (batch?.active && tabId != null && tabId === batch.controllerTabId && batch.stage === 'coupons') role = 'controller';
      if (batch?.active && tabId != null && tabId === batch.productTabId && batch.stage === 'products') role = 'product';
      sendResponse({ok: true, role});
      return;
    }
    if (msg?.type === 'openBatchProduct') {
      const batch = await getBatch();
      if (!batch?.active || batch.stage !== 'products' || sender.tab?.id !== batch.controllerTabId) {
        sendResponse({ok: false, error: 'Aba controladora inválida.'}); return;
      }
      await openProductTab(batch);
      sendResponse({ok: true});
      return;
    }
    if (msg?.type === 'batchProductFinished') {
      const batch = await getBatch();
      const finishedTabId = sender.tab?.id;
      if (!batch?.active || batch.stage !== 'products' || finishedTabId == null || finishedTabId !== batch.productTabId) {
        sendResponse({ok: false, ignored: true}); return;
      }
      // Avança o índice somente após a última página do link atual ter sido capturada.
      batch.linkIndex = (batch.linkIndex || 0) + 1;
      batch.pageIndex = 1;
      batch.productTabId = null;
      await saveBatch(batch);
      try { await chrome.tabs.remove(finishedTabId); } catch (_) {}
      if (batch.linkIndex >= (batch.links || []).length) {
        batch.active = false;
        batch.stage = 'done';
        batch.finishedAt = new Date().toISOString();
        await saveBatch(batch);
        await chrome.storage.local.set({pipelineCollectionDone: true});
        const data = await chrome.storage.local.get('meliItems');
        const total = Array.isArray(data.meliItems) ? data.meliItems.length : 0;
        await setStatus(`Fluxo concluído. ${batch.links.length} links processados e ${total} produtos salvos.`, {batch: true, stage: 'done', totalLinks: batch.links.length, total});
        sendResponse({ok: true, done: true});
        return;
      }
      await setStatus(`Link concluído. Aba fechada; preparando link ${batch.linkIndex + 1}/${batch.links.length}...`, {batch: true, stage: 'products', linkIndex: batch.linkIndex + 1, totalLinks: batch.links.length});
      await openProductTab(batch);
      sendResponse({ok: true, done: false});
      return;
    }
    if (msg?.type === 'probeCouponButtonDestination') {
      const batch = await getBatch();
      if (!batch?.active || batch.stage !== 'coupons' || sender.tab?.id !== batch.controllerTabId) {
        sendResponse({ok: false, error: 'Aba controladora inválida.', url: null}); return;
      }
      const sourceUrl = String(msg.url || sender.tab?.url || '');
      const index = Math.max(0, Math.min(100, Number(msg.index) || 0));
      const url = await probeOne(sourceUrl, index);
      sendResponse({ok: true, url});
      return;
    }
    if (msg?.type === 'probeCouponPage') {
      const sourceUrl = String(msg.url || sender.tab?.url || '');
      const count = Math.max(0, Math.min(100, Number(msg.count) || 0));
      const links = [];
      for (let i = 0; i < count; i++) {
        const url = await probeOne(sourceUrl, i);
        if (url && /^https?:/i.test(url) && url !== sourceUrl) links.push(url);
      }
      sendResponse({ok: true, links: [...new Set(links)], tested: count});
      return;
    }
    sendResponse({ok: false, error: 'Mensagem não reconhecida.'});
  })().catch(error => {
    try { sendResponse({ok: false, error: String(error), links: []}); } catch (_) {}
  });
  return true;
});
