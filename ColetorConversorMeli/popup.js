const $ = id => document.getElementById(id);
const LB = 'https://www.mercadolivre.com.br/afiliados/linkbuilder*';
const err = m => { $('err').textContent = m || ''; };

async function linkbuilderTab() {
  const tabs = await chrome.tabs.query({currentWindow: true, url: LB});
  return tabs[0] || null;
}
async function startConverter(tab) {
  try { await chrome.tabs.sendMessage(tab.id, {action: 'START'}); }
  catch (_) {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['converter.js']});
    await chrome.tabs.sendMessage(tab.id, {action: 'START'});
  }
}
async function activeTab() { return (await chrome.tabs.query({active: true, currentWindow: true}))[0]; }

async function clearPipeline() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('pipelineChunk_'));
  await chrome.storage.local.remove([...keys, 'converterStats', 'pipelineChunkCount', 'meliCollectorStatus', 'meliCollectorEventLog', 'meliCollectorPageLog']);
  await chrome.storage.local.set({meliItems: []});
}

function extractLinks(value) {
  return [...new Set(String(value || '').match(/https?:\/\/[^\s"'<>]+/gi) || [])]
    .map(url => url.replace(/[),.;]+$/, ''));
}

$('start').onclick = async () => {
  err('');
  try {
    const marketplace = $('marketplace').value;
    const manualLinks = extractLinks($('manualLinks').value);
    const lb = await linkbuilderTab();
    if (marketplace === 'mercadolivre' && !lb) throw new Error('Abra o Linkbuilder (mercadolivre.com.br/afiliados/linkbuilder) em uma aba desta janela.');
    const tab = await activeTab();
    if (!tab?.url || (marketplace === 'mercadolivre' && !tab.url.includes('mercadolivre.com.br')) || (marketplace === 'shopee' && !/shopee\./i.test(tab.url))) throw new Error(`Deixe uma página do ${marketplace === 'shopee' ? 'Shopee' : 'Mercado Livre'} ativa e clique em Iniciar de novo.`);
    if (lb && tab.id === lb.id) throw new Error('Deixe a página de coleta ativa, não o Linkbuilder.');
    const pages = Math.max(1, Math.min(100, parseInt($('pageCount').value, 10) || 1));
    $('pageCount').value = String(pages);
    await clearPipeline();
    await chrome.storage.local.set({
      pipelineRunId: Date.now(), pipelineRunning: true, pipelineCollectionDone: false,
      pipelineSettings: {backupCsv: $('backup').checked, marketplace},
      pipelineManualLinks: manualLinks
    });
    const previous = (await chrome.storage.local.get('converterState')).converterState;
    if (previous?.rows?.length) {
      await chrome.storage.local.set({converterState: {...previous, runId: Date.now(), taken: 0, finalized: false, lastGrowth: Date.now()}});
    }
    if (marketplace === 'mercadolivre') await startConverter(lb);
    try { await chrome.tabs.sendMessage(tab.id, {type: 'startBatch', maxPages: pages, marketplace, manualLinks}); }
    catch (_) { await chrome.storage.local.set({pipelineRunning: false}); throw new Error('Não consegui falar com a lista de cupons. Atualize essa página (F5) e clique em Iniciar de novo.'); }
  } catch (e) { err(e.message || String(e)); }
};

$('stop').onclick = async () => {
  err('');
  try {
    const lb = await linkbuilderTab();
    const tabs = (await chrome.tabs.query({currentWindow: true})).filter(t => /mercadoli(vre\.com\.br|bre\.com)/.test(t.url || '') && t.id !== lb?.id);
    let sent = false;
    for (const t of tabs) { try { const r = await chrome.tabs.sendMessage(t.id, {type: 'stopBatch'}); if (r?.ok) { sent = true; break; } } catch (_) {} }
    if (!sent) { // aba ativa sem o script: encerra direto pelo armazenamento
      const d = await chrome.storage.local.get('meliBatchWorkflow');
      if (d.meliBatchWorkflow) { d.meliBatchWorkflow.active = false; d.meliBatchWorkflow.stage = 'stopped'; await chrome.storage.local.set({meliBatchWorkflow: d.meliBatchWorkflow}); }
      await chrome.storage.local.set({pipelineCollectionDone: true});
    }
  } catch (e) { err(e.message || String(e)); }
};

$('resume').onclick = async () => {
  err('');
  try {
    const lb = await linkbuilderTab();
    if (!lb) throw new Error('Abra o Linkbuilder em uma aba desta janela.');
    await chrome.storage.local.set({pipelineRunning: true});
    await startConverter(lb);
  } catch (e) { err(e.message || String(e)); }
};

$('export').onclick = async () => {
  err('');
  const r = await chrome.runtime.sendMessage({type: 'exportFinal'}).catch(e => ({ok: false, error: String(e)}));
  if (!r?.ok) err(r?.error || 'Falha ao exportar.');
};

$('reset').onclick = async () => {
  if (!confirm('Apagar a planilha e o progresso salvos? Exporte antes se precisar.')) return;
  await chrome.storage.local.set({pipelineRunning: false});
  await chrome.storage.local.remove(['pipelineRunId', 'meliBatchWorkflow']);
  await clearPipeline();
  await chrome.storage.local.set({pipelineCollectionDone: false});
  err('');
};

async function refresh() {
  const d = await chrome.storage.local.get(['converterStats', 'meliCollectorStatus', 'meliBatchWorkflow', 'pipelineRunning', 'pipelineRunId', 'pipelineCollectionDone', 'pipelineSettings']);
  const st = d.converterStats || {total: 0, ok: 0, err: 0, pending: 0, message: ''};
  $('nTotal').textContent = st.total || 0; $('nOk').textContent = st.ok || 0;
  $('nPend').textContent = st.pending || 0; $('nErr').textContent = st.err || 0;
  const b = d.meliBatchWorkflow;
  $('collect').textContent = d.meliCollectorStatus?.message || (b?.active ? 'Em andamento...' : 'Parado.');
  const conv = d.pipelineRunId ? (d.pipelineRunning ? '' : (st.finalized ? '' : 'PAUSADA — ')) + (st.message || 'Aguardando...') : 'Parada.';
  $('convert').textContent = conv;
  $('start').disabled = !!d.pipelineRunning;
  $('backup').checked = !!d.pipelineSettings?.backupCsv || $('backup').checked;
  if (d.pipelineSettings?.marketplace) $('marketplace').value = d.pipelineSettings.marketplace;
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && Object.keys(ch).some(k => k === 'converterStats' || k === 'meliCollectorStatus' || k.startsWith('pipeline') || k === 'meliBatchWorkflow')) refresh();
});
refresh(); setInterval(refresh, 2000);
