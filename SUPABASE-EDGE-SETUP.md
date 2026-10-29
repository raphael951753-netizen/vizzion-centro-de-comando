# Configuração do backend Vizzion com Supabase Edge Functions

Este pacote inclui a função `supabase/functions/vizzion-api/index.ts`, adaptada para substituir o backend Express/Render. A URL base a colocar no painel/extensão será:

`https://SEU_PROJECT_REF.supabase.co/functions/v1/vizzion-api`

Não cole o arquivo TypeScript no SQL Editor. Ele é código de Edge Function, não SQL.

## Caminho recomendado: publicar pelo Supabase CLI

1. Instale o Supabase CLI conforme a documentação oficial.
2. Abra um terminal na pasta `centro-de-comando` (a pasta que contém `supabase/`).
3. Faça login e vincule o projeto:

   ```bash
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   ```

4. Configure os secrets da função. O project URL e a service-role key normalmente são disponibilizados no ambiente Edge Functions; defina a anon key explicitamente se ela não estiver disponível:

   ```bash
   supabase secrets set SUPABASE_ANON_KEY=SUA_CHAVE_ANON
   ```

   Não coloque a service-role key em arquivos do projeto, na extensão ou no GitHub. Se precisar configurá-la manualmente, use `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` no terminal local, nunca em um arquivo versionado.

5. Publique a função:

   ```bash
   supabase functions deploy vizzion-api --no-verify-jwt
   ```

   O `--no-verify-jwt` é necessário porque `/auth/login` precisa aceitar a primeira requisição sem token. As rotas privadas validam o Bearer token dentro da função.

6. No Centro de Comando Vizzion, use a URL base acima, substituindo `SEU_PROJECT_REF` pelo identificador do projeto. A URL não termina em `/auth/login`.

## Se publicar pelo editor do Dashboard (sem CLI)

Na tela de publicação/configuração da função `vizzion-api`, desative **Verify JWT** / **Verify JWT with legacy secret** para esta função e publique novamente. O endpoint `/auth/login` precisa aceitar a primeira chamada sem token; a própria função valida o token nas rotas privadas. Se essa opção não estiver disponível no editor, será necessário publicar pelo Supabase CLI com `--no-verify-jwt`, conforme o passo acima.

## Importante

- As tabelas esperadas são `vizzion_state`, `vizzion_products`, `vizzion_profiles` e `vizzion_activity_log`.
- Não execute novamente o SQL inicial nem a migração de histórico se essas tabelas já existem.
- O código não foi testado ao vivo contra seu projeto. Depois de publicar, teste primeiro o login e só depois a sincronização.
- A criação de novos membros está liberada a qualquer usuário autenticado, conforme o modelo simples da equipe que foi combinado.
- O estado compartilhado atual é um documento JSON. Para garantir distribuição de tarefas estritamente atômica entre usuários simultâneos, ainda será necessária uma evolução separada do modelo de tarefas; não considere isso garantido apenas pela sincronização atual.
