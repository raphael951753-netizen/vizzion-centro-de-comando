# Centro de Comando — Afiliados (extensão Chrome, Manifest V3)

Painel em **aba própria do Chrome** que controla as abas das redes abertas **na mesma janela**:
publicação em várias redes, atendimento com IA no WhatsApp/Telegram, ofertas do dia, e tasks da equipe por projeto.

## 1. Instalar (2 minutos)
1. Descompacte a pasta `centro-de-comando`.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta.
4. Fixe a extensão na barra e clique no ícone: o painel abre numa aba.

> Dica de organização: use **uma janela do Chrome (ou um perfil do Chrome) por projeto**, logada nas contas daquele projeto
> (ex.: janela "Meli" com Instagram, WhatsApp Web e Telegram Web do Meli). O painel só enxerga as abas da janela em que foi aberto.

## 2. Primeiro uso
1. Entre com o e-mail e a senha individuais criados previamente no Supabase Authentication. Não há cadastro público na extensão.
2. **Configurações**: escolha Google Gemini e cole uma chave do Google AI Studio (modelo padrão `gemini-2.5-flash`). O Gemini tem camada gratuita sujeita a limites e disponibilidade; consulte o AI Studio. Claude continua opcional.
3. **Catálogo**: importe seus produtos (`.json` ou `.csv`; veja `exemplo-produtos.csv`). Campos reconhecidos: id, titulo, preco, preco_antigo, link, imagem, categoria, loja, vendas, nota.
4. **Projeto geral**: escreva as etapas da empresa, crie os projetos (Meli, Shopee, clientes…) e cadastre a equipe.
5. Em cada **projeto**: defina posts por dia, responsáveis, etapas internas, contas (um grupo por linha em "Itens" nas contas de WhatsApp/Telegram) e o tom do bot.
6. Em **Hoje**, clique em **Gerar tasks de hoje**. (Gera sozinho no primeiro acesso de cada dia.)

## 3. Como funciona cada tela
- **Hoje**: suas tasks, progresso da meta diária de posts, **ofertas do dia** (maior desconto + vendas + nota) e **insights de conteúdo** com IA.
- **Projetos**: perfis individuais com logo, bio, catálogo, urgência das etapas (verde/amarelo/vermelho), número de tasks internas por dia e arquivos de ferramentas. **Usuários** fica em aba separada.
- **Projeto**: meta e equipe, etapas internas, contas e itens, tasks de hoje, configuração do bot.
- **Publicar**: escolha projeto, arquivo, título (YouTube) e texto, marque as redes e clique **Preparar nas abas**. O painel abre cada rede, anexa o arquivo e escreve o texto. **Você revisa e clica em Publicar** em cada aba. Depois clique **Já publiquei** para contar 1 post na meta do dia.
- **Atendimento**: com um chat aberto no WhatsApp/Telegram Web, **Ler conversa → Gerar resposta → Colocar no campo**. A leitura usa o conteúdo do WhatsApp Web diretamente, sem captura de tela nem troca forçada de foco. A IA busca produtos na base, monta kits para pedidos como "monte um quarto" ou "monte um computador", explica o processo de compra (compra no marketplace pelo link) e marca **[HUMANO]** quando o caso pede atendente. O **Simulador** testa tudo sem abrir o chat.
- **Monitor**: observa o chat aberto e prepara a resposta quando o cliente escreve. Modo **Rascunho** (padrão) deixa o texto no campo; modo **Auto** envia sozinho só em conversas 1:1, com limite por hora.
- **Ofertas e grupos**: marque ofertas, gere variações (preço e link vêm da base; a IA só escreve a abertura e a chamada) e use **Abrir e preencher** em cada grupo cadastrado. Você aperta Enter.

## 4. Tasks diárias: como são montadas
Para cada projeto: uma task por post da meta (ex.: 3) dividida entre os responsáveis + até N etapas internas (padrão 2). Etapas "Em andamento" voltam todo dia até concluir; as demais entram por sorteio. A agência recebe etapas do projeto geral para os admins. Marcar uma task de etapa muda a etapa para "Em andamento"; concluir de vez é no status da etapa. Posts registrados em **Publicar** fecham as tasks de post automaticamente.

## 5. Login individual, equipe compartilhada e histórico

