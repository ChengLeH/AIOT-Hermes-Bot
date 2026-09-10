import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRunContext} from './aiot-run-context.mjs';
const ep={base:'http://localhost/p/demo',headers:{Authorization:'Bearer test'}};
test('restores previous question and answer from the same profile and session',async()=>{
 const history=await loadRunContext(async(url,options)=>{
  assert.equal(url,'http://localhost/p/demo/api/sessions/chat-one/messages?order=latest&limit=7');
  assert.equal(options.headers,ep.headers);
  return Response.json({data:[{role:'user',content:'Remember amber-42'},{role:'assistant',content:'I will remember amber-42'},{role:'tool',content:'private tool trace'},{role:'assistant',content:[{type:'text',text:'Done'},{type:'thinking',text:'private reasoning'}]}]});
 },ep,'chat-one');
 assert.deepEqual(history,[{role:'user',content:'Remember amber-42'},{role:'assistant',content:'I will remember amber-42'},{role:'assistant',content:'Done'}]);
});
test('does not silently start an empty conversation on history failures',async()=>{
 for(const response of [new Response('',{status:404}),new Response('',{status:503}),Response.json({})]) await assert.rejects(loadRunContext(async()=>response,ep,'chat'),/context_unavailable/);
});
test('rejects oversized context rather than silently dropping previous turns',async()=>{
 await assert.rejects(loadRunContext(async()=>Response.json({data:[{role:'user',content:'x'.repeat(256*1024)}]}),ep,'chat'),/context_too_large/);
});
test('native run context is the latest 7 public turns',async()=>{
 const history=await loadRunContext(async(url)=>{
  assert.match(String(url),/limit=7/);
  return Response.json({data:Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:`m${i}`}))});
 },ep,'chat');
 assert.deepEqual(history.map((row)=>row.content),['m5','m6','m7','m8','m9','m10','m11']);
});
