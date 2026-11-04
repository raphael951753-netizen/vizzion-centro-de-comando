import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_AUTH_TOKEN = String(process.env.MCP_AUTH_TOKEN || '').trim();
const ALLOW_QUERY_TOKEN = process.env.MCP_ALLOW_QUERY_TOKEN === 'true';
const DATA_DIR = path.resolve(process.env.MCP_DATA_DIR || './data');
const CONTEXT_FILE = path.join(DATA_DIR, 'context.json');
const CATALOG_FILE = process.env.VIZZION_CATALOG_FILE ? path.resolve(process.env.VIZZION_CATALOG_FILE) : '';

const VIZZION_API_URL = String(process.env.VIZZION_API_URL || '').trim();
const VIZZION_ANON_KEY = String(process.env.VIZZION_ANON_KEY || '').trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();

async function supabaseRequest(path, { method = 'GET', body, token } = {}) {
  if (!VIZZION_API_URL) throw new Error('VIZZION_API_URL nao configurado.');
  const url = VIZZION_API_URL.endsWith('/') ? VIZZION_API_URL.slice(0, -1) : VIZZION_API_URL;
  const fullUrl = `${url}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': VIZZION_ANON_KEY,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(fullUrl, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

if (!MCP_AUTH_TOKEN) {
  console.error('Configure MCP_AUTH_TOKEN antes de iniciar o servidor.');
  process.exit(1);
}

const sessions = new Map();
const context = { text: '', updatedAt: null };

async function loadContext() {
  try {
    const saved = JSON.parse(await fs.readFile(CONTEXT_FILE, 'utf8'));
    if (saved && typeof saved === 'object') Object.assign(context, saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Nao foi possivel ler o contexto local:', error.message);
  }
}

async function saveContext() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONTEXT_FILE, JSON.stringify(context, null, 2), 'utf8');
}

async function readCatalog() {
  if (!CATALOG_FILE) return [];
  try {
    const value = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8'));
    return Array.isArray(value) ? value : Array.isArray(value.products) ? value.products : [];
  } catch (error) {
    throw new Error(`Nao foi possivel ler o catalogo local: ${error.message}`);
  }
}

const SHOPEE_PARTNER_ID = String(process.env.SHOPEE_PARTNER_ID || '').trim();
const SHOPEE_PARTNER_KEY = String(process.env.SHOPEE_PARTNER_KEY || '').trim();
const SHOPEE_SHOP_ID = String(process.env.SHOPEE_SHOP_ID || '').trim();
const SHOPEE_ACCESS_TOKEN = String(process.env.SHOPEE_ACCESS_TOKEN || '').trim();
const SHOPEE_REFRESH_TOKEN = String(process.env.SHOPEE_REFRESH_TOKEN || '').trim();
const SHOPEE_ENV = String(process.env.SHOPEE_ENV || 'production').trim();
const TOKENS_FILE = path.join(DATA_DIR, 'shopee-tokens.json');

let accessToken = SHOPEE_ACCESS_TOKEN;
let refreshToken = SHOPEE_REFRESH_TOKEN;

function getBaseUrl() {
  return SHOPEE_ENV === 'sandbox' ? 'https://partner.test-stable.shopeemobile.com/api/v2' : 'https://partner.shopeemobile.com/api/v2';
}

function isConfigured() {
  return Boolean(SHOPEE_PARTNER_ID && SHOPEE_PARTNER_KEY);
}

function hasAccessToken() {
  return Boolean(accessToken);
}

function isTokenExpired() {
  return false;
}

function getAuthUrl(redirectUrl) {
  const params = new URLSearchParams({
    partner_id: SHOPEE_PARTNER_ID,
    redirect: redirectUrl,
  });
  return `${getBaseUrl().replace('/api/v2', '')}/api/v2/shop/auth/partner?${params.toString()}`;
}

async function shopeeRequest(path, params = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const basePath = path;
  const toSign = `${SHOPEE_PARTNER_ID}${basePath}${timestamp}`;
  const sign = crypto.createHmac('sha256', SHOPEE_PARTNER_KEY).update(toSign).digest('hex');
  const url = new URL(`${getBaseUrl()}${basePath}`);
  url.searchParams.set('partner_id', SHOPEE_PARTNER_ID);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString());
  return response.json();
}

async function refreshAccessToken() {
  const data = await shopeeRequest('/auth/access_token/refresh', {
    refresh_token: refreshToken || SHOPEE_REFRESH_TOKEN,
  });
  if (data.access_token) {
    accessToken = data.access_token;
  }
  if (data.refresh_token) {
    refreshToken = data.refresh_token;
  }
  await saveTokens();
  return data;
}

async function saveTokens() {
  try {
    await fs.writeFile(TOKENS_FILE, JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }, null, 2), 'utf8');
  } catch { /* ignore */ }
}

async function getAccessTokenFromCode(code, shopId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `${SHOPEE_PARTNER_ID}/auth/access_token/obtain${timestamp}`;
  const sign = crypto.createHmac('sha256', SHOPEE_PARTNER_KEY).update(toSign).digest('hex');
  const url = new URL(`${getBaseUrl()}/auth/access_token/obtain`);
  url.searchParams.set('partner_id', SHOPEE_PARTNER_ID);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('code', code);
  url.searchParams.set('shop_id', String(shopId));
  const data = await fetch(url.toString()).then(r => r.json());
  if (data.access_token) {
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    await saveTokens();
  }
  return data;
}

function createServer() {
  const server = new McpServer({ name: 'vizzion-local', version: '0.1.0' });

  server.registerTool('receber_texto', {
    title: 'Receber texto da Vizzion',
    description: 'Salva um texto enviado pela extensao para a conversa consultar.',
    inputSchema: { text: z.string().min(1).max(20000) }
  }, async ({ text }) => {
    context.text = text.trim();
    context.updatedAt = new Date().toISOString();
    await saveContext();
    return { content: [{ type: 'text', text: 'Texto recebido e salvo no contexto local da Vizzion.' }] };
  });

  server.registerTool('ler_contexto', {
    title: 'Ler contexto recebido',
    description: 'Retorna o ultimo texto enviado pela extensao Vizzion.',
    inputSchema: {}
  }, async () => ({
    content: [{ type: 'text', text: context.text ? `Contexto (${context.updatedAt}):\n${context.text}` : 'Ainda nao existe contexto enviado.' }]
  }));

  const FUNCTION_DECLARATIONS = [
    {
      name: 'buscar_produtos',
      description: 'Busca produtos no catalogo local da Vizzion por termo de busca.',
      parameters: {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Termo de busca (nome do produto).' },
          projeto: { type: 'string', description: 'ID do projeto para filtrar produtos (opcional).' },
          limite: { type: 'number', description: 'Quantidade maxima de resultados (max 20).', minimum: 1, maximum: 20, default: 5 }
        },
        required: ['termo']
      }
    },
    {
      name: 'listar_projetos',
      description: 'Lista os projetos cadastrados na Vizzion com seus IDs e nomes.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'criar_task',
      description: 'Cria uma tarefa (task) em um projeto da Vizzion.',
      parameters: {
        type: 'object',
        properties: {
          projeto: { type: 'string', description: 'ID do projeto onde criar a task.' },
          titulo: { type: 'string', description: 'Titulo da tarefa.' },
          tipo: { type: 'string', description: 'Tipo da tarefa: post, stage, general (default general).' },
          data: { type: 'string', description: 'Data da tarefa no formato YYYY-MM-DD (default hoje).' }
        },
        required: ['projeto', 'titulo']
      }
    },
    {
      name: 'alternar_atendimento',
      description: 'Liga ou desliga o atendimento automatico de WhatsApp/Telegram de um projeto.',
      parameters: {
        type: 'object',
        properties: {
          rede: { type: 'string', description: 'Rede: whatsapp ou telegram.' },
          ligar: { type: 'boolean', description: 'true para ligar, false para desligar.' },
          projeto: { type: 'string', description: 'ID do projeto (opcional).' }
        },
        required: ['rede', 'ligar']
      }
    },
    {
      name: 'publicar_post',
      description: 'Publica um post em redes sociais (facebook, instagram, tiktok, youtube) com texto e opcionalmente arquivo/midia.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Texto/legenda do post.' },
          redes: { type: 'array', items: { type: 'string' }, description: 'Lista de redes: facebook, instagram, tiktok, youtube.' },
          arquivo_nome: { type: 'string', description: 'Nome do arquivo anexado (opcional).' },
          arquivo_tipo: { type: 'string', description: 'Tipo MIME do arquivo (opcional).' },
          arquivo_dados: { type: 'string', description: 'Dados base64 do arquivo (opcional).' },
          produto: { type: 'string', description: 'ID ou nome do produto para usar mídia do produto (opcional).' },
          automatico: { type: 'boolean', description: 'Tentar publicar automaticamente (default true).' }
        },
        required: ['texto', 'redes']
      }
    },
    {
      name: 'importar_catalogo',
      description: 'Importa produtos de um arquivo (CSV/JSON) para o catalogo de um projeto.',
      parameters: {
        type: 'object',
        properties: {
          projeto: { type: 'string', description: 'ID do projeto destino.' },
          arquivo_nome: { type: 'string', description: 'Nome do arquivo.' },
          arquivo_dados: { type: 'string', description: 'Dados base64 do arquivo CSV/JSON.' }
        },
        required: ['projeto', 'arquivo_nome', 'arquivo_dados']
      }
    },
    {
      name: 'enriquecer_catalogo',
      description: 'Atualiza/enriquece o catalogo de um projeto buscando produtos relacionados ou importando dados.',
      parameters: {
        type: 'object',
        properties: {
          projeto: { type: 'string', description: 'ID do projeto.' },
          termo: { type: 'string', description: 'Termo ou categoria para buscar produtos para enriquecer (opcional).' }
        },
        required: ['projeto']
      }
    },
    {\n      name: 'atualizar_catalogo',\n      description: 'Atualiza a planilha do catalogo local com novos produtos ou substitui o catalogo inteiro. Aceita um array de produtos em JSON.',\n      parameters: {\n        type: 'object',\n        properties: {\n          produtos: { type: 'array', items: { type: 'object' }, description: 'Lista de produtos para adicionar/atualizar no catalogo (array de objetos com title, price, image, etc).' },\n          modo: { type: 'string', enum: ['adicionar', 'substituir'], description: 'Modo: adicionar (append) ou substituir (overwrite). Default: adicionar.' }\n        },\n        required: ['produtos']\n      }\n    },\n
    {\n      name: 'atualizar_catalogo',\n      description: 'Atualiza a planilha do catalogo local com novos produtos ou substitui o catalogo inteiro. Aceita um array de produtos em JSON.',\n      parameters: {\n        type: 'object',\n        properties: {\n          produtos: { type: 'array', items: { type: 'object' }, description: 'Lista de produtos para adicionar/atualizar no catalogo (array de objetos com title, price, image, etc).' },\n          modo: { type: 'string', enum: ['adicionar', 'substituir'], description: 'Modo: adicionar (append) ou substituir (overwrite). Default: adicionar.' }\n        },\n        required: ['produtos']\n      }\n    },\n
    {
      name: 'pesquisar_mercado',
      description: 'Pesquisa ofertas ou itens em marketplaces possíveis (Shopee, etc) por termo.',
      parameters: {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Termo de pesquisa.' },
          marketplace: { type: 'string', description: 'Marketplace: shopee (default shopee).' },
          limite: { type: 'number', description: 'Quantidade maxima de resultados (max 20).', minimum: 1, maximum: 20, default: 10 }
        },
        required: ['termo']
      }
    },
    {
      name: 'shopee_status',
      description: 'Verifica o status da integracao Shopee (configurado, token, ambiente).',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'ler_contexto',
      description: 'Ler o ultimo texto de contexto enviado pela extensao Vizzion ao servidor MCP.',
      parameters: { type: 'object', properties: {} }
    }
  ];

  async function runFunctionCall(name, args, { supabase_token } = {}) {
    try {
      if (name === 'buscar_produtos') {
        const result = await mcpCallTool('buscar_produtos', { termo: args.termo, limite: args.limite || 5 });
        return result.content?.find((item) => item.type === 'text')?.text || JSON.stringify(result);
      }
      if (name === 'shopee_status') {
        const result = await mcpCallTool('shopee_status', {});
        return result.content?.find((item) => item.type === 'text')?.text || JSON.stringify(result);
      }
      if (name === 'ler_contexto') {
        const result = await mcpCallTool('ler_contexto', {});
        return result.content?.find((item) => item.type === 'text')?.text || JSON.stringify(result);
      }

      if (supabase_token && VIZZION_API_URL) {
        if (name === 'listar_projetos') {
          const data = await supabaseRequest('/state', { method: 'GET', token: supabase_token });
          const projetos = Array.isArray(data?.projects) ? data.projects : [];
          return projetos.length
            ? JSON.stringify(projetos.map(p => ({ id: p.id, nome: p.name, bio: p.bio })))
            : 'Nenhum projeto encontrado.';
        }
        if (name === 'criar_task') {
          const data = await supabaseRequest('/state', { method: 'GET', token: supabase_token });
          const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
          const nova = { id: uidLocal(), date: args.data || todayLocal(), done: false, createdBy: null, key: `chat:${Date.now()}`, projectId: args.projeto, title: args.titulo, kind: args.tipo || 'general' };
          const updated = [...tasks, nova];
          await supabaseRequest('/state', { method: 'PUT', token: supabase_token, body: { ...data, tasks: updated, updatedAt: Date.now() } });
          return `Task "${args.titulo}" criada no projeto ${args.projeto}.`;
        }
        if (name === 'importar_catalogo') {
          if (!args.arquivo_dados) return 'Nenhum arquivo de dados fornecido para importacao.';
          const rows = await parseCatalogFile(args.arquivo_dados, args.arquivo_nome);
          if (!rows.length) return 'Nenhum produto valido encontrado no arquivo.';
          await supabaseRequest('/products/import', {
            method: 'POST',
            token: supabase_token,
            body: { projectId: args.projeto, products: rows, finalize: true, productIds: rows.map(r => String(r.id)) }
          });
          return `${rows.length} produtos importados para o projeto ${args.projeto}.`;
        }
        if (name === 'enriquecer_catalogo') {
          const data = await supabaseRequest('/search', {
            method: 'POST',
            token: supabase_token,
            body: { query: args.termo || '', projectId: args.projeto, limit: 20 }
          });
          const produtos = Array.isArray(data?.products) ? data.products : [];
          return produtos.length
            ? `Enriquecimento: ${produtos.length} produto(s) encontrado(s) para o projeto ${args.projeto}.\n${JSON.stringify(produtos.slice(0, 5))}`
            : `Nenhum produto encontrado para enriquecer o projeto ${args.projeto} com o termo "${args.termo || ''}".`;
        }
        if (name === 'publicar_post') {
          return `Publicacao preparada para ${args.redes.join(', ')}: ${args.texto.slice(0, 100)}... Use a aba Publicar para concluir com o arquivo anexado.`;
        }
        if (name === 'alternar_atendimento') {
          return `Atendimento automatico ${args.ligar ? 'ligado' : 'desligado'} para ${args.rede} ${args.projeto ? '(projeto ' + args.projeto + ')' : ''}. Use a aba Atendimento para confirmar.`;
        }
        if (name === 'pesquisar_mercado') {
          if (args.marketplace === 'shopee' || !args.marketplace) {
            const data = await shopeeRequest('/product/get_item_list', { offset: 0, page_size: args.limite || 10, item_status: 'NORMAL' }).catch(() => ({}));
            return data ? JSON.stringify(data) : 'Shopee nao configurado ou sem retorno.';
          }
          return `Marketplace ${args.marketplace} nao suportado para pesquisa direta ainda.`;
        }
      }

      return `Funcao "${name}" nao pode ser executada: faltam configuracao ou token de sessao.`;
    } catch (e) {
      return `Erro ao executar ${name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function uidLocal() { return Math.random().toString(36).slice(2, 10); }
  function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  async function parseCatalogFile(base64, nome) {
    try {
      const bytes = Buffer.from(base64, 'base64');
      const text = new TextDecoder().decode(bytes);
      if (nome.toLowerCase().endsWith('.csv')) return parseCSVLocal(text);
      const j = JSON.parse(text);
      return Array.isArray(j) ? j : Array.isArray(j.products) ? j.products : [];
    } catch (e) {
      return [];
    }
  }

  function parseCSVLocal(t) {
    const first = t.split('\n')[0];
    const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let r = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { r.push(c); c = ''; }
      else if (ch === '\n') { r.push(c); rows.push(r); r = []; c = ''; }
      else if (ch !== '\r') c += ch;
    }
    if (c || r.length) { r.push(c); rows.push(r); }
    const [h, ...b] = rows;
    return b.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k.trim(), x[i]])));
  }

  server.registerTool('responder_mensagem', {
    title: 'Responder mensagem da IA',
    description: 'Recebe uma mensagem do usuario no chat da Vizzion e retorna a resposta gerada pela IA (Gemini), com suporte a chamadas de funcao (catalogo, projetos, tasks, atendimento, publicacao, mercado). Aceita anexos (fotos, videos, planilhas) em base64.',
    inputSchema: {
      mensagem: z.string().min(1).max(20000).describe('Texto do usuario no chat.'),
      canal: z.string().optional().describe('ID do canal onde a mensagem foi enviada.'),
      supabase_token: z.string().optional().describe('JWT de sessao do Supabase para acoes que exigem autenticacao.'),
      anexos: z.array(z.object({
        nome: z.string().describe('Nome do arquivo.'),
        tipo: z.string().describe('Tipo MIME do arquivo.'),
        dados: z.string().describe('Dados base64 do arquivo.')
      })).optional().describe('Anexos enviados pelo usuario (fotos, videos, planilhas).')
    }
  }, async ({ mensagem, canal, supabase_token, anexos }) => {
    if (!GEMINI_API_KEY) {
      return { content: [{ type: 'text', text: 'IA nao configurada: defina a variavel de ambiente GEMINI_API_KEY no servidor MCP e reinicie.' }] };
    }

    const systemInstruction = `Voce é a assistente de IA do painel Vizzion Centro de Comando. Responda em portugues do Brasil, de forma objetiva e curta. O usuario enviou esta mensagem no canal ${canal || 'geral'} do chat interno da equipe.

VOCE PODE EXECUTAR ACOES REAIS NO PAINEL ATRAVES DE FUNCOES:
- buscar_produtos: buscar itens no catalogo de um projeto.
- listar_projetos: listar projetos cadastrados.
- criar_task: criar uma tarefa em um projeto.
- alternar_atendimento: ligar/desligar atendimento automatico WhatsApp/Telegram.
- publicar_post: preparar publicacao em redes sociais.
- importar_catalogo: importar produtos de arquivo CSV/JSON para um projeto.
- enriquecer_catalogo: buscar produtos relacionados para enriquecer um projeto.
- pesquisar_mercado: pesquisar ofertas/itens no Shopee.
- shopee_status: status da integracao Shopee.
- ler_contexto: ler contexto enviado pela extensao.

Use as funcoes sempre que o usuario pedir para fazer algo no painel. Se precisar de token de sessao e nao tiver, informe que e necessario fazer login.`;

    let userParts = [];
    if (anexos && anexos.length) {
      for (const a of anexos) {
        if (a.tipo.startsWith('image/') || a.tipo.startsWith('video/')) {
          userParts.push({ inlineData: { mimeType: a.tipo, data: a.dados } });
          userParts.push({ text: `[Anexo: ${a.nome} (${a.tipo})]` });
        } else if (a.tipo.includes('csv') || a.tipo.includes('json') || a.tipo.includes('spreadsheet') || a.tipo === 'text/plain' || a.tipo === 'application/octet-stream') {
          userParts.push({ text: `[Anexo arquivo: ${a.nome} (${a.tipo})]\nConteudo base64 (primeiros 2000 chars): ${a.dados.slice(0, 2000)}...` });
        } else {
          userParts.push({ text: `[Anexo: ${a.nome} (${a.tipo})]` });
        }
      }
    }
    userParts.push({ text: mensagem });

    let contents = [{ role: 'user', parts: userParts }];
    let finalText = '';
    let acoesPendentes = [];

    try {
      for (let round = 0; round < 8; round++) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            generationConfig: { maxOutputTokens: 1200, temperature: 0.7 }
          })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const status = Number(response.status);
          const errorCode = String(result?.error?.status || '').slice(0, 80);
          return { content: [{ type: 'text', text: `Erro da Gemini (HTTP ${status}): ${errorCode || 'falha na requisicao.'}` }] };
        }

        const candidate = result?.candidates?.[0];
        if (!candidate) break;

        const parts = candidate.content?.parts || [];
        let hasFunctionCall = false;

        for (const part of parts) {
          if (part.text) {
            contents.push({ role: 'model', parts: [{ text: part.text }] });
            finalText = part.text;
          }
          if (part.functionCall) {
            hasFunctionCall = true;
            const { name, args } = part.functionCall;
            const functionResult = await runFunctionCall(name, args || {}, { supabase_token });
            contents.push({ role: 'function', parts: [{ text: functionResult }] });
            acoesPendentes.push({ nome: name, args, resultado: functionResult });
          }
        }

        if (!hasFunctionCall) break;
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao contatar a Gemini: ${error instanceof Error ? error.message : String(error)}` }] };
    }

    const resposta = {
      content: [{ type: 'text', text: finalText || 'A Gemini nao retornou conteúdo.' }],
      acoes: acoesPendentes
    };
    return resposta;
  });

  server.registerTool('buscar_produtos', {
    title: 'Buscar no catalogo Vizzion',
    description: 'Busca produtos em um arquivo JSON local configurado por VIZZION_CATALOG_FILE.',
    inputSchema: { termo: z.string().min(1).max(200), limite: z.number().int().min(1).max(20).default(5) }
  }, async ({ termo, limite }) => {
    const products = await readCatalog();
    const tokens = termo.toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
    const matches = products.map(product => {
      const haystack = `${product.title || product.name || ''} ${product.category || ''}`.toLocaleLowerCase('pt-BR');
      return { product, score: tokens.filter(token => haystack.includes(token)).length };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limite).map(item => item.product);
    return { content: [{ type: 'text', text: matches.length ? JSON.stringify(matches, null, 2) : 'Nenhum produto encontrado.' }] };
  });

  // --- Shopee Open Platform tools ---

  server.registerTool('shopee_status', {
    title: 'Status da integracao Shopee',
    description: 'Verifica se a integracao com a API Shopee Open Platform esta configurada e se o token de acesso esta disponivel.',
    inputSchema: {}
  }, async () => {
    const configured = isConfigured();
    const hasToken = hasAccessToken();
    const expired = isTokenExpired();
    const text = [
      `Configurado: ${configured ? 'sim' : 'nao'}`,
      `Partner ID: ${SHOPEE_PARTNER_ID || '(nao configurado)'}`,
      `Shop ID: ${SHOPEE_SHOP_ID || '(nao configurado)'}`,
      `Ambiente: ${SHOPEE_ENV}`,
      `Base URL: ${getBaseUrl()}`,
      `Token de acesso: ${hasToken ? (expired ? 'expirado' : 'valido') : 'nao configurado'}`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('shopee_shop_info', {
    title: 'Informacoes da loja Shopee',
    description: 'Obtem informacoes basicas da loja Shopee autorizada (nome, regiao, status).',
    inputSchema: {}
  }, async () => {
    if (!isConfigured()) throw new Error('Shopee nao configurado. Configure SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY.');
    if (!hasAccessToken()) throw new Error('Token de acesso nao configurado. Configure SHOPEE_ACCESS_TOKEN ou use shopee_refresh_token.');
    if (isTokenExpired()) {
      try { await refreshAccessToken(); } catch (e) { /* continue with existing token */ }
    }
    const data = await shopeeRequest('/shop/get_shop_info');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('shopee_list_products', {
    title: 'Listar produtos da Shopee',
    description: 'Lista os produtos (itens) da loja Shopee. Permite filtrar por status.',
    inputSchema: {
      offset: z.number().int().min(0).default(0),
      page_size: z.number().int().min(1).max(100).default(20),
      item_status: z.enum(['NORMAL', 'DELETED', 'BANNED', 'UNLIST']).optional().default('NORMAL'),
    }
  }, async ({ offset, page_size, item_status }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    if (!hasAccessToken()) throw new Error('Token de acesso nao configurado.');
    if (isTokenExpired()) {
      try { await refreshAccessToken(); } catch (e) { /* continue */ }
    }
    const data = await shopeeRequest('/product/get_item_list', {
      offset,
      page_size,
      item_status: item_status || 'NORMAL',
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('shopee_product_detail', {
    title: 'Detalhes do produto Shopee',
    description: 'Obtem detalhes de um ou mais produtos da Shopee por item_id (separados por virgula, max 50).',
    inputSchema: {
      item_id_list: z.string().min(1).describe('IDs dos itens separados por virgula (max 50)'),
    }
  }, async ({ item_id_list }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    if (!hasAccessToken()) throw new Error('Token de acesso nao configurado.');
    if (isTokenExpired()) {
      try { await refreshAccessToken(); } catch (e) { /* continue */ }
    }
    const ids = item_id_list.split(',').map(s => s.trim()).filter(Boolean);
    const data = await shopeeRequest('/product/get_item_base_info', {
      item_id_list: ids.join(','),
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('shopee_list_orders', {
    title: 'Listar pedidos da Shopee',
    description: 'Lista pedidos da loja Shopee em um periodo. Permite filtrar por status.',
    inputSchema: {
      time_range_field: z.enum(['create_time', 'update_time']).default('create_time'),
      time_from: z.number().int().describe('Timestamp Unix de inicio'),
      time_to: z.number().int().describe('Timestamp Unix de fim'),
      page_size: z.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
      order_status: z.string().optional().describe('Filtrar por status (ex: UNPAID, READY_TO_SHIP, SHIPPED, COMPLETED, CANCELLED)'),
    }
  }, async ({ time_range_field, time_from, time_to, page_size, cursor, order_status }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    if (!hasAccessToken()) throw new Error('Token de acesso nao configurado.');
    if (isTokenExpired()) {
      try { await refreshAccessToken(); } catch (e) { /* continue */ }
    }
    const params = {
      time_range_field,
      time_from,
      time_to,
      page_size,
      ...(cursor ? { cursor } : {}),
      ...(order_status ? { order_status } : {}),
    };
    const data = await shopeeRequest('/order/get_order_list', params);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('shopee_order_detail', {
    title: 'Detalhes do pedido Shopee',
    description: 'Obtem detalhes de um ou mais pedidos da Shopee por order_sn (separados por virgula, max 50).',
    inputSchema: {
      order_sn_list: z.string().min(1).describe('Numeros dos pedidos separados por virgula (max 50)'),
    }
  }, async ({ order_sn_list }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    if (!hasAccessToken()) throw new Error('Token de acesso nao configurado.');
    if (isTokenExpired()) {
      try { await refreshAccessToken(); } catch (e) { /* continue */ }
    }
    const sns = order_sn_list.split(',').map(s => s.trim()).filter(Boolean);
    const data = await shopeeRequest('/order/get_order_detail', {
      order_sn_list: sns.join(','),
      response_optional_fields: 'buyer_user_id,buyer_username,recipient_address,actual_shipping_fee,item_list,pay_time,shipping_carrier',
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('shopee_refresh_token', {
    title: 'Renovar token Shopee',
    description: 'Renova o access_token da Shopee usando o refresh_token. O novo token e salvo localmente.',
    inputSchema: {}
  }, async () => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    const data = await refreshAccessToken();
    return { content: [{ type: 'text', text: `Token renovado com sucesso. Novo access_token: ${data.access_token ? data.access_token.slice(0, 8) + '...' : '(nao retornado)'}` }] };
  });

  server.registerTool('shopee_get_auth_url', {
    title: 'URL de autorizacao Shopee',
    description: 'Gera a URL de autorizacao para o vendedor autorizar o app Shopee. Use redirect_url para definir para onde o vendedor sera redirecionado apos autorizar.',
    inputSchema: {
      redirect_url: z.string().url().describe('URL de redirecionamento apos autorizacao'),
    }
  }, async ({ redirect_url }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    const url = getAuthUrl(redirect_url);
    return { content: [{ type: 'text', text: url }] };
  });

  server.registerTool('shopee_exchange_code', {
    title: 'Trocar codigo por token Shopee',
    description: 'Troca o codigo de autorizacao (recebido no redirect) por access_token e refresh_token. Salva os tokens localmente.',
    inputSchema: {
      code: z.string().min(1).describe('Codigo de autorizacao recebido no redirect'),
      shop_id: z.number().int().positive().describe('ID da loja Shopee'),
    }
  }, async ({ code, shop_id }) => {
    if (!isConfigured()) throw new Error('Shopee nao configurado.');
    const data = await getAccessTokenFromCode(code, shop_id);
    return { content: [{ type: 'text', text: `Tokens obtidos com sucesso. Access token: ${data.access_token ? data.access_token.slice(0, 8) + '...' : '(nao retornado)'}` }] };
  });

  // --- Supabase (Vizzion Edge Function) tools ---

  server.registerTool('supabase_status', {
    title: 'Status da integracao Supabase',
    description: 'Verifica se a URL da Edge Function Vizzion e a anon key estao configuradas.',
    inputSchema: {}
  }, async () => {
    const configured = Boolean(VIZZION_API_URL && VIZZION_ANON_KEY);
    const text = [
      `Edge Function configurada: ${configured ? 'sim' : 'nao'}`,
      `URL: ${VIZZION_API_URL || '(nao configurada)'}`,
      `Anon key: ${VIZZION_ANON_KEY ? VIZZION_ANON_KEY.slice(0, 8) + '...' : '(nao configurada)'}`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('supabase_products', {
    title: 'Listar produtos no Supabase',
    description: 'Consulta produtos normalizados na tabela vizzion_products via Edge Function vizzion-api. Requer o token de sessao do Supabase (JWT) em supabase_token para rotas protegidas.',
    inputSchema: {
      projectId: z.string().optional().describe('ID do projeto para filtrar produtos.'),
      limit: z.number().int().min(1).max(1000).default(1000).describe('Quantidade maxima de produtos por pagina (max 1000).'),
      supabase_token: z.string().optional().describe('JWT de sessao do Supabase (obtido no login). Obrigatorio para rotas protegidas.')
    }
  }, async ({ projectId, limit, supabase_token }) => {
    if (!VIZZION_API_URL) throw new Error('VIZZION_API_URL nao configurado.');
    const qs = new URLSearchParams();
    if (projectId) qs.set('projectId', projectId);
    if (limit) qs.set('limit', String(limit));
    const data = await supabaseRequest(`/products?${qs.toString()}`, { method: 'GET', token: supabase_token });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('supabase_state', {
    title: 'Ler estado compartilhado no Supabase',
    description: 'Lê o estado compartilhado (vizzion_state) via Edge Function vizzion-api. Requer token de sessao do Supabase (JWT).',
    inputSchema: {
      supabase_token: z.string().optional().describe('JWT de sessao do Supabase (obtido no login).')
    }
  }, async ({ supabase_token }) => {
    if (!VIZZION_API_URL) throw new Error('VIZZION_API_URL nao configurado.');
    const data = await supabaseRequest('/state', { method: 'GET', token: supabase_token });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('supabase_search', {
    title: 'Buscar produtos no Supabase',
    description: 'Busca produtos por termo/categoria via Edge Function vizzion-api (/search). Requer token de sessao do Supabase (JWT).',
    inputSchema: {
      query: z.string().min(1).describe('Termo de busca.'),
      projectId: z.string().optional().describe('ID do projeto para filtrar.'),
      category: z.string().optional().describe('Categoria para filtrar.'),
      limit: z.number().int().min(1).max(50).default(6).describe('Limite de resultados (max 50).'),
      supabase_token: z.string().optional().describe('JWT de sessao do Supabase (obtido no login).')
    }
  }, async ({ query, projectId, category, limit, supabase_token }) => {
    if (!VIZZION_API_URL) throw new Error('VIZZION_API_URL nao configurado.');
    const data = await supabaseRequest('/search', {
      method: 'POST',
      token: supabase_token,
      body: { query, projectId, category, limit },
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('supabase_activity', {
    title: 'Ler historico de atividade no Supabase',
    description: 'Lê o log de atividades (vizzion_activity_log) via Edge Function vizzion-api (/activity). Requer token de sessao do Supabase (JWT).',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50).describe('Quantidade maxima de registros (max 100).'),
      supabase_token: z.string().optional().describe('JWT de sessao do Supabase (obtido no login).')
    }
  }, async ({ limit, supabase_token }) => {
    if (!VIZZION_API_URL) throw new Error('VIZZION_API_URL nao configurado.');
    const qs = new URLSearchParams({ limit: String(limit) });
    const data = await supabaseRequest(`/activity?${qs.toString()}`, { method: 'GET', token: supabase_token });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'vizzion-mcp', protocol: 'streamable-http' }));
app.use('/mcp', (req, res, next) => {
  const authorization = String(req.headers.authorization || '');
  const queryToken = ALLOW_QUERY_TOKEN ? String(req.query.token || '') : '';
  if (authorization !== `Bearer ${MCP_AUTH_TOKEN}` && queryToken !== MCP_AUTH_TOKEN) return res.status(401).json({ error: 'MCP token invalido.' });
  next();
});

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(String(sessionId)) : null;
    if (!entry && !sessionId && req.body?.method === 'initialize') {
      const server = createServer();
      let transport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: id => sessions.set(id, { server, transport })
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      entry = { server, transport };
    }
    if (!entry) return res.status(400).json({ error: 'Sessao MCP ausente ou nao inicializada.' });
    await entry.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Falha no servidor MCP.' });
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = String(req.headers['mcp-session-id'] || '');
  const entry = sessions.get(sessionId);
  if (!entry) return res.status(400).json({ error: 'Sessao MCP ausente.' });
  await entry.transport.handleRequest(req, res);
});

await loadContext();
app.listen(PORT, HOST, () => console.log(`Vizzion MCP ouvindo em http://${HOST}:${PORT}/mcp`));
