# Deploy do Cloudflare Worker fixo para o MCP da Vizzion
# Requisitos: wrangler instalado (npm install -g wrangler) e conta no Cloudflare.

$ErrorActionPreference = "Stop"

Write-Host "=== Deploy do Worker MCP Vizzion ===" -ForegroundColor Cyan

# Verifica se wrangler está disponível
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Warning "wrangler não encontrado. Instale com: npm install -g wrangler"
    Write-Host "Após instalar, rode: wrangler login" -ForegroundColor Yellow
    exit 1
}

# Verifica autenticação
try {
    wrangler whoami | Out-Null
} catch {
    Write-Host "Fazendo login no Cloudflare..." -ForegroundColor Yellow
    wrangler login
}

# Deploy
Write-Host "Fazendo deploy do worker..." -ForegroundColor Yellow
wrangler deploy

Write-Host "Deploy concluído!" -ForegroundColor Green
Write-Host "Agora defina no painel Vizzion (Configuracoes > URL do MCP):" -ForegroundColor Cyan
Write-Host "  https://<seu-worker>.workers.dev/mcp" -ForegroundColor Green
Write-Host "E o Token MCP igual ao MCP_AUTH_TOKEN do servidor backend." -ForegroundColor Cyan
