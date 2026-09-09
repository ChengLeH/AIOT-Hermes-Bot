import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { containMiddlewareFailure, samePageOrigin, preventStaleAppShell } from './aiot-hermes-proxy.mjs';

test('entry documents are never cached across hashed-asset deployments', () => {
  for (const url of ['/', '/?profile=example', '/index.html']) {
    const headers = {};
    preventStaleAppShell({ method: 'GET', url }, { setHeader: (key, value) => { headers[key] = value; } });
    assert.equal(headers['cache-control'], 'no-store');
  }
  preventStaleAppShell({ method: 'GET', url: '/assets/example.css' }, { setHeader: () => assert.fail('leave hashed asset policy unchanged') });
});

test('browser origin guard rejects cross-site requests even when Origin is omitted', () => {
  const request = (headers = {}, remoteAddress = '100.64.0.10') => ({
    method: 'POST',
    headers: { host: 'machine.example.ts.net:10000', ...headers },
    socket: { remoteAddress },
  });
  assert.equal(samePageOrigin(request({ origin: 'https://machine.example.ts.net:10000' })), true);
  assert.equal(samePageOrigin(request({ origin: 'https://other.example.ts.net:10000' })), false);
  assert.equal(samePageOrigin(request({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(samePageOrigin(request({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(samePageOrigin(request()), false);
  assert.equal(samePageOrigin(request({}, '127.0.0.1')), true);
});

test('async native/session rejection becomes sanitized 503 and server keeps serving', async () => {
  const handler = containMiddlewareFailure(async (req, res) => {
    if (req.url !== '/ok') throw new TypeError('fetch failed ECONNREFUSED127.0.0.1:8645 private-secret');
    res.end('healthy');
  });
  // Deliberately ignore its promise like Connect/Vite does.
  const server = createServer((req, res) => { handler(req, res, () => {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/api/bot/native/history', '/api/bot/sessions/list']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'upstream_service_unavailable' });
    }
    assert.equal(await (await fetch(base + '/ok')).text(), 'healthy');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('late middleware errors cannot rewrite headers or touch a closed response', async () => {
  let ended = 0;
  const handler = containMiddlewareFailure(async () => { throw new Error('late'); });
  await handler({}, { headersSent: true, end: () => { ended++; } }, () => {});
  assert.equal(ended, 1);
  await handler({}, { destroyed: true, end: () => { throw new Error('must not touch'); } }, () => {});
  await handler({}, { writableEnded: true, end: () => { throw new Error('must not touch'); } }, () => {});
});
