import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

interface MockEmailRecord {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  created: string;
}

export interface MockStackUrls {
  backendBaseUrl: string;
  apiBaseUrl: string;
  openApiUrl: string;
  mailpitApiUrl: string;
  frontendUrl: string;
  close: () => Promise<void>;
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string | string[]> = {},
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export async function startMockStack(): Promise<MockStackUrls> {
  const emails: MockEmailRecord[] = [];
  const otpByEmail = new Map<string, string>();
  const verifiedEmails = new Set<string>();
  const refreshFamilies = new Map<string, { familyId: string; revoked: boolean; email: string }>();

  const backendServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/api/v1/health') {
      sendJson(res, 200, { status: 'ok', db: 'up', redis: 'up' });
      return;
    }

    if (method === 'GET' && path === '/api/docs-json') {
      sendJson(res, 200, {
        openapi: '3.0.3',
        info: { title: 'Vendexa Mock API', version: '1.0.0' },
        paths: {
          '/api/v1/health': { get: {} },
          '/api/v1/auth/platform/register': { post: {} },
          '/api/v1/auth/platform/login': { post: {} },
          '/api/v1/auth/platform/verify-otp': { post: {} },
          '/api/v1/auth/refresh': { post: {} },
          '/api/v1/auth/me': { get: {} },
          '/api/v1/plans': { get: {} },
          '/api/v1/tenants/resolve': { get: {} },
          '/api/v1/platform-admin/overview': { get: {} },
          '/api/v1/storefront/config': { get: {} },
          '/api/v1/cart': { get: {} },
        },
        components: {
          schemas: {
            HealthResponse: { type: 'object' },
            Rfc7807Error: { type: 'object' },
          },
        },
      });
      return;
    }

