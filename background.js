// Service worker: abre (ou foca) a página do Centro de Comando ao clicar no ícone.
// O trabalho pesado (IA, busca, sync) roda na própria página app.html, que tem
// permissão de rede e de abas — assim o service worker não "dorme" no meio de uma tarefa.
chrome.action.onClicked.addListener(async (tab) => {
  const url = chrome.runtime.getURL('app.html');
  const existing = (await chrome.tabs.query({ url })).find((t) => t.windowId === tab.windowId);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url, windowId: tab.windowId });
  }
});

// Relógio para content scripts em abas ocultas (ver CC.sleep em common.js).
chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m && m.type === 'CC_SLEEP') {
    setTimeout(() => send({ ok: true }), Math.min(Number(m.ms) || 0, 20000));
    return true;
  }
});