Esta versão usa Supabase Auth para autenticar cada integrante. Todos os integrantes autenticados têm permissões de trabalho equivalentes: o login serve principalmente para identificar quem entrou e quem concluiu ou alterou tarefas. A API verifica o token de cada sessão; não confia em um nome enviado livremente pelo navegador.

### Preparação do banco

1. O SQL inicial já cria `vizzion_state`, `vizzion_products` e `vizzion_profiles`.
2. No Supabase, abra **SQL Editor** e execute também o arquivo `backend-exemplo/migracao-historico.sql`. Ele cria `vizzion_activity_log`, usado para registrar logins, criação de etapas, conclusão/reabertura de tarefas, criação/exclusão de projetos e publicações registradas.

### Criar contas pela extensão

Depois de hospedar o backend e entrar com a primeira conta, abra a aba **Equipe**. Preencha nome, e-mail e senha inicial e clique em **Criar conta**. A nova conta fica disponível imediatamente e o perfil aparece na lista. A pessoa entra com o e-mail e a senha inicial que você combinou com ela por um canal privado. Use uma senha exclusiva, com pelo menos 8 caracteres. Não há uma lista fixa de três e-mails: a equipe pode crescer sem alterar as variáveis do servidor. Qualquer integrante autenticado pode cadastrar outro integrante, conforme o modelo simples de colaboração combinado.

### Hospedar a API

Publique a pasta `backend-exemplo` em um serviço que execute Node.js 18 ou superior (por exemplo, Render). Configure estas variáveis no painel do serviço, nunca no código da extensão:

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_ANON_KEY`: chave pública/anon do projeto, disponível em Project Settings → API Keys.
- `SUPABASE_SERVICE_ROLE_KEY`: chave secreta `service_role`/secret. **Somente no servidor; nunca na extensão, GitHub ou mensagens.**
- `PORT`: normalmente a hospedagem define automaticamente.

O comando de inicialização é `npm start`. A rota `/health` deve responder com `ok: true` quando a API estiver ativa. A URL que você usará no login da extensão é a URL da API hospedada, e não a URL `https://...supabase.co`.

### Entrar na extensão

1. Recarregue a extensão em `chrome://extensions`.
2. Abra o Centro de Comando e cole a URL da API no campo **URL do backend**.
3. Clique em **Permitir conexão** e aceite a permissão do Chrome.
4. Entre com seu e-mail e senha individuais.
5. Repita nos outros dois computadores/perfis Chrome.

O estado de projetos, etapas/tarefas, registros de publicações e catálogo de produtos passa a ser compartilhado. A aba **Histórico** mostra as últimas 100 ações recebidas pela API. A aba **Equipe** mostra as contas que existem no Supabase. Os tokens de sessão ficam no armazenamento local do Chrome; a chave `service_role` fica apenas no servidor.

**Observações:** esta é uma implementação simples para uma equipe de três pessoas, sem níveis de permissão complexos. Todos os integrantes autenticados podem editar os dados compartilhados. A sincronização do estado inteiro usa uma estratégia simples de última gravação e não é um sistema de edição simultânea com resolução de conflitos; evitem editar exatamente o mesmo item ao mesmo tempo. Os dados que já existiam apenas no navegador não são enviados automaticamente ao primeiro login se o estado remoto já tiver conteúdo: antes da migração, faça um backup e use “Enviar para a equipe” conscientemente.

## 6. Limites e cuidados (leia)
- **Seletores quebram.** WhatsApp, Instagram, Facebook, TikTok e YouTube mudam o HTML sem avisar. Os seletores estão no topo de `whatsapp.js`, `telegram.js` e em cada função de `social.js`. Se uma rede parar de funcionar, o ajuste é local (inspecione o elemento e troque o seletor).
- **A extensão não clica em "Publicar" nem aperta Enter por você** nas redes. Isso é intencional: automação de envio em massa e postagem sem revisão é a principal causa de banimento (os termos do WhatsApp, Meta e TikTok restringem automação) e risco para a reputação das contas. Preferi o modelo "a IA prepara, a pessoa confirma".
- O modo **Auto** do atendimento existe, mas use apenas com clientes que escreveram primeiro; mesmo assim há risco para a conta, principalmente em número comum. Para escala, o caminho oficial é a **API do WhatsApp Business**.
- Envie ofertas só para grupos que aceitam esse conteúdo, mantenha o aviso de **link de afiliado** (já vai nos textos) e respeite as regras de cada marketplace.
- As senhas são verificadas pelo Supabase Auth. A chave secreta `service_role` existe somente como variável de ambiente no backend. Cada pessoa mantém sua própria chave de IA no armazenamento local do navegador.
- Vídeos grandes são enviados à aba em pedaços; arquivos acima de ~200 MB podem ficar lentos.
- Depois de instalar ou atualizar a extensão, **recarregue as abas das redes** (ou deixe o painel injetar o script na primeira ação).

