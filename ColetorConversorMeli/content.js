(() => {
  if (window.__meliCollectorV20Loaded) return;
  window.__meliCollectorV20Loaded = true;

  const K = {
    items: "meliItems",
    enabled: "meliCollectorEnabled",
    auto: "meliAutoNextEnabled",
    status: "meliCollectorStatus",
    log: "meliCollectorPageLog",
    batch: "meliBatchWorkflow"
  };
  let enabled = false, autoNext = false;
  let lastUrl = location.href;
  let pageStartedAt = Date.now();
  let lastProgressAt = Date.now();
  let refreshedUrl = "";
  let navigationBusy = false;
  let recoveryBusy = false;
  let capturePromise = null;
  let observer = null;
  let debounceTimer = null;
  let lastKnownTotal = 0;
  let pageSignature = "";
  let batchBusy = false;
  let batchFinishPending = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function canonicalProductUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      if (!/(^|\.)mercadolivre\.com\.br$/i.test(u.hostname)) return null;
      const p = u.pathname;
      if (!(/\/p\/MLB\d+/i.test(p) ||
            /\/MLB-\d{6,}/i.test(p) ||
            /\/UP\/MLBU\d+/i.test(p) ||
            /\/ITEM\/MLB\d+/i.test(p) ||
            /\/product\/MLB\d+/i.test(p))) return null;
      return (u.origin + p).replace(/\/+$/, "");
    } catch (_) { return null; }
  }
  function parseMoney(text) {
    if (!text) return "";
    // DOM text may split the cents into separate spans, producing "R$ 163 , 36".
    // Normalize spacing around the decimal separator before parsing.
    const t = clean(String(text).replace(/\u00a0/g, " "))
      .replace(/\s*,\s*/g, ",")
      .replace(/R\s*\$\s*/i, "R$ ");
    const m = t.match(/R\$\s*[\d.]+(?:,\d{1,2})?/i) || t.match(/[\d.]+,\d{1,2}/);
    return m ? clean(m[0]) : "";
  }
  function parsePercent(text) {
    const m = clean(text).match(/(\d{1,3})\s*%/);
    return m ? `${m[1]}%` : "";
  }
  function textOf(el) { return el ? clean(el.innerText || el.textContent || "") : ""; }
  function firstText(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const value = textOf(el);
      if (value) return value;
    }
    return "";
  }
  function firstAttr(root, selectors, attr) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const value = el?.getAttribute(attr);
      if (value) return value;
    }
    return "";
  }
  function findCard(anchor) {
    // IMPORTANT: do not treat generic .poly-component__title/.poly-component__price
    // elements as cards. Product title links often have those classes themselves;
    // returning the link as the card makes name, price and image appear empty.
    const cardSelectors = [
      ".poly-card", ".ui-search-result", ".ui-search-result__wrapper",
      "li.ui-search-layout__item", ".andes-card", "[data-testid*='result']"
    ];
    for (const selector of cardSelectors) {
      const found = anchor.closest(selector);
      if (found) return found;
    }

    // Walk upward and prefer a container that actually contains product data.
    let node = anchor.parentElement;
    let best = null;
    for (let i = 0; i < 9 && node && node !== document.body; i++, node = node.parentElement) {
      const productLinks = node.querySelectorAll("a[href*='/p/MLB'], a[href*='/MLB-'], a[href*='/UP/MLBU'], a[href*='/ITEM/MLB'], a[href*='/product/MLB']");
      if (productLinks.length > 1) {
        continue;
      }
      const hasImage = !!node.querySelector("img, picture source");
      const hasPrice = !!node.querySelector("[class*='price'], .andes-money-amount, [aria-label*='Preço'], [aria-label*='price']");
      const hasTitle = !!node.querySelector("[class*='title'], h2, h3") || !!clean(anchor.getAttribute("title"));
      if (hasImage && (hasPrice || hasTitle)) best = node;
      if (hasImage && hasPrice && hasTitle) return node;
    }
    return best || anchor.closest("li") || anchor.parentElement || anchor;
  }

  function extractProductId(rawUrl, canonicalUrl) {
    // Prefer the product code explicitly embedded in the path (including MLBU IDs).
    const candidates = [rawUrl, canonicalUrl].filter(Boolean);
    for (const value of candidates) {
      try {
        const u = new URL(value, location.href);
        const path = decodeURIComponent(u.pathname);
        const mlbu = path.match(/MLBU\d+/i);
        if (mlbu) return mlbu[0].toUpperCase();
        const catalog = path.match(/(?:^|\/)p\/(MLB\d+)/i);
        if (catalog) return catalog[1].toUpperCase();
        const item = path.match(/(MLB-?\d{6,})/i);
        if (item) return item[1].toUpperCase();
        const wid = u.searchParams.get("wid");
        if (wid && /^(?:MLBU?B?\d+|MLB-?\d+)$/i.test(wid)) return wid.toUpperCase();
      } catch (_) {}
    }
    return "";
  }

  function extractCategory(_card, _anchor, title, _url) {
    // A categoria é inferida somente pelo nome do produto. Não usamos breadcrumbs,
    // classes genéricas ou outros textos da página, que podem pertencer a widgets.
    const t = clean(title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const has = (...terms) => terms.some(term => new RegExp(`(?:^| )${term}(?: |$)`, "i").test(t));
    const any = re => re.test(t);

    // Classifique termos específicos antes dos genéricos para reduzir falsos positivos.
    if (any(/\b(cola rato|placa adesiva para rato|armadilha para rato|raticida|veneno para rato)\b/)) return "Casa e Controle de Pragas";
    if (any(/\b(racao|areia higienica|arranhador|coleira antipulgas|antipulgas|vermifugo|comedouro|bebedouro pet|tapete higienico pet|brinquedo para cachorro|brinquedo para gato|casinha para cachorro|caixa de transporte pet|shampoo para cachorro|shampoo para gato)\b/)) return "Pet Shop";
    if (any(/\b(iphone|smartphone|celular|motorola edge|galaxy s[0-9]|redmi note|poco x[0-9])\b/)) return "Celulares e Telefonia";
    if (any(/\b(notebook|laptop|chromebook|computador desktop|pc gamer|placa de video|processador ryzen|processador intel|memoria ram|ssd|hd externo|monitor gamer|impressora|teclado mecanico|mouse gamer|webcam|roteador|switch de rede)\b/)) return "Informática";
    if (any(/\b(smart tv|televisao|televisor|soundbar|home theater|projetor|caixa de som|fone de ouvido|headphone|microfone usb|amplificador de audio)\b/)) return "TV, Áudio e Vídeo";
    if (any(/\b(fogao|cooktop|geladeira|refrigerador|freezer|microondas|micro ondas|air fryer|fritadeira eletrica|liquidificador|batedeira|cafeteira|maquina de lavar|lavadora|secadora de roupa|lava loucas|aspirador de po|purificador de agua)\b/)) return "Eletrodomésticos";
    if (any(/\b(furadeira|parafusadeira|esmerilhadeira|serra circular|serra tico tico|chave de impacto|jogo de ferramentas|alicate|chave de fenda|trena|nivel a laser|compressor de ar|lavadora de alta pressao|tinta para parede|torneira|chuveiro eletrico|fechadura|cadeado)\b/)) return "Ferramentas e Construção";
    if (any(/\b(perfume|eau de parfum|shampoo|condicionador|mascara capilar|secador de cabelo|chapinha|modelador de cachos|barbeador|maquina de cortar cabelo|hidratante facial|protetor solar|base maquiagem|batom|mascara de cilios|serum facial|skincare|escova secadora)\b/)) return "Beleza e Cuidado Pessoal";
    if (any(/\b(fralda|carrinho de bebe|cadeirinha infantil|bebe conforto|berco|banheira de bebe|bomba tira leite|mamadeira|chupeta|cadeira de alimentacao|mochila maternidade)\b/)) return "Bebês";
    if (any(/\b(boneca|lego|blocos de montar|quebra cabeca|jogo de tabuleiro|brinquedo infantil|pista de carrinho|hot wheels|massinha de modelar|patinete infantil)\b/)) return "Brinquedos e Jogos";
    if (any(/\b(pneu|bateria automotiva|oleo de motor|central multimidia|lampada automotiva|tapete automotivo|capa para banco de carro|capacete motociclismo|pastilha de freio|amortecedor|moto pecas|macaco hidraulico)\b/)) return "Automotivo";
    if (any(/\b(bicicleta|esteira ergometrica|halter|anilha|barra de musculacao|colchonete|bola de futebol|luva de boxe|tenis de corrida|raquete|barraca de camping|mochila de trekking|saco de dormir|creatina|whey protein)\b/)) return "Esportes e Fitness";
    if (any(/\b(sofa|mesa de jantar|cadeira de escritorio|guarda roupa|colchao|travesseiro|cortina|tapete|luminaria|rack para tv|estante|panela|frigideira|jogo de cama|toalha de banho|organizador|pote hermetico|varal de roupa|cabide)\b/)) return "Casa, Móveis e Decoração";
    if (any(/\b(cafe em graos|capsula de cafe|azeite|arroz|feijao|chocolate|biscoito|suplemento alimentar|vitamina c|creatina|whey protein|leite em po|temperos|cereal)\b/)) return "Mercado e Alimentos";
    if (any(/\b(playstation|ps5|xbox|nintendo switch|controle gamer|console gamer|jogo para pc|cadeira gamer)\b/)) return "Games";
    if (any(/\b(camiseta|camisa|calca jeans|vestido|saia|blusa|jaqueta|casaco|meia|cueca|calcinha|sutia|tenis casual|sapato|sandalia|chinelo|bolsa feminina|carteira|oculos de sol|relogio masculino|relogio feminino|cinto)\b/)) return "Moda e Acessórios";
    if (any(/\b(ebook|livro|caderno|agenda|caneta|lapis|mochila escolar|material escolar|papel a4)\b/)) return "Livros, Papelaria e Escritório";
    if (any(/\b(ventilador|ar condicionado|umidificador|desumidificador|aquecedor|climatizador)\b/)) return "Climatização";
    if (any(/\b(capa de celular|pelicula para celular|carregador usb|cabo usb|power bank|carregador portatil|suporte para celular)\b/)) return "Acessórios para Celular";
    return "Não identificada";
  }

  function getCouponName(button) {
    // Usa o texto visível completo do menor cartão que contém o botão Conferir.
    // Não reduz o nome ao valor do desconto: preserva descrição, regras e limites.
    if (!button) return 'Cupom sem nome';
    let node = button;
    let best = '';
    let bestArea = Infinity;
    for (let depth = 0; node && node !== document.body && depth < 10; depth++, node = node.parentElement) {
      const raw = String(node.innerText || node.textContent || '').replace(/\u00a0/g, ' ');
      const normalized = clean(raw);
      if (!/\bconferir\b/i.test(normalized) || !/(?:R\$\s*\d|\d\s*%|%\s*\d)/i.test(normalized)) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.height > 900 || rect.width > Math.max(window.innerWidth * 0.95, 1200)) continue;
      const lines = raw.split(/\n+/).map(line => clean(line)).filter(Boolean);
      const filtered = lines.filter(line => !/^(conferir|copiar cupom|copiar código|copiar codigo|ver regras|saiba mais)$/i.test(line));
      const full = [...new Set(filtered)].join(' | ').replace(/\s+/g, ' ').trim();
      const area = rect.width * rect.height;
      if (full.length > 8 && area < bestArea) {
        best = full;
        bestArea = area;
      }
      // Depois de encontrar um cartão compacto, não suba para o container da página inteira.
      if (depth >= 1 && area < window.innerWidth * 0.9) break;
    }
    return best || clean(button.closest('article, li, [class*="coupon"], [class*="card"]')?.innerText || '') || 'Cupom sem nome';
  }

  function safeFilePart(value) {
    // Preserva o máximo de texto possível no nome; o CSV também guarda o texto integral na coluna cupom.
    return clean(value || 'Cupom sem nome').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 150) || 'Cupom_sem_nome';
  }

  function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  const PARTIAL_EXPORT_THRESHOLD = 1000; // exporta automaticamente a cada 1000 produtos

  async function exportCurrentCoupon(batch, partial = false) {
    const items = (await getItems()).filter(x => x && typeof x === 'object' && x.url);
    if (!items.length) return 0;
    const couponName = batch.currentCouponName || 'Cupom sem nome';
    const part = Math.max(1, Number(batch.currentCouponPart) || 1);
    const headers = ['cupom', 'id', 'nome', 'preco', 'preco_anterior', 'preco_com_desconto', 'categoria', 'imagem url', 'url'];
    const rows = items.map(x => [couponName, x.id || '', x.title || '', x.currentPrice || '', x.originalPrice || '', x.discountedPrice || '', x.category || 'Não identificada', x.image || '', x.url || '']);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
    const date = new Date().toISOString().slice(0,10);
    const partSuffix = (partial || batch.currentCouponHadParts) ? `_parte_${part}` : '';
    const filename = `ColetorMeli_${safeFilePart(couponName)}${partSuffix}_${date}.csv`;
    const pipe = await chrome.storage.local.get(['pipelineRunId', 'pipelineSettings']);
    if (pipe.pipelineRunId) {
      // Entrega os produtos ao conversor (outra aba) em um bloco novo; um único set atômico.
      const cc = await chrome.storage.local.get('pipelineChunkCount');
      const n = cc.pipelineChunkCount || 0;
      await chrome.storage.local.set({['pipelineChunk_' + n]: rows, pipelineChunkCount: n + 1});
    }
    if (!pipe.pipelineRunId || pipe.pipelineSettings?.backupCsv) {
      const result = await chrome.runtime.sendMessage({type: 'downloadCouponCsv', csv, filename});
      if (!result?.ok) throw new Error(result?.error || 'Não consegui iniciar o download automático do CSV.');
      await sleep(900);
    }
    await chrome.storage.local.set({[K.items]: []});
    lastKnownTotal = 0;
    batch.currentCouponExportedCount = (batch.currentCouponExportedCount || 0) + items.length;
    if (partial) {
      batch.currentCouponHadParts = true;
      batch.currentCouponPart = part + 1;
      await saveBatch(batch);
      await setStatus(`Download parcial concluído: ${couponName}, parte ${part} (${items.length} produtos). A coleta continua.`, {
        batch: true, stage: 'products', exported: items.length, couponName, part, partial: true,
        totalExportedForCoupon: batch.currentCouponExportedCount
      });
    } else {
      await setStatus(`Exportação concluída: ${couponName}; ${items.length} produtos neste arquivo e ${batch.currentCouponExportedCount} exportados neste cupom.`, {
        batch: true, stage: 'products', exported: items.length, couponName, part: batch.currentCouponHadParts ? part : null,
        totalExportedForCoupon: batch.currentCouponExportedCount
      });
    }
    return items.length;
  }

  // Entrega os produtos de cada página ao conversor logo após a captura (sem esperar o cupom acabar).
  async function pushItemsToPipeline(batch) {
    const items = (await getItems()).filter(x => x && typeof x === 'object' && x.url);
    if (!items.length) return 0;
    const couponName = batch.currentCouponName || 'Cupom sem nome';
    const rows = items.map(x => [couponName, x.id || '', x.title || '', x.currentPrice || '', x.originalPrice || '', x.discountedPrice || '', x.category || 'Não identificada', x.image || '', x.url || '']);
    const cc = await chrome.storage.local.get('pipelineChunkCount');
    const n = cc.pipelineChunkCount || 0;
    await chrome.storage.local.set({['pipelineChunk_' + n]: rows, pipelineChunkCount: n + 1, [K.items]: []});
    lastKnownTotal = 0;
    batch.currentCouponExportedCount = (batch.currentCouponExportedCount || 0) + items.length;
    await saveBatch(batch);
    return items.length;
  }

  async function exportPartialIfNeeded(batch) {
    const pipe = await chrome.storage.local.get(['pipelineRunId', 'pipelineSettings']);
    if (pipe.pipelineRunId && !pipe.pipelineSettings?.backupCsv) { await pushItemsToPipeline(batch); return; }
    const items = await getItems();
    if (items.length >= PARTIAL_EXPORT_THRESHOLD) await exportCurrentCoupon(batch, true);
  }

  function extractProduct(anchor, url) {
    const card = findCard(anchor);
    const rawHref = anchor.href || anchor.getAttribute("href") || url;
    const id = extractProductId(rawHref, url);
    const title = firstText(card, [
      "a.poly-component__title", ".poly-component__title", ".ui-search-item__title",
      ".ui-search-item__title-label", "h2", "h3", "[class*='title']"
    ]) || clean(anchor.getAttribute("title")) || clean(anchor.getAttribute("aria-label"));

    // In the current Mercado Livre polycard, the primary image uses this class.
    // Prefer it over arbitrary images that may belong to badges or widgets.
    let image = "";
    const img = card.querySelector("img.poly-component__picture, img[data-testid='picture'], .poly-card__portada img, img");
    if (img) {
      const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
      image = img.getAttribute("data-src") || img.getAttribute("data-lazy") ||
        img.getAttribute("data-lazy-src") || img.getAttribute("src") ||
        srcset.split(",").slice(-2)[0]?.trim().split(/\s+/)[0] ||
        srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    }
    if (!image) {
      const source = card.querySelector("picture source[srcset], source[data-srcset]");
      const srcset = source?.getAttribute("srcset") || source?.getAttribute("data-srcset") || "";
      image = srcset.split(",").slice(-2)[0]?.trim().split(/\s+/)[0] || srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    }
    if (image.startsWith("//")) image = location.protocol + image;
    if (image.startsWith("data:")) image = "";

    const cardText = textOf(card);
    const priceCandidates = [];
    card.querySelectorAll("[class*='price'], .andes-money-amount, [aria-label*='Preço']").forEach(el => {
      const t = textOf(el) || el.getAttribute("aria-label") || "";
      const money = parseMoney(t);
      if (money) priceCandidates.push({money, el, text: t});
    });
    let currentPrice = "";
    let originalPrice = "";
    // Mercado Livre usually marks current and original prices with these classes.
    currentPrice = parseMoney(firstText(card, [
      ".poly-price__current .andes-money-amount",
      ".poly-price__current [data-andes-money-amount='true']",
      ".poly-price__current", ".poly-component__price .andes-money-amount:not(.andes-money-amount--previous)",
      ".ui-search-price__second-line .andes-money-amount",
      ".andes-money-amount--cents-superscript:not(.andes-money-amount--previous)",
      "[class*='price'] .andes-money-amount:not(.andes-money-amount--previous)"
    ]));
    if (!currentPrice) {
      const currentNode = card.querySelector(".poly-price__current [aria-label], .poly-price__current .andes-money-amount");
      currentPrice = parseMoney(currentNode?.getAttribute("aria-label") || textOf(currentNode));
    }
    if (currentPrice && !currentPrice.includes("R$")) currentPrice = "R$ " + currentPrice;
    originalPrice = parseMoney(firstText(card, [
      ".poly-price__labels .andes-money-amount--previous",
      ".andes-money-amount--previous", ".poly-price__previous", ".ui-search-price__original-value",
      "s .andes-money-amount", "del .andes-money-amount", "[class*='previous']"
    ]));
    if (!originalPrice) {
      const previousNode = card.querySelector(".andes-money-amount--previous[aria-label], s[aria-label], del[aria-label]");
      originalPrice = parseMoney(previousNode?.getAttribute("aria-label") || textOf(previousNode));
    }
    if (originalPrice && !originalPrice.includes("R$")) originalPrice = "R$ " + originalPrice;

    // Fallback: use price DOM nodes and strike-through candidates.
    if (!currentPrice && priceCandidates.length) {
      const nonStrike = priceCandidates.find(x => !x.el.closest("s,del") &&
        !/previous|original|old/i.test(x.el.className || ""));
      if (nonStrike) currentPrice = nonStrike.money.includes("R$") ? nonStrike.money : "R$ " + nonStrike.money;
    }
    if (!originalPrice) {
      const strike = card.querySelector("s, del, [class*='previous'], [class*='original']");
      if (strike) originalPrice = parseMoney(textOf(strike));
      if (originalPrice && !originalPrice.includes("R$")) originalPrice = "R$ " + originalPrice;
    }

    const discountLabel = firstText(card, [
      ".poly-price__discount-polylabel", ".poly-price__discount",
      ".ui-search-price__discount", "[class*='discount']"
    ]);
    const discount = parsePercent(discountLabel || cardText);

    // Regra solicitada para os cards do Mercado Livre:
    // - preço: valor junto de "ou R$ ...";
    // - preço_com_desconto: valor principal que acompanha a porcentagem;
    // - sem valor "ou R$ ...", não há desconto para esta saída: o valor principal
    //   (não taxado) continua sendo o preço e preço_com_desconto fica vazio.
    let ouPrice = "";
    const installmentNodes = card.querySelectorAll(".poly-price__installments");
    for (const node of installmentNodes) {
      const t = textOf(node);
      if (/^ou\b/i.test(t) && /R\s*\$/i.test(t)) {
        ouPrice = parseMoney(t);
        if (ouPrice && !ouPrice.includes("R$")) ouPrice = "R$ " + ouPrice;
        if (ouPrice) break;
      }
    }
    let discountedPrice = "";
    const hasPercentBadge = Boolean(parsePercent(discountLabel));
    if (ouPrice) {
      // O preço principal do card é o valor promocional acompanhado do selo percentual.
      if (hasPercentBadge && currentPrice) discountedPrice = currentPrice;
      currentPrice = ouPrice;
    }

    const shipping = /frete grátis/i.test(cardText) ? "Frete grátis" :
      (/frete/i.test(cardText) ? clean((cardText.match(/.{0,20}frete.{0,35}/i) || [""])[0]) : "");
    const rating = firstText(card, [
      ".poly-reviews__rating", ".ui-search-reviews__rating",
      "[class*='rating']"
    ]);
    const reviewCount = firstText(card, [
      ".poly-reviews__total", ".ui-search-reviews__amount",
      "[class*='review'] [class*='total']"
    ]).replace(/[()]/g, "");
    const seller = firstText(card, [
      ".poly-component__seller", ".ui-search-official-store-label",
      "[class*='seller']", "[class*='official-store']"
    ]);
    const badges = [];
    card.querySelectorAll("[class*='badge'], [class*='pill'], [class*='highlight'], [class*='label']").forEach(el => {
      const t = textOf(el);
      if (t && t.length < 90 && !badges.includes(t)) badges.push(t);
    });
    const category = extractCategory(card, anchor, title, url);
    return {
      id,
      url,
      title,
      image,
      currentPrice,
      originalPrice,
      discountedPrice,
      discount,
      shipping,
      rating,
      reviewCount,
      seller,
      badges: badges.join(" | "),
      category,
      sourcePage: location.href,
      collectedAt: new Date().toISOString()
    };
  }

  function collectCards() {
    const products = new Map();
    document.querySelectorAll("a[href]").forEach(anchor => {
      const url = canonicalProductUrl(anchor.href || anchor.getAttribute("href") || "");
      if (!url) return;
      const item = extractProduct(anchor, url);
      const old = products.get(url);
      if (!old || Object.values(item).filter(Boolean).length > Object.values(old).filter(Boolean).length) {
        products.set(url, item);
      }
    });
    return [...products.values()];
  }

  async function getItems() {
    const d = await chrome.storage.local.get(K.items);
    return Array.isArray(d[K.items]) ? d[K.items] : [];
  }
  async function getCatalog() {
    const d = await chrome.storage.local.get('meliCatalog');
    return Array.isArray(d.meliCatalog) ? d.meliCatalog : [];
  }
  function mergeItems(items, products) {
    const map = new Map();
    for (const item of items) {
      if (typeof item === 'string') map.set(item, {url: item});
      else if (item?.url) map.set(item.url, item);
    }
    let added = 0, enriched = 0;
    for (const p of products) {
      if (!p.url) continue;
      const old = map.get(p.url);
      if (!old) {
        map.set(p.url, p);
        added++;
      } else {
        const merged = {...old};
        for (const [key, value] of Object.entries(p)) {
          if (value && (!merged[key] || ["id","title","image","currentPrice","originalPrice","discountedPrice","discount","shipping","rating","reviewCount","seller","badges","category"].includes(key))) {
            if (merged[key] !== value) enriched++;
            merged[key] = value;
          }
        }
        map.set(p.url, merged);
      }
    }
    return {items: [...map.values()], added, enriched};
  }
  async function saveProducts(products) {
    const current = await getItems();
    const currentResult = mergeItems(current, products);
    const catalogResult = mergeItems(await getCatalog(), products);
    if (currentResult.added || currentResult.enriched || catalogResult.added || catalogResult.enriched) {
      await chrome.storage.local.set({[K.items]: currentResult.items, meliCatalog: catalogResult.items});
      lastProgressAt = Date.now();
    }
    return {added: currentResult.added, enriched: currentResult.enriched, total: catalogResult.items.length};
  }
  async function setStatus(message, extra = {}) {
    const now = Date.now();
    await chrome.storage.local.set({[K.status]: {message, url: location.href, time: now, ...extra}});
    // Histórico separado de eventos para que el popup muestre el avance en tiempo real.
    const eventKey = 'meliCollectorEventLog';
    const data = await chrome.storage.local.get(eventKey);
    const events = Array.isArray(data[eventKey]) ? data[eventKey] : [];
    const last = events[events.length - 1];
    if (!last || last.message !== message || now - (last.time || 0) > 1200) {
      events.push({time: now, message});
      await chrome.storage.local.set({[eventKey]: events.slice(-250)});
    }
  }
  async function logPage(count, result) {
    const d = await chrome.storage.local.get(K.log);
    const log = Array.isArray(d[K.log]) ? d[K.log] : [];
    const key = location.pathname + location.search;
    const entry = {page: key, url: location.href, count, result, time: new Date().toISOString()};
    const i = log.findIndex(x => x.page === key);
    if (i >= 0) log[i] = entry; else log.push(entry);
    await chrome.storage.local.set({[K.log]: log.slice(-500)});
  }

  async function capturePage(reason = "auto") {
    if (!enabled) return {count: 0, total: lastKnownTotal};
    if (capturePromise) return capturePromise;
    capturePromise = (async () => {
      await setStatus("Esperando os cards aparecerem...");
      await sleep(1400);
      let previousSignature = "";
      let stablePasses = 0;
      let pass = 0;
      let products = [];
      let saved = {total: lastKnownTotal, added: 0, enriched: 0};
      const started = Date.now();
      while (enabled && Date.now() - started < 25000) {
        pass++;
        products = collectCards();
        saved = await saveProducts(products);
        const signature = products.map(p => p.url + "|" + p.title + "|" + p.currentPrice + "|" + p.discountedPrice + "|" + p.image).sort().join("\n");
        if (signature && signature === previousSignature) stablePasses++;
        else stablePasses = 0;
        previousSignature = signature;
        if (products.length > 0 && stablePasses >= 1) break;
        if (pass === 1 || pass % 3 === 0) {
          await setStatus(`Coletando dados dos cards: ${products.length} produtos encontrados (verificação ${pass}).`, {
            pageCount: products.length, total: saved.total, added: saved.added, enriched: saved.enriched
          });
        }
        await sleep(1300);
      }
      // One final capture catches content that appeared during the last wait.
      const finalProducts = collectCards();
      const finalSignature = finalProducts.map(p => p.url + "|" + p.title + "|" + p.currentPrice + "|" + p.discountedPrice + "|" + p.image).sort().join("\n");
      if (finalSignature !== previousSignature) {
        saved = await saveProducts(finalProducts);
        products = finalProducts;
      } else {
        products = finalProducts;
      }
      lastKnownTotal = saved.total;
      pageSignature = finalSignature;
      await logPage(products.length, products.length ? "capturada" : "sem cards detectados");
      await setStatus(`Página capturada: ${products.length} produtos; ${saved.total} no total.`, {
        pageCount: products.length, total: saved.total, added: saved.added, enriched: saved.enriched, reason
      });
      return {count: products.length, total: saved.total};
    })().finally(() => { capturePromise = null; });
    return capturePromise;
  }

  function findNext() {
    const selectors = [
      "li.andes-pagination__button--next a",
      "a.andes-pagination__link[aria-label*='Próxima']",
      "a[aria-label*='Próxima']",
      "a[aria-label*='Siguiente']",
      "a[title='Seguinte']",
      "a[title='Next']",
      "a[aria-label='Next']",
      "a[aria-label='Siguiente']"
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el?.href && !el.closest("[aria-disabled='true']") &&
          !el.classList.contains("andes-pagination__link--disabled")) return el;
    }
    return [...document.querySelectorAll("a[href]")].find(a => {
      const t = clean(a.innerText || a.getAttribute("aria-label") || a.title).toLowerCase();
      return /^(próxima|seguinte|next|siguiente|próximo)( página)?$/.test(t) && a.href;
    }) || null;
  }

  // Na página de produtos, nunca clicar em um "Próximo" genérico fora da paginação:
  // no Mercado Livre, depois da última página alguns fluxos podem levar a outra loja.
  function findProductPaginationNext() {
    const containers = [
      document.querySelector(".andes-pagination"),
      document.querySelector(".ui-search-pagination"),
      document.querySelector("nav[aria-label*='paginação' i]"),
      document.querySelector("nav[aria-label*='pagination' i]"),
      document.querySelector("[data-testid*='pagination']")
    ].filter(Boolean);
    const container = containers[0];
    if (!container) return null; // seguro: sem paginação identificável, não avançar

    const currentEl = container.querySelector(
      ".andes-pagination__button--current, [aria-current='page'], [aria-current='true']"
    );
    const currentText = clean(currentEl?.innerText || currentEl?.textContent || currentEl?.getAttribute("aria-label") || "");
    const currentMatch = currentText.match(/\d+/);
    const currentPage = currentMatch ? Number(currentMatch[0]) : null;

    const pageNumbers = [...container.querySelectorAll("a, button, li")]
      .map(el => {
        const label = clean(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "");
        const m = label.match(/(?:página|pagina|page)?\s*(\d+)\s*$/i);
        return m ? Number(m[1]) : null;
      })
      .filter(n => Number.isInteger(n) && n > 0);
    const lastVisiblePage = pageNumbers.length ? Math.max(...pageNumbers) : null;

    // Não encerrar só porque a página atual é o maior número VISÍVEL: o Mercado
    // Livre mostra uma janela curta de números (ex.: 1–5) mesmo quando há mais páginas.
    // A condição real de parada passa a ser a ausência de um botão Próxima ativo
    // dentro do componente de paginação reconhecido.

    const selectors = [
      "li.andes-pagination__button--next a",
      "a.andes-pagination__link[aria-label*='Próxima']",
      "a.andes-pagination__link[aria-label*='Siguiente']",
      "a[aria-label*='Próxima']",
      "a[aria-label*='Siguiente']",
      "a[title='Seguinte']",
      "a[title='Next']",
      "a[aria-label='Next']"
    ];
    for (const selector of selectors) {
      const el = container.querySelector(selector);
      if (el?.href && !el.closest("[aria-disabled='true']") &&
          !el.closest(".andes-pagination__button--disabled") &&
          !el.classList.contains("andes-pagination__link--disabled") &&
          el.getAttribute("aria-disabled") !== "true") return el;
    }
    return [...container.querySelectorAll("a[href]")].find(a => {
      const t = clean(a.innerText || a.getAttribute("aria-label") || a.title).toLowerCase();
      return /^(próxima|seguinte|next|siguiente|próximo)( página)?$/.test(t) &&
        !a.closest("[aria-disabled='true']") && !a.closest(".andes-pagination__button--disabled");
    }) || null;
  }

  async function captureAndAdvance() {
    if (!enabled || !autoNext || navigationBusy) return;
    navigationBusy = true;
    try {
      const result = await capturePage("antes de avançar");
      if (!enabled || !autoNext) return;
      await sleep(350);
      const next = findNext();
      if (!next) {
        await setStatus(`Fim da paginação ou botão Próximo não encontrado. ${result.total} produtos salvos.`);
        return;
      }
      await setStatus(`Página salva (${result.count} produtos). Avançando...`, {pageCount: result.count, total: result.total});
      next.click();
      setTimeout(() => { if (location.href === lastUrl) navigationBusy = false; }, 10000);
    } finally {
      setTimeout(() => { if (location.href === lastUrl) navigationBusy = false; }, 10000);
    }
  }

  function getConferirLinks() {
    const found = new Map();
    const buttons = [...document.querySelectorAll('button, [role="button"], a')]
      .filter(el => {
        const label = clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '');
        const rect = el.getBoundingClientRect();
        return /\bconferir\b/i.test(label) && rect.width > 0 && rect.height > 0 &&
          getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
      })
      .filter((el, i, arr) => !arr.some((other, j) => j < i && other.contains(el)));
    for (const el of buttons) {
        const directAnchor = el.matches('a[href]') ? el : el.querySelector('a[href]');
        const wrapperAnchor = el.closest('a[href]');
        const raw = directAnchor?.href || directAnchor?.getAttribute('href') || wrapperAnchor?.href ||
          el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-target-url');
        if (!raw) continue;
        try {
          const u = new URL(raw, location.href);
          if (!/^https?:$/.test(u.protocol) || u.href === location.href) continue;
          u.hash = '';
          if (u.hostname === 'hp.mercadolibre.com' && (u.pathname === '/' || u.pathname === '')) continue;
          if (!found.has(u.href)) found.set(u.href, {url: u.href, couponName: getCouponName(el)});
        } catch (_) {}
    }
    return [...found.values()];
  }

  async function getBatch() {
    const d = await chrome.storage.local.get(K.batch);
    return d[K.batch] || null;
  }
  async function saveBatch(batch) {
    await chrome.storage.local.set({[K.batch]: batch});
  }
  async function continueAfterClick(fromUrl) {
    // Most pagination controls navigate normally. If the site updates in place,
    // give it time to replace the cards before resuming the workflow.
    setTimeout(() => {
      if (location.href === fromUrl) runBatchStep().catch(() => {});
    }, 3800);
  }
  async function finishBatch(batch, message) {
    batch.active = false;
    batch.stage = 'done';
    batch.finishedAt = new Date().toISOString();
    await saveBatch(batch);
    await chrome.storage.local.set({pipelineCollectionDone: true});
    await setStatus(message, {batch: true, totalLinks: batch.links?.length || 0, total: (await getItems()).length});
  }
  async function getBatchRole() {
    // Só a aba original controla a coleta de cupons; só a aba de produto ativa raspa produtos.
    if (new URL(location.href).searchParams.get('__meli_probe') === '1') return 'none';
    try {
      const result = await chrome.runtime.sendMessage({type: 'getBatchRole'});
      return result?.role || 'none';
    } catch (_) { return 'none'; }
  }

  async function runBatchStep() {
    if (batchBusy || batchFinishPending) return;
    const batch = await getBatch();
    if (!batch?.active) return;
    const role = await getBatchRole();
    if ((batch.stage === 'coupons' && role !== 'controller') ||
        (batch.stage === 'products' && role !== 'product')) return;
    batchBusy = true;
    try {
      enabled = true;
      autoNext = false;
      await chrome.storage.local.set({[K.enabled]: true, [K.auto]: false});

      if (batch.stage === 'coupons') {
        await setStatus(`Lendo página ${batch.pageIndex} de ${batch.maxPages} da lista de cupons...`, {batch: true, stage: batch.stage, pageIndex: batch.pageIndex, maxPages: batch.maxPages});
        await sleep(1700);
        // Captura somente o destino real de cada botão. Não misturar links genéricos
        // do cartão/página, pois isso pode fazer a etapa seguinte abrir URLs irrelevantes.
        const couponButtons = [...document.querySelectorAll('button, [role="button"], a')]
          .filter(b => {
            const label = clean(b.innerText || b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '');
            const rect = b.getBoundingClientRect();
            return /\bconferir\b/i.test(label) && rect.width > 0 && rect.height > 0 &&
              getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none';
          })
          .filter((b, i, arr) => !arr.some((other, j) => j < i && other.contains(b)));
        let links = [];
        if (couponButtons.length) {
          for (let i = 0; i < couponButtons.length; i++) {
            try {
              const result = await chrome.runtime.sendMessage({type:'probeCouponButtonDestination', url:location.href, index:i});
              const url = result?.url;
              const detectedName = getCouponName(couponButtons[i]);
              const couponName = detectedName && detectedName !== 'Cupom sem nome'
                ? detectedName
                : `Cupom_${String((batch.links || []).length + 1).padStart(2, '0')}`;
              if (url && /^https?:\/\//i.test(url) && !(batch.links || []).some(x => (typeof x === 'string' ? x : x.url) === url)) {
                const entry = {url, couponName};
                links.push(entry);
                batch.links = [...(batch.links || []), entry];
                // Persist each destination and its coupon label immediately.
                await saveBatch(batch);
              }
              await setStatus(`Cupons página ${batch.pageIndex}/${batch.maxPages}: botão ${i + 1}/${couponButtons.length}; ${batch.links.length} destinos salvos.`, {batch:true, stage:batch.stage, pageIndex:batch.pageIndex, maxPages:batch.maxPages, totalLinks:batch.links.length, testedButtons:i+1, totalButtons:couponButtons.length});
            } catch (_) {
              await setStatus(`Cupons página ${batch.pageIndex}/${batch.maxPages}: falha ao capturar o botão ${i + 1}/${couponButtons.length}; vou continuar.`, {batch:true, stage:batch.stage, pageIndex:batch.pageIndex, maxPages:batch.maxPages, totalLinks:(batch.links || []).length});
            }
          }
        } else {
          // Fallback estrito: usar apenas URLs diretamente associadas a um botão “Conferir”.
          links = getConferirLinks();
          const byUrl = new Map((batch.links || []).map((x, i) => {
            const item = typeof x === 'string' ? {url:x, couponName:`Cupom_${String(i + 1).padStart(2, '0')}`} : {...x};
            if (!item.couponName || item.couponName === 'Cupom sem nome') item.couponName = `Cupom_${String(i + 1).padStart(2, '0')}`;
            return [item.url, item];
          }));
          for (const item of links) {
            if (!byUrl.has(item.url)) {
              if (!item.couponName || item.couponName === 'Cupom sem nome') item.couponName = `Cupom_${String(byUrl.size + 1).padStart(2, '0')}`;
              byUrl.set(item.url, item);
            }
          }
          batch.links = [...byUrl.values()];
          await saveBatch(batch);
        }
        const byUrl = new Map();
        for (const raw of (batch.links || [])) {
          const item = typeof raw === 'string' ? {url: raw, couponName: 'Cupom sem nome'} : raw;
          if (item?.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
        }
        const merged = [...byUrl.values()];
        batch.links = merged;
        batch.pagesScanned = Math.max(batch.pagesScanned || 0, batch.pageIndex);
        await saveBatch(batch);
        await setStatus(`Página de cupons ${batch.pageIndex}/${batch.maxPages}: ${couponButtons.length} botões testados; ${merged.length} destinos únicos guardados.`, {batch: true, stage: batch.stage, pageIndex: batch.pageIndex, maxPages: batch.maxPages, totalLinks: merged.length});
        if (batch.pageIndex < batch.maxPages) {
          const next = findNext();
          if (next) {
            const fromUrl = location.href;
            batch.pageIndex += 1;
            await saveBatch(batch);
            next.click();
            await continueAfterClick(fromUrl);
            return;
          }
          batch.couponPaginationEndedEarly = true;
        }
        if (!batch.links.length) {
          await finishBatch(batch, 'Nenhum endereço de botão “Conferir” foi encontrado. Confira se a página de cupons está aberta e tente novamente.');
          return;
        }
        batch.stage = 'products';
        batch.linkIndex = 0;
        batch.pageIndex = 1;
        batch.productTabId = null;
        await saveBatch(batch);
        await setStatus(`Lista de cupons concluída: ${batch.links.length} links. Vou abrir um único link por vez e fechar sua aba ao terminar a paginação.`, {batch: true, stage: batch.stage, totalLinks: batch.links.length});
        await chrome.runtime.sendMessage({type: 'openBatchProduct'});
        return;
      }

      if (batch.stage === 'products') {
        const currentLinkRaw = batch.links[batch.linkIndex];
        const currentLink = typeof currentLinkRaw === 'string' ? {url: currentLinkRaw, couponName: 'Cupom sem nome'} : currentLinkRaw;
        if (!currentLink?.url) {
          await finishBatch(batch, `Fluxo concluído. ${batch.links.length} links processados e ${(await getItems()).length} produtos salvos.`);
          return;
        }
        batch.currentCouponName = currentLink.couponName || 'Cupom sem nome';
        await saveBatch(batch);
        await setStatus(`Cupom ${batch.currentCouponName} · link ${batch.linkIndex + 1}/${batch.links.length} · página ${batch.pageIndex}: coletando produtos...`, {batch: true, stage: batch.stage, linkIndex: batch.linkIndex + 1, totalLinks: batch.links.length, pageIndex: batch.pageIndex, couponName: batch.currentCouponName});
        await capturePage(`fluxo automático: ${batch.currentCouponName}, link ${batch.linkIndex + 1}, página ${batch.pageIndex}`);
        // Exporta lotes pequenos para evitar quota de armazenamento. Exportar uma
        // parte não encerra o cupom nem modifica o controle de paginação.
        await exportPartialIfNeeded(batch);
        // Re-read in case the workflow was stopped while capture/export was running.
        const latest = await getBatch();
        if (!latest?.active || latest.stage !== 'products') return;
        const next = findProductPaginationNext();
        if (next) {
          const fromUrl = location.href;
          batch.pageIndex += 1;
          await saveBatch(batch);
          await setStatus(`Página ${batch.pageIndex} salva. Avançando para a próxima página deste link; vou continuar até o fim da paginação...`, {batch: true, stage: batch.stage, linkIndex: batch.linkIndex + 1, totalLinks: batch.links.length, pageIndex: batch.pageIndex});
          next.click();
          await continueAfterClick(fromUrl);
          return;
        }
        // Se não houver botão próximo, confirmar explicitamente que está desabilitado.
        // Se o estado não for claro (carregamento/DOM diferente), nunca fechar a aba.
        const pag = document.querySelector(".andes-pagination, .ui-search-pagination, nav[aria-label*='paginação' i], nav[aria-label*='pagination' i], [data-testid*='pagination']");
        // Muitos destinos de cupom abrem uma listagem de página única e não exibem
        // nenhum componente de paginação. Isso é fim válido: não ficar em retry.
        const singlePage = !pag;
        const disabled = pag && pag.querySelector(".andes-pagination__button--next.andes-pagination__button--disabled, li.andes-pagination__button--next[aria-disabled='true'], li.andes-pagination__button--next button:disabled, li.andes-pagination__button--next a[aria-disabled='true'], .andes-pagination__button--next[aria-disabled='true']");
        if (pag && !disabled) {
          await setStatus(`Componente de paginação encontrado, mas o fim ainda não foi confirmado para ${batch.currentCouponName || 'cupom'}. Mantendo a aba aberta e tentando novamente em 5 segundos; não avançarei para outro cupom.`, {batch:true, stage:'products', pageIndex:batch.pageIndex, retryingPagination:true});
          setTimeout(() => runBatchStep().catch(() => {}), 5000);
          return;
        }
        batchFinishPending = true;
        await setStatus(singlePage
          ? `Nenhuma paginação encontrada para ${batch.currentCouponName || 'cupom'}: tratando como página única. Exportando CSV antes de avançar...`
          : `Última página confirmada para ${batch.currentCouponName || 'cupom'}. Exportando CSV antes de avançar...`,
          {batch: true, stage: batch.stage, linkIndex: batch.linkIndex + 1, totalLinks: batch.links.length, couponName: batch.currentCouponName, singlePage});
        await exportCurrentCoupon(batch);
        await chrome.runtime.sendMessage({type: 'batchProductFinished'});
      }
    } catch (e) {
      await setStatus(`Erro no fluxo automático: ${e?.message || e}. Os dados já coletados foram preservados.`, {batch: true, error: String(e)});
    } finally {
      batchBusy = false;
    }
  }

  function onNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    pageStartedAt = Date.now();
    lastProgressAt = Date.now();
    refreshedUrl = "";
    navigationBusy = false;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const batch = await getBatch();
      if (batch?.active) {
        const role = await getBatchRole();
        if ((batch.stage === 'coupons' && role === 'controller') ||
            (batch.stage === 'products' && role === 'product')) runBatchStep().catch(() => {});
        return;
      }
      if (enabled) {
        const result = await capturePage("nova página");
        if (autoNext && enabled) {
          await sleep(250);
          await captureAndAdvance();
        }
      }
    }, 1500);
  }

  function queueCapture() {
    if (!enabled || capturePromise || batchBusy) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (enabled && !capturePromise) capturePage("cards atualizados").catch(() => {});
    }, 1000);
  }

  function installObservers() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      onNavigation();
      // Only schedule a capture when not already capturing; the capture loop itself
      // watches for late-loaded cards and exits as soon as the set stabilizes.
      if (enabled && !capturePromise) queueCapture();
    });
    observer.observe(document.documentElement || document, {childList: true, subtree: true});
    window.addEventListener("pageshow", onNavigation);
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    setInterval(onNavigation, 900);
  }

  async function maybeRecover() {
    if (!enabled || !autoNext || recoveryBusy) return;
    const age = Date.now() - pageStartedAt;
    const idle = Date.now() - lastProgressAt;
    if (age < 90000 || idle < 75000 || refreshedUrl === location.href) return;
    refreshedUrl = location.href;
    recoveryBusy = true;
    await setStatus("Sem progresso por muito tempo; salvando os dados e tentando F5 uma vez...");
    await capturePage("antes de recarregar");
    await sleep(500);
    location.reload();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'probeCouponButton') {
      const index = Math.max(0, Number(msg.index) || 0);
      const buttons = [...document.querySelectorAll('button, [role="button"], a')]
          .filter(b => {
            const label = clean(b.innerText || b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '');
            const rect = b.getBoundingClientRect();
            return /\bconferir\b/i.test(label) && rect.width > 0 && rect.height > 0 &&
              getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none';
          })
          .filter((b, i, arr) => !arr.some((other, j) => j < i && other.contains(b)));
      const button = buttons[index];
      if (!button) { sendResponse({ok:false, reason:'button-not-found', count:buttons.length}); return; }
      try { button.click(); sendResponse({ok:true, count:buttons.length}); }
      catch (e) { sendResponse({ok:false, reason:String(e), count:buttons.length}); }
      return;
    }
    (async () => {
      if (msg?.type === "startBatch") {
        const maxPages = Math.max(1, Math.min(100, parseInt(msg.maxPages, 10) || 1));
        const controller = await chrome.runtime.sendMessage({type: 'registerBatchController'});
        const manualLinks = [...new Set((Array.isArray(msg.manualLinks) ? msg.manualLinks : []).filter(url => /^https?:\/\//i.test(url)))];
        const batch = {active: true, stage: manualLinks.length ? 'products' : 'coupons', marketplace: msg.marketplace || 'mercadolivre', maxPages, pageIndex: 1, links: manualLinks.map(url => ({url, couponName: 'Links adicionais'})), linkIndex: 0, pagesScanned: 0, controllerTabId: controller?.tabId ?? null, productTabId: null, startedAt: new Date().toISOString()};
        enabled = true; autoNext = false;
        await chrome.storage.local.set({[K.enabled]: true, [K.auto]: false, [K.batch]: batch});
        await setStatus(manualLinks.length ? `Iniciando com ${manualLinks.length} links adicionais para coleta.` : `Iniciando fluxo: vou ler até ${maxPages} páginas de cupons e depois processar cada link “Conferir”.`, {batch: true, stage: batch.stage, pageIndex: 1, maxPages, marketplace: batch.marketplace});
        sendResponse({ok: true});
        setTimeout(() => runBatchStep().catch(() => {}), 250);
      } else if (msg?.type === "stopBatch") {
        const batch = await getBatch();
        if (batch) { batch.active = false; batch.stage = 'stopped'; await saveBatch(batch); }
        try { if (batch) await exportCurrentCoupon(batch, true); } catch (_) {}
        await chrome.storage.local.set({pipelineCollectionDone: true});
        await setStatus('Coleta interrompida. O conversor vai converter o que já foi coletado e entregar a planilha.');
        sendResponse({ok: true});
      } else if (msg?.type === "setEnabled") {
        enabled = !!msg.enabled;
        await chrome.storage.local.set({[K.enabled]: enabled});
        await setStatus(enabled ? "Coleta ligada." : "Coleta pausada.");
        if (enabled) await capturePage("ativação");
        sendResponse({ok: true});
      } else if (msg?.type === "setAutoNext") {
        autoNext = !!msg.enabled;
        await chrome.storage.local.set({[K.auto]: autoNext});
        await setStatus(autoNext ? "Avanço automático ligado." : "Avanço automático desligado.");
        sendResponse({ok: true});
      } else if (msg?.type === "scan") {
        await capturePage("manual"); sendResponse({ok: true});
      } else if (msg?.type === "advance") {
        await captureAndAdvance(); sendResponse({ok: true});
      } else sendResponse({ok: false});
    })();
    return true;
  });

  chrome.storage.local.get([K.enabled, K.auto, K.items, K.batch]).then(d => {
    enabled = !!d[K.enabled];
    autoNext = !!d[K.auto];
    const items = Array.isArray(d[K.items]) ? d[K.items] : [];
    lastKnownTotal = items.length;
    if (d[K.batch]?.active) {
      enabled = true; autoNext = false;
      setTimeout(() => runBatchStep().catch(() => {}), 1800);
    } else if (enabled) setTimeout(async () => {
      await capturePage("retomada");
      if (autoNext && enabled) captureAndAdvance();
    }, 1600);
  });

  installObservers();
  setInterval(() => {
    onNavigation();
    maybeRecover().catch(() => {});
  }, 4000);
})();