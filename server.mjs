/** Zero-production-dependency demo server. Node 22+. Static Pages deployment does NOT run this server. */
import http from 'node:http';
import { readFile, writeFile, mkdir, rename, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import C from './src/core.js';
import { Provider } from './src/llm.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHA = text => createHash('sha256').update(text).digest('hex');
const equalSecret = (a, b) => timingSafeEqual(Buffer.from(SHA(a)), Buffer.from(SHA(b)));
const TTL = 7 * 24 * 3600 * 1000;
class APIError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createApp(options = {}) {
  const provider = options.provider || new Provider({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, timeout: process.env.LLM_TIMEOUT_MS });
  const accessToken = options.accessToken ?? process.env.APP_ACCESS_TOKEN ?? '';
  if (provider.enabled && accessToken.length < 24) throw new Error('Keyed backend requires a separate APP_ACCESS_TOKEN of at least 24 characters.');
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data', 'sessions');
  const staticDir = options.staticDir || path.join(ROOT, 'dist');
  const allowedOrigins = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const sessions = new Map(), limits = new Map();
  const rateLimit = (key, cap) => {
    const time = Date.now(), current = limits.get(key);
    if (!current || time - current.at >= 60000) { limits.set(key, { at: time, count: 1 }); if (limits.size > 5000) for (const [k, v] of limits) if (time - v.at > 60000) limits.delete(k); return; }
    if (++current.count > cap) throw new APIError(429, 'Rate limit reached. Wait a minute before trying again.');
  };
  const writeSession = async s => {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const target = path.join(dataDir, `${s.id}.json`), tmp = target + '.tmp';
    await writeFile(tmp, JSON.stringify({ expires: s.expires, state: s.engine.export() }), { mode: 0o600 });
    await rename(tmp, target);
  };
  const getSession = async req => {
    const token = (req.headers.authorization || '').replace(/^Bearer /u, '');
    if (!/^[a-f0-9]{64}$/u.test(token)) throw new APIError(401, 'Connect the backend first.');
    const id = SHA(token); let s = sessions.get(id);
    if (!s) {
      try { const data = JSON.parse(await readFile(path.join(dataDir, `${id}.json`), 'utf8')); s = { id, expires: data.expires, engine: new C.Engine(data.state), tail: Promise.resolve() }; sessions.set(id, s); }
      catch { throw new APIError(401, 'Session expired or unavailable. Please reconnect.'); }
    }
    if (s.expires < Date.now()) { sessions.delete(id); await unlink(path.join(dataDir, `${id}.json`)).catch(() => {}); throw new APIError(401, 'Session expired.'); }
    return s;
  };
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new APIError(415, 'Use application/json.');
    let count = 0, chunks = [];
    for await (const chunk of req) { count += chunk.length; if (count > 16000) throw new APIError(413, 'Request is too large.'); chunks.push(chunk); }
    try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0; return b; }
    catch { throw new APIError(400, 'Invalid JSON object.'); }
  }
  const app = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const origin = req.headers.origin;
      const sameOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
      if (url.pathname.startsWith('/api/')) {
        if (origin && !sameOrigin && !allowedOrigins.includes(origin)) throw new APIError(403, 'Origin not allowed. Set ALLOWED_ORIGINS on the backend.');
        if (origin && (sameOrigin || allowedOrigins.includes(origin))) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type'); res.writeHead(204); return res.end(); }
        if (url.pathname === '/api/config' && req.method === 'GET') return send(200, { apiEnabled: provider.enabled, requiresAccessToken: Boolean(accessToken), mode: provider.enabled ? 'keyed-backend' : 'server-demo', noClinicalValidation: true });
        rateLimit(`ip:${req.socket.remoteAddress}`, 180);
        if (url.pathname === '/api/session' && req.method === 'POST') {
          rateLimit(`login:${req.socket.remoteAddress}`, 10);
          const b = await body(req);
          if (accessToken && (typeof b.accessToken !== 'string' || !equalSecret(b.accessToken, accessToken))) throw new APIError(401, 'Incorrect application access token.');
          if (sessions.size >= 1000) { for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id); if (sessions.size >= 1000) throw new APIError(503, 'Demo session capacity reached.'); }
          const token = randomBytes(32).toString('hex'), s = { id: SHA(token), expires: Date.now() + TTL, engine: new C.Engine(), tail: Promise.resolve() };
          sessions.set(s.id, s); await writeSession(s);
          return send(201, { sessionToken: token, state: s.engine.export(), apiEnabled: provider.enabled });
        }
        const s = await getSession(req);
        if (url.pathname === '/api/state' && req.method === 'GET') { await s.tail.catch(() => {}); return send(200, { state: s.engine.export(), apiEnabled: provider.enabled }); }
        if (url.pathname === '/api/session' && req.method === 'DELETE') {
          await s.tail.catch(() => {}); sessions.delete(s.id); await unlink(path.join(dataDir, `${s.id}.json`)).catch(() => {}); return send(200, { deleted: true });
        }
        if (url.pathname === '/api/turn' && req.method === 'POST') {
          rateLimit(`session:${s.id}`, 30);
          const b = await body(req);
          const operation = s.tail.catch(() => {}).then(async () => {
            let input = b.input;
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw new APIError(400, 'A structured input is required.');
            if (b.profile) s.engine.switchProfile(b.profile);
            let extraction = 'not-needed', wording = provider.enabled ? 'pending' : 'not-configured';
            if (input.mode === 'chat' && typeof input.text === 'string' && input.text.length <= 3000 && C.parseMessage(input.text).mode === 'chat' && provider.enabled) {
              try { const parsed = await provider.extract(input.text); extraction = parsed ? 'api-grounded-spans' : 'rejected-or-unclear'; if (parsed) input = { ...input, ...parsed }; }
              catch { extraction = 'provider-unavailable; deterministic fallback'; }
            }
            let result;
            try { result = s.engine.transact(input); } catch (e) { throw new APIError(400, e.message); }
            if (result.message && result.trace && !result.skipped && provider.enabled) {
              try { const index = await provider.wording(result.trace); wording = s.engine.applyWording(index) ? 'api-selected-approved-wording' : 'invalid-provider-output; deterministic fallback'; }
              catch { wording = 'provider-unavailable; deterministic fallback'; }
            }
            await writeSession(s);
            const state = s.engine.export(), p = s.engine.profile();
            return { ...result, state, trace: p.lastTrace, message: result.skipped ? result.message : p.history.at(-1)?.text || result.message, provider: { enabled: provider.enabled, extraction, wording } };
          });
          s.tail = operation.then(() => undefined, () => undefined);
          return send(200, await operation);
        }
        if (url.pathname === '/api/profile' && req.method === 'POST') {
          const b = await body(req);
          const operation = s.tail.catch(() => {}).then(async () => { try { if (b.reset) s.engine.resetProfile(b.profile); s.engine.switchProfile(b.profile); } catch (e) { throw new APIError(400, e.message); } await writeSession(s); return { state: s.engine.export() }; });
          s.tail = operation.then(() => undefined, () => undefined); return send(200, await operation);
        }
        throw new APIError(404, 'Unknown API route.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new APIError(405, 'Method not allowed.');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const target = path.resolve(staticDir, relative);
      if (!target.startsWith(path.resolve(staticDir) + path.sep) || relative.split('/').some(x => x.startsWith('.'))) throw new APIError(404, 'Not found.');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
      const type = types[path.extname(target)];
      if (!type) throw new APIError(404, 'Not found.');
      let data; try { data = await readFile(target); } catch { throw new APIError(404, 'Not found. Run npm run build first.'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) { send(e.status || 500, { error: e.status ? e.message : 'Internal server error. No upstream response or secrets are exposed.' }); }
  });
  app.requestTimeout = 45000; app.headersTimeout = 10000;
  // Retention cleanup on startup; do not include any user text in logs.
  mkdir(dataDir, { recursive: true, mode: 0o700 }).then(async () => {
    for (const file of await readdir(dataDir)) if (/^[a-f0-9]{64}\.json$/u.test(file)) {
      try { const value = JSON.parse(await readFile(path.join(dataDir, file), 'utf8')); if (value.expires < Date.now()) await unlink(path.join(dataDir, file)); } catch { /* leave corrupt files for the operator */ }
    }
  }).catch(() => {});
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8000);
  const app = createApp();
  app.listen(port, host, () => console.log(`ChildGPT running at http://${host}:${port}. API configuration is server-only. No user-content logging.`));
}
