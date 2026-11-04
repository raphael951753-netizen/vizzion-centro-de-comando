chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'createCsvBlobUrl' && typeof msg.csv === 'string') {
    try {
      const blob = new Blob([msg.csv], {type: 'text/csv;charset=utf-8'});
      sendResponse({ok: true, url: URL.createObjectURL(blob)});
    } catch (e) { sendResponse({ok: false, error: String(e)}); }
  } else if (msg.type === 'revokeBlobUrl' && typeof msg.url === 'string') {
    try { URL.revokeObjectURL(msg.url); } catch (_) {}
    sendResponse({ok: true});
  }
  return true;
});
