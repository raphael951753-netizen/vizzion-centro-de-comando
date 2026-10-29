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
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"][aria-label*="caption" i]',
        '[contenteditable="true"][aria-label*="legenda" i]',
        'textarea[placeholder*="caption" i]',
        'textarea[placeholder*="legenda" i]',
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
    if (actualMediaType === 'photo' && ed.isContentEditable) {
      // O TikTok pode rejeitar a inserção direta via paste. Foca o editor e insere
      // o conteúdo em pequenos passos, em vez de despejar a legenda inteira de uma vez.
      ed.click();
      ed.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete');
      await CC.sleep(180);
      const caption = String(text || '');
      for (const char of caption) {
        if (char === '\n') {
          document.execCommand('insertLineBreak');
        } else {
          document.execCommand('insertText', false, char);
        }
        await CC.sleep(18);
      }
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    } else if (actualMediaType === 'video' && ed.isContentEditable) {
      // O TikTok pode preencher automaticamente a legenda com o nome do arquivo.
      // Primeiro seleciona e apaga TODO o conteúdo existente; só então digita o texto programado.
      ed.click();
      ed.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete');
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      await CC.sleep(250);
      const caption = String(text || '');
      for (const char of caption) {
        if (char === '\n') {
          document.execCommand('insertLineBreak');
        } else {
          document.execCommand('insertText', false, char);
        }
        await CC.sleep(18);
      }
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    } else {
      // Para campos input/textarea, zera o nome automático antes de inserir a legenda.
      if (actualMediaType === 'video') CC.setText(ed, '');
      CC.setText(ed, text);
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

  CC.handlers.POST_FILL = async ({ fileId, fileIds, text, title, autoPost, mediaType }) => {
    const fn = need(RUN[host], 'Rede não suportada: ' + host);
    const ids = (Array.isArray(fileIds) && fileIds.length ? fileIds : (fileId ? [fileId] : []));
    const files = ids.map(id => CC.files[id]).filter(Boolean);
    if (ids.length && files.length !== ids.length) throw new Error('Uma ou mais fotos não chegaram completas à aba.');
    const file = files[0] || null;
    // Hashtags are plain text while composing; the platforms make them clickable after publishing.
    // Normalize accidental missing spaces between a word and a hashtag without altering hashtag spelling.
    const postText = String(text || '').replace(/([^\s#])(#\w)/gu, '$1 $2');
    const msg = await fn({ text: postText, file, files, title, autoPost: !!autoPost, mediaType: mediaType || (file?.type?.startsWith('image/') ? 'photo' : 'video') });
    CC.banner('Centro de Comando: ' + msg);
    return { ok: true, msg };
  };
})();
