# Cloudflare Worker fixo para expor o MCP da Vizzion.
# Este Worker é um proxy reverso: nao acessa o localhost da sua maquina diretamente.
# Ele encaminha requisicoes MCP para o backend definido em MCP_BACKEND_URL.
#
# Como usar:
#   1. npm install -g wrangler
#   2. wrangler login
#   3. Ajuste wrangler.toml:
#        - MCP_BACKEND_URL = URL do seu MCP server (localhost:8787 se rodar localmente,
#          ou a URL do seu cloudflared tunnel se quiser expor fixo via tunnel)
#   4. wrangler deploy
#   5. No painel Vizzion > Configuracoes > URL do MCP, coloque:
#        https://<seu-worker>.workers.dev/mcp
#   6. Token MCP igual ao MCP_AUTH_TOKEN do servidor backend.
#
# Rotas suportadas: GET/POST /mcp, GET /health, OPTIONS /mcp (CORS).
