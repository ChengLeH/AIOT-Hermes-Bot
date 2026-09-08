import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createPushService, validPushSubscription } from './aiot-push-service.mjs';
import { createPrivateStateCipher } from './aiot-private-state.mjs';
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/mock', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
test('push endpoint validation rejects local, arbitrary and credential URLs', () => {
  assert.equal(validPushSubscription(sub), true);
  assert.equal(validPushSubscription({...sub, endpoint: "https://jmt17.google.com/fcm/send/mock"}), true);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://example.com/a', 'https://fcm.googleapis.com.attacker.com/a', 'https://user@fcm.googleapis.com/a']) assert.equal(validPushSubscription({ ...sub, endpoint }), false);
});
test('authenticated enrollment skips history; delivers private events once and persists cursor', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-push-'));
  let events = [{seq:1, kind:'complete', profile:'demo', conversation:'session', event_id:'old'}];
  const sent = [];
  let failDelivery = false, failEvents = false;
  const fetchImpl = async (url, options) => failEvents && url.includes('/events') ? {ok:false,status:404} : options.headers.Authorization !== 'Bearer valid' ? {ok:false,status:401} : url.includes('/native/events') ? {ok:false,status:404} : {ok:true,json:async()=> url.includes('/profiles') ? {profiles:[]} : {events:events.filter(e=>e.seq>Number(new URL(url).searchParams.get('after')))}};
  const service = createPushService({dataDir,fetchImpl,send:async(s,p)=>{if(failDelivery) throw new Error("offline"); sent.push(JSON.parse(p));},pollMs:999999});
  const call = async (action, body={}, auth='Bearer valid') => {
    const req=Readable.from([JSON.stringify(body)]); req.url='/api/pwa/push/'+action; req.method=action==='status'?'GET':'POST'; req.headers={authorization:auth};
    let code, result; await service.handle(req,{writeHead:c=>code=c,end:r=>result=JSON.parse(r)},'http://hermes.test/api/bot'); return {code,result};
  };
  try {
    assert.equal((await call('status',{},'Bearer wrong')).code,401);
    assert.equal((await call('status')).result.publicKey.length,87);
    failEvents=true; assert.equal((await call('status')).result.sourceReady,false); failEvents=false;
    const enrolled=await call('subscribe',{subscription:sub}); assert.equal(enrolled.code,200); assert.equal(sent.length,0);
    assert.equal(statSync(join(dataDir,'push-private.json')).mode&0o777,0o600);
    events.push({seq:2,kind:'typing',payload:{text:'private'}},{seq:3,kind:'complete',profile:'demo',conversation:'session',event_id:'new',payload:{text:'secret answer'}},{seq:4,kind:'approval_request',profile:'demo',conversation:'session',event_id:'approve',payload:{command:'secret command'}});
    await service.tick(); await service.tick(); assert.equal(sent.length,2); assert.ok(!JSON.stringify(sent).includes('secret'));
    const saved = createPrivateStateCipher({ dataDir }).read(() => ({}));
    assert.equal(saved.sources[Object.keys(saved.sources)[0]].cursor,4);
    failDelivery=true; events.push({seq:5,kind:'complete',profile:'demo',conversation:'session',event_id:'retry'});
    await Promise.all([service.tick(),service.tick()]); assert.equal(sent.length,2);
    failDelivery=false; await service.tick(); await service.tick(); assert.equal(sent.length,3);
    assert.equal((await call('test',{id:'unknown'})).code,404);
    assert.equal((await call('test',{id:enrolled.result.id})).code,200);
    assert.equal((await call('unsubscribe',{id:enrolled.result.id})).code,200);
  } finally {service.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('restarted service resumes persisted subscriptions without a browser request', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-push-restart-'));
  const events = [];
  const sent = [];
  const options = {
    dataDir, pollMs: 10,
    fetchImpl: async url => url.includes('/native/events') ? {ok:false,status:404} : ({ ok: true, json: async () => url.includes('/profiles') ? {profiles: []} : {events: events.filter(e => e.seq > Number(new URL(url).searchParams.get('after')))} }),
    send: async (_sub, payload) => sent.push(JSON.parse(payload)),
  };
  let service = createPushService(options);
  try {
    const req = Readable.from([JSON.stringify({subscription: sub})]);
    req.url = '/api/pwa/push/subscribe'; req.method = 'POST'; req.headers = {authorization: 'Bearer test'};
    await service.handle(req, {writeHead: code => assert.equal(code, 200), end() {}}, 'http://hermes.test/api/bot');
    service.close();
    events.push({seq: 1, kind: 'approval_request', profile: 'demo', conversation: 'chat', event_id: 'approval'});
    service = createPushService(options);
    const deadline = Date.now() + 1000;
    while (!sent.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'approval_request');
    assert.equal(sent[0].body, 'Approval requested');
  } finally { service.close(); rmSync(dataDir, {recursive: true, force: true}); }
});

test('official Runs completion and approval events use the existing notification channel', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-push-native-'));
  const native = [];
  const sent = [];
  const service = createPushService({ dataDir, pollMs: 999999,
    nativeEvents: async after => ({ events: native.filter(event => event.seq > after) }),
    fetchImpl: async url => {
      assert.equal(url.includes('/native/events'), false, 'native events are local AIOT state, not a Hermes route');
      return { ok: true, json: async () => url.includes('/profiles') ? {profiles: []} : {events: []} };
    },
    send: async (_sub, payload) => sent.push(JSON.parse(payload)),
  });
  try {
    const req = Readable.from([JSON.stringify({subscription: sub})]);
    req.url = '/api/pwa/push/subscribe'; req.method = 'POST'; req.headers = {authorization: 'Bearer test'};
    await service.handle(req, {writeHead: code => assert.equal(code, 200), end() {}}, 'http://hermes.test/api/bot');
    native.push({source:'native-runs',seq:1,kind:'approval_request',profile:'demo',conversation:'chat',event_id:'run-1',payload:{request_id:'request'}});
    native.push({source:'native-runs',seq:2,kind:'turn_complete',profile:'demo',conversation:'chat',event_id:'run-1',payload:{outcome:'success'}});
    await service.tick();
    assert.deepEqual(sent.map(item => item.kind), ['approval_request', 'complete']);
    assert.equal(JSON.stringify(sent).includes('req-12345678'), false);
  } finally { service.close(); rmSync(dataDir, {recursive: true, force: true}); }
});

