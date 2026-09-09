import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const script = readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
for (const [name,windows,expected,tag] of [
  ['foreground',[{url:'https://app.test/',visibilityState:'visible'}],0],
  ['manual test in foreground',[{url:'https://app.test/',visibilityState:'visible'}],1,'aiot:test'],
  ['background',[{url:'https://app.test/',visibilityState:'hidden'}],1],
  ['closed',[],1],
  ['other origin',[{url:'https://other.test/',visibilityState:'visible'}],1],
]) test(`push ${name} notification policy`,async()=>{
  const handlers={},notices=[],messages=[];
  runInNewContext(script,{URL,self:{location:{origin:'https://app.test'},addEventListener:(k,f)=>handlers[k]=f,
    clients:{matchAll:async()=>windows.map(w=>({...w,postMessage:m=>messages.push(m)}))},
    registration:{showNotification:async(...args)=>notices.push(args)}}});
  let pending;handlers.push({data:{json:()=>({kind:'complete',profile:'demo',tag})},waitUntil:p=>pending=p});await pending;
  assert.equal(notices.length,expected);assert.equal(messages.length,expected?0:1);
});
