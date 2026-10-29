// Roda no "mundo" da própria página do WhatsApp Web (world: MAIN, document_start).
// Faz o WhatsApp acreditar que a aba está visível e com foco, para que ele continue
// carregando conversas e processando digitação mesmo com a aba em segundo plano.
(() => {
  if (window.__CC_vis) return;
  window.__CC_vis = 1;
  // rAF não roda em aba oculta e o WhatsApp usa isso para desenhar telas como a pré-visualização de foto.
  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')?.get;
  const rafOrig = window.requestAnimationFrame.bind(window), cafOrig = window.cancelAnimationFrame.bind(window);
  const fake = new Map(); let fid = 1e9;
  window.requestAnimationFrame = (cb) => {
    if (!realHidden || !realHidden.call(document)) return rafOrig(cb);
    const id = fid++;
    fake.set(id, setTimeout(() => { fake.delete(id); cb(performance.now()); }, 16));
    return id;
  };
  window.cancelAnimationFrame = (id) => { if (fake.has(id)) { clearTimeout(fake.get(id)); fake.delete(id); } else cafOrig(id); };
  const def = (obj, key, val) => { try { Object.defineProperty(obj, key, { get: () => val, configurable: true }); } catch (_) {} };
  def(Document.prototype, 'hidden', false);
  def(Document.prototype, 'visibilityState', 'visible');
  def(Document.prototype, 'webkitHidden', false);
  def(Document.prototype, 'webkitVisibilityState', 'visible');
  try { document.hasFocus = () => true; } catch (_) {}
  const stop = (e) => e.stopImmediatePropagation();
  ['visibilitychange', 'webkitvisibilitychange'].forEach((t) => {
    document.addEventListener(t, stop, true);
    window.addEventListener(t, stop, true);
  });
  window.addEventListener('blur', stop, true);
})();
