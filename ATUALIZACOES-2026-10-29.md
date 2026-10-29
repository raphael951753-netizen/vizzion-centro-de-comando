# Atualização Vizzion 1.7.3 — Vitrine

- Em cada projeto, a aba **Vitrine** agora permite ordenar por **maior desconto primeiro** ou **menor desconto primeiro**, mantendo os filtros existentes de nome, categoria e faixa de preço combináveis.
- Cada card de produto tem o botão **Excluir do catálogo**. A ação pede confirmação, remove o item do catálogo local e agenda a sincronização com o backend configurado. O item deixa de aparecer nas ofertas geradas a partir desse catálogo.
- Mantida a paginação de 50 cards por página.

## Versão 1.7.4 — Mensagens IA e catálogo
- Na janela “Mensagem adicional”, botão para gerar texto introdutório com IA com base nos produtos selecionados; texto fica editável antes do envio.
- Em Configurações, opção de apagar todos os produtos da tabela compartilhada do backend e do catálogo local. Exige login e confirmação digitada; usa o endpoint PUT /products com lista vazia.
- Em Projeto → Redes sociais e atendimento, campo “Produtos enviados por solicitação (1 a 20)”. O bot respeita esse limite ao atender pedidos de produtos; padrão 5.
- O limite de fotos nas Configurações gerais continua separado do número de produtos enviados.


## Versão 1.7.5 — Quantidade de produtos por solicitação
- O valor configurado em Projeto → Redes sociais e atendimento → Atendimento · bot do projeto determina a quantidade de produtos correspondentes enviados em cada pedido (ex.: 2 = duas opções para 'quero ver tênis'), sem ficar preso a cinco. Se houver menos correspondências no catálogo, envia apenas as disponíveis.
- Cada produto segue em mensagem separada, tentando enviar a foto própria e incluindo nome, categoria, preço atual, preço anterior quando disponível e link. Se a foto não estiver disponível ou falhar, envia os dados do produto em texto.
- O caminho de vitrine por produto não usa o limite geral de fotos das respostas textuais.


## Versão 1.7.6 — Imagens de produtos nas publicações
- Em **Publicar → Várias redes**, botão **Imagem do produto** ao lado de Vídeo e Foto.
- Ao ativar, a Vizzion procura no catálogo do projeto os produtos mencionados no corpo do texto, baixa as imagens disponíveis e as anexa ao post junto com a legenda já escrita.
- Aceita menções pelo nome completo ou por palavras relevantes do nome do produto; tenta anexar até 10 imagens por publicação.
- Mantém o fluxo de revisão/publicação das redes existentes. YouTube fica indisponível nesse modo porque o fluxo atual do Studio é de envio de vídeo, não de post com fotos.
- A publicação agendada também salva o modo de imagem de produto e refaz a busca no catálogo quando chega o horário.
