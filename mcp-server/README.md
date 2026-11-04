# Vizzion MCP inicial

Servidor MCP minimo para testar um conector personalizado. Ele expoe somente:
- `receber_texto`: salva contexto enviado pela Vizzion.
- `ler_contexto`: le o ultimo contexto salvo.
- `buscar_produtos`: consulta um catalogo JSON local, se configurado.

## Instalar
```powershell
cd mcp-server
npm install
```

## Iniciar
```powershell
$env:MCP_AUTH_TOKEN = 'troque-por-um-token-local'
$env:VIZZION_CATALOG_FILE = 'C:\\caminho\\catalogo.json'
npm start
```

O endpoint local fica em `http://127.0.0.1:8787/mcp` e exige `Authorization: Bearer <MCP_AUTH_TOKEN>`. Em outro dispositivo da mesma rede, use o IPv4 do PC, por exemplo `http://192.168.0.104:8787/mcp`.

Este primeiro servidor nao publica, nao apaga dados e nao acessa o Supabase. Para conectar em um servico externo, o conector precisa aceitar HTTP local ou o servidor precisa ser publicado com HTTPS e autenticacao forte.

Servidor MCP para a Vizzion que expoe ferramentas de contexto local e integracao com a API Shopee Open Platform.

## Ferramentas disponiveis

### Contexto local
- `receber_texto`: salva contexto enviado pela Vizzion.
- `ler_contexto`: le o ultimo contexto salvo.
- `buscar_produtos`: consulta um catalogo JSON local, se configurado.

### Shopee Open Platform
- `shopee_status`: verifica se a integracao Shopee esta configurada e se o token esta valido.
- `shopee_shop_info`: obtem informacoes da loja Shopee autorizada.
- `shopee_list_products`: lista produtos da loja Shopee.
- `shopee_product_detail`: obtem detalhes de produtos por item_id.
- `shopee_list_orders`: lista pedidos em um periodo.
- `shopee_order_detail`: obtem detalhes de pedidos por order_sn.
- `shopee_refresh_token`: renova o access_token usando o refresh_token.
- `shopee_get_auth_url`: gera URL de autorizacao para o vendedor.
- `shopee_exchange_code`: troca codigo de autorizacao por tokens.

## Instalar
```powershell
cd mcp-server
npm install
```

## Configurar Shopee Open Platform

1. Registre-se como desenvolvedor em https://open.shopee.com e crie um app.
2. Obtenha `partner_id` e `partner_key` no console.
3. Gere a URL de autorizacao com `shopee_get_auth_url` e envie ao vendedor.
4. Apos autorizacao, use `shopee_exchange_code` para obter tokens.
5. Configure as variaveis de ambiente abaixo.

## Iniciar
```powershell
$env:MCP_AUTH_TOKEN = 'troque-por-um-token-local'
$env:VIZZION_CATALOG_FILE = 'C:\caminho\catalogo.json'

# Shopee Open Platform
$env:SHOPEE_PARTNER_ID = '123456'
$env:SHOPEE_PARTNER_KEY = 'sua-partner-key-secreta'
$env:SHOPEE_SHOP_ID = '123456789'
$env:SHOPEE_ACCESS_TOKEN = 'token-de-acesso'
$env:SHOPEE_REFRESH_TOKEN = 'token-de-refresh'
$env:SHOPEE_ENV = 'production'

npm start
```

O endpoint local fica em `http://127.0.0.1:8787/mcp` e exige `Authorization: Bearer <MCP_AUTH_TOKEN>`. Em outro dispositivo da mesma rede, use o IPv4 do PC, por exemplo `http://192.168.0.104:8787/mcp`.

## Ambiente

- `SHOPEE_ENV=production` usa `https://partner.shopeemobile.com/api/v2`
- `SHOPEE_ENV=sandbox` usa `https://partner.test-stable.shopeemobile.com/api/v2`

## Tokens

- `access_token` dura 4 horas. Use `shopee_refresh_token` para renovar.
- `refresh_token` dura 30 dias.
- Tokens renovados sao salvos em `data/shopee-tokens.json`.

Este servidor nao publica, nao apaga dados e nao acessa o Supabase. Para conectar em um servico externo, o conector precisa aceitar HTTP local ou o servidor precisa ser publicado com HTTPS e autenticacao forte.

Servidor MCP minimo para testar um conector personalizado. Ele expoe somente:

- `receber_texto`: salva contexto enviado pela Vizzion.
- `ler_contexto`: le o ultimo contexto salvo.
- `buscar_produtos`: consulta um catalogo JSON local, se configurado.

## Instalar

```powershell
cd mcp-server
npm install
```

## Iniciar

```powershell
$env:MCP_AUTH_TOKEN = 'troque-por-um-token-local'
$env:VIZZION_CATALOG_FILE = 'C:\caminho\catalogo.json'
npm start
```

O endpoint local fica em `http://127.0.0.1:8787/mcp` e exige `Authorization: Bearer <MCP_AUTH_TOKEN>`. Em outro dispositivo da mesma rede, use o IPv4 do PC, por exemplo `http://192.168.0.104:8787/mcp`.

Este primeiro servidor nao publica, nao apaga dados e nao acessa o Supabase. Para conectar em um servico externo, o conector precisa aceitar HTTP local ou o servidor precisa ser publicado com HTTPS e autenticacao forte.