    if (method === 'POST' && path === '/api/v1/auth/platform/register') {
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email || 'unexpectedRole' in body) {
        sendJson(res, 400, {
          statusCode: 400,
          error: 'Bad Request',
          message: ['property unexpectedRole should not exist'],
          path,
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        });
        return;
      }
      const otp = '482913';
      otpByEmail.set(email, otp);
      emails.unshift({
        id: crypto.randomUUID(),
        to: email,
        subject: 'Verifica tu cuenta en Vendexa',
        text: `Tu código OTP de verificación es ${otp}`,
        html: `<p>Tu código OTP es <strong>${otp}</strong></p>`,
        created: new Date().toISOString(),
      });
      sendJson(res, 201, {
        id: crypto.randomUUID(),
        email,
        fullName: body.fullName ?? 'Test Owner',
        emailVerifiedAt: null,
      });
      return;
    }

    if (method === 'POST' && path === '/api/v1/auth/platform/verify-otp') {
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      const otp = String(body.otp ?? body.code ?? '');
      if (otpByEmail.get(email) !== otp) {
        sendJson(res, 400, {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid OTP code',
          path,
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        });
        return;
      }
      verifiedEmails.add(email);
      sendJson(res, 200, { verified: true, email });
      return;
    }

    if (method === 'POST' && path === '/api/v1/auth/platform/login') {
      const body = await readJsonBody(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      const familyId = crypto.randomUUID();
      const refreshToken = `rt-${crypto.randomUUID()}`;
      refreshFamilies.set(refreshToken, { familyId, revoked: false, email });

      sendJson(
        res,
        200,
        { user: { email, role: 'STORE_OWNER' } },
        {
          'Set-Cookie': [
            `access_token=at-${email}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`,
            `refresh_token=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
          ],
        },
      );
      return;
    }

    if (method === 'POST' && path === '/api/v1/auth/refresh') {
      const cookies = parseCookies(req);
      const token = cookies.refresh_token;
      const record = token ? refreshFamilies.get(token) : undefined;
      if (!record) {
        sendJson(res, 401, {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Missing or invalid refresh token',
          path,
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        });
        return;
      }
      if (record.revoked) {
        for (const [, entry] of refreshFamilies.entries()) {
          if (entry.familyId === record.familyId) {
            entry.revoked = true;
          }
        }
        sendJson(res, 401, {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Refresh token reuse detected; family revoked',
          path,
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        });
        return;
      }

      record.revoked = true;
      const nextRefresh = `rt-${crypto.randomUUID()}`;
      refreshFamilies.set(nextRefresh, {
        familyId: record.familyId,
        revoked: false,
        email: record.email,
      });

      sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': [
            `access_token=at-rotated-${record.email}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`,
            `refresh_token=${nextRefresh}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
          ],
        },
      );
      return;
    }

    if (method === 'POST' && path === '/api/v1/auth/logout') {
      sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': [
            'access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
            'refresh_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
          ],
        },
      );
      return;
    }

    if (method === 'GET' && path === '/api/v1/storefront/config') {
      const tenantHost = String(req.headers['x-tenant-host'] ?? '');
      const tenantSlug = String(req.headers['x-tenant-slug'] ?? '');
      if (tenantHost.startsWith('moda-mayorista') || tenantSlug === 'moda-mayorista') {
        sendJson(res, 200, {
          tenant: { slug: 'moda-mayorista', name: 'Urban Threads Studio' },
          theme: { primaryColor: '#0F172A', accentColor: '#4F46E5' },
        });
        return;
      }
      sendJson(res, 404, {
        statusCode: 404,
        error: 'Not Found',
        message: 'Tenant not found',
        path,
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      });
      return;
    }

    sendJson(res, 404, {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${method} ${path} not found`,
      path,
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    });
  });

  const mailpitServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/v1/messages') {
      sendJson(res, 200, {
        total: emails.length,
        unread: emails.length,
        count: emails.length,
        messages: emails.map((m) => ({
          ID: m.id,
          MessageID: `<${m.id}@mock.local>`,
          Created: m.created,
          From: { Name: 'Vendexa', Address: 'no-reply@vendexa.local' },
          To: [{ Name: '', Address: m.to }],
          Subject: m.subject,
          Snippet: m.text.slice(0, 120),
          Read: false,
        })),
      });
      return;
    }

    if (req.method === 'GET' && path.startsWith('/api/v1/message/')) {
      const id = decodeURIComponent(path.replace('/api/v1/message/', ''));
      const found = emails.find((e) => e.id === id);
      if (!found) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Message not found');
        return;
      }
      sendJson(res, 200, {
        ID: found.id,
        MessageID: `<${found.id}@mock.local>`,
        Date: found.created,
        From: { Name: 'Vendexa', Address: 'no-reply@vendexa.local' },
        To: [{ Name: '', Address: found.to }],
        Subject: found.subject,
        Text: found.text,
        HTML: found.html,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  const frontendServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/store/moda-mayorista') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>Urban Threads Studio</title></head>' +
          '<body><main><h1>Urban Threads Studio</h1><p>Hoodie Boxy Heavyweight 450gsm</p></main></body></html>',
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Vendexa SaaS</title></head><body><h1>Vendexa</h1></body></html>');
  });

  await Promise.all([
    new Promise<void>((resolve) => backendServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => mailpitServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => frontendServer.listen(0, '127.0.0.1', resolve)),
  ]);

  const backendPort = (backendServer.address() as AddressInfo).port;
  const mailpitPort = (mailpitServer.address() as AddressInfo).port;
  const frontendPort = (frontendServer.address() as AddressInfo).port;

  return {
    backendBaseUrl: `http://127.0.0.1:${backendPort}`,
    apiBaseUrl: `http://127.0.0.1:${backendPort}/api/v1`,
    openApiUrl: `http://127.0.0.1:${backendPort}/api/docs-json`,
    mailpitApiUrl: `http://127.0.0.1:${mailpitPort}/api/v1`,
    frontendUrl: `http://127.0.0.1:${frontendPort}`,
    close: async () => {
      await Promise.all([
        new Promise<void>((resolve, reject) => backendServer.close((e) => (e ? reject(e) : resolve()))),
        new Promise<void>((resolve, reject) => mailpitServer.close((e) => (e ? reject(e) : resolve()))),
        new Promise<void>((resolve, reject) => frontendServer.close((e) => (e ? reject(e) : resolve()))),
      ]);
    },
  };
}
