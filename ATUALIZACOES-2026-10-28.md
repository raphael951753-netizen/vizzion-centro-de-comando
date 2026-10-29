# Vizzion — correções e melhorias de catálogo (28/10/2026)

## Correções e implementações
- Corrigida a leitura de preços brasileiros como `3.149` e `3.699` (milhares), sem quebrar `3.149,90`, `39,90`, `3149.90` ou notas como `4.8`.
- Em **Publicar**, “Gerar texto a partir de um produto” agora é uma busca por nome com sugestões dinâmicas enquanto se digita.
- Em **Ofertas do dia**, os cards identificam o projeto de origem. “Copiar texto” inclui o link do produto/afiliado, nome do projeto e, quando disponíveis, categoria e loja.
- **Abrir catálogo** começa sem listar produtos. Ao digitar, mostra até 100 produtos cujo nome começa com o texto digitado; os resultados mudam conforme a busca e cada item tem “Copiar informações”.
- Removida a lista de produtos exibida diretamente na seção “Catálogo do projeto”.
- Adicionada a aba **Vitrine** dentro de cada projeto, com cards de produto, imagem, preço atual/anterior, desconto, categoria, loja e projeto; busca, filtro por categoria, preço mínimo/máximo, paginação de 50 produtos e botão para copiar informações/link de afiliado.
- Mantido o fluxo existente de publicação nas redes sociais; esta atualização não altera a sequência de publicação.

## Importação
Os campos principais continuam sendo `id`, `nome`, `preco`, `preco_anterior`, `categoria`, `imagem url` e `url`. Campos adicionais são ignorados.


## Versão 1.2.1 — IA e ofertas
- Adicionada permissão de host para Google Gemini para permitir chamadas da IA pela extensão.
- A conexão Gemini existente usa a chave cadastrada em Configurações > IA; a chave não é incluída em exportações de backup.
- Ofertas do dia exibem a identidade visual do projeto no card (logo cadastrado ou inicial como alternativa).
- Copiar texto nas ofertas copia apenas nome, preço, link e aviso de afiliado; remove categoria, loja e nome do projeto.


## Versão 1.2.2 — Atendimento visual e monitor de não lidas
- Removida a captura de tela do WhatsApp: a leitura usa somente o conteúdo DOM da conversa, evitando ativar a aba e puxar a janela para o foco.
- O monitor busca indicadores de mensagens não lidas na lista lateral, abre conversas individuais uma por vez e aguarda o processamento da Vizzion antes de seguir.
- O monitor envia uma confirmação ao content script após processar cada evento, evitando que a varredura avance para outro chat antes de terminar a resposta.
- Mantém modo Rascunho e modo Auto, limite configurável por hora e ignora grupos no envio automático.
- A leitura de mensagens não envia imagens da tela ao provedor de IA.
- Removida a permissão `activeTab`, que era usada somente para captura visual.


## Vizzion 1.2.3 — Backend configurado automaticamente
- URL do backend Supabase Vizzion definida internamente e aplicada também a instalações com configurações antigas.
- Campo da URL removido da tela de login e das configurações comuns.
- Login solicita a permissão de conexão do Chrome quando necessário; usuário informa apenas e-mail e senha.
- Mantidas as demais funções e o fluxo de publicação da versão 1.2.2.


## Vizzion 1.2.6 — atendimento automático
- Simplificada a tela de Atendimento: projeto, rede e botão único para ligar/desligar o automático.
- Ao ligar, o modo de resposta é automático e a fila processa uma conversa por vez.
- Corrigida a expressão regular que identificava contadores de mensagens não lidas no WhatsApp.
- Adicionado monitoramento de conversas com indicadores de não lidas no Telegram Web.
- Ao trocar de rede durante o monitoramento, o monitor antigo é desligado; é necessário ligar novamente para a nova rede.
- Mantidos os limites de envio por hora e o tratamento de transferência para atendimento humano.


# Atualização 1.2.9 — WhatsApp sem roubar foco

- Removida a ativação temporária da aba/janela do WhatsApp durante a varredura e leitura de mensagens.
- O monitor continua tentando identificar conversas com notificações não lidas no DOM e abrir a conversa dentro da própria aba em segundo plano.
- Mantida a fila de processamento do atendimento e a proteção de duplicidade existente.
- Importante: o HTML fornecido é uma captura estática. É necessário validar na sessão real do WhatsApp Web; o site pode limitar ações/envios quando a aba fica em segundo plano.


## Versão 1.3.0 — correção de segurança do atendimento
- O monitor observa mudanças do título da aba do WhatsApp (ex.: `(1) WhatsApp`) como gatilho adicional para varrer conversas não lidas.
- A detecção de não lidas inclui atributos `class`, `data-icon`, `data-testid`, `title` e `aria-label`.
- `CHAT_OPEN` clica na linha da conversa/grupo e aguarda confirmação do título antes de preencher.
- Respostas automáticas e rascunhos passam a carregar o nome da conversa de origem. O WhatsApp bloqueia o preenchimento/envio se o título atual não corresponder ao alvo.
- Se o envio automático falhar ou a conversa não puder ser confirmada, o sistema não coloca a resposta em outra conversa como fallback.
- O botão de grupos pede confirmação explícita, abre o grupo correto e envia uma única vez; se o título do grupo não corresponder, bloqueia o envio.
- Validado sintaticamente com `node --check`; não foi possível realizar teste com sessão WhatsApp ao vivo nesta execução.