test('actual Hermes turn completion notifies once across legacy events and restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-push-turn-'));
  const events = [];
  const sent = [];
  const append = (kind, event_id, payload = {}) => events.push({seq: events.length + 1, kind, event_id, profile: 'demo', conversation: 'chat', payload});
  const options = {
    dataDir, pollMs: 999999,
    fetchImpl: async url => url.includes('/native/events') ? {ok:false,status:404} : ({ok: true, json: async () => url.includes('/profiles') ? {profiles: []} : {events: events.filter(e => e.seq > Number(new URL(url).searchParams.get('after')))}}),
    send: async (_sub, payload) => sent.push(JSON.parse(payload)),
  };
  append('turn_complete', 'historical', {outcome: 'success', notify: false});
  let service = createPushService(options);
  try {
    const req = Readable.from([JSON.stringify({subscription: sub})]);
    req.url = '/api/pwa/push/subscribe'; req.method = 'POST'; req.headers = {authorization: 'Bearer test'};
    await service.handle(req, {writeHead: code => assert.equal(code, 200), end() {}}, 'http://hermes.test/api/bot');
    append('complete', 'historical');
    append('turn_start', 'actual', {notify: false});
    append('edit', 'actual', {finalize: true, text: 'private answer', notify: false});
    await service.tick();
    assert.equal(sent.length, 0, 'edits and enrollment history must not notify');
    append('turn_complete', 'actual', {outcome: 'success', notify: false});
    await service.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body, 'New reply');
    assert.equal(sent[0].kind, 'complete');
    assert.equal(sent[0].sessionId, 'chat');
    assert.ok(!JSON.stringify(sent).includes('private answer'));
    service.close(); service = createPushService(options);
    append('complete', 'actual');
    append('turn_complete', 'failed', {outcome: 'failure'});
    append('turn_complete', 'cancelled', {outcome: 'cancelled'});
    append('complete', 'failed');
    await service.tick();
    assert.equal(sent.length, 1, 'restart keeps turn deduplication; failures are not replies');
    append('complete', 'legacy-first');
    await service.tick();
    append('turn_complete', 'legacy-first', {outcome: 'success'});
    await service.tick();
    assert.equal(sent.length, 2, 'either terminal order delivers only once');
    append('turn_complete', 'next', {outcome: 'success', notify: false});
    await service.tick();
    assert.equal(sent.length, 3, 'the next turn in the same conversation still notifies');
  } finally {service.close(); rmSync(dataDir, {recursive: true, force: true});}
});

test('foreground leases suppress only that device, release per tab, and expire safely', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-presence-'));
  const sent = []; let clock = 0;
  const service = createPushService({ dataDir, now: () => clock, pollMs: 999999,
    fetchImpl: async url => url.includes('/native/events') ? {ok:false,status:404} : ({ok:true,json:async()=>url.includes('/profiles')?{profiles:[]}:{events:[]}}),
    send: async s => sent.push(s.endpoint) });
  const call = async (action, body) => {
    const req = Readable.from([JSON.stringify(body)]); req.url='/api/pwa/push/'+action;req.method='POST';req.headers={authorization:'Bearer test'};
    let code,result;await service.handle(req,{writeHead:c=>code=c,end:r=>result=JSON.parse(r)},'http://hermes.test/api/bot');return {code,...result};
  };
  try {
    const a = await call('subscribe',{subscription:sub});
    const b = await call('subscribe',{subscription:{...sub,endpoint:sub.endpoint+'-second'}});
    assert.equal((await call('presence',{id:a.id,clientId:'tab-one-123',visible:true})).code,200);
    await call('test',{id:a.id});await call('test',{id:b.id});assert.deepEqual(sent,[sub.endpoint+'-second']);
    await call('presence',{id:a.id,clientId:'tab-two-123',visible:true});
    await call('presence',{id:a.id,clientId:'tab-one-123',visible:false});
    await call('test',{id:a.id});assert.equal(sent.length,1);
    await call('presence',{id:a.id,clientId:'tab-two-123',visible:false});
    await call('test',{id:a.id});assert.equal(sent.length,2);
    await call('presence',{id:a.id,clientId:'tab-one-123',visible:true});clock=15001;
    await call('test',{id:a.id});assert.equal(sent.length,3);
    assert.equal((await call('presence',{id:a.id,clientId:'x',visible:true})).code,400);
    assert.equal((await call('presence',{id:'unknown',clientId:'tab-one-123',visible:true})).code,404);
  } finally {service.close();rmSync(dataDir,{recursive:true,force:true});}
});
