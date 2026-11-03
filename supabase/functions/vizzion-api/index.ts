import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
const AI_CREDENTIAL_TABLE = 'vizzion_project_ai_credentials';
const GEMINI_PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_SECONDARY_MODEL = 'gemini-3.8-flash';
const GEMINI_ALLOWED_MODELS = new Set([GEMINI_PRIMARY_MODEL, GEMINI_SECONDARY_MODEL]);
const GEMINI_MODEL_UNAVAILABLE = 'gemini_model_unavailable';
const ADMIN_ROLES = new Set(['admin', 'masteradmin']);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function getEncryptionKey() {
  const master = Deno.env.get('GEMINI_MASTER_KEY') || '';
  if (master.length < 32) throw new Error('encryption_unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(master));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function sameMemberIds(left: unknown, right: unknown) {
  const a = Array.isArray(left) ? [...new Set(left.map(String))].sort() : [];
  const b = Array.isArray(right) ? [...new Set(right.map(String))].sort() : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function unauthorizedMemberChanges(currentState: any, incomingState: any) {
  const currentProjects = Array.isArray(currentState?.projects) ? currentState.projects : [];
  const incomingProjects = Array.isArray(incomingState?.projects) ? incomingState.projects : [];
  const currentById = new Map<string, any>(currentProjects.map((project: any) => [String(project?.id || ''), project]));
  return incomingProjects.some((project: any) => {
    const id = String(project?.id || '');
    const current = currentById.get(id);
    return current && !sameMemberIds(current.memberIds, project.memberIds);
  });
}

function unauthorizedProjectSetChange(currentState: any, incomingState: any) {
  const currentIds = new Set((Array.isArray(currentState?.projects) ? currentState.projects : []).map((project: any) => String(project?.id || '')));
  const incomingIds = new Set((Array.isArray(incomingState?.projects) ? incomingState.projects : []).map((project: any) => String(project?.id || '')));
  if (currentIds.size !== incomingIds.size) return true;
  for (const id of currentIds) if (!incomingIds.has(id)) return true;
  return false;
}

function projectIdsForUser(state: any, userId: string, role: string) {
  if (role === 'masteradmin') return new Set((Array.isArray(state?.projects) ? state.projects : []).map((p: any) => String(p?.id || '')));
  return new Set((Array.isArray(state?.projects) ? state.projects : [])
    .filter((p: any) => Array.isArray(p?.memberIds) && p.memberIds.map(String).includes(userId))
    .map((p: any) => String(p?.id || '')));
}

function filterStateForUser(state: any, userId: string, role: string) {
  const allowed = projectIdsForUser(state, userId, role);
  if (role === 'masteradmin') return state || {};
  const projects = (Array.isArray(state?.projects) ? state.projects : []).filter((p: any) => allowed.has(String(p?.id || '')));
  const tasks = (Array.isArray(state?.tasks) ? state.tasks : []).filter((t: any) => !t?.projectId ? t?.userId === userId : allowed.has(String(t.projectId)));
  const postsLog = (Array.isArray(state?.postsLog) ? state.postsLog : []).filter((p: any) => allowed.has(String(p?.projectId || '')));
  return { ...(state || {}), projects, tasks, postsLog };
}

function mergeStateForUser(currentState: any, incomingState: any, userId: string, role: string) {
  const current = currentState || {};
  const incoming = incomingState || {};
  if (role === 'masteradmin') return incoming;
  const currentProjects = Array.isArray(current.projects) ? current.projects : [];
  const incomingProjects = Array.isArray(incoming.projects) ? incoming.projects : [];
  const allowed = projectIdsForUser(current, userId, role);
  const currentById = new Map(currentProjects.map((p: any) => [String(p?.id || ''), p]));
  const nextProjects = currentProjects.map((project: any) => {
    const id = String(project?.id || '');
    const candidate = incomingProjects.find((p: any) => String(p?.id || '') === id);
    if (!allowed.has(id)) return project;
    if (!candidate) return role === 'admin' ? null : project;
    if (role === 'member') return project;
    return { ...candidate, memberIds: project.memberIds };
  }).filter(Boolean);
  if (role === 'admin') {
    for (const project of incomingProjects) {
      const id = String(project?.id || '');
      if (!id || currentById.has(id)) continue;
      if (Array.isArray(project.memberIds) && project.memberIds.map(String).includes(userId)) nextProjects.push(project);
    }
  }
  const permittedProjectIds = new Set(nextProjects.filter((p: any) => allowed.has(String(p?.id || ''))).map((p: any) => String(p.id)));
  const currentTasks = Array.isArray(current.tasks) ? current.tasks : [];
  const incomingTasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
  const tasks = currentTasks.map((task: any) => {
    const candidate = incomingTasks.find((t: any) => String(t?.id || '') === String(task?.id || ''));
    if (!candidate) return task;
    const permitted = !task.projectId ? task.userId === userId : permittedProjectIds.has(String(task.projectId));
    if (!permitted) return task;
    if (role === 'member' && task.userId !== userId && task.completedBy !== userId) return task;
    return candidate;
  });
  for (const task of incomingTasks) {
    if (!currentTasks.some((t: any) => String(t?.id || '') === String(task?.id || '')) &&
      (!task.projectId ? task.userId === userId : permittedProjectIds.has(String(task.projectId)))) tasks.push(task);
  }
  const currentPosts = Array.isArray(current.postsLog) ? current.postsLog : [];
  const incomingPosts = Array.isArray(incoming.postsLog) ? incoming.postsLog : [];
  const postsLog = incomingPosts.filter((post: any) => permittedProjectIds.has(String(post?.projectId || '')));
  return {
    ...current,
    ...incoming,
    projects: nextProjects,
    tasks,
    postsLog: postsLog.length || !currentPosts.length ? postsLog : currentPosts,
    general: role === 'admin' ? incoming.general : current.general,
  };
}

async function encryptGeminiKey(plainText: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptGeminiKey(ciphertext: string, iv: string) {
  const key = await getEncryptionKey();
  const plainText = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(plainText);
}

async function resolveGeminiModel(apiKey: string, requestedModel = '') {
  const available = new Set<string>();
  let pageToken = '';
  let page = 0;
  const seenTokens = new Set<string>();
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
    });
    const payload = await response.json().catch(() => ({}));
    const diagnostics = (Array.isArray(payload?.models) ? payload.models : []).map((model: any) => ({
      name: String(model?.name || ''),
      supportedGenerationMethods: Array.isArray(model?.supportedGenerationMethods)
        ? model.supportedGenerationMethods.map(String)
        : [],
    }));
    console.info('Gemini models.list diagnostic', {
      status: response.status,
      page,
      models: diagnostics,
    });
    if (!response.ok) throw new Error(GEMINI_MODEL_UNAVAILABLE);
    for (const model of diagnostics) {
      const normalizedName = model.name.replace(/^models\//, '').trim();
      if (normalizedName && model.supportedGenerationMethods.includes('generateContent')) {
        available.add(normalizedName);
      }
    }
    const nextPageToken = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : '';
    if (!nextPageToken || seenTokens.has(nextPageToken)) break;
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
    page++;
  } while (page < 100);
  if (requestedModel && GEMINI_ALLOWED_MODELS.has(requestedModel) && available.has(requestedModel)) return requestedModel;
  if (available.has(GEMINI_PRIMARY_MODEL)) return GEMINI_PRIMARY_MODEL;
  if (available.has(GEMINI_SECONDARY_MODEL)) return GEMINI_SECONDARY_MODEL;
  throw new Error(GEMINI_MODEL_UNAVAILABLE);
}

function maskedKey(value: string) {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

async function getAuthorizedProject(projectId: string, userId: string, role: string) {
  if (!projectId || projectId.length > 200) return null;
  const { data, error } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
  if (error) throw error;
  const projects = Array.isArray(data?.state?.projects) ? data.state.projects : [];
  const project = projects.find((item: any) => String(item?.id || '') === projectId);
  if (!project) return null;
  if (role !== 'masteradmin' && (!Array.isArray(project.memberIds) || !project.memberIds.map(String).includes(userId))) return null;
  return project;
}

async function recordAiCredentialActivity(userId: string, actorName: string, action: string, projectId: string) {
  const { error } = await admin.from('vizzion_activity_log').insert({
    user_id: userId,
    actor_name: actorName,
    action,
    entity_type: 'project_ai_credential',
    entity_id: projectId,
    details: { title: action },
  });
  if (error) throw new Error('audit_failed');
}

function projectIdFromAiCredentialPath(path: string) {
  const match = /^\/projects\/([^/]+)\/ai-key$/.exec(path);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function projectIdFromAiGeneratePath(path: string) {
  const match = /^\/projects\/([^/]+)\/ai\/generate$/.exec(path);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function classifyGeminiFailure(status: number | null, payload: any) {
  const error = payload?.error || payload || {};
  const reason = `${String(error?.status || '')} ${String(error?.message || '')} ${String(error?.code || '')}`.toLowerCase();
  if (status === 401 || reason.includes('api key') || reason.includes('api_key') || reason.includes('unauthenticated')) return 'invalid_api_key';
  if (status === 403 || reason.includes('permission_denied') || reason.includes('permission denied') || reason.includes('forbidden')) return 'permission_denied';
  if (status === 429 || reason.includes('resource_exhausted') || reason.includes('quota')) return 'quota_exceeded';
  if (status === 404 || reason.includes('not_found') || reason.includes('model') && reason.includes('available')) return 'model_unavailable';
  if (status !== null && status >= 400 && status < 500) return 'gemini_http_4xx';
  return 'gemini_http_5xx';
}

function geminiFailureMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_api_key: 'A chave Gemini foi rejeitada pelo Google.',
    permission_denied: 'O Google não permitiu o uso desta chave Gemini.',
    quota_exceeded: 'A cota da chave Gemini foi excedida.',
    model_unavailable: 'O modelo Gemini configurado não está disponível.',
    gemini_http_4xx: 'O Google rejeitou a solicitação de teste Gemini.',
    gemini_http_5xx: 'O serviço Google Gemini não respondeu corretamente.',
  };
  return messages[code] || messages.gemini_http_5xx;
}

function isMasterAdmin(userId: string) {
  const configuredId = Deno.env.get('MASTERADMIN_USER_ID')?.trim() || '';
  return configuredId.length > 0 && configuredId === userId;
}

function masterAdminConfigured() {
  return Boolean(Deno.env.get('MASTERADMIN_USER_ID')?.trim());
}

function effectiveRole(userId: string, persistedRole: unknown) {
  if (isMasterAdmin(userId)) return 'masteradmin';
  return persistedRole === 'admin' ? 'admin' : 'member';
}

function hasRole(profile: any, roles: Set<string>) {
  return !!profile && roles.has(profile.role);
}

async function recordAdminActivity(userId: string, actorName: string, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  const { error } = await admin.from('vizzion_activity_log').insert({
    user_id: userId,
    actor_name: actorName,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    details,
  });
  if (error) throw new Error('audit_failed');
}

async function getProfile(user: any, defaultRole = 'member') {
  const display_name = safeName(user).split('@')[0] || 'Integrante';
  const { data, error } = await admin.from('vizzion_profiles')
    .upsert({ user_id: user.id, display_name, role: defaultRole === 'admin' ? 'admin' : 'member' }, { onConflict: 'user_id', ignoreDuplicates: true })
    .select('user_id,display_name,role').maybeSingle();
  if (error) throw error;
  if (data) return { id: user.id, name: data.display_name, email: user.email || '', role: effectiveRole(user.id, data.role) };
  const { data: existing, error: readError } = await admin.from('vizzion_profiles')
    .select('user_id,display_name,role').eq('user_id', user.id).single();
  if (readError) throw readError;
  return { id: user.id, name: existing.display_name || display_name, email: user.email || '', role: effectiveRole(user.id, existing.role) };
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

  const aiProjectId = projectIdFromAiCredentialPath(path);
  if (aiProjectId) {
    let project;
    try { project = await getAuthorizedProject(aiProjectId, authUser.id, profile.role); }
    catch { return json({ error: 'Não foi possível validar o projeto.' }, 500); }
    if (!project) return json({ error: 'Projeto não encontrado ou acesso não autorizado.' }, 403);

    if (req.method === 'GET') {
      const { data, error } = await admin.from(AI_CREDENTIAL_TABLE)
        .select('provider,key_hint,last_tested_at,last_test_status')
        .eq('project_id', aiProjectId)
        .maybeSingle();
      if (error) return json({ error: 'Não foi possível consultar a configuração de IA do projeto.' }, 500);
      return json({
        configured: !!data,
        provider: data?.provider || 'gemini',
        maskedKey: data?.key_hint || null,
        lastTestedAt: data?.last_tested_at || null,
        lastTestStatus: data?.last_test_status || null,
      });
    }

    if (req.method === 'PUT') {
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
      if (apiKey.length < 20 || apiKey.length > 300 || /\s/.test(apiKey)) return json({ error: 'Chave Gemini inválida.' }, 400);
      const { data: existing, error: existingError } = await admin.from(AI_CREDENTIAL_TABLE)
        .select('project_id')
        .eq('project_id', aiProjectId)
        .maybeSingle();
      if (existingError) return json({ error: 'Não foi possível consultar a chave Gemini do projeto.' }, 500);
      await recordAiCredentialActivity(authUser.id, profile.name, existing ? 'project.ai_key.replaced' : 'project.ai_key.created', aiProjectId);
      let encrypted;
      try { encrypted = await encryptGeminiKey(apiKey); }
      catch { return json({ error: 'Não foi possível proteger a chave Gemini.' }, 500); }
      const { error } = await admin.from(AI_CREDENTIAL_TABLE).upsert({
        project_id: aiProjectId,
        provider: 'gemini',
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        key_hint: maskedKey(apiKey),
        key_version: 1,
        updated_by: authUser.id,
        updated_at: new Date().toISOString(),
        last_tested_at: null,
        last_test_status: null,
        last_error_code: null,
        ...(existing ? {} : { created_by: authUser.id, created_at: new Date().toISOString() }),
      }, { onConflict: 'project_id' });
      if (error) return json({ error: 'Não foi possível salvar a chave Gemini do projeto.' }, 500);
      return json({ ok: true, configured: true, provider: 'gemini', maskedKey: maskedKey(apiKey) });
    }

    if (req.method === 'POST') {
      const { data, error } = await admin.from(AI_CREDENTIAL_TABLE)
        .select('ciphertext,iv')
        .eq('project_id', aiProjectId)
        .maybeSingle();
      if (error) return json({ error: 'Não foi possível consultar a chave Gemini do projeto.' }, 500);
      if (!data) return json({ error: 'Este projeto ainda não possui uma chave Gemini configurada.' }, 404);
      await recordAiCredentialActivity(authUser.id, profile.name, 'project.ai_key.tested', aiProjectId);
      let apiKey = '';
      try { apiKey = await decryptGeminiKey(data.ciphertext, data.iv); }
      catch { return json({ error: 'Não foi possível proteger a chave Gemini do projeto.' }, 500); }
      try {
        const model = await resolveGeminiModel(apiKey, typeof body?.model === 'string' ? body.model : '');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Respond only with OK.' }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } }),
        });
        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          const errorCode = classifyGeminiFailure(response.status, errorPayload);
          const { error: updateError } = await admin.from(AI_CREDENTIAL_TABLE).update({
            last_tested_at: new Date().toISOString(),
            last_test_status: 'error',
            last_error_code: errorCode,
            updated_by: authUser.id,
            updated_at: new Date().toISOString(),
          }).eq('project_id', aiProjectId);
          if (updateError) return json({ error: 'O teste falhou e não foi possível atualizar o status.' }, 500);
          return json({ error: geminiFailureMessage(errorCode), code: errorCode }, response.status >= 500 ? 502 : 400);
        }
        const { error: updateError } = await admin.from(AI_CREDENTIAL_TABLE).update({
          last_tested_at: new Date().toISOString(),
          last_test_status: 'success',
          last_error_code: null,
          updated_by: authUser.id,
          updated_at: new Date().toISOString(),
        }).eq('project_id', aiProjectId);
        if (updateError) return json({ error: 'A conexão funcionou, mas não foi possível atualizar o status.' }, 500);
        return json({ ok: true, status: 'connected' });
      } catch (error) {
        const errorCode = error instanceof Error && error.message === GEMINI_MODEL_UNAVAILABLE
          ? 'model_unavailable'
          : 'gemini_http_5xx';
        await admin.from(AI_CREDENTIAL_TABLE).update({
          last_tested_at: new Date().toISOString(),
          last_test_status: 'error',
          last_error_code: errorCode,
          updated_by: authUser.id,
          updated_at: new Date().toISOString(),
        }).eq('project_id', aiProjectId);
        return json({ error: errorCode === 'model_unavailable' ? 'Nenhum modelo Gemini compatível está disponível para esta chave.' : geminiFailureMessage(errorCode), code: errorCode }, 502);
      }
    }

    if (req.method === 'DELETE') {
      await recordAiCredentialActivity(authUser.id, profile.name, 'project.ai_key.removed', aiProjectId);
      const { error } = await admin.from(AI_CREDENTIAL_TABLE).delete().eq('project_id', aiProjectId);
      if (error) return json({ error: 'Não foi possível remover a chave Gemini do projeto.' }, 500);
      return json({ ok: true, configured: false });
    }
  }

  const aiGenerateProjectId = projectIdFromAiGeneratePath(path);
  if (aiGenerateProjectId && req.method === 'POST') {
    let project;
    try { project = await getAuthorizedProject(aiGenerateProjectId, authUser.id, profile.role); }
    catch { return json({ error: 'Não foi possível validar o projeto.' }, 500); }
    if (!project) return json({ error: 'Projeto não encontrado ou acesso não autorizado.' }, 403);
    const system = typeof body?.system === 'string' ? body.system.slice(0, 12000) : '';
    const user = typeof body?.user === 'string' ? body.user.slice(0, 30000) : '';
    const max = Math.max(1, Math.min(2000, Number(body?.max || 900)));
    if (!user) return json({ error: 'Conteúdo para geração ausente.' }, 400);
    const { data, error } = await admin.from(AI_CREDENTIAL_TABLE).select('ciphertext,iv').eq('project_id', aiGenerateProjectId).maybeSingle();
    if (error || !data) return json({ error: 'Este projeto não possui uma chave Gemini configurada.' }, 404);
    let apiKey = '';
    try { apiKey = await decryptGeminiKey(data.ciphertext, data.iv); } catch { return json({ error: 'Não foi possível usar a chave Gemini do projeto.' }, 500); }
    try {
      const model = await resolveGeminiModel(apiKey, typeof body?.model === 'string' ? body.model : '');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: max, temperature: 0.7 } }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const status = Number(response.status);
        const errorCode = String(result?.error?.status || '').slice(0, 80);
        return json({ error: errorCode ? `A geração Gemini falhou (${errorCode}).` : `A geração Gemini falhou (HTTP ${status}).` }, 502);
      }
      const text = (result?.candidates?.[0]?.content?.parts || []).map((part: any) => part?.text || '').join('').trim();
      if (!text) return json({ error: 'O Gemini não retornou conteúdo.' }, 502);
      return json({ text });
    } catch (error) {
      if (error instanceof Error && error.message === GEMINI_MODEL_UNAVAILABLE) {
        return json({ error: 'Nenhum modelo Gemini compatível está disponível para esta chave.', code: 'model_unavailable' }, 503);
      }
      return json({ error: 'Não foi possível contactar o Gemini.' }, 502);
    }
  }

  if (req.method === 'GET' && path === '/team') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return json({ error: 'Não foi possível listar a equipe.' }, 500);
    const users = [];
    const { data: stateRow, error: stateError } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (stateError) return json({ error: 'Não foi possível consultar os integrantes dos projetos.' }, 500);
    const allowedProjectIds = projectIdsForUser(stateRow?.state, authUser.id, profile.role);
    const allowedUserIds = new Set<string>([authUser.id]);
    for (const project of (Array.isArray(stateRow?.state?.projects) ? stateRow.state.projects : [])) {
      if (profile.role === 'masteradmin' || allowedProjectIds.has(String(project?.id || ''))) {
        for (const memberId of (Array.isArray(project?.memberIds) ? project.memberIds : [])) allowedUserIds.add(String(memberId));
      }
    }
    for (const u of (data?.users || [])) {
      if (u.deleted_at) continue;
      if (profile.role !== 'admin' && profile.role !== 'masteradmin' && !allowedUserIds.has(u.id)) continue;
      try { users.push(await getProfile(u)); } catch (e) { console.warn('skip team profile', e); }
    }
    users.sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));
    return json({ users });
  }

  if (req.method === 'POST' && path === '/team/delete') {
    const targetId = String(body?.id || '').trim();
    if (!targetId) return json({ error: 'Informe a conta que deseja excluir.' }, 400);
    if (targetId === authUser.id) return json({ error: 'Não é possível excluir a própria conta por esta tela.' }, 400);
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'Apenas administradores podem excluir contas.' }, 403);
    if (!masterAdminConfigured()) return json({ error: 'MASTERADMIN_USER_ID ainda não foi configurado; exclusões estão temporariamente bloqueadas.' }, 503);
    if (isMasterAdmin(targetId)) return json({ error: 'A conta MASTERADMIN não pode ser excluída por esta rota.' }, 403);
    const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !targetData?.user) return json({ error: 'Conta não encontrada.' }, 404);
    const targetProfile = await getProfile(targetData.user);
    if (targetProfile.role === 'admin' && profile.role !== 'masteradmin') {
      return json({ error: 'ADMINs só podem excluir contas MEMBER.' }, 403);
    }
    await recordAdminActivity(authUser.id, profile.name, 'team.deleted', 'user', targetId, { title: 'Excluiu uma conta da equipe', targetRole: targetProfile.role });
    const { data: stateRow, error: stateError } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (stateError) return json({ error: 'Não foi possível preparar a remoção das associações da conta.' }, 500);
    const cleanedState = structuredClone(stateRow?.state || {});
    if (Array.isArray(cleanedState.projects)) {
      cleanedState.projects = cleanedState.projects.map((project: any) => ({
        ...project,
        memberIds: Array.isArray(project.memberIds) ? project.memberIds.filter((id: unknown) => String(id) !== targetId) : project.memberIds,
      }));
    }
    if (Array.isArray(cleanedState.tasks)) {
      cleanedState.tasks = cleanedState.tasks.map((task: any) => ({
        ...task,
        userId: String(task.userId || '') === targetId ? null : task.userId,
        createdBy: String(task.createdBy || '') === targetId ? null : task.createdBy,
        completedBy: String(task.completedBy || '') === targetId ? null : task.completedBy,
      }));
    }
    if (Array.isArray(cleanedState.postsLog)) cleanedState.postsLog = cleanedState.postsLog.filter((post: any) => String(post.userId || '') !== targetId);
    const { error: stateWriteError } = await admin.from('vizzion_state').upsert({ id: 'main', state: cleanedState, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (stateWriteError) return json({ error: 'Não foi possível remover as associações da conta.' }, 500);
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) return json({ error: 'Não foi possível excluir a conta: ' + String(error.message || 'erro do Supabase').slice(0, 180) }, 400);
    return json({ ok: true });
  }

  // Guarda o arquivo de origem separado dos produtos normalizados, para permitir baixar a planilha original.
  if (req.method === 'POST' && path === '/catalog-file') {
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'MEMBERs não podem enviar arquivos de catálogo.' }, 403);
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
    const projectId = String(body?.projectId || '').trim();
    if (profile.role !== 'masteradmin' && !projectIdsForUser((await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle()).data?.state, authUser.id, profile.role).has(projectId)) {
      return json({ error: 'ADMIN só pode enviar arquivos para projetos autorizados.' }, 403);
    }
    const pathName = `original/${projectId || 'global'}/${authUser.id}/${Date.now()}-${name}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(pathName, bytes, { contentType: type, upsert: true });
    if (uploadError) return json({ error: 'Não foi possível guardar a planilha original na nuvem. ' + String(uploadError.message || '').slice(0, 160) }, 500);
    const { error: metaError } = await admin.from('vizzion_state').upsert({ id: 'catalog_file', state: { path: pathName, name, type, size: bytes.byteLength, uploadedBy: authUser.id, uploadedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (metaError) { console.warn('catalog file metadata', metaError.message); return json({ error: 'Arquivo enviado, mas não consegui registrar seus dados no catálogo.' }, 500); }
    return json({ ok: true, name, size: bytes.byteLength });
  }
  if (req.method === 'GET' && path === '/catalog-file') {
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'MEMBERs não podem baixar o arquivo original do catálogo.' }, 403);
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
    const requestedRole = String(body?.role || 'member').toLowerCase();
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'Apenas administradores podem criar contas.' }, 403);
    if (!['admin', 'member'].includes(requestedRole)) return json({ error: 'Papel inválido.' }, 400);
    if (requestedRole === 'admin' && profile.role !== 'masteradmin') {
      return json({ error: 'Somente o MASTERADMIN pode criar contas ADMIN.' }, 403);
    }
    if (name.length < 2) return json({ error: 'Informe o nome da pessoa (mínimo de 2 caracteres).' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (password.length < 8) return json({ error: 'A senha inicial precisa ter pelo menos 8 caracteres.' }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name, full_name: name } });
    if (error) {
      const msg = /already|registered|exists/i.test(error.message || '') ? 'Já existe uma conta com esse e-mail.' : 'Não foi possível criar a conta. Confira as configurações do Supabase.';
      return json({ error: msg }, 400);
    }
    try {
      const newProfile = await getProfile(data.user, requestedRole);
      try {
        await recordAdminActivity(authUser.id, profile.name, 'team.created', 'user', data.user.id, { title: `Cadastrou ${name}`, email, role: requestedRole });
      } catch {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: 'Não foi possível registrar a auditoria; a conta não foi criada.' }, 500);
      }
      return json({ ok: true, user: newProfile, message: 'Conta criada. Entregue a senha inicial à pessoa por um canal privado.' }, 201);
    } catch (e) {
      console.error('create team profile', e);
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: 'Não foi possível preparar o perfil e registrar a auditoria; a conta não foi criada.' }, 500);
    }
  }

  if (req.method === 'POST' && path === '/team/role') {
    if (profile.role !== 'masteradmin') return json({ error: 'Somente o MASTERADMIN pode alterar papéis.' }, 403);
    const targetId = String(body?.id || '').trim();
    const nextRole = String(body?.role || '').toLowerCase();
    if (!targetId || !['admin', 'member'].includes(nextRole)) return json({ error: 'Informe uma conta e um papel válido.' }, 400);
    if (targetId === authUser.id || isMasterAdmin(targetId)) return json({ error: 'A conta MASTERADMIN não pode ser rebaixada por esta rota.' }, 403);
    const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !targetData?.user) return json({ error: 'Conta não encontrada.' }, 404);
    const targetProfile = await getProfile(targetData.user);
    await recordAdminActivity(authUser.id, profile.name, 'team.role_changed', 'user', targetId, { title: 'Alterou o papel da conta', previousRole: targetProfile.role, role: nextRole });
    const { error } = await admin.from('vizzion_profiles').update({ role: nextRole }).eq('user_id', targetId);
    if (error) return json({ error: 'Não foi possível alterar o papel da conta.' }, 500);
    return json({ ok: true, user: { ...targetProfile, role: nextRole } });
  }

  if (req.method === 'GET' && path === '/state') {
    const { data, error } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (error) return json({ error: 'Falha ao ler estado compartilhado.' }, 500);
    return json(filterStateForUser(data?.state || {}, authUser.id, profile.role));
  }
  if (req.method === 'PUT' && path === '/state') {
    const incoming = body && typeof body === 'object' ? structuredClone(body) : {};
    delete incoming.users;
    const { data: current, error: readError } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    if (readError) return json({ error: 'Falha ao consultar estado.' }, 500);
    const currentState = current?.state || {};
    const allowedCurrentProjectIds = projectIdsForUser(currentState, authUser.id, profile.role);
    const incomingProjectIds = new Set((Array.isArray(incoming.projects) ? incoming.projects : []).map((p: any) => String(p?.id || '')));
    const memberProjectSetChanged = [...allowedCurrentProjectIds].some((id) => !incomingProjectIds.has(id)) ||
      [...incomingProjectIds].some((id) => !allowedCurrentProjectIds.has(id));
    if (profile.role === 'member' && memberProjectSetChanged) {
      return json({ error: 'MEMBERs não podem criar ou excluir projetos.' }, 403);
    }
    if (profile.role !== 'masteradmin' && unauthorizedMemberChanges(currentState, incoming)) {
      await recordAdminActivity(authUser.id, profile.name, 'state.membership_change_denied', 'state', 'main', { title: 'Tentativa não autorizada de alterar membros de projeto', role: profile.role });
      return json({ error: 'Somente o MASTERADMIN pode alterar os membros dos projetos.' }, 403);
    }
    if (Number(incoming.updatedAt || 0) < Number(currentState.updatedAt || 0)) return json({ ok: true, skipped: true, reason: 'estado remoto mais recente' });
    const nextState = mergeStateForUser(currentState, incoming, authUser.id, profile.role);
    const deletedProjectIds = profile.role === 'admin' || profile.role === 'masteradmin'
      ? (Array.isArray(currentState.projects) ? currentState.projects : []).map((p: any) => String(p?.id || '')).filter((id: string) => !new Set((nextState.projects || []).map((p: any) => String(p?.id || ''))).has(id))
      : [];
    if (deletedProjectIds.length) {
      await recordAdminActivity(authUser.id, profile.name, 'project.deleted', 'project', deletedProjectIds.join(','), { title: 'Excluiu projeto(s)' });
      const { error: credentialError } = await admin.from(AI_CREDENTIAL_TABLE).delete().in('project_id', deletedProjectIds);
      if (credentialError) return json({ error: 'Não foi possível remover as credenciais dos projetos excluídos.' }, 500);
    }
    const { error } = await admin.from('vizzion_state').upsert({ id: 'main', state: nextState, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return json({ error: 'Falha ao salvar estado compartilhado.' }, 500);
    if (profile.role === 'masteradmin' && unauthorizedMemberChanges(currentState, nextState)) {
      await recordAdminActivity(authUser.id, profile.name, 'project.members.updated', 'state', 'main', { title: 'Atualizou membros de projetos' });
    }
    return json({ ok: true });
  }

  if (req.method === 'GET' && path === '/products') {
    // Pagina para não truncar catálogos grandes no limite padrão do Supabase (ex.: 5.672 produtos).
    const all: any[] = [];
    const pageSize = 1000;
    const { data: state } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    const allowed = projectIdsForUser(state?.state, authUser.id, profile.role);
    const requestedProjectId = String(url.searchParams.get('projectId') || '').trim();
    if (requestedProjectId && profile.role !== 'masteradmin' && !allowed.has(requestedProjectId)) {
      return json({ error: 'Projeto não encontrado ou acesso não autorizado.' }, 403);
    }
    const projectId = requestedProjectId || '';
    for (let offset = 0; ; offset += pageSize) {
      let query = admin.from('vizzion_products').select('product_data,project_id').order('title').range(offset, offset + pageSize - 1);
      if (projectId) query = query.eq('project_id', projectId);
      else if (profile.role !== 'masteradmin' && allowed.size) query = query.in('project_id', [...allowed]);
      else if (profile.role !== 'masteradmin') return json({ products: [] });
      const { data, error } = await query;
      if (error) return json({ error: 'Falha ao ler produtos.' }, 500);
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    const products = all.map((r: any) => r.product_data).filter((product: any) => {
      const projectId = String(product?.projectId || '');
      return profile.role === 'masteradmin' || (profile.role === 'admin' && !projectId) || allowed.has(projectId);
    });
    return json({ products });
  }
  if (req.method === 'DELETE' && path === '/products') {
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'Somente administradores podem limpar o catálogo.' }, 403);
    const { error } = await admin.from('vizzion_products').delete().not('id', 'is', null);
    if (error) return json({ error: 'Falha ao limpar o catálogo.' }, 500);
    return json({ ok: true });
  }
  if (req.method === 'POST' && path === '/products/import') {
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'MEMBERs não podem importar ou substituir catálogos.' }, 403);
    const projectId = String(body?.projectId || '').trim();
    const products = Array.isArray(body?.products) ? body.products : [];
    const finalize = body?.finalize === true;
    const productIds = Array.isArray(body?.productIds) ? body.productIds.map((id: unknown) => String(id)).filter(Boolean) : [];
    if (!projectId) return json({ error: 'Selecione um projeto para importar o catálogo.' }, 400);
    if (!products.length || products.length > 500) return json({ error: 'Envie um lote entre 1 e 500 produtos.' }, 400);
    if (finalize && !productIds.length) return json({ error: 'A finalização precisa confirmar os produtos importados.' }, 400);
    const { data: state } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    const allowed = projectIdsForUser(state?.state, authUser.id, profile.role);
    if (profile.role !== 'masteradmin' && !allowed.has(projectId)) {
      return json({ error: 'ADMIN só pode operar catálogos de projetos autorizados.' }, 403);
    }
    if (products.some((product: any) => String(product?.projectId || '') !== projectId)) {
      return json({ error: 'Todos os produtos do lote precisam pertencer ao projeto selecionado.' }, 400);
    }
    const rows = products.filter((p: any) => p && p.id != null && (p.title || p.name)).map((p: any) => {
      const title = String(p.title || p.name || '');
      const category = String(p.category || '');
      return {
        id: `${projectId}:${String(p.id)}`,
        project_id: projectId,
        title,
        category,
        search_text: norm(`${title} ${category}`),
        product_data: p,
        updated_at: new Date().toISOString(),
      };
    });
    if (!rows.length) return json({ error: 'O lote não contém produtos válidos.' }, 400);
    const { error: upsertError } = await admin.from('vizzion_products').upsert(rows, { onConflict: 'id' });
    if (upsertError) return json({ error: 'Falha ao salvar o lote do catálogo.' }, 500);
    if (finalize) {
      const keepIds = new Set(productIds.map((id: string) => `${projectId}:${id}`));
      const staleIds: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from('vizzion_products').select('id').eq('project_id', projectId).range(offset, offset + 999);
        if (error) return json({ error: 'Lote salvo, mas não foi possível finalizar a substituição do catálogo.' }, 500);
        const page = data || [];
        staleIds.push(...page.map((row: any) => String(row.id)).filter((id: string) => !keepIds.has(id)));
        if (page.length < 1000) break;
      }
      for (let offset = 0; offset < staleIds.length; offset += 500) {
        const { error } = await admin.from('vizzion_products').delete().in('id', staleIds.slice(offset, offset + 500));
        if (error) return json({ error: 'Lote salvo, mas não foi possível remover versões antigas do catálogo.' }, 500);
      }
    }
    return json({ ok: true, count: rows.length, finalized: finalize });
  }
  if (req.method === 'PUT' && path === '/products') {
    if (!hasRole(profile, ADMIN_ROLES)) return json({ error: 'MEMBERs não podem importar ou substituir catálogos.' }, 403);
    const products = Array.isArray(body?.products) ? body.products : [];
    if (!products.length) return json({ error: 'A substituição vazia do catálogo é bloqueada; nenhum dado foi removido.' }, 400);
    if (products.length > 50000) return json({ error: 'Catálogo muito grande; divida a importação.' }, 413);
    const { data: state } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    const allowed = projectIdsForUser(state?.state, authUser.id, profile.role);
    if (profile.role !== 'masteradmin' && products.some((product: any) => !product?.projectId || !allowed.has(String(product.projectId)))) {
      return json({ error: 'ADMIN só pode operar catálogos de projetos autorizados.' }, 403);
    }
    const rows = products.filter((p: any) => p && p.id != null && (p.title || p.name)).map((p: any) => {
      const title = String(p.title || p.name || '');
      const category = String(p.category || '');
      return {
        id: String(p.id),
        project_id: String(p.projectId || ''),
        title,
        category,
        search_text: norm(`${title} ${category}`),
        product_data: p,
        updated_at: new Date().toISOString(),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('vizzion_products').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
      if (error) return json({ error: 'Falha ao salvar catálogo.' }, 500);
    }
    return json({ ok: true, count: rows.length });
  }
  if (req.method === 'POST' && path === '/search') {
    const query = String(body?.query || '');
    const limit = Math.max(1, Math.min(50, Number(body?.limit || 6)));
    const requestedProjectId = String(body?.projectId || '').trim();
    const requestedCategory = String(body?.category || '').trim();
    const titleOnly = body?.titleOnly === true;
    const excludeTerms = Array.isArray(body?.excludeTerms)
      ? body.excludeTerms.map((term: unknown) => norm(term)).filter((term: string) => term.length > 1 && term.length < 50).slice(0, 12)
      : [];
    const all: any[] = [];
    const pageSize = 1000;
    const { data: state } = await admin.from('vizzion_state').select('state').eq('id', 'main').maybeSingle();
    const allowed = projectIdsForUser(state?.state, authUser.id, profile.role);
    if (requestedProjectId && profile.role !== 'masteradmin' && !allowed.has(requestedProjectId)) {
      return json({ error: 'Projeto não encontrado ou acesso não autorizado.' }, 403);
    }
    const searchProjectIds = requestedProjectId ? [requestedProjectId] : [...allowed];
    if (profile.role !== 'masteradmin' && !searchProjectIds.length) return json({ products: [], searched: 0 });
    for (let offset = 0; ; offset += pageSize) {
      let productsQuery = admin.from('vizzion_products').select('product_data,project_id,title,category,search_text').range(offset, offset + pageSize - 1);
      if (requestedProjectId || profile.role !== 'masteradmin') productsQuery = productsQuery.in('project_id', searchProjectIds);
      if (requestedCategory) productsQuery = productsQuery.eq('category', requestedCategory);
      const { data, error } = await productsQuery;
      if (error) return json({ error: 'Falha na busca de produtos.' }, 500);
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    const visible = all.filter((row: any) => {
      const projectId = String(row.project_id || row.product_data?.projectId || '');
      return profile.role === 'masteradmin' || allowed.has(projectId);
    });
    const toks = norm(query).split(/\W+/).filter(t => t.length > 2);
    const products = visible.filter((row: any) => {
      if (!excludeTerms.length) return true;
      const title = norm(row.title);
      return !excludeTerms.some((term: string) => title.includes(term));
    }).map((row: any) => {
      const title = norm(row.title);
      const category = norm(row.category);
      const titleMatches = toks.filter(t => title.includes(t)).length;
      const categoryMatches = toks.filter(t => category.includes(t)).length;
      return { p: row.product_data, score: titleOnly ? titleMatches : titleMatches * 3 + categoryMatches };
    })
      .filter((x: any) => x.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, limit).map((x: any) => x.p);
    return json({ products, searched: visible.length });
  }
  if (req.method === 'POST' && path === '/activity') {
    const action = String(body?.action || '').slice(0, 80);
    if (!action) return json({ error: 'Ação ausente.' }, 400);
    if (/^(team\.|user\.|project\.members\.|state\.membership)/.test(action)) {
      return json({ error: 'Ações administrativas são registradas exclusivamente pelo backend.' }, 403);
    }
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
