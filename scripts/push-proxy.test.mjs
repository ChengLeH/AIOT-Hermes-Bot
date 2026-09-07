import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
const original = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'aiot-proxy-test-'));
process.chdir(scratch);
const { aiotHermesProxyPlugin } = await import('./aiot-hermes-proxy.mjs');
process.chdir(original);
test('AIOT handles notifications locally and authenticates against Hermes', async () => {
  const upstream = createServer((req,res) => {
    res.setHeader('content-type','application/json');
    assert.equal(req.headers.authorization, 'Bearer synthetic-test');
    assert.ok(['/api/bot/profiles', '/api/bot/events?after=0'].includes(req.url));
    res.end(JSON.stringify(req.url.includes('profiles') ? {profiles:[]} : {events:[]}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  mkdirSync(join(scratch,'.aiot'));
  writeFileSync(join(scratch,'.aiot/runtime.json'),JSON.stringify({hermesBotTarget:`http://127.0.0.1:${upstream.address().port}/api/bot`}));
  let handler; const lifecycle = new EventEmitter();
  const plugin = aiotHermesProxyPlugin();
  plugin.configurePreviewServer({httpServer:lifecycle,middlewares:{use(h){handler=h;}}});
  assert.equal(existsSync(join(scratch,".aiot/push-private.json")),true,"push must initialize before any browser request");
  const proxy=createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${proxy.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/pwa/push/status`)).status,401);
    const res = await fetch(`${base}/api/pwa/push/status`, {headers:{authorization:'Bearer synthetic-test'}});
    assert.equal(res.status,200);
    const body = await res.json();
    assert.ok(body.publicKey);
    assert.equal(body.subscriptions,0);
    assert.equal((await fetch(`${base}/api/pwa/push/unknown`)).status,404);
  } finally {
    lifecycle.emit("close");
    proxy.closeAllConnections();upstream.closeAllConnections();proxy.close();upstream.close();rmSync(scratch,{recursive:true});
  }
});
