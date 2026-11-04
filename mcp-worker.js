export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const backend = env.MCP_BACKEND_URL || 'http://localhost:8787';

    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-max-age': '86400'
          }
        });
      }

      const target = `${backend}${url.pathname}${url.search}`;
      const headers = {};
      for (const [key, value] of request.headers.entries()) {
        const lk = key.toLowerCase();
        if (lk === 'host') continue;
        if (lk === 'content-length') continue;
        headers[key] = value;
      }

      let body = null;
      if (request.method === 'POST' || request.method === 'PUT') {
        body = await request.arrayBuffer();
      }

      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: 'manual'
      });

      const responseHeaders = {};
      for (const [key, value] of upstream.headers.entries()) {
        const lk = key.toLowerCase();
        if (lk === 'connection' || lk === 'transfer-encoding') continue;
        responseHeaders[key] = value;
      }
      responseHeaders['access-control-allow-origin'] = '*';
      responseHeaders['access-control-expose-headers'] = 'mcp-session-id';

      const contentType = upstream.headers.get('content-type') || '';
      let bodyResult;
      if (contentType.includes('text/event-stream')) {
        bodyResult = upstream.body;
      } else {
        bodyResult = await upstream.arrayBuffer();
      }

      return new Response(bodyResult, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    }

    if (url.pathname === '/health') {
      const target = `${backend}/health`;
      const upstream = await fetch(target, { redirect: 'manual' });
      const data = await upstream.json().catch(() => ({ ok: false, service: 'mcp-worker', protocol: 'streamable-http' }));
      return Response.json(data, { status: upstream.status });
    }

    return new Response('MCP Worker Vizzion. Use /mcp ou /health.', { status: 200 });
  }
};
