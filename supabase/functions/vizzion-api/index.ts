import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});
const publicAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const safeName = (u: any) => String(u?.user_metadata?.display_name || u?.user_metadata?.full_name || u?.email || 'Integrante').trim().slice(0, 100);

async function getProfile(user: any) {
  const display_name = safeName(user).split('@')[0] || 'Integrante';
  const { data, error } = await admin.from('vizzion_profiles')
    .upsert({ user_id: user.id, display_name, role: 'member' }, { onConflict: 'user_id', ignoreDuplicates: true })
    .select('user_id,display_name,role').maybeSingle();
  if (error) throw error;
  if (data) return { id: user.id, name: data.display_name, email: user.email || '', role: 'member' };
  const { data: existing, error: readError } = await admin.from('vizzion_profiles')
    .select('user_id,display_name,role').eq('user_id', user.id).single();
  if (readError) throw readError;
  return { id: user.id, name: existing.display_name || display_name, email: user.email || '', role: 'member' };
}

const labels: Record<string, string> = {
  login: 'Entrou na Vizzion', 'team.created': 'Cadastrou um integrante', 'task.completed': 'Concluiu uma tarefa',
  'task.reopened': 'Reabriu uma tarefa', 'tasks.generated': 'Gerou tarefas do dia', 'task.created': 'Criou uma etapa/tarefa',
  'stage.updated': 'Atualizou uma etapa', 'project.created': 'Criou um projeto', 'project.deleted': 'Excluiu um projeto',
  'post.recorded': 'Registrou uma publicação',
};
const norm = (s: unknown) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY nos secrets da função.' }, 500);
  }

  const url = new URL(req.url);
  // Permite usar a URL base da função e continuar os caminhos /auth/login, /team etc.
  const marker = '/vizzion-api';
  const markerIndex = url.pathname.indexOf(marker);
  const path = markerIndex >= 0 ? (url.pathname.slice(markerIndex + marker.length) || '/') : url.pathname;
  let body: any = {};
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    try { body = await req.json(); } catch { body = {}; }
  }

  if (req.method === 'POST' && path === '/auth/login') {
    const email = String(body?.email || '').trim();
    const password = String(body?.password || '');
    if (!email || !password) return json({ error: 'Informe e-mail e senha.' }, 400);
    const { data, error } = await publicAuth.auth.signInWithPassword({ email, password });
    if (error || !data?.session || !data?.user) return json({ error: 'E-mail ou senha incorretos, ou conta ainda não confirmada.' }, 401);
    try { return json({ session: data.session, profile: await getProfile(data.user) }); }
    catch (e) { console.error('profile on login', e); return json({ error: 'Login realizado, mas não foi possível preparar o perfil. Confira as tabelas do Supabase.' }, 500); }
  }

  if (req.method === 'POST' && path === '/auth/refresh') {
    const refresh_token = String(body?.refresh_token || '');
    if (!refresh_token) return json({ error: 'Token de renovação ausente.' }, 400);
    const { data, error } = await publicAuth.auth.refreshSession({ refresh_token });
    if (error || !data?.session || !data?.user) return json({ error: 'Sessão expirada. Entre novamente.' }, 401);
    try { return json({ session: data.session, profile: await getProfile(data.user) }); }
    catch (e) { console.error('profile on refresh', e); return json({ error: 'Não foi possível carregar o perfil.' }, 500); }
  }

  const authHeader = req.headers.get('authorization') || '';
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!tokenMatch) return json({ error: 'Entre com sua conta Vizzion.' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(tokenMatch[1]);
  if (authError || !authData?.user) return json({ error: 'Sessão inválida ou expirada. Entre novamente.' }, 401);
  const authUser = authData.user;
  let profile: any;
  try { profile = await getProfile(authUser); }
  catch (e) { console.error('auth profile', e); return json({ error: 'Não foi possível carregar o perfil do usuário.' }, 500); }

  if (req.method === 'GET' && path === '/auth/me') return json({ profile });

  if (req.method === 'GET' && path === '/team') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return json({ error: 'Não foi possível listar a equipe.' }, 500);
    const users = [];
    for (const u of (data?.users || [])) {
      if (u.deleted_at) continue;
      try { users.push(await getProfile(u)); } catch (e) { console.warn('skip team profile', e); }
    }
    users.sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));
    return json({ users });
  }

  if (req.method === 'POST' && path === '/team/delete') {
    const targetId = String(body?.id || '').trim();
    if (!targetId) return json({ error: 'Informe a conta que deseja excluir.' }, 400);
    if (targetId === authUser.id) return json({ error: 'Não é possível excluir a própria conta por esta tela.' }, 400);
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) return json({ error: 'Não foi possível excluir a conta: ' + String(error.message || 'erro do Supabase').slice(0, 180) }, 400);
    await admin.from('vizzion_activity_log').insert({ user_id: authUser.id, action: 'team.deleted', entity_type: 'user', entity_id: targetId, details: { title: 'Excluiu uma conta da equipe' } });
    return json({ ok: true });
  }

  // Guarda o arquivo de origem separado dos produtos normalizados, para permitir baixar a planilha original.
  if (req.method === 'POST' && path === '/catalog-file') {
    const name = String(body?.name || 'catalogo-original.csv').replace(/[\\/]/g, '_').slice(0, 180);
    const type = String(body?.type || 'application/octet-stream').slice(0, 120);
    const data = String(body?.data || '');
    const match = /^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!match) return json({ error: 'Arquivo original inválido. Reimporte um CSV ou JSON.' }, 400);
    const bytes = Uint8Array.from(atob(match[1]), c => c.charCodeAt(0));
    if (bytes.byteLength > 15 * 1024 * 1024) return json({ error: 'O arquivo original excede o limite de 15 MB.' }, 413);
    const bucket = 'vizzion-catalog-files';
    const { error: bucketError } = await admin.storage.createBucket(bucket, { public: false, fileSizeLimit: 15728640 });
    if (bucketError && !/already exists|duplicate/i.test(bucketError.message || '')) console.warn('catalog bucket', bucketError.message);
    const pathName = `original/${authUser.id}/${Date.now()}-${name}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(pathName, bytes, { contentType: type, upsert: true });
    if (uploadError) return json({ error: 'Não foi possível guardar a planilha original na nuvem. ' + String(uploadError.message || '').slice(0, 160) }, 500);
    const { error: metaError } = await admin.from('vizzion_state').upsert({ id: 'catalog_file', state: { path: pathName, name, type, size: bytes.byteLength, uploadedBy: authUser.id, uploadedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (metaError) { console.warn('catalog file metadata', metaError.message); return json({ error: 'Arquivo enviado, mas não consegui registrar seus dados no catálogo.' }, 500); }
    return json({ ok: true, name, size: bytes.byteLength });
  }
  if (req.method === 'GET' && path === '/catalog-file') {
    const { data: meta, error } = await admin.from('vizzion_state').select('state').eq('id', 'catalog_file').maybeSingle();
    if (error) return json({ error: 'Falha ao consultar o arquivo original.' }, 500);
    const info = meta?.state || {};
    if (!info.path) return json({ url: null, name: null });
    const { data, error: signError } = await admin.storage.from('vizzion-catalog-files').createSignedUrl(info.path, 120);
    if (signError || !data?.signedUrl) return json({ error: 'Não foi possível gerar o link de download do arquivo original.' }, 500);
    return json({ url: data.signedUrl, name: info.name || 'catalogo-original', size: info.size || 0 });
  }

  if (req.method === 'POST' && path === '/team') {
    const name = String(body?.name || '').trim().slice(0, 100);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (name.length < 2) return json({ error: 'Informe o nome da pessoa (mínimo de 2 caracteres).' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (password.length < 8) return json({ error: 'A senha inicial precisa ter pelo menos 8 caracteres.' }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name, full_name: name } });
    if (error) {
      const msg = /already|registered|exists/i.test(error.message || '') ? 'Já existe uma conta com esse e-mail.' : 'Não foi possível criar a conta. Confira as configurações do Supabase.';
      return json({ error: msg }, 400);
    }
    try {
      const newProfile = await getProfile(data.user);
      await admin.from('vizzion_activity_log').insert({ user_id: authUser.id, action: 'team.created', entity_type: 'user', entity_id: data.user.id, details: { title: `Cadastrou ${name}`, email } });
      return json({ ok: true, user: newProfile, message: 'Conta criada. Entregue a senha inicial à pessoa por um canal privado.' }, 201);
    } catch (e) {
      console.error('create team profile', e);
      return json({ ok: true, user: { id: data.user.id, name, email, role: 'member' }, message: 'Conta criada; o perfil será preparado no primeiro login.' }, 201);
    }
  }

  if (req.method === 'GET' && path === '/state') {
    const { data, error } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (error) return json({ error: 'Falha ao ler estado compartilhado.' }, 500);
    return json(data?.state || {});
  }
  if (req.method === 'PUT' && path === '/state') {
    const incoming = body && typeof body === 'object' ? body : {};
    delete incoming.users;
    const { data: current, error: readError } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (readError) return json({ error: 'Falha ao consultar estado.' }, 500);
    if (Number(incoming.updatedAt || 0) < Number(current?.state?.updatedAt || 0)) return json({ ok: true, skipped: true, reason: 'estado remoto mais recente' });
    const { error } = await admin.from('vizzion_state').upsert({ id: 'main', state: incoming, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return json({ error: 'Falha ao salvar estado compartilhado.' }, 500);
    return json({ ok: true });
  }

  if (req.method === 'GET' && path === '/products') {
    // Pagina para não truncar catálogos grandes no limite padrão do Supabase (ex.: 5.672 produtos).
    const all: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.from('vizzion_products').select('product_data').order('title').range(offset, offset + pageSize - 1);
      if (error) return json({ error: 'Falha ao ler produtos.' }, 500);
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return json({ products: all.map((r: any) => r.product_data).filter(Boolean) });
  }
  if (req.method === 'PUT' && path === '/products') {
    const products = Array.isArray(body?.products) ? body.products : [];
    if (products.length > 50000) return json({ error: 'Catálogo muito grande; divida a importação.' }, 413);
    const rows = products.filter((p: any) => p && p.id != null && (p.title || p.name)).map((p: any) => ({ id: String(p.id), title: String(p.title || p.name || ''), category: String(p.category || ''), product_data: p, updated_at: new Date().toISOString() }));
    const { error: deleteError } = await admin.from('vizzion_products').delete().neq('id', '__keep_nothing__');
    if (deleteError) return json({ error: 'Falha ao preparar catálogo.' }, 500);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('vizzion_products').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
      if (error) return json({ error: 'Falha ao salvar catálogo.' }, 500);
    }
    return json({ ok: true, count: rows.length });
  }
  if (req.method === 'POST' && path === '/search') {
    const query = String(body?.query || '');
    const limit = Math.max(1, Math.min(50, Number(body?.limit || 6)));
    const all: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.from('vizzion_products').select('product_data,title,category').range(offset, offset + pageSize - 1);
      if (error) return json({ error: 'Falha na busca de produtos.' }, 500);
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    const toks = norm(query).split(/\W+/).filter(t => t.length > 2);
    const products = all.map((row: any) => ({ p: row.product_data, score: toks.filter(t => norm(`${row.title} ${row.category}`).includes(t)).length }))
      .filter((x: any) => x.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, limit).map((x: any) => x.p);
    return json({ products, searched: all.length });
  }
  if (req.method === 'POST' && path === '/activity') {
    const action = String(body?.action || '').slice(0, 80);
    if (!action) return json({ error: 'Ação ausente.' }, 400);
    const details = body?.details && typeof body.details === 'object' ? body.details : {};
    const { data, error } = await admin.from('vizzion_activity_log').insert({ user_id: authUser.id, action, entity_type: String(body?.entity_type || 'general').slice(0, 80), entity_id: body?.entity_id ? String(body.entity_id).slice(0, 120) : null, details }).select('id').single();
    if (error) return json({ error: 'Falha ao registrar atividade. Verifique a tabela vizzion_activity_log.' }, 500);
    return json({ ok: true, id: data.id });
  }
  if (req.method === 'GET' && path === '/activity') {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 100)));
    const { data, error } = await admin.from('vizzion_activity_log').select('id,user_id,action,entity_type,entity_id,details,created_at').order('created_at', { ascending: false }).limit(limit);
    if (error) return json({ error: 'Falha ao ler histórico. Verifique a tabela vizzion_activity_log.' }, 500);
    const ids = [...new Set((data || []).map((x: any) => x.user_id).filter(Boolean))];
    let profiles: any[] = [];
    if (ids.length) { const r = await admin.from('vizzion_profiles').select('user_id,display_name').in('user_id', ids); if (!r.error) profiles = r.data || []; }
    const names = new Map(profiles.map((p: any) => [p.user_id, p.display_name]));
    return json({ activity: (data || []).map((a: any) => ({ ...a, display_name: names.get(a.user_id) || 'Integrante', action_label: labels[a.action] || a.action })) });
  }
  return json({ error: `Rota não encontrada: ${req.method} ${path}` }, 404);
});
