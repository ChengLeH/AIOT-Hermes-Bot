import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRpcClient } from './aiot-session-rpc.mjs';

class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url, protocols) {
    super(); Object.assign(this, { url, protocols, sent: [], closeCount: 0 });
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.frame({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { heartbeat: true } } }));
  }
  frame(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closeCount++; this.dispatchEvent(new Event('close')); }
}
const options = { dashboardBase: 'https://hermes.example/dashboard', ticketProvider: async () => ({ ticket: 'test_ticket' }), WebSocketImpl: FakeSocket };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('official ticket upgrade, ready gate, correlated replies and NDJSON events', async () => {
  const events = [];
  const client = new SessionRpcClient({ ...options, onEvent: event => events.push(event) });
  const first = client.connect();
  assert.equal(client.connect(), first);
  await first;
  const ws = client.socket;
  assert.equal(ws.url, 'wss://hermes.example/dashboard/api/ws');
  assert.deepEqual(ws.protocols, ['hermes-gateway-v1', 'hermes-gateway-ticket.test_ticket']);
  const a = client.request('session.create', { profile: 'alpha' });
  const b = client.request('session.list');
  await tick();
  const [ra, rb] = ws.sent;
  assert.notEqual(ra.id, rb.id);
  ws.frame([
    { jsonrpc: '2.0', id: rb.id, result: [] },
    { jsonrpc: '2.0', method: 'event', params: { type: 'message.complete', session_id: 's1', payload: { text: 'Done' } } },
    { jsonrpc: '2.0', id: ra.id, result: { session_id: 's1', stored_session_id: 'db1' } },
  ].map(JSON.stringify).join('\n') + '\n');
  assert.deepEqual(await a, { session_id: 's1', stored_session_id: 'db1' });
  assert.deepEqual(await b, []);
  assert.equal(events.at(-1).session_id, 's1');
  assert.equal(client.pending.size, 0);
  client.close(); client.close();
  assert.equal(ws.closeCount, 1);
});

test('close rejects pending calls, prevents reuse and does not leak remote error text', async () => {
  const client = new SessionRpcClient(options);
  await client.connect();
  const errorRequest = client.request('session.list');
  const checked = assert.rejects(errorRequest, error => error.code === 401 && !error.message.includes('secret'));
  await tick();
  client.socket.frame({ jsonrpc: '2.0', id: client.socket.sent[0].id, error: { code: 401, message: 'secret credential' } });
  await checked;
  const pending = client.request('session.list');
  const rejected = assert.rejects(pending, /closed/);
  await tick(); client.close(); await rejected;
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('session.list'), /closed/);
});

test('request timeout drops pending entry and ignores late reply', async () => {
  const client = new SessionRpcClient({ ...options, requestTimeoutMs: 5 });
  await client.connect();
  await assert.rejects(client.request('session.list'), /timed out/);
  assert.equal(client.pending.size, 0);
  client.socket.frame({ jsonrpc: '2.0', id: client.socket.sent[0].id, result: [] });
  assert.equal(client.closed, false); client.close();
});

test('connection timeout covers ticket provider and never opens after close', async () => {
  let release;
  const before = FakeSocket.instances.length;
  const client = new SessionRpcClient({ ...options, connectTimeoutMs: 5, ticketProvider: () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(client.connect(), /timed out/);
  release('late_ticket'); await tick();
  assert.equal(FakeSocket.instances.length, before);
});

test('malformed and oversized frames close fail-safe; unsafe URLs rejected', async () => {
  for (const frame of ['{bad json', 'x'.repeat(301)]) {
    const client = new SessionRpcClient({ ...options, maxFrameBytes: 300 });
    await client.connect();
    client.socket.frame(frame);
    assert.equal(client.closed, true);
  }
  for (const dashboardBase of ['http://remote.example', 'https://user:secret@example.test', 'https://example.test?ticket=secret']) {
    assert.throws(() => new SessionRpcClient({ ...options, dashboardBase }));
  }
});

test('legacy credential is constrained to verified HTTPS origin and kept out of public URL/errors', async () => {
  const credential = { authMode: 'legacy', authRequired: false, dashboardOrigin: 'https://hermes.example', loopbackToken: 'legacy_secret_1234567890' };
  const client = new SessionRpcClient({ ...options, ticketProvider: async () => credential });
  await client.connect();
  assert.equal(new URL(client.socket.url).searchParams.get('token'), credential.loopbackToken);
  assert.equal(client.socket.protocols, undefined);
  assert.equal(client.url.includes('token'), false);
  client.close();
  for (const patch of [{ authRequired: true }, { dashboardOrigin: 'https://other.example' }, { loopbackToken: 'bad' }]) {
    const rejected = new SessionRpcClient({ ...options, ticketProvider: async () => ({ ...credential, ...patch }) });
    await assert.rejects(rejected.connect(), error => error.message === 'RPC connection failed');
  }
  class ThrowingSocket { constructor(url) { throw new Error(url); } }
  const rejected = new SessionRpcClient({ ...options, ticketProvider: async () => credential, WebSocketImpl: ThrowingSocket });
  await assert.rejects(rejected.connect(), error => !error.message.includes(credential.loopbackToken));
});

test('transport close reports disconnect once immediately', async () => {
  let disconnected = 0;
  const client = new SessionRpcClient({ ...options, onDisconnect: () => { disconnected++; } });
  await client.connect();
  client.socket.close(); client.close();
  assert.equal(disconnected, 1);
});
