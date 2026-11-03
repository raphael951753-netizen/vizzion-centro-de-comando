# Revisão de segurança — chaves Gemini por projeto

## Escopo

Revisão somente da implementação de credenciais Gemini em:

- `supabase/functions/vizzion-api/index.ts`
- `supabase/migrations/20261030190000_project_ai_credentials.sql`

## Achados

| # | Severidade | Arquivo | Linhas | Vulnerabilidade | Confiança |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | `supabase/functions/vizzion-api/index.ts` | 61-64, 329-335 | Autorização baseada em `memberIds` pode ser manipulada porque qualquer usuário autenticado pode alterar o estado global por `PUT /state`; um usuário pode se adicionar a qualquer projeto e administrar sua credencial Gemini. | 10/10 |
| 2 | 🟡 MEDIUM | `supabase/functions/vizzion-api/index.ts` | 30-34 | `GEMINI_MASTER_KEY` é validada somente por comprimento mínimo, sem exigir formato ou entropia suficiente; um segredo previsível permite ataque offline contra ciphertext obtido. | 9/10 |
| 3 | ⚪ LOW | `supabase/functions/vizzion-api/index.ts` | 216-220 | A chave Gemini é enviada ao Google no parâmetro de query `key`; URLs podem ser registrados por infraestrutura intermediária. | 8/10 |

## Controles positivos

- AES-256-GCM é usado com chave derivada por SHA-256 e IV aleatório de 12 bytes.
- A autenticação GCM detecta adulteração de ciphertext.
- Ciphertext e IV não são retornados pelas rotas.
- A chave plaintext não é registrada explicitamente em logs nem retornada em respostas.
- A interface da API retorna somente uma máscara com os últimos quatro caracteres.
- A migration habilita RLS e revoga permissões de `anon` e `authenticated`.
- O acesso à credencial exige autenticação e validação de associação no projeto.

## Riscos residuais

- A autorização por projeto depende de um estado JSON mutável pelo cliente.
- A perda ou substituição indevida do segredo mestre pode impedir a descriptografia ou expor as credenciais.
- O modelo atual de projetos não possui uma relação SQL formal entre projeto e usuários.

## Recomendações

1. Impedir que usuários não autorizados alterem `projects[].memberIds` em `/state`.
2. Exigir autorização administrativa para alterações de membros.
3. Exigir um segredo mestre gerado aleatoriamente, com validação explícita de formato e tamanho.
4. Avaliar o uso de cabeçalho, quando suportado pela API Gemini, em vez de query string.