## Versão 1.4.0 — atendimento WhatsApp reescrito (validado contra o HTML real)
- Leitura de mensagens: a direção (cliente x você) agora vem do rótulo "Nome:/Você:" e do ícone de status; antes, mensagens sem "rabinho" (2ª, 3ª... de uma sequência) eram descartadas.
- Abrir conversa: o clique agora é completo (pointer+mouse) no elemento interno; antes era disparado na linha externa e o React não recebia.
- Fila FIFO por ordem de chegada: detecta contador de não lidas OU mudança de prévia/hora na lista (não depende só do contador).
- Envio sem duplicar texto: espera o editor atualizar antes de usar o fallback; trava de segurança se o campo ficar com texto a mais.
- Campo de busca corrigido (é <input>); texto multi-linha com quebra correta (antes saía "\n" literal); mensagens antigas duplicadas são colapsadas na leitura.
- Segundo plano: wa-visibility.js (aba "visível"), relógio via service worker em aba oculta, e a aba do WhatsApp pode estar em outra janela.
- Dica: deixe o WhatsApp Web numa janela própria, pequena, sem minimizar nem cobrir totalmente.


## Versão 1.5.0 — fotos dos produtos no atendimento
- Depois de enviar a resposta de texto, o bot baixa a foto (coluna "imagem url") dos produtos que a resposta cita e envia até N fotos na mesma conversa (Configurações > Bot e tasks > "Fotos de produtos por resposta", padrão 3; 0 desliga).
- As imagens são convertidas para JPEG (máx. 1200 px) antes de enviar; só vale no modo automático e nunca em conversa diferente da de origem.
- Permissões de rede adicionadas para os CDNs do Mercado Livre e da Shopee (mlstatic.com, susercontent.com, shopee.com.br).
- A tela de pré-visualização de foto do WhatsApp não estava no HTML enviado: o clique em "Enviar" usa seletores genéricos. Se falhar, a atividade recente mostra "fotos NÃO enviadas".


## Versão 1.5.1 — envio da foto corrigido
- O botão de enviar da pré-visualização é achado por diferença (botões novos após o paste): rótulo/ícone "enviar" ou, na falta, o botão mais ao canto inferior direito.
- O clique vai no elemento mais interno sob o botão; se a tela não fechar, tenta Enter uma única vez.
- Em caso de falha, a mensagem em "Atividade recente" lista os botões encontrados (ajuda a ajustar).


## Versão 1.6.0 — vitrine de produtos no atendimento
- A IA agora classifica a pergunta (produtos / kit / outro). Pergunta direta por produto ("tem iphone?", "quero um guarda-roupa") ativa o modo vitrine.
- Fluxo: 1) mensagem "Já vou procurar isso pra você..." (texto em Projeto > bot > searchText, padrão embutido); 2) busca no catálogo; 3) até 5 produtos, cada um em UMA mensagem: foto + legenda (nome, preço, link). Se a legenda não puder ser digitada na foto, a foto vai e o texto em seguida; sem foto, vai só o texto.
- Respeita o orçamento citado pelo cliente quando há produtos dentro dele. Se nada for encontrado, segue o fluxo normal (IA diz que não achou e oferece humano). Pedidos de kit seguem como antes.
- A vitrine inteira conta como 1 resposta no limite por hora (o aviso inicial conta); as mensagens de produto não são contadas. "Fotos de produtos por resposta" = 0 envia só texto, sem foto.
- Se o aviso inicial for bloqueado (limite/conversa errada), a vitrine é cancelada.


## Versão 1.6.1 — fotos com aba oculta e vitrine tolerante a falhas
- Causa do erro anterior: o WhatsApp só desenha a pré-visualização da foto com a aba visível; o código confundiu botões do cabeçalho (ligação, pesquisar) com o botão de enviar.
- Botões do cabeçalho, lista lateral e rodapé agora são ignorados na procura do botão de enviar.
- Durante o envio das fotos, a aba do WhatsApp é trazida para frente (só se não estiver ativa) e a aba anterior volta ao terminar. Com o WhatsApp em janela própria, nada pisca.
- requestAnimationFrame com fallback quando a aba está realmente oculta (ajuda o WhatsApp a desenhar telas em segundo plano).
- Se a foto falhar, a tela é fechada com Esc e o produto segue em texto; a vitrine continua. Após 2 falhas seguidas, o restante vai só em texto. Só uma troca de conversa interrompe a vitrine.

## Versão 1.7.0 — fila de ofertas e ativação automática do Gemini
- Ofertas em grupos: busca de produtos por texto com resultados dinâmicos; ofertas do dia concentradas nessa aba e removidas do Início.
- Adicionada caixa de mensagem, seleção de todos os destinos, programação por data/horário, fila sequencial, estados pendente/enviando/enviado/erro/cancelado e controles para retomar/cancelar/pausar.
- A fila processa um destino por vez enquanto o painel estiver aberto. Um envio não confirmado vira erro para conferência; não é repetido automaticamente.
- Ao finalizar um atendimento individual, pergunta se a pessoa consentiu em entrar na lista de envios. Se aceitar, o nome/número como aparece no chat é adicionado à lista WhatsApp do projeto sem duplicar registros.
- Gemini definido como provedor ativo e modelo `gemini-3.5-flash-lite`; a extensão tenta validar a conexão automaticamente após login/restauração de sessão.
- A chave da API é mantida no armazenamento local da extensão e não é incluída nos backups exportados.
- Validação realizada: sintaxe JavaScript e integridade do ZIP. O fluxo real de WhatsApp/Telegram e a disponibilidade do modelo exigem teste na sessão autenticada.
