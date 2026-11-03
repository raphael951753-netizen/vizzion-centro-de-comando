# Vizzion — Documentação da Arquitetura

## 1. Objetivo

Este documento descreve a arquitetura atual do Centro de Comando Vizzion.

O GitHub Copilot deve consultar este documento antes de propor ou executar alterações no projeto, especialmente alterações no banco de dados, backend, autenticação e sincronização.

**Regra principal: preservar o funcionamento atual e todos os dados existentes.**

## 2. Tecnologias utilizadas

- Extensão Chrome Manifest V3.
- JavaScript na interface.
- Supabase como backend e banco de dados.
- PostgreSQL como banco relacional.
- Supabase Edge Functions com Deno e TypeScript.
- Supabase Auth para autenticação.
- Supabase Storage para arquivos.
- GitHub para versionamento e integração de migrações.

## 3. Estrutura do projeto

A estrutura principal inclui:

- `app.html`: interface do painel.
- `app.js`: lógica da interface.
- `manifest.json`: configuração da extensão.
- `supabase/config.toml`: configuração do Supabase.
- `supabase/functions/vizzion-api/index.ts`: API principal.
- `supabase/migrations/`: histórico de migrações SQL.

## 4. Banco de dados atual

O schema `public` possui quatro tabelas principais.

### vizzion_state

Armazena o estado compartilhado do painel.

Registro principal identificado:

- `id`: main
- `state`: JSONB
- `updated_at`: timestamp

Propriedades encontradas dentro de `state`:

- `tasks`
- `general`
- `lastGen`
- `postsLog`
- `projects`
- `updatedAt`

A API também utiliza um registro separado com `id = catalog_file` para guardar os metadados do arquivo original do catálogo.

Não presumir que todas as informações do painel estejam em tabelas individuais.

### vizzion_products

Armazena produtos normalizados.

Colunas:

- `id`: identificador do produto.
- `title`: nome.
- `category`: categoria.
- `product_data`: JSONB com os dados completos.
- `updated_at`: última atualização.

A API implementa leitura paginada de 1.000 registros e importação em lotes de 500.

A importação atual apaga os registros existentes antes de inserir os novos. Essa operação deve ser revisada antes de qualquer alteração.

### vizzion_profiles

Armazena perfis vinculados aos usuários do Supabase Auth.

Colunas:

- `user_id`
- `display_name`
- `role`
- `created_at`

Os papéis permitidos atualmente são `admin` e `member`.

A API atual retorna o papel `member` nos perfis preparados por `getProfile`. Não alterar o modelo de permissões sem revisar o fluxo completo.

### vizzion_activity_log

Armazena o histórico de atividades.

Colunas:

- `id`
- `user_id`
- `actor_name`
- `action`
- `entity_type`
- `entity_id`
- `details`
- `created_at`

Já existem registros históricos. Nunca apagar ou recriar essa tabela em uma migração comum.

## 5. Segurança atual

As quatro tabelas possuem Row Level Security (RLS) ativado.

Na inspeção realizada, nenhuma política RLS foi encontrada no schema `public`.

O backend utiliza duas instâncias do Supabase:

- `publicAuth`: utiliza a chave anon para autenticação.
- `admin`: utiliza a chave service role para operações administrativas.

A service role ignora as políticas RLS. Portanto, as rotas da Edge Function precisam validar autenticação, autorização e dados recebidos.

Não expor a service role no frontend, na extensão ou no repositório.

Revisar especialmente as rotas administrativas, incluindo criação e exclusão de integrantes.

## 6. Edge Function vizzion-api

A função está em:

`supabase/functions/vizzion-api/index.ts`

Rotas identificadas:

### Autenticação
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /auth/me`

### Equipe
- `GET /team`
- `POST /team`
- `POST /team/delete`

### Estado compartilhado
- `GET /state`
- `PUT /state`

### Catálogo
- `GET /products`
- `PUT /products`
- `POST /search`
- `POST /catalog-file`
- `GET /catalog-file`

### Auditoria
- `GET /activity`
- `POST /activity`

O atendimento automático ainda precisa ser estudado para definir sua integração futura com a API.

## 7. Arquivos e armazenamento

O arquivo original do catálogo é armazenado no Supabase Storage:

- Bucket: `vizzion-catalog-files`
- Caminho: `original/{user_id}/...`

Os metadados são registrados na tabela `vizzion_state`, com o identificador `catalog_file`.

Não confundir esse registro com o estado principal `main`.

## 8. Regras obrigatórias para o Copilot

Antes de modificar qualquer funcionalidade:

1. Inspecionar o código atual e identificar dependências.
2. Não presumir que a arquitetura desejada já esteja implementada.
3. Não recriar tabelas existentes.
4. Não apagar dados para facilitar uma migração.
5. Não substituir a estrutura JSON atual sem justificativa e plano de migração.
6. Preferir alterações incrementais e compatíveis.
7. Preservar rotas e contratos utilizados pela extensão.
8. Não alterar seletores, fluxos ou automações de redes sociais sem solicitação expressa.
9. Não alterar o fluxo de autenticação sem analisar frontend e backend.
10. Não inserir senhas, tokens ou chaves nos arquivos versionados.
11. Não executar comandos destrutivos no banco de produção.
12. Criar uma migração SQL separada para cada alteração de schema.
13. Explicar o objetivo e os impactos de cada migração.
14. Verificar se a migração preserva todos os dados existentes.
15. Não aplicar migrações sem revisão e autorização do responsável.

## 9. Processo de migração do banco

O repositório utiliza:

`supabase/migrations/`

A estrutura atual foi obtida do banco remoto por meio de `supabase db pull`.

O arquivo de referência gerado foi:

`20261030183058_remote_schema.sql`

Esse arquivo representa a estrutura já existente e está registrado como aplicado no histórico remoto.

Existe também o registro histórico:

`20261029181503_remote_schema.sql`

Não reaplicar nem recriar o baseline.

Para novas alterações:

1. Analisar o schema e o código dependente.
2. Criar uma nova migração SQL com timestamp único.
3. Preferir `ALTER TABLE`, criação de objetos novos e alterações incrementais.
4. Evitar `DROP`, `TRUNCATE` e recriação de tabelas.
5. Revisar constraints, índices, permissões e políticas RLS.
6. Testar a migração em ambiente seguro.
7. Revisar o SQL antes do commit.
8. Versionar a migração no GitHub.
9. Aplicar em produção somente após autorização.

## 10. Deploy

A integração GitHub-Supabase está configurada para acompanhar a branch `main` e aplicar migrações SQL.

A implantação de Edge Functions é um processo separado e não deve ser considerada automática pela integração de migrações.

Qualquer alteração em `vizzion-api` exige um procedimento próprio de deploy da função.

## 11. Estado conhecido do banco

Na última inspeção:

| Tabela | Quantidade de registros |
|---|---:|
| vizzion_state | 1 |
| vizzion_products | 0 |
| vizzion_profiles | 2 |
| vizzion_activity_log | 217 |

Essas quantidades são apenas uma fotografia do momento da inspeção e podem mudar.

## 12. Orientação final

A Vizzion já está em funcionamento e possui usuários, dados, histórico e integrações.

O objetivo do desenvolvimento é evoluir o sistema existente, não reconstruí-lo.

Quando houver dúvida sobre uma alteração, o Copilot deve primeiro explicar o risco e solicitar confirmação, em vez de executar uma mudança potencialmente destrutiva.