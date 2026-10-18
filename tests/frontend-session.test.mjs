import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../server.mjs';
const APP_TOKEN = 'DUMMY_APPLICATION_TOKEN_FOR_TESTS_ONLY';
const provider = { enabled: true, model: 'test-model', providerHost: 'api.groq.com', async realize(plan) { return { action: plan.action, text: 'Oh, show me how?' }; } };
async function setup(t, options = {}, bind = '127.0.0.1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'childgpt-ui-session-'));
  await writeFile(path.join(root, 'index.html'), '<html><head></head><body>Test</body></html>');
  const dataDir = path.join(root, 'sessions');
  const app = createApp({ accessToken: APP_TOKEN, provider, staticDir: root, dataDir, ...options });
  await new Promise(resolve => app.listen(0, bind, resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const call = async (route, body, token, headers = {}) => {
    const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json() };
  };
  const session = async () => (await call('/api/session', { accessToken: APP_TOKEN })).data.sessionToken;
  return { base, call, session, dataDir };
}
test('loopback page bootstraps without exposing app/provider credentials or caching its capability', async t => {
  const { base, call } = await setup(t, { localAutoConnect: true });
  const page = await fetch(base), html = await page.text();
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const key = /name="childgpt-local-key" content="([a-f0-9]{64})"/u.exec(html)?.[1];
  assert.ok(key); assert.ok(!html.includes(APP_TOKEN));
  const result = await call('/api/local-session', { localKey: key }, null, { Origin: base, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(result.status, 201); assert.equal(result.data.model, 'test-model');
  assert.equal(result.data.service, 'Groq');
  assert.equal((await call('/api/state', undefined, result.data.sessionToken)).status, 200);
  const config = await call('/api/config');
  assert.equal(config.data.localAutoConnect, true);
  assert.ok(!JSON.stringify(config).includes(key)); assert.ok(!JSON.stringify(config).includes(APP_TOKEN));
});
test('local bootstrap rejects missing proof, cross-site requests and rebinding host names', async t => {
  const { base, call } = await setup(t, { localAutoConnect: true, allowedOrigins: ['https://allowed.example'] });
  const html = await (await fetch(base)).text();
  const localKey = /name="childgpt-local-key" content="([a-f0-9]{64})"/u.exec(html)[1];
  for (const [key, headers] of [
    [localKey, {}], [localKey, { Origin: base }], ['bad', { Origin: base, 'Sec-Fetch-Site': 'same-origin' }],
    [localKey, { Origin: 'https://allowed.example', 'Sec-Fetch-Site': 'cross-site' }],
    [localKey, { Origin: 'http://rebind.invalid', Host: 'rebind.invalid', 'Sec-Fetch-Site': 'same-origin' }]
  ]) assert.equal((await call('/api/local-session', { localKey: key }, null, headers)).status, 403);
  const reboundPage = await new Promise((resolve, reject) => {
    const req = http.get(base, { headers: { Host: 'rebind.invalid' } }, res => { let text = ''; res.on('data', data => { text += data; }); res.on('end', () => resolve(text)); }); req.on('error', reject);
  });
  assert.ok(!reboundPage.includes(localKey));
});
test('local bootstrap is disabled by default, without a provider, and on wildcard listeners', async t => {
  for (const [options, bind] of [[{}, '127.0.0.1'], [{ localAutoConnect: true, provider: { enabled: false } }, '127.0.0.1'], [{ localAutoConnect: true }, '0.0.0.0']]) {
    const { base, call } = await setup(t, options, bind);
    assert.ok(!(await (await fetch(base)).text()).includes('childgpt-local-key'));
    assert.equal((await call('/api/config')).data.localAutoConnect, false);
    assert.equal((await call('/api/local-session', { localKey: 'x' }, null, { Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status, 403);
  }
});
test('demo sessions require authentication and never reset the parent or the other demo', async t => {
  const { call, session } = await setup(t); const parent = await session();
  await call('/api/turn', { input: { mode: 'teach', concept: 'original', content: 'keep my original lesson' } }, parent);
  assert.equal((await call('/api/demo-session', { kind: 'learning' })).status, 401);
  assert.equal((await call('/api/demo-session', { kind: 'invalid' }, parent)).status, 400);
  const learning = (await call('/api/demo-session', { kind: 'learning' }, parent)).data;
  const chat = (await call('/api/demo-session', { kind: 'conversation' }, parent)).data;
  assert.notEqual(learning.sessionToken, chat.sessionToken);
  await call('/api/turn', { input: { mode: 'teach', concept: 'demo', content: 'synthetic fact' } }, learning.sessionToken);
  const original = (await call('/api/state', undefined, parent)).data.state.profiles['learner-a'];
  assert.equal(original.memories.length, 1); assert.equal(original.memories[0].concept, 'original');
  const other = (await call('/api/state', undefined, chat.sessionToken)).data;
  assert.equal(other.demoKind, 'conversation'); assert.equal(other.state.profiles['learner-a'].memories.length, 0);
});
test('rate-limit retry changes only speech, persists provenance, and cannot double-teach', async t => {
  let calls = 0;
  const flaky = { ...provider, async realize(plan) { calls++; if (calls === 1) { const e = new Error('Provider HTTP 429.'); e.retryAfterMs = 2300; throw e; } return { action: plan.action, text: 'That sounds like a tiny celebration.' }; } };
  const { call, session, dataDir } = await setup(t, { provider: flaky }); const token = await session();
  const first = (await call('/api/turn', { input: { mode: 'teach', concept: 'tavi', content: 'a moment of joy' } }, token)).data;
  assert.equal(first.provider.error.code, 'rate-limited'); assert.equal(first.provider.error.retryAfterMs, 2300);
  const before = first.state.profiles['learner-a'];
  assert.equal(before.history.at(-1).generation.source, 'fallback');
  const body = { interactionId: first.trace.interactionId };
  const [a, b] = await Promise.all([call('/api/reply/retry', body, token), call('/api/reply/retry', body, token)]);
  assert.equal(calls, 2); assert.equal(a.status, 200); assert.equal(b.status, 200);
  const after = b.data.state.profiles['learner-a'];
  assert.deepEqual(after.memories, before.memories); assert.equal(after.turn, before.turn); assert.equal(after.history.length, before.history.length);
  assert.equal(after.history.at(-1).generation.source, 'llm'); assert.equal(after.history.at(-1).generation.model, 'test-model');
  assert.equal(after.lastTrace.provider.wording, 'api-generated-response');
  const disk = JSON.parse(await readFile(path.join(dataDir, (await readdir(dataDir)).find(n => n.endsWith('.json'))), 'utf8'));
  assert.equal(disk.state.profiles['learner-a'].history.at(-1).generation.source, 'llm');
  assert.ok(!JSON.stringify(disk).includes(token));
  await call('/api/turn', { input: { mode: 'teach', concept: 'another', content: 'another fact' } }, token);
  assert.equal((await call('/api/reply/retry', body, token)).status, 409);
});
test('provider exception details cannot leak into reply diagnostics', async t => {
  const { call, session } = await setup(t, { provider: { ...provider, async realize() { throw new Error(`secret ${APP_TOKEN}`); } } });
  const reply = await call('/api/turn', { input: { mode: 'teach', concept: 'tavi', content: 'a synthetic fact' } }, await session());
  assert.equal(reply.data.provider.error.code, 'unavailable');
  assert.ok(!JSON.stringify(reply).includes(APP_TOKEN));
});
