// Instagram / Facebook / TikTok / YouTube Studio.
// Estes sites mudam a interface com frequência: cada rede tem sua função abaixo e os
// A publicação automática é opcional e só tenta clicar quando o usuário a habilita no painel.
(() => {
  if (window.__CC_social) return;
  window.__CC_social = 1;
  const CC = window.__CC;
  const host = location.hostname;

  const need = (v, msg) => { if (!v) throw new Error(msg); return v; };
  const btnOf = (el) => el && (el.closest('a,button,div[role="button"]') || el);

  // Preenche os editores de legenda do Instagram/Facebook sem disparar paste sintético
  // seguido de fallback (combinação que pode duplicar o texto em editores React).
  const setSocialCaption = (el, value) => {
    const text = String(value ?? '');
    el.focus();
    if (!el.isContentEditable) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (index) document.execCommand('insertLineBreak');
      if (line) document.execCommand('insertText', false, line);
    });
    // execCommand('insertText'/'delete') já dispara os eventos de edição do navegador.
    // Não disparar um segundo InputEvent manual aqui: Instagram/Facebook podem processá-lo
    // como uma nova inserção e duplicar a legenda.
  };

  async function instagram({ text, file, files, autoPost }) {
    files = (files && files.length ? files : (file ? [file] : []));
    need(files.length, 'Instagram exige imagem ou vídeo.');
    const create = await CC.waitFor(
      () => document.querySelector('svg[aria-label="Novo post"],svg[aria-label="New post"],svg[aria-label="Criar"],svg[aria-label="Create"]'),
      8000
    );
    if (create) { btnOf(create).click(); await CC.sleep(900); }
    const item = CC.findByText('a,button,div[role="button"],span', /^(Publicação|Post)$/i);
    if (item) { btnOf(item).click(); await CC.sleep(700); }

    const input = need(await CC.waitFor(() => document.querySelector('input[type="file"]'), 15000), 'Campo de upload do Instagram não apareceu.');
    CC.attach(input, files);

    // Instagram exige passar pelas telas de enquadramento/filtros antes de mostrar a legenda.
    // O enquadramento inicial da plataforma é centralizado; não tentamos preencher a legenda
    // até que o editor de legenda esteja realmente disponível.
    const capSel = 'div[aria-label*="legenda" i][contenteditable="true"],div[aria-label*="caption" i][contenteditable="true"],div[contenteditable="true"][role="textbox"],textarea[aria-label*="legenda" i],textarea[aria-label*="caption" i]';
    const visible = (el) => {
      if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    };
    const modalRoot = () => document.querySelector('div[role="dialog"]') || document;
    const captionField = () => [...modalRoot().querySelectorAll(capSel)].find(visible) || null;
    const nextButton = () => {
      const root = modalRoot();
      const candidates = [...root.querySelectorAll('button,div[role="button"]')].filter(visible);
      return candidates.find(el => /^(Avançar|Avancar|Next)$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim())) || null;
    };

    // Aguarda o preview aparecer e percorre os passos (corte/enquadramento e filtros).
    let cap = await CC.waitFor(captionField, 1800, 250);
    for (let step = 0; !cap && step < 5; step++) {
      await CC.sleep(500);
      const next = nextButton();
      if (!next) {
        // O upload/preview pode ainda estar renderizando; aguarda antes de tentar de novo.
        cap = await CC.waitFor(captionField, 2500, 250);
        if (cap) break;
        const retry = nextButton();
        if (!retry) break;
        CC.click(retry);
      } else {
        CC.click(next);
      }
      cap = await CC.waitFor(captionField, 4500, 250);
    }
    cap = cap || await CC.waitFor(captionField, 5000, 250);
    need(cap, 'Instagram: não encontrei a caixa de legenda depois de avançar pelas telas de enquadramento e filtros. Confira se a foto terminou de carregar e se o botão Avançar está visível.');
    setSocialCaption(cap, text);
    await CC.sleep(300);
    const probe = String(text || '').trim().slice(0, 12);
    if (probe && !String(cap.innerText || cap.value || '').includes(probe)) {
      throw new Error('Instagram: a caixa de legenda apareceu, mas o texto não foi confirmado. Clique na caixa e tente novamente.');
    }
    if (autoPost) { await CC.sleep(1200); const share = CC.findByText('div[role=button],button', /^(Compartilhar|Share)$/i); if (share) { share.click(); await CC.sleep(1200); return 'Clique em Compartilhar executado; confira se a publicação foi concluída.'; } throw new Error('Publicação automática: botão Compartilhar não encontrado.'); }
    return 'Foto carregada; telas de enquadramento/filtros avançadas e legenda preenchida. Revise e clique em Compartilhar.';
  }

  async function facebook({ text, file, files, autoPost }) {
    files = (files && files.length ? files : (file ? [file] : []));
    const trigger = need(
      await CC.waitFor(() => CC.findByText('div[role="button"]', /(no que você está pensando|o que você está pensando|what's on your mind)/i), 10000),
      'Caixa "No que você está pensando" não encontrada (abra o feed ou a página).'
    );
    trigger.click();
    const box = need(await CC.waitFor(() => document.querySelector('div[role="dialog"] div[contenteditable="true"][role="textbox"]'), 8000), 'Editor de post do Facebook não abriu.');
    setSocialCaption(box, text);
    if (files.length) {
      const pv = document.querySelector('div[role="dialog"] [aria-label="Foto/vídeo"],div[role="dialog"] [aria-label="Photo/video"]');
      if (pv) pv.click();
      const input = need(await CC.waitFor(() => document.querySelector('div[role="dialog"] input[type="file"]'), 8000), 'Upload do Facebook não apareceu.');
      CC.attach(input, files);
    }
    if (autoPost) { await CC.sleep(1800); const publish = CC.findByText('div[role=dialog] button,div[role=dialog] div[role=button]', /^(Publicar|Post)$/i); if (publish) { publish.click(); await CC.sleep(1200); return 'Clique em Publicar executado; confira o resultado no Facebook.'; } throw new Error('Publicação automática: botão Publicar não encontrado.'); }
    return 'Post preparado. Revise e clique em Publicar.';
  }

  const marketplaceVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const marketplaceStepDelay = async (ms = 850) => {
    await CC.sleep(ms);
    await CC.sleep(150);
  };
  const isMarketplaceCreatePage = () => location.hostname === 'www.facebook.com' && /^\/marketplace\/create\/item\/?$/.test(location.pathname);
  const ensureMarketplaceCreatePage = () => {
    if (!isMarketplaceCreatePage()) throw new Error(`Facebook Marketplace: rota inesperada (${location.pathname}).`);
  };
  const marketplaceText = (el) => String(el?.innerText || el?.textContent || el?.getAttribute('aria-label') || el?.placeholder || '').trim();
  const isMarketplaceEditPage = () => location.hostname === 'www.facebook.com' && /^\/marketplace\/edit\/?$/.test(location.pathname);
  const marketplaceFormRoot = () => {
    const heading = [...document.querySelectorAll('h1,h2,h3,[role="heading"],div,span')]
      .find((item) => marketplaceVisible(item) && /^item para venda$/i.test(marketplaceText(item).replace(/\s+/g, ' ').trim()) && item.getBoundingClientRect().left < 360);
    if (!heading) return null;
    let root = heading;
    while (root.parentElement && root.parentElement !== document.body) {
      const parent = root.parentElement;
      const rect = parent.getBoundingClientRect();
      if (rect.left >= 0 && rect.left < 360 && rect.width >= 180 && rect.width <= 500 && rect.height >= 400) root = parent;
      else if (rect.width > 500 || rect.left >= 360) break;
      else root = parent;
    }
    return root;
  };
  const marketplaceClick = (re) => {
    const candidates = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="listbox"] [role="button"],button,[role="button"],a,label,span')]
      .filter((x) => marketplaceVisible(x) && re.test(marketplaceText(x)));
    const el = candidates.sort((a, b) => {
      const exactA = re.test(marketplaceText(a)) && marketplaceText(a).trim().length < 80 ? 1 : 0;
      const exactB = re.test(marketplaceText(b)) && marketplaceText(b).trim().length < 80 ? 1 : 0;
      return exactB - exactA || marketplaceText(a).length - marketplaceText(b).length;
    })[0];
    if (!el) return false;
    const target = el.matches('[role="option"],[role="menuitem"]') ? el : (el.closest('[role="option"],[role="menuitem"]') || el);
    target.scrollIntoView({block: 'center'});
    target.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    target.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    target.click();
    return true;
  };
  const marketplaceClickWait = async (re, timeout = 5000) => {
    const found = await CC.waitFor(() => marketplaceClick(re), timeout, 150);
    if (found) await marketplaceStepDelay();
    return !!found;
  };
  const marketplaceFormClickWait = async (re, timeout = 5000) => {
    const found = await CC.waitFor(() => {
      const formRoot = marketplaceFormRoot();
      if (!formRoot) return null;
      const candidates = [...formRoot.querySelectorAll('button,[role="button"],[role="combobox"]')]
        .filter((el) => marketplaceVisible(el) && re.test(marketplaceText(el).replace(/\s+/g, ' ').trim()))
        .filter((el) => !el.matches('a,[role="link"]') && !el.closest('a,[role="link"]'))
        .sort((a, b) => marketplaceText(a).length - marketplaceText(b).length);
      const element = candidates[0];
      if (!element) return null;
      element.scrollIntoView({ block: 'center' });
      CC.clickDeep(element);
      return element;
    }, timeout, 150);
    if (found) await marketplaceStepDelay();
    return !!found;
  };
  const marketplacePublishWait = async (timeout = 8000) => {
    const found = await CC.waitFor(() => {
      const candidates = [...document.querySelectorAll('button,[role="button"],[role="none"],span')]
        .filter((el) => marketplaceVisible(el) && /^(publicar|publish)$/i.test(marketplaceText(el).replace(/\s+/g, ' ').trim()))
        .sort((a, b) => marketplaceText(a).length - marketplaceText(b).length);
      const element = candidates[0];
      if (!element) return null;
      const target = element.closest('[role="none"],button,[role="button"]') || element;
      target.scrollIntoView({ block: 'center' });
      CC.clickDeep(target);
      return target;
    }, timeout, 150);
    if (found) await marketplaceStepDelay(500);
    return !!found;
  };
  const marketplaceClickExactTextWait = async (re, timeout = 5000) => {
    const found = await CC.waitFor(() => {
      if (!isMarketplaceCreatePage()) return null;
      const formRoot = marketplaceFormRoot();
      if (!formRoot) return null;
      const textNodes = [];
      const walker = document.createTreeWalker(formRoot, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/mais detalhes|more details/i.test(String(node.nodeValue || '').replace(/\s+/g, ' ').trim())) {
          textNodes.push(node);
        }
      }
      let element = null;
      for (const textNode of textNodes) {
        let current = textNode.parentElement;
        for (let depth = 0; current && current !== formRoot && depth < 8; depth++, current = current.parentElement) {
          if (!marketplaceVisible(current)) continue;
          const text = marketplaceText(current).replace(/\s+/g, ' ').trim();
          const rect = current.getBoundingClientRect();
          const inForm = rect.left >= 0 && rect.left < 360 && rect.top > 120 &&
            rect.width >= 140 && rect.width <= 380 && rect.height >= 30 && rect.height <= 180;
          const safe = !current.matches('a[href],[role="link"]') && !current.closest('a[href],[role="link"]');
          const cardText = /mais detalhes\s+atraia mais interesse incluindo mais detalhes|more details/i.test(text);
          if (inForm && safe && cardText) {
            element = current;
            break;
          }
        }
        if (element) break;
      }
      if (!element) {
        const labels = [...formRoot.querySelectorAll('div,span,p,h1,h2,h3,[role="heading"]')]
          .filter((item) => marketplaceVisible(item) && /^(mais detalhes|more details)$/i.test(marketplaceText(item).replace(/\s+/g, ' ').trim()));
        element = labels[0] || null;
      }
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.left >= 360 || rect.top <= 120 || rect.width <= 0 || rect.height <= 0) return null;
      const safe = !element.matches('a[href],[role="link"]') && !element.closest('a[href],[role="link"]');
      if (!safe) return null;
      element.scrollIntoView({block: 'center'});
      CC.clickDeep(element);
      return element;
    }, timeout, 150);
    if (found) {
      await CC.sleep(600);
      if (!isMarketplaceCreatePage()) throw new Error(`Facebook Marketplace: o clique saiu da tela de criação (${location.pathname}).`);
    }
    return !!found;
  };
  const marketplaceField = (re) => [...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="combobox"]')]
    .find((el) => marketplaceVisible(el) && re.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('name') || ''} ${el.parentElement?.innerText || ''}`));
  const marketplaceDescriptionField = () => {
    const fields = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
      .filter(marketplaceVisible);
    return fields.find((el) => /descri[cç][aã]o|description/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('name') || ''} ${el.parentElement?.innerText || ''}`))
      || fields.find((el) => el.tagName === 'TEXTAREA')
      || null;
  };
  const marketplaceIntegerPrice = (value) => {
    const raw = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? String(Math.ceil(numeric)) : raw;
  };
  const marketplaceTitle = (value, maxLength = 100) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const shortened = normalized.slice(0, maxLength + 1).replace(/\s+\S*$/, '').trim();
    return (shortened || normalized.slice(0, maxLength)).slice(0, maxLength).trim();
  };
  const marketplaceExactTextRegex = (value) => new RegExp(`^${String(value || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const marketplaceSet = (el, value) => {
    if (!el) return false;
    const text = String(value ?? '');
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  };
  const marketplaceType = async (el, value) => {
    if (!el) return false;
    const text = String(value ?? '');
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll');
      document.execCommand('delete');
      for (const char of text) {
        document.execCommand('insertText', false, char);
        await CC.sleep(12);
      }
      return true;
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) return marketplaceSet(el, text);
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const char of text) {
      setter.call(el, String(el.value || '') + char);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
      await CC.sleep(12);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const marketplaceTitleKey = (value) => normalizeMarketplaceText(value).replace(/[^a-z0-9]+/g, ' ').trim();
  const marketplaceEditTaskKey = '__cc_marketplace_edit_task';
  const resumeMarketplaceEditTask = async () => {
    if (window.__CC_marketplaceResumeStarted || host !== 'www.facebook.com') return;
    window.__CC_marketplaceResumeStarted = true;
    let task;
    try { task = JSON.parse(sessionStorage.getItem(marketplaceEditTaskKey) || 'null'); } catch (_) { task = null; }
    if (!task?.title || !task?.description) return;
    try {
      if (location.pathname.startsWith('/marketplace/you/selling')) {
        await CC.sleep(1800);
        const wanted = marketplaceTitleKey(task.title);
        const listing = await CC.waitFor(() => {
          const links = [...document.querySelectorAll('a[href*="/marketplace/item/"]')]
            .filter(marketplaceVisible)
            .map((link) => {
              const href = link.href || link.getAttribute('href') || '';
              const id = href.match(/\/marketplace\/item\/(\d+)/)?.[1] || '';
              const text = marketplaceTitleKey(`${link.innerText || ''} ${link.parentElement?.innerText || ''}`);
              const score = wanted && text.includes(wanted) ? 2 : wanted && wanted.split(' ').filter(token => token.length >= 4 && text.includes(token)).length ? 1 : 0;
              return { id, score };
            })
            .filter(item => item.id)
            .sort((a, b) => b.score - a.score)[0];
          return listing && listing.score > 0 ? listing : null;
        }, 12000, 250);
        if (!listing) throw new Error('anúncio recém-publicado não foi localizado em "Seus anúncios"');
        sessionStorage.setItem(marketplaceEditTaskKey, JSON.stringify({ ...task, listingId: listing.id }));
        location.href = `https://www.facebook.com/marketplace/edit/?listing_id=${encodeURIComponent(listing.id)}`;
        return;
      }
      if (isMarketplaceEditPage()) {
        const field = await CC.waitFor(() => marketplaceField(/descri[cç][aã]o|description/i), 12000, 200);
        if (!field || !await marketplaceType(field, task.description)) throw new Error('campo Descrição não apareceu na edição');
        await CC.sleep(300);
        if (!await marketplaceClickWait(/^salvar$|^save$|^publicar$|^publish$/i, 8000)) {
          throw new Error('campo preenchido, mas botão Salvar não foi encontrado');
        }
        sessionStorage.removeItem(marketplaceEditTaskKey);
        CC.banner(`Marketplace: descrição salva${task.listingId ? ` no anúncio ${task.listingId}` : ''}.`);
      }
    } catch (e) {
      CC.banner(`Marketplace: descrição pendente — ${String(e?.message || e).slice(0, 150)}`);
    }
  };
  const normalizeMarketplaceText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const marketplaceMenuOptions = () => [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="listbox"] [role="button"],button,[role="button"],a')]
    .filter(marketplaceVisible)
    .map(element => ({ element, text: marketplaceText(element).trim() }))
    .filter(item => item.text && item.text.length <= 100 && !/^(categoria|category|voltar|back|cancelar|cancel)$/i.test(item.text));
  const marketplaceTokens = (value) => normalizeMarketplaceText(value).split(/[^a-z0-9]+/).filter(token => token.length >= 3);
  const marketplaceOptionScore = (text, query) => {
    const option = normalizeMarketplaceText(text);
    const tokens = [...new Set(marketplaceTokens(query))];
    let score = 0;
    for (const token of tokens) {
      if (option.includes(token)) score += token.length >= 6 ? 4 : 2;
    }
    if (/outros|other|diversos|varios|varias/.test(option)) score -= 1;
    return score;
  };
  async function chooseCurrentMarketplaceOption(query, message, preferredText = '') {
    const result = await CC.waitFor(() => {
      const preferred = normalizeMarketplaceText(preferredText).trim();
      if (preferred) {
        const header = [...document.querySelectorAll('[aria-label^="Cabeçalho "]')]
          .filter(marketplaceVisible)
          .map((element) => ({
            element: element.closest('[role="button"]') || element,
            text: String(element.getAttribute('aria-label') || '').replace(/^Cabeçalho\s+/i, '').trim()
          }))
          .find((item) => normalizeMarketplaceText(item.text) === preferred);
        if (header) return header;
      }
      const options = marketplaceMenuOptions();
      if (!options.length) return null;
      return options.sort((a, b) => marketplaceOptionScore(b.text, query) - marketplaceOptionScore(a.text, query) || a.text.length - b.text.length)[0];
    }, 5000, 150);
    if (!result) throw new Error(`Facebook Marketplace: ${message} não encontrada.`);
    const target = result.element.matches('[role="option"],[role="menuitem"],[role="button"]')
      ? result.element
      : (result.element.closest('[role="option"],[role="menuitem"],[role="button"]') || result.element);
    target.scrollIntoView({block: 'center'});
    CC.clickDeep(target);
    await marketplaceStepDelay();
    return result.text;
  }
  async function selectMarketplaceCategory(category, title) {
    if (!await marketplaceFormClickWait(/categoria|category/i)) throw new Error('Facebook Marketplace: campo Categoria não encontrado no formulário.');
    await marketplaceStepDelay(900);
    await chooseCurrentMarketplaceOption(`${category} ${title}`, 'subcategoria', category);
    await marketplaceStepDelay(900);
  };
  async function facebookMarketplace({ text, files, autoPost, marketplaceProduct, marketplaceLocation, marketplaceGroups, marketplaceDelivery }) {
    const product = marketplaceProduct || {};
    const data = product.product_data && typeof product.product_data === 'object' ? product.product_data : product;
    const first = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '') || '';
    const title = marketplaceTitle(first(product.title, data.title, 'Produto'));
    const price = first(product.price, data.price, data.currentPrice);
    const category = first(product.category, data.category);
    const affiliateValues = [data.affiliate, data.affiliateUrl, data.affiliateLink, product.affiliate, product.affiliateUrl, product.affiliateLink]
      .filter(Boolean).map(value => String(value).trim()).filter(Boolean);
    const isAffiliateUrl = (url) => /(?:meli\.la|mercadolivre\.com\/sec\/|mercadolivre\.com\.br\/afiliados|shopee\.com\.br\/universal-link)/i.test(url)
      || affiliateValues.some(value => value === url);
    const marketplaceNotice = 'Preços sujeitos a alteração. O frete deve ser calculado no site da loja.';
    const description = `${String(first(data.description, data.details, text, title))
      .replace(/https?:\/\/[^\s<>"']+/gi, (url) => isAffiliateUrl(url.replace(/[),.;]+$/, '')) ? '' : url)
      .replace(/[ \t]{2,}/g, ' ').trim()}\n\n${marketplaceNotice}`;
    if (!files?.length) throw new Error('Facebook Marketplace: adicione pelo menos uma foto do produto.');
    await CC.waitFor(() => location.pathname.startsWith('/marketplace'), 12000);
    if (!await marketplaceClickWait(/criar novo classificado|create new listing/i)) throw new Error('Facebook Marketplace: botão "Criar novo classificado" não encontrado.');
    await CC.sleep(700);
    if (!await marketplaceClickWait(/^item para venda$|item for sale/i)) throw new Error('Facebook Marketplace: opção "Item para venda" não encontrada.');
    await CC.waitFor(() => isMarketplaceCreatePage(), 10000);
    ensureMarketplaceCreatePage();
    await marketplaceStepDelay(1200);
    const input = need(await CC.waitFor(() => [...document.querySelectorAll('input[type="file"]')].find(marketplaceVisible), 10000), 'Facebook Marketplace: campo de fotos não apareceu.');
    CC.attach(input, files.slice(0, 10));
    await marketplaceStepDelay(1300);
    const titleField = marketplaceField(/t[ií]tulo|title/i);
    if (!await marketplaceType(titleField, title)) throw new Error('Facebook Marketplace: campo Título não encontrado.');
    await marketplaceStepDelay(1100);
    const priceField = marketplaceField(/pre[cç]o|price/i);
    if (priceField && price !== '') await marketplaceType(priceField, marketplaceIntegerPrice(price));
    await marketplaceStepDelay(1100);
    await selectMarketplaceCategory(first(product.category, data.category), title);
    if (await marketplaceClickWait(/condi[cç][aã]o|condition/i)) {
      await marketplaceStepDelay(900);
      if (!await marketplaceClickWait(/^novo$|^new$/i)) throw new Error('Facebook Marketplace: opção de condição "Novo" não encontrada.');
      await marketplaceStepDelay(1000);
    }
    let descriptionPending = false;
    const detailsField = await CC.waitFor(() => marketplaceDescriptionField() || marketplaceField(/descri[cç][aã]o|description/i), 12000, 200);
    if (!detailsField || !await marketplaceType(detailsField, description)) {
      descriptionPending = true;
    } else {
      await marketplaceStepDelay(1100);
    }
    const locationValue = marketplaceLocation || 'Seropédica - Rio de Janeiro';
    const locationField = marketplaceField(/localiza[cç][aã]o|location/i);
    if (!await marketplaceType(locationField, locationValue)) throw new Error('Facebook Marketplace: campo de localização não encontrado.');
    await marketplaceStepDelay(1100);
    const locationParts = String(locationValue).split(/\s*[-,]\s*/, 2).filter(Boolean);
    const selectedLocation = locationParts.length >= 2
      ? new RegExp(`^${locationParts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,\\s*${locationParts[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      : marketplaceExactTextRegex(locationValue);
    if (!await marketplaceClickWait(selectedLocation, 8000)) throw new Error('Facebook Marketplace: sugestão de localização não encontrada para validar a cidade.');
    await marketplaceStepDelay(900);
    if (marketplaceDelivery) {
      const controls = [...document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].filter(marketplaceVisible);
      const controlText = (el) => `${el.getAttribute('aria-label') || ''} ${el.parentElement?.innerText || ''}`.replace(/\s+/g, ' ').trim();
      controls.filter((el) => /retirada|pickup/i.test(controlText(el))).forEach((el) => {
        if ((el.type === 'checkbox' && el.checked) || el.getAttribute('aria-checked') === 'true') btnOf(el).click();
      });
      const delivery = controls.find((el) => /^(entrega|delivery)$|\b(entrega|delivery)\b/i.test(controlText(el)) && !/retirada|pickup/i.test(controlText(el)));
      if (delivery && ((delivery.type === 'checkbox' && !delivery.checked) || delivery.getAttribute('aria-checked') === 'false')) btnOf(delivery).click();
      await marketplaceStepDelay(900);
    }
    if (!await marketplaceClickWait(/^avan[cç]ar$|^next$/i)) throw new Error('Facebook Marketplace: botão Avançar não encontrado.');
    await marketplaceStepDelay(1300);
    const groups = Math.max(0, Math.min(10, Number(marketplaceGroups) || 0));
    if (groups) {
      await marketplaceClickWait(/publicar em mais lugares|post in more places|grupos/i);
      await marketplaceStepDelay(900);
      const checks = [...document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].filter((el) => marketplaceVisible(el));
      checks.slice(0, groups).forEach((el) => {
        if ((el.type === 'checkbox' && !el.checked) || el.getAttribute('aria-checked') === 'false') btnOf(el).click();
      });
      await marketplaceStepDelay(1000);
    }
    if (!autoPost) return 'Classificado do Marketplace preparado. Revise fotos, dados e grupos antes de publicar.';
    if (!await marketplacePublishWait()) throw new Error('Facebook Marketplace: botão Publicar não encontrado.');
    await CC.sleep(2500);
    if (descriptionPending) {
      sessionStorage.setItem(marketplaceEditTaskKey, JSON.stringify({ title, description }));
      location.href = 'https://www.facebook.com/marketplace/you/selling';
      return 'Classificado publicado; procurando o anúncio em Seus anúncios para preencher a descrição.';
    }
    return 'Classificado do Marketplace enviado. Confira a confirmação do Facebook.';
  }

  async function tiktok({ text, file, files, autoPost, mediaType }) {
    files = (files && files.length ? files : (file ? [file] : []));
    file = files[0];
    need(file, 'TikTok exige arquivo de mídia.');
    // A extensão usa o tipo real do arquivo como fonte da verdade. Isso evita executar
    // o fluxo de Fotos (e exibir mensagens sobre foto) quando o painel está em Vídeo.
    const actualMediaType = file.type.startsWith('image/') ? 'photo' : file.type.startsWith('video/') ? 'video' : mediaType;
    if (actualMediaType === 'photo' && !file.type.startsWith('image/')) throw new Error('Para TikTok Foto, selecione uma imagem.');
    if (actualMediaType !== 'photo' && !file.type.startsWith('video/')) throw new Error('Para TikTok Vídeo, selecione um vídeo.');
    if (actualMediaType === 'photo') {
      // A rota tab=photo pode renderizar mais de um input (incluindo o de vídeo). Priorizar
      // explicitamente o input que aceita imagens para não enviar a foto ao controle errado.
      const photoTab = CC.findByText('button,[role=tab],[role=button]', /^(Foto|Photos|Photo|Image|Publicar fotos|Upload photos)$/i);
      if (photoTab && !/photo|foto/i.test(location.search)) { photoTab.click(); await CC.sleep(1000); }
    } else {
      // No fluxo de vídeo, o Studio apresenta uma área/botão explícito chamado
      // “Selecionar vídeos”. Clicamos nele antes de procurar o input, pois em alguns
      // layouts o input correto só é montado depois dessa ação.
      const selectVideos = await CC.waitFor(() => {
        const candidates = [...document.querySelectorAll('button,[role="button"],label,div,span')];
        return candidates.find(el => {
          const txt = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (!/^(Selecionar vídeos|Selecionar vídeos do computador|Select videos|Select video|Choose videos|Choose video)$/i.test(txt)) return false;
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
        }) || null;
      }, 8000, 250);
      if (selectVideos) {
        const clickable = selectVideos.closest('button,[role="button"],label') || selectVideos;
        CC.click(clickable);
        await CC.sleep(500);
      } else {
        CC.banner('TikTok Vídeo: não encontrei o botão “Selecionar vídeos”; vou tentar localizar o campo de arquivo diretamente.');
      }
    }
    const findPhotoInput = () => {
      const inputs = [...document.querySelectorAll('input[type="file"]')].filter(x => !x.disabled);
      if (actualMediaType === 'photo') return inputs.find(x => /image|jpg|jpeg|png|webp/i.test(x.accept || '')) || inputs.find(x => x.multiple && /image/i.test(x.accept || '')) || null;
      return inputs.find(x => /video/i.test(x.accept || '')) || inputs.find(x => !/image/i.test(x.accept || '') && (!x.accept || /mp4|mov|video/i.test(x.accept))) || null;
    };
    const input = need(await CC.waitFor(findPhotoInput, 20000), actualMediaType === 'photo' ? 'TikTok Studio não apresentou um campo de upload de imagem. Confirme que a aba Foto está aberta e tente novamente.' : 'TikTok Vídeo: cliquei em “Selecionar vídeos”, mas não encontrei o campo de arquivo de vídeo. Confira se a aba Vídeo está aberta e tente novamente.');
    // Usa o seletor de arquivo normal. Na aba Foto, não usa atraso fixo:
    // aguarda a própria caixa de legenda ficar visível após o upload.
    CC.attach(input, files);
    if (actualMediaType === 'photo') {
      CC.banner('TikTok Foto: upload iniciado; aguardando a caixa de legenda ficar disponível...');
    }
    const visible = (el) => !!el && !!el.getClientRects().length && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      const findCaption = () => {
        const selectors = [
          '.public-DraftEditor-content[contenteditable="true"]',
          'textarea[placeholder*="description" i]',
          'textarea[placeholder*="descri" i]',
          'textarea[placeholder*="legenda" i]',
          'textarea[placeholder*="descrição" i]',
          'textarea[aria-label*="description" i]',
          'textarea[aria-label*="descri" i]',
          'textarea[aria-label*="legenda" i]',
          'textarea[aria-label*="descrição" i]',
          'textarea[data-placeholder*="description" i]',
          'textarea[data-placeholder*="descri" i]',
          'textarea[data-placeholder*="legenda" i]',
          'textarea[data-placeholder*="descrição" i]',
          'textarea[maxlength="4000"]',
          '[contenteditable="true"][data-placeholder*="description" i]',
          '[contenteditable="true"][data-placeholder*="descri" i]',
          '[contenteditable="true"][data-placeholder*="legenda" i]',
          '[contenteditable="true"][data-placeholder*="descrição" i]',
          '[contenteditable="true"][aria-label*="caption" i]',
          '[contenteditable="true"][aria-label*="legenda" i]',
          '[contenteditable="true"][aria-label*="description" i]',
          '[contenteditable="true"][aria-label*="descri" i]',
          '[contenteditable="true"][aria-label*="descrição" i]',
          '[contenteditable="true"][data-placeholder]',
          'div[contenteditable="true"]',
          'textarea'
        ];
      for (const selector of selectors) {
        const el = [...document.querySelectorAll(selector)].find(visible);
        if (el) return el;
      }
      return null;
    };
    const ed = need(await CC.waitFor(findCaption, 60000, 350), actualMediaType === 'photo'
      ? 'TikTok Foto: a caixa de legenda não ficou disponível em até 60 segundos após o upload da imagem.'
      : 'TikTok Vídeo: a caixa de legenda não ficou disponível em até 60 segundos após o upload do vídeo. Confira se o vídeo terminou de carregar e se a tela de publicação está aberta.');
    CC.banner(actualMediaType === 'photo' ? 'TikTok Foto: caixa de legenda encontrada; digitando o texto gradualmente...' : 'TikTok Vídeo: caixa de legenda encontrada; preenchendo o texto...');
    if (actualMediaType === 'photo') {
      const caption = String(text || '').trim();
      CC.setText(ed, caption);
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    } else {
      // Fluxo exclusivo de vídeo: apenas setText, sem InputEvent extra para evitar duplicação no DraftEditor
      const caption = String(text || '').trim();
      CC.setText(ed, caption);
    }
    await CC.sleep(900);
    const entered = String(ed.innerText || ed.value || ed.textContent || '').trim();
    const probe = String(text || '').trim().slice(0, 24);
    if (probe && !entered.includes(probe)) {
      throw new Error('TikTok: encontrei a caixa de legenda, mas o texto não apareceu após a inserção automática. A caixa pode não aceitar colagem automatizada.');
    }
    CC.banner(actualMediaType === 'photo' ? 'TikTok Foto: legenda inserida e verificada.' : 'TikTok Vídeo: legenda inserida e verificada.');
    // Só abre o seletor de som depois que a foto terminou de carregar e a legenda foi preenchida.
    // O seletor de música é específico do fluxo de fotos; vídeos seguem sem música automática.
    if (actualMediaType === 'photo') {
      await CC.sleep(1200);
      const addSound = CC.findByText('button,[role="button"],div[role="button"]', /^(Adicionar som|Add sound|Adicionar música|Add music)$/i);
      if (addSound) {
        addSound.click(); await CC.sleep(900);
        const search = await CC.waitFor(() => {
          const isVisible = el => !!el?.getClientRects?.().length && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
          const fieldSelector = 'input:not([type="file"]):not([type="hidden"]),textarea,[contenteditable="true"],[role="combobox"]';
          const fieldLabel = el => [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-placeholder'), el.getAttribute('title'), el.getAttribute('name')].join(' ');
          const badField = el => /caption|legenda|comentário|comment|endereço|address|url|website/i.test(fieldLabel(el));
          // IMPORTANTE: a busca deve estar dentro do painel flutuante que abriu ao clicar
          // em “Adicionar som”. Nunca usar um campo global da página como alternativa.
          const panelSelector = '[role="dialog"],[aria-modal="true"],[role="listbox"],[class*="modal" i],[class*="drawer" i],[class*="popup" i],[class*="overlay" i],[class*="sound" i],[class*="music" i]';
          const panels = [...document.querySelectorAll(panelSelector)].filter(isVisible).map(el => {
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            const centered = r.left < innerWidth * 0.8 && r.right > innerWidth * 0.2 && r.top < innerHeight * 0.85 && r.bottom > innerHeight * 0.15;
            return {el, area, centered};
          }).filter(x => x.centered && x.area > 18000).sort((a,b) => a.area - b.area);
          // Primeiro, procura campos com rótulo de pesquisa dentro dos painéis centrais.
          for (const panel of panels) {
            const found = [...panel.el.querySelectorAll(fieldSelector)].filter(isVisible).find(el => !badField(el) && /pesquisar|search|buscar|música|musica|sound/i.test(fieldLabel(el)));
            if (found) return found;
          }
          // Alguns layouts não rotulam o input: só aceita campo de texto dentro de um
          // painel central grande, excluindo campos de legenda e campos fora do modal.
          for (const panel of panels) {
            const found = [...panel.el.querySelectorAll(fieldSelector)].filter(isVisible).find(el => {
              if (badField(el)) return false;
              const r = el.getBoundingClientRect();
              return r.width > 100 && r.height > 15 && !el.matches('input[type="checkbox"],input[type="radio"]');
            });
            if (found) return found;
          }
          return null;
        }, 10000, 250);
        if (search) {
          // Digita a busca em etapas para que campos controlados pelo React atualizem a cada caractere.
          const query = 'lofi';
          search.click(); search.focus();
          if (search.isContentEditable || search.getAttribute('contenteditable') === 'true') {
            search.textContent = '';
            search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
            for (const char of query) {
              document.execCommand('insertText', false, char);
              search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
              await CC.sleep(90);
            }
          } else {
            const proto = search.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(search, ''); else search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await CC.sleep(120);
            let typed = '';
            for (const char of query) {
              typed += char;
              if (setter) setter.call(search, typed); else search.value = typed;
              search.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
              search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
              search.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
              await CC.sleep(100);
            }
            search.dispatchEvent(new Event('change', { bubbles: true }));
          }
          // Envia a pesquisa com Enter, como na interface do TikTok Studio.
          search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          search.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          search.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          await CC.sleep(1800);
          const visible = el => !!el?.getClientRects?.().length && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
          // Restringe a busca de resultados ao painel flutuante de som.
          const panelSelector = '[role="dialog"],[aria-modal="true"],[role="listbox"],[class*="modal" i],[class*="drawer" i],[class*="popup" i],[class*="overlay" i],[class*="sound" i],[class*="music" i]';
          const panels = [...document.querySelectorAll(panelSelector)].filter(visible).map(el => {
            const r = el.getBoundingClientRect(); return {el, area:r.width*r.height, centered:r.left < innerWidth*.8 && r.right > innerWidth*.2 && r.top < innerHeight*.85 && r.bottom > innerHeight*.15};
          }).filter(x => x.centered && x.area > 18000).sort((a,b) => a.area-b.area);
          // Os botões “Use” ficam ao lado de cada faixa; o título da faixa nem sempre
          // contém “lofi”. Portanto, após pesquisar lofi e pressionar Enter, sorteamos
          // diretamente entre os botões Use/Usar visíveis dentro dos painéis centrais,
          // sem exigir que o texto da linha contenha a palavra lofi.
          const fallbackPanel = search.closest('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="sound" i],[class*="music" i]');
          const scopes = [...new Set([...panels.map(x => x.el), ...(fallbackPanel ? [fallbackPanel] : [])])];
          const isUseButton = btn => {
            const txt = String(btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
            const aria = String(btn.getAttribute('aria-label') || btn.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
            return /^(use|usar)$/i.test(txt) || /^(use|usar)$/i.test(aria);
          };
          const candidates = [...new Set(scopes.flatMap(scope => [...scope.querySelectorAll('button,[role="button"],div[role="button"]')]))]
            .filter(btn => visible(btn) && isUseButton(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
          if (candidates.length) {
            const chosen = candidates[Math.floor(Math.random() * candidates.length)];
            chosen.scrollIntoView({ block: 'center', inline: 'nearest' });
            await CC.sleep(150);
            chosen.click();
            await CC.sleep(900);
            CC.banner('TikTok Foto: pesquisou lofi, pressionou Enter e clicou aleatoriamente em um dos botões Use/Usar ao lado das faixas.');
          } else {
            CC.banner('TikTok Foto: pesquisa enviada com Enter, mas não encontrei botões Use/Usar visíveis dentro do painel de som. Confira se os resultados carregaram.');
          }
        } else CC.banner('TikTok Foto: painel de som aberto, mas a busca não apareceu; selecione manualmente uma faixa instrumental neutra.');
      } else CC.banner('TikTok Foto: não encontrei o seletor de som; confira se esta tela permite adicionar música.');
    }
    if (autoPost) { await CC.sleep(5000); const post = CC.findByText('button,[role=button]', /^(Publicar|Post)$/i); if (post && !post.disabled) { post.click(); await CC.sleep(1200); return 'Clique em Publicar executado; confira o resultado no TikTok Studio.'; } throw new Error('Publicação automática: botão Publicar ainda indisponível; o upload pode não ter terminado.'); }
    return 'Legenda preenchida. Aguarde o upload terminar e clique em Publicar.';
  }

  async function youtube({ text, file, title, autoPost, mediaType }) {
    need(file, 'YouTube exige vídeo.');
    if (mediaType === 'photo' || !file.type.startsWith('video/')) throw new Error('YouTube aceita vídeo neste fluxo. Selecione Vídeo no painel.');

    const clickText = async (regex, timeout = 12000, selector = 'button,[role="button"],ytcp-button') => {
      const el = await CC.waitFor(() => {
        const found = CC.findByText(selector, regex);
        return found && !found.disabled && found.getAttribute('aria-disabled') !== 'true' ? found : null;
      }, timeout);
      if (!el) return false;
      (el.closest('ytcp-button,button,[role="button"]') || el).click();
      await CC.sleep(900);
      return true;
    };
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
    const clickOptionByText = async (pattern, timeout = 7000) => {
      const option = await CC.waitFor(() => {
        const selectors = [
          'tp-yt-paper-radio-button', 'tp-yt-paper-checkbox', 'ytcp-radio-button',
          'ytcp-checkbox-lit', '[role="radio"]', '[role="checkbox"]', 'label',
          'button', '[role="button"]', '.label', '#label', 'span', 'div'
        ].join(',');
        const nodes = [...document.querySelectorAll(selectors)];
        // Prefer the smallest visible text node/label matching the option, then click its control wrapper.
        const match = nodes.find(e => {
          const txt = normalize(e.innerText || e.textContent);
          return txt && pattern.test(txt) && e.getClientRects().length && txt.length < 180;
        });
        if (!match) return null;
        return match.closest('tp-yt-paper-radio-button,tp-yt-paper-checkbox,ytcp-radio-button,ytcp-checkbox-lit,[role="radio"],[role="checkbox"],label,button,[role="button"]') || match;
      }, timeout);
      if (!option) return false;
      option.scrollIntoView({block:'center', inline:'nearest'});
      await CC.sleep(250);
      option.click();
      await CC.sleep(650);
      return true;
    };
    const clickAudience = async () => {
      // O Studio costuma renderizar esta escolha como radio buttons mutuamente exclusivos.
      // Primeiro tenta o ID estável do controle; depois procura o rótulo exato usado na tela.
      const isSelected = (el) => !!el && (
        el.getAttribute('aria-checked') === 'true' ||
        el.getAttribute('aria-pressed') === 'true' ||
        el.hasAttribute('checked') ||
        el.getAttribute('checked') === 'true' ||
        el.matches(':checked') ||
        /(checked|selected|active)/i.test(String(el.className || ''))
      );
      const directSelectors = [
        '#not-made-for-kids-radio-button',
        '[name="made-for-kids"][value="false"]',
        'tp-yt-paper-radio-button[name="not-made-for-kids"]',
        '[data-testid*="not-made-for-kids" i]'
      ];
      let control = directSelectors.map(sel => document.querySelector(sel)).find(Boolean);
      if (control && control.getClientRects().length) {
        control.scrollIntoView({block:'center', inline:'nearest'});
        if (!isSelected(control)) control.click();
        await CC.sleep(350);
        // Confirmou que a opção Não ficou selecionada? Se não, tenta o input/label interno.
        if (isSelected(control) || control.getAttribute('aria-checked') === 'true') return true;
        const inner = control.querySelector('input,[role="radio"],tp-yt-paper-radio-button,ytcp-radio-button');
        if (inner && !isSelected(inner)) inner.click();
        await CC.sleep(350);
        if (isSelected(control) || isSelected(inner)) return true;
      }
      const pattern = /não\s*(?:,\s*)?(?:não\s+)?é conteúdo para crianças|not made for kids|no,?\s*it'?s not made for kids/i;
      const clicked = await clickOptionByText(pattern, 5000);
      if (!clicked) return false;
      // O clique no rótulo costuma alternar o radio. Verifica a opção diretamente sempre que possível.
      await CC.sleep(350);
      control = directSelectors.map(sel => document.querySelector(sel)).find(Boolean);
      if (control && isSelected(control)) return true;
      const labels = [...document.querySelectorAll('label,[role="radio"],tp-yt-paper-radio-button,ytcp-radio-button')];
      const target = labels.find(el => pattern.test(normalize(el.innerText || el.textContent)) && el.getClientRects().length);
      return !!clicked || !!target;
    };
    const setPublic = async () => clickOptionByText(/^público$|^public$/i, 8000);

    const create = need(await CC.waitFor(() => document.querySelector('#create-icon,[aria-label*="Criar" i],[aria-label*="Create" i]'), 15000), 'Botão Criar do YouTube Studio não encontrado. Abra o YouTube Studio na conta correta.');
    create.click();
    await CC.sleep(500);
    // Abrir explicitamente Criar > Enviar vídeos (não depender do índice #text-item-0).
    const uploadMenu = await CC.waitFor(() => CC.findByText('button,[role="button"],tp-yt-paper-item,[role="menuitem"],ytcp-text-menu', /^(Enviar vídeos|Upload videos|Upload video)$/i), 7000);
    if (uploadMenu) { (uploadMenu.closest('tp-yt-paper-item,[role="menuitem"],button,[role="button"]') || uploadMenu).click(); await CC.sleep(700); }
    const input = need(await CC.waitFor(() => document.querySelector('ytcp-uploads-file-picker input[type="file"],input[type="file"]'), 15000), 'Upload do YouTube não apareceu após clicar em “Enviar vídeos”. Abra Criar > Enviar vídeos manualmente e tente novamente.');
    CC.attach(input, file);

    const t = need(await CC.waitFor(() => document.querySelector('#title-textarea #textbox, #title-textarea textarea'), 30000), 'Campo de título não apareceu.');
    const firstLine = (title || text.split('\n')[0] || file.name).slice(0, 100);
    CC.setText(t, firstLine);
    const d = await CC.waitFor(() => document.querySelector('#description-textarea #textbox, #description-textarea textarea'), 5000);
    if (d) CC.setText(d, text);

    // Etapa 1: definir explicitamente que não é conteúdo para crianças, e avançar.
    const audienceSet = await clickAudience();
    if (!audienceSet) throw new Error('YouTube: não encontrei a opção “Não, não é conteúdo para crianças”. Selecione-a manualmente e tente novamente.');
    if (!await clickText(/^(Avançar|Next)$/i)) throw new Error('YouTube: não encontrei Avançar após os detalhes do vídeo. Confira o Studio e tente novamente.');

    // Etapa 2 (Elementos) e etapa 3 (Verificações): avançar sem alterar configurações.
    if (!await clickText(/^(Avançar|Next)$/i)) throw new Error('YouTube: não encontrei Avançar na etapa Elementos do vídeo.');
    await CC.sleep(1200);
    if (!await clickText(/^(Avançar|Next)$/i)) throw new Error('YouTube: não encontrei Avançar na etapa Verificações.');

    // Etapa 4: marcar Público e, quando a publicação automática estiver habilitada, salvar/concluir.
    await CC.sleep(900);
    const publicSet = await setPublic();
    if (!publicSet) throw new Error('YouTube: não encontrei a opção Público na etapa Visibilidade. Selecione Público manualmente.');
    await CC.sleep(700);
    if (!autoPost) return 'Vídeo preparado: título, descrição, “não é conteúdo para crianças” e visibilidade Público definidos. Revise e clique em Salvar manualmente.';

    if (!await clickText(/^(Salvar|Save|Publicar|Publish)$/i, 12000, 'button,[role="button"],ytcp-button')) throw new Error('YouTube: as etapas foram preenchidas, mas não encontrei o botão Salvar. Confira a tela de Visibilidade e conclua manualmente.');
    await CC.sleep(1800);
    return 'Clique em Salvar executado no YouTube Studio. Confira a confirmação de conclusão.';
  }

  const RUN = {
    'www.instagram.com': instagram,
    'www.facebook.com': facebook,
    'www.tiktok.com': tiktok,
    'studio.youtube.com': youtube,
  };

  CC.handlers.POST_FILL = async ({ fileId, fileIds, text, title, autoPost, mediaType, destination, marketplaceProduct, marketplaceLocation, marketplaceGroups, marketplaceDelivery }) => {
    const fn = host === 'www.facebook.com' && destination === 'marketplace' ? facebookMarketplace : need(RUN[host], 'Rede não suportada: ' + host);
    const ids = (Array.isArray(fileIds) && fileIds.length ? fileIds : (fileId ? [fileId] : []));
    const files = ids.map(id => CC.files[id]).filter(Boolean);
    if (ids.length && files.length !== ids.length) throw new Error('Uma ou mais fotos não chegaram completas à aba.');
    const file = files[0] || null;
    // Hashtags are plain text while composing; the platforms make them clickable after publishing.
    // Normalize accidental missing spaces between a word and a hashtag without altering hashtag spelling.
    const postText = String(text || '').replace(/([^\s#])(#\w)/gu, '$1 $2');
    const msg = await fn({ text: postText, file, files, title, autoPost: !!autoPost, mediaType: mediaType || (file?.type?.startsWith('image/') ? 'photo' : 'video'), marketplaceProduct, marketplaceLocation, marketplaceGroups, marketplaceDelivery });
    CC.banner('Centro de Comando: ' + msg);
    return { ok: true, msg };
  };
  if (host === 'www.facebook.com') setTimeout(() => { void resumeMarketplaceEditTask(); }, 0);
})();
