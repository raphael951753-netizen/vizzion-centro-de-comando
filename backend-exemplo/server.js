// API da Vizzion: Supabase Auth para identidade e Supabase Postgres para dados compartilhados.
// SUPABASE_SERVICE_ROLE_KEY deve existir SOMENTE como variável secreta no servidor.
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.');
  process.exit(1);
}
const publicAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'vizzion-backend' }));

const safeName = (u) => String(u?.user_metadata?.display_name || u?.user_metadata?.full_name || u?.email || 'Integrante').trim().slice(0, 100);
async function getProfile(user) {
  const display_name = safeName(user).split('@')[0] || 'Integrante';
  const { data, error } = await admin.from('vizzion_profiles').upsert({ user_id: user.id, display_name, role: 'member' }, { onConflict: 'user_id', ignoreDuplicates: true }).select('user_id,display_name,role').maybeSingle();
  if (error) throw error;
  if (data) return { id: user.id, name: data.display_name, email: user.email || '', role: 'member' };
  const { data: existing, error: readError } = await admin.from('vizzion_profiles').select('user_id,display_name,role').eq('user_id', user.id).single();
  if (readError) throw readError;
  return { id: user.id, name: existing.display_name || display_name, email: user.email || '', role: 'member' };
}

// Login and refresh are the only unauthenticated routes besides health.
app.post('/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const { data, error } = await publicAuth.auth.signInWithPassword({ email, password });
  if (error || !data?.session || !data?.user) return res.status(401).json({ error: 'E-mail ou senha incorretos, ou conta ainda não confirmada.' });
  try {
    const profile = await getProfile(data.user);
    return res.json({ session: data.session, profile });
  } catch (e) {
    console.error('profile on login', e.message);
    return res.status(500).json({ error: 'Login realizado, mas não foi possível preparar o perfil. Confira a estrutura SQL do Supabase.' });
  }
});
app.post('/auth/refresh', async (req, res) => {
  const refresh_token = String(req.body?.refresh_token || '');
  if (!refresh_token) return res.status(400).json({ error: 'Token de renovação ausente.' });
  const { data, error } = await publicAuth.auth.refreshSession({ refresh_token });
  if (error || !data?.session || !data?.user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  try { return res.json({ session: data.session, profile: await getProfile(data.user) }); }
  catch (e) { console.error('profile on refresh', e.message); return res.status(500).json({ error: 'Não foi possível carregar o perfil.' }); }
});

// Every data route validates the Supabase access token. The three team members have equal app permissions.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/auth/') && req.path !== '/auth/me') return next();
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ error: 'Entre com sua conta Vizzion.' });
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data?.user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });
  req.authUser = data.user;
  try { req.profile = await getProfile(data.user); }
  catch (e) { console.error('auth profile', e.message); return res.status(500).json({ error: 'Não foi possível carregar o perfil do usuário.' }); }
  next();
});

app.get('/auth/me', (req, res) => res.json({ profile: req.profile }));
app.get('/team', async (_req, res) => {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return res.status(500).json({ error: 'Não foi possível listar a equipe.' });
  const users = [];
  for (const u of (data?.users || [])) {
    if (u.deleted_at) continue;
    try { users.push(await getProfile(u)); } catch (e) { console.warn('skip team profile', e.message); }
  }
  users.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ users });
});

// Para a equipe pequena combinada: qualquer integrante autenticado pode cadastrar outro.
// A senha é criada no servidor e nunca é registrada no histórico nem devolvida pela API.
app.post('/team', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Informe o nome da pessoa (mínimo de 2 caracteres).' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (password.length < 8) return res.status(400).json({ error: 'A senha inicial precisa ter pelo menos 8 caracteres.' });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: name, full_name: name }
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message || '') ? 'Já existe uma conta com esse e-mail.' : 'Não foi possível criar a conta. Confira as configurações do Supabase.';
    return res.status(400).json({ error: msg });
  }
  try {
    const profile = await getProfile(data.user);
    await admin.from('vizzion_activity_log').insert({
      user_id: req.authUser.id, action: 'team.created', entity_type: 'user', entity_id: data.user.id,
      details: { title: `Cadastrou ${name}`, email }
    });
    res.status(201).json({ ok: true, user: profile, message: 'Conta criada. Entregue a senha inicial à pessoa por um canal privado.' });
  } catch (e) {
    console.error('create team profile', e.message);
    res.status(201).json({ ok: true, user: { id: data.user.id, name, email, role: 'member' }, message: 'Conta criada; o perfil será preparado no primeiro login.' });
  }
});