## 7. Novos recursos desta versão
- Normalização de preços para formatos `1.234,56`, `1,234.56` e aliases de CSV comuns em marketplaces, incluindo `sale_price`, `price`, `price_before_discount`, `image_link` e `product_link`. Confira os cabeçalhos se sua fonte usa nomes próprios.
- Os cards de produto mostram a imagem ao lado do nome e preço.
- Cada projeto permite carregar logo, bio, definir quantas tasks de etapas serão puxadas para o dia, classificar urgência e manter seu catálogo e arquivos.
- A Biblioteca de posts guarda o texto completo e, para arquivos de até 2 MB, uma cópia da imagem publicada.
- A interface usa o tema visual Vizzion e cards em formato de feed social.

## 8. Arquivos
`manifest.json` · `background.js` (abre o painel) · `app.html/css/js` (painel) · `common.js` (utilitários) · `whatsapp.js` · `telegram.js` · `social.js` (Instagram, Facebook, TikTok, YouTube) · `icons/` · `exemplo-produtos.csv` · `backend-exemplo/server.js` · `backend-exemplo/migracao-historico.sql`


## Identidade visual Vizzion
O painel usa o logo fornecido e uma paleta baseada nele: grafite/carvão no fundo, azul elétrico e ciano/turquesa em gradientes, com cartões escuros e realces discretos. O arquivo `vizzion-logo.png` é o logo aplicado na navegação.


## Publicação por foto ou vídeo
Na aba Publicar, selecione Foto ou Vídeo. O YouTube é ocultado no modo Foto. O TikTok deve estar autenticado no TikTok Studio; selecione a aba de Foto ou Vídeo correspondente quando a interface pedir. A opção Publicar automaticamente tenta acionar o botão final quando localizado, mas as redes mudam seus seletores e podem exigir confirmação manual.


### Rotas do TikTok Studio
- Para publicar vídeo, o painel abre `https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video`.
- Para publicar foto/carrossel, o painel abre `https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=photo`.
- A rota é escolhida automaticamente pelo modo Foto/Vídeo selecionado no painel, inclusive quando já existe uma aba do TikTok aberta.


## Implementações desta revisão

- Aba Publicar: escolha “Postar agora” ou desmarque para definir data e horário; publicações agendadas guardam redes, mídia e textos e entram na fila local.
- A fila chama a ação `runPublish` existente; os fluxos de busca, cliques, preenchimento de campos e upload em `social.js` não foram alterados.
- Fila visível com data/hora, status, erros e cancelamento de itens ainda agendados.
- Ferramentas: download por arquivo mantido e opção de substituir arquivo individualmente.
- Catálogo: botão para baixar/exportar os produtos do catálogo selecionado (JSON).
- Download de catálogo remoto paginado em lotes de 1.000 para evitar truncamento no limite padrão do Supabase.
- Configurações: botão para testar a conexão com o provedor de IA configurado.

### Limitações importantes do agendamento

A fila fica no armazenamento local deste navegador/instalação e não é sincronizada entre usuários. Para executar no horário, mantenha o Centro de Comando aberto, o Chrome ativo, as abas/sessões das redes autenticadas e o computador fora de suspensão. A execução usa exatamente o modo já escolhido: se “Publicar automaticamente” estiver desmarcado, prepara o conteúdo nas abas para revisão; se estiver marcado, tenta o fluxo automático existente. A disponibilidade e a confirmação final continuam dependentes de cada plataforma.

O botão de exportação do catálogo gera JSON para preservar todos os campos. O código não foi testado ao vivo com as credenciais nem com as contas sociais do usuário; faça um teste com uma publicação de baixo risco antes de depender da fila.
