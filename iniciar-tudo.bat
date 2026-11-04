@echo off
title Vizzion MCP + Cloudflare Tunnel
echo ========================================
echo  INICIANDO SERVIDOR MCP + TUNEL HTTPS
echo ========================================
echo.

:: Caminho da pasta mcp-server
set "PROJECT_DIR=C:\Users\Raphael Corsini\OneDrive\Área de Trabalho\Banco de dados shopee\centro-de-comando\mcp-server"

:: ========================================================
:: PREREENCH ABAIXO: seus dados do Supabase (copie do painel)
:: ========================================================
set "VIZZION_API_URL=https://SEU_PROJECT_REF.supabase.co/functions/v1/vizzion-api"
set "VIZZION_ANON_KEY=SUA_ANON_KEY_DO_SUPABASE"
set "MCP_AUTH_TOKEN=qualquer-token-secreto-que-voce-criar"
:: ========================================================

echo.
echo [1/3] Entrando na pasta mcp-server...
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
    echo ERRO: Nao foi possivel entrar na pasta mcp-server.
    pause
    exit /b 1
)

echo [2/3] Subindo o servidor MCP na porta 8787...
start "MCP Server" cmd /k "set MCP_AUTH_TOKEN=%MCP_AUTH_TOKEN% & set VIZZION_API_URL=%VIZZION_API_URL% & set VIZZION_ANON_KEY=%VIZZION_ANON_KEY% & npm start"

timeout /t 3 >nul

echo [3/3] Subindo tunel HTTPS (Cloudflare)...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:8787"

echo.
echo ========================================
echo  SERVIDORES SUBINDO...
echo ========================================
echo.
echo Aguarde alguns segundos e anote a URL HTTPS que aparecer
echo na janela do Cloudflare Tunnel (tipo https://xxxx.trycloudflare.com).
echo.
echo Essa URL e o que voce coloca no Migoo como endpoint do MCP.
echo O token e: %MCP_AUTH_TOKEN%
echo.
pause
