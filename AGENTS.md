# Instruções permanentes — GitHub Copilot / Vizzion

## 1. Antes de começar qualquer tarefa

- Leia `ARCHITECTURE.md` antes de modificar o projeto.
- Inspecione os arquivos envolvidos na tarefa.
- Entenda como a funcionalidade atual funciona antes de propor mudanças.
- Identifique dependências entre frontend, Edge Function e banco de dados.
- Não presuma que uma funcionalidade existe apenas porque está documentada como desejada.

## 2. Proteção do banco de dados

O banco Supabase de produção já contém dados reais.

É proibido executar ou sugerir sem autorização explícita:

- DROP TABLE.
- DROP COLUMN.
- TRUNCATE.
- DELETE em massa.
- Recriação de tabelas existentes.
- Limpeza de dados para facilitar migrações.
- Alterações que possam apagar ou sobrescrever informações existentes.

Toda alteração estrutural deve possuir uma migração SQL própria em `supabase/migrations/`.

Preferir alterações incrementais e compatíveis.

Nunca modificar o baseline remoto já aplicado para simular uma nova migração.

## 3. Processo obrigatório para migrações

Antes de criar uma migração:

1. Identificar a estrutura atual.
2. Verificar dependências no código.
3. Explicar o que será alterado.
4. Identificar riscos para dados existentes.
5. Criar SQL incremental.
6. Verificar permissões, índices, constraints e RLS.
7. Apresentar o SQL para revisão humana.

Nunca aplicar migrações em produção sem autorização explícita.

Não considerar uma migração segura apenas porque o SQL executou sem erros.

## 4. Segurança e autenticação

- Nunca expor SUPABASE_SERVICE_ROLE_KEY.
- Nunca inserir chaves ou senhas no código versionado.
- Validar autenticação em todas as rotas protegidas.
- Verificar autorização para operações administrativas.
- Validar dados recebidos do frontend.
- Preservar a separação entre anon key e service role.
- Considerar LGPD e proteção de dados dos clientes.

## 5. Preservação do funcionamento

Não modificar sem solicitação expressa:

- Fluxo de login.
- Sincronização do estado compartilhado.
- Publicação em redes sociais.
- Seletores e automações do WhatsApp.
- Seletores e automações do Telegram.
- Fluxos de upload.
- Conversão de links de afiliados.
- Estrutura visual das abas não envolvidas na tarefa.

Não substituir funcionalidades existentes por versões simplificadas sem autorização.

## 6. Organização do código

- Reutilizar funções existentes quando apropriado.
- Evitar duplicação desnecessária.
- Manter compatibilidade com Chrome Manifest V3.
- Preservar os contratos das rotas da API.
- Não introduzir dependências sem necessidade.
- Manter os nomes e formatos de dados compatíveis.
- Documentar alterações importantes.

## 7. Como trabalhar

Para cada solicitação:

1. Explicar brevemente o que será feito.
2. Identificar os arquivos afetados.
3. Fazer a menor alteração necessária.
4. Verificar possíveis efeitos colaterais.
5. Executar testes disponíveis.
6. Informar o que foi alterado.
7. Informar se existe migração SQL.
8. Informar se é necessário atualizar a Edge Function.
9. Aguardar autorização antes de qualquer alteração em produção.

## 8. Forma de comunicação

O usuário prefere instruções simples, objetivas e realizadas em etapas.

Não solicitar várias ações simultaneamente quando uma etapa depende da anterior.

Explicar comandos antes de pedir sua execução.

Não afirmar que algo foi testado se não foi executado.

## 9. Regra principal

A Vizzion é um sistema em produção.

**Evoluir sem reconstruir. Melhorar sem perder dados. Preservar o que já funciona.**