app.get('/state', async (_req, res) => {
  const { data, error } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
  if (error) return res.status(500).json({ error: 'Falha ao ler estado compartilhado.' });
  res.json(data?.state || {});
});
app.put('/state', async (req, res) => {
  const incoming = req.body && typeof req.body === 'object' ? req.body : {};
  delete incoming.users; // usuários e PINs nunca são sincronizados dentro do estado geral.
  const { data: current, error: readError } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
  if (readError) return res.status(500).json({ error: 'Falha ao consultar estado.' });
  if (Number(incoming.updatedAt || 0) < Number(current?.state?.updatedAt || 0)) return res.json({ ok: true, skipped: true, reason: 'estado remoto mais recente' });
  const { error } = await admin.from('vizzion_state').upsert({ id: 'main', state: incoming, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return res.status(500).json({ error: 'Falha ao salvar estado compartilhado.' });
  res.json({ ok: true });
});

app.get('/products', async (_req, res) => {
  // Pagina para não truncar catálogos grandes no limite padrão do Supabase.
  const all = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from('vizzion_products').select('product_data').order('title').range(offset, offset + pageSize - 1);
    if (error) return res.status(500).json({ error: 'Falha ao ler produtos.' });
    const page = data || [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  res.json({ products: all.map(r => r.product_data).filter(Boolean) });
});
app.put('/products', async (req, res) => {
  const products = Array.isArray(req.body?.products) ? req.body.products : [];
  if (products.length > 50000) return res.status(413).json({ error: 'Catálogo muito grande; divida a importação.' });
  const rows = products.filter(p => p && p.id != null && (p.title || p.name)).map(p => ({ id: String(p.id), title: String(p.title || p.name || ''), category: String(p.category || ''), product_data: p, updated_at: new Date().toISOString() }));
  const { error: deleteError } = await admin.from('vizzion_products').delete().neq('id', '__keep_nothing__');
  if (deleteError) return res.status(500).json({ error: 'Falha ao preparar catálogo.' });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('vizzion_products').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) return res.status(500).json({ error: 'Falha ao salvar catálogo.' });
  }
  res.json({ ok: true, count: rows.length });
});
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
app.post('/search', async (req, res) => {
  const query = String(req.body?.query || '');
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit || 6)));
  const { data, error } = await admin.from('vizzion_products').select('product_data,title,category');
  if (error) return res.status(500).json({ error: 'Falha na busca de produtos.' });
  const toks = norm(query).split(/\W+/).filter(t => t.length > 2);
  const products = (data || []).map(row => ({ p: row.product_data, score: toks.filter(t => norm(`${row.title} ${row.category}`).includes(t)).length }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.p);
  res.json({ products });
});

const labels = {
  login: 'Entrou na Vizzion', 'team.created': 'Cadastrou um integrante', 'task.completed': 'Concluiu uma tarefa', 'task.reopened': 'Reabriu uma tarefa',
  'tasks.generated': 'Gerou tarefas do dia', 'task.created': 'Criou uma etapa/tarefa', 'stage.updated': 'Atualizou uma etapa',
  'project.created': 'Criou um projeto', 'project.deleted': 'Excluiu um projeto', 'post.recorded': 'Registrou uma publicação'
};
app.post('/activity', async (req, res) => {
  const action = String(req.body?.action || '').slice(0, 80);
  if (!action) return res.status(400).json({ error: 'Ação ausente.' });
  const details = req.body?.details && typeof req.body.details === 'object' ? req.body.details : {};
  const { data, error } = await admin.from('vizzion_activity_log').insert({
    user_id: req.authUser.id, action, entity_type: String(req.body?.entity_type || 'general').slice(0, 80),
    entity_id: req.body?.entity_id ? String(req.body.entity_id).slice(0, 120) : null, details
  }).select('id').single();
  if (error) return res.status(500).json({ error: 'Falha ao registrar atividade. Verifique se executou o SQL de histórico.' });
  res.json({ ok: true, id: data.id });
});
app.get('/activity', async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 100)));
  const { data, error } = await admin.from('vizzion_activity_log').select('id,user_id,action,entity_type,entity_id,details,created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: 'Falha ao ler histórico. Verifique se executou o SQL de histórico.' });
  const ids = [...new Set((data || []).map(x => x.user_id))];
  let profiles = [];
  if (ids.length) {
    const r = await admin.from('vizzion_profiles').select('user_id,display_name').in('user_id', ids);
    if (!r.error) profiles = r.data || [];
  }
  const names = new Map(profiles.map(p => [p.user_id, p.display_name]));
  res.json({ activity: (data || []).map(a => ({ ...a, display_name: names.get(a.user_id) || 'Integrante', action_label: labels[a.action] || a.action })) });
});

app.listen(PORT, () => console.log(`Backend Vizzion ouvindo na porta ${PORT}`));
