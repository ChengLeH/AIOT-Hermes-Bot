import { createHash } from 'node:crypto';
import { createPrivateStateCipher } from './aiot-private-state.mjs';
import { createSessionAuth } from './aiot-session-auth.mjs';
import { createSessionRpcClient } from './aiot-session-rpc.mjs';
import { createTaskSessions } from './aiot-task-sessions.mjs';

const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const json = (res, status, data) => { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(data)); };
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const hasControlCharacter = value => [...value].some(character => { const code=character.charCodeAt(0); return code <= 31 || code === 127; });
const FILE_MIMES = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** Download only existing Bot upload IDs under the caller's verified connection. */
export async function resolveSessionAttachments({ attachments, target, authorization, fetchImpl = fetch }) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 5) throw new Error('invalid_attachments');
  const ids = attachments.map(item => typeof item === 'string' ? item : item?.id);
  if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid_attachment_id');
  const result = [];
  for (const id of ids) {
    const endpoint = `${target.replace(/\/$/, '')}/attachments/${encodeURIComponent(id)}`;
    const response = await fetchImpl(endpoint, { headers: { Authorization: authorization, Accept: '*/*' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok || response.redirected || (response.url && response.url !== endpoint)) throw new Error('attachment_unavailable');
    const disposition = response.headers.get('content-disposition') || '';
    const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    const plain = disposition.match(/filename\s*=\s*(?:"([^"\r\n]*)"|([^;\s]+))/i);
    const name = encoded ? decodeURIComponent(encoded[1].trim()) : plain?.[1] || plain?.[2] || '';
    if (!name || name.length > 240 || hasControlCharacter(name) || /[/\\]/.test(name) || name === '.' || name === '..') throw new Error('invalid_attachment_name');
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'heic' || ext === 'heif') throw new Error('session_heic_unsupported');
    const expectedMime = FILE_MIMES[ext];
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!expectedMime || (mime !== expectedMime && mime !== 'application/octet-stream' && !(ext === 'md' && mime === 'text/plain'))) throw new Error('unsupported_attachment_type');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_ATTACHMENT_BYTES || !response.body?.getReader) throw new Error('attachment_too_large');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_ATTACHMENT_BYTES) throw new Error('attachment_too_large');
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (!size) throw new Error('attachment_empty');
    const bytes = Buffer.concat(chunks);
    if (expectedMime.startsWith('image/')) {
      const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : ['jpg', 'jpeg'].includes(ext) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : ext === 'gif' ? /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!valid) throw new Error('invalid_image_bytes');
    }
    result.push({ id, name, mime: expectedMime, size, bytes });
  }
  return result;
}
async function body(req) {
  let text=''; for await (const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>65536) throw new Error('request_too_large'); }
  return text ? JSON.parse(text) : {};
}
export function createSessionService({dataDir, fetchImpl=fetch, rpcClientFactory=createSessionRpcClient}) {
  const cipher=createPrivateStateCipher({dataDir,fileName:'task-sessions.json'});
  let state=cipher.read(()=>({tasks:[],auth:{}}));
  const save=()=>cipher.write(state);
  const clients=new Map();
  const connecting=new Map();
  let closed=false;
  const auth=createSessionAuth({
    read: owner=>state.auth?.[owner],
    write:(owner,record)=>{state.auth ||= {}; if(record) state.auth[owner]=record; else delete state.auth[owner]; save();}, fetchImpl,
  });
  const runtime=createTaskSessions({
    readState:()=>state,
    writeState:value=>{
      const remaining = new Set(value.tasks.map(task=>`${task.owner}\n${task.id}`));
      const removed = new Set((state.tasks||[]).filter(task=>!remaining.has(`${task.owner}\n${task.id}`)).map(task=>`${task.owner}\n${task.id}`));
      const previous=state;
      state={...state,tasks:value.tasks,deletedTasks:value.deletedTasks,...(removed.size?{reports:(state.reports||[]).filter(report=>!removed.has(`${report.owner}\n${report.taskId}`))}: {})};
      try { save(); } catch(error) { state=previous; throw error; }
    },
    getClient:async owner=>{
      if(closed) throw new Error('service_closed');
      if(clients.get(owner)?.closed===false) return clients.get(owner);
      clients.delete(owner);
      if(connecting.has(owner)) return connecting.get(owner);
      const promise=(async()=>{
        const status=await auth.status(owner);
        if(!status.authenticated) throw new Error('session_login_required');
        const client=rpcClientFactory({dashboardBase:status.dashboardOrigin,maxFrameBytes:15*1024*1024,ticketProvider:()=>auth.ticket(owner),onDisconnect:()=>{if(clients.get(owner)!==client)return;clients.delete(owner);return runtime.connectionLost(owner);},onEvent:event=>{if(clients.get(owner)!==client)return;void runtime.onEvent(owner,event).catch(()=>{client.close();clients.delete(owner);void runtime.connectionLost(owner).catch(()=>{});});}});
        try { await client.connect(); if(closed) throw new Error('service_closed'); } catch { client.close(); throw new Error('session_connection_failed'); }
        clients.set(owner,client);return client;
      })();
      connecting.set(owner,promise);
      try{return await promise;}finally{connecting.delete(owner);}
    },
    onApprovalRequested:async task=>{
      if((state.reports||[]).some(event=>event.owner===task.owner&&event.approvalKey===task.approvalKey)) return;
      const reportSeq=(state.reportSeq||0)+1;
      const report={owner:task.owner,approvalKey:task.approvalKey,seq:reportSeq,
        profile:task.profile,conversation:task.parentConversation,kind:'approval_request',
        event_id:`approval-${task.approvalKey}`,taskId:task.id,payload:{request_id:task.requestId}};
      const previous=state;
      state={...state,reportSeq,reports:[...(state.reports||[]),report].slice(-2000)};
      try { save(); } catch(error) { state=previous;throw error; }
    },
    onCompleted:async task=>{
      if((state.reports||[]).some(e=>e.completionKey===task.completionKey && e.owner===task.owner)) return;
      const reportSeq=(state.reportSeq||0)+1;
      const report={owner:task.owner,completionKey:task.completionKey,seq:reportSeq,profile:task.profile,conversation:task.parentConversation,kind:'turn_complete',event_id:`task-${task.id}-${Date.now()}`,payload:{outcome:'success'},taskId:task.id,title:task.title};
      const previous=state;
      state={...state,reportSeq,reports:[...(state.reports||[]),report].slice(-2000)};
      try { save(); } catch(error) { state=previous;throw error; }
    },
  });
  let maintaining=false;
  async function maintain() {
    if(closed||maintaining)return;
    maintaining=true;
    try {
      await Promise.all([...clients].map(async ([owner,client])=>{
        try { await client.request('gateway.ping',{}); }
        catch { if(clients.get(owner)===client){clients.delete(owner);client.close();await runtime.connectionLost(owner);} }
      }));
      await runtime.reconcile();
      await runtime.flushCompletions();
    } catch { /* Next bounded maintenance pass retries; never terminate the server. */ }
    finally { maintaining=false; }
  }
  const timer=setInterval(()=>{void maintain();},15000);
  queueMicrotask(()=>{void maintain();});
  timer.unref?.();
  function resultContext(target,authorization,profile,parentConversation) {
    const owner=createHash('sha256').update(`${target}\n${authorization}`).digest('hex');
    const completed=(state.tasks||[]).filter(task=>task.owner===owner&&task.profile===profile&&task.parentConversation===parentConversation&&task.status==='completed'&&!task.deletion)
      .map(task=>({task,final:(task.messages||[]).findLast(message=>message?.role==='assistant'&&typeof (message.text??message.content)==='string'&&(message.text??message.content).trim())}))
      .filter(item=>item.final)
      .sort((a,b)=>Date.parse(b.task.terminalAt||b.task.updatedAt||b.task.createdAt||0)-Date.parse(a.task.terminalAt||a.task.updatedAt||a.task.createdAt||0))
      .slice(0,8);
    const messages=[]; let bytes=0;
    for(const {task,final} of completed) {
      const excerpt=String(final.text??final.content).slice(0,1500);
      const content=`Completed Session task reference (${String(task.title||task.id).slice(0,200)}):\n${excerpt}`;
      const size=Buffer.byteLength(content,'utf8');
      if(bytes+size>12_000) continue;
      messages.push({role:'assistant',content}); bytes+=size;
    }
    return messages;
  }
  return {
    async handle(req,res,target) {
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/__aiot/session-callback') {
        if(!loopback(req)) return json(res,403,{error:'desktop_setup_required'});
        try { const logged=await auth.finish({code:url.searchParams.get('code'),state:url.searchParams.get('state')}); clients.get(logged.owner)?.close();clients.delete(logged.owner); await runtime.connectionLost(logged.owner);
          res.writeHead(303,{location:'/?session_login=complete','cache-control':'no-store','referrer-policy':'no-referrer'});return res.end();
        } catch { return json(res,400,{error:'session_login_failed'}); }
      }
      try {
        const authorization=req.headers.authorization;
        if(typeof authorization!=='string'||!/^Bearer \S+$/.test(authorization)) return json(res,401,{error:'connection_required'});
        const response=await fetchImpl(`${target.replace(/\/$/,'')}/profiles`,{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(6000)});
        if(!response.ok) return json(res,response.status===401?401:503,{error:'connection_unavailable'});
        const catalog=await response.json();
        if(!Array.isArray(catalog.profiles)) return json(res,503,{error:'invalid_profiles'});
        const owner=createHash('sha256').update(`${target}\n${authorization}`).digest('hex');
        const input=req.method==='POST'?await body(req):Object.fromEntries(url.searchParams);
        const action=url.pathname.split('/').pop();
        if(action==='status') return json(res,200,await auth.status(owner));
        if(action==='login') {
          if(!loopback(req)||!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||'')) return json(res,400,{error:'desktop_setup_required'});
          const result=await auth.start({owner,dashboardOrigin:input.dashboardOrigin,callbackUrl:`http://${req.headers.host}/__aiot/session-callback`,provider:input.provider});
          return json(res,200,result);
        }
        if(typeof input.botId!=='string'||!input.botId.trim()) return json(res,400,{error:'invalid_botId'});
        if(!catalog.profiles.some(p=>p.name===input.profile)) return json(res,403,{error:'profile_unavailable'});
        if(action==='delete'&&req.method==='POST') return json(res,200,await runtime.delete({owner,ids:input.ids,botId:input.botId,profile:input.profile}));
        if(action==='list') return json(res,200,{tasks:await runtime.list({owner,botId:input.botId,profile:input.profile})});
        if(action==='create'&&req.method==='POST') {
          const attachments=await resolveSessionAttachments({attachments:input.attachments,target,authorization,fetchImpl});
          return json(res,200,{task:await runtime.create({owner,botId:input.botId,profile:input.profile,parentConversation:input.parentConversation,title:input.title || String(input.text||'').slice(0,60),text:input.text,attachments,requestId:input.requestId,mode:input.mode,context:input.context})});
        }
        const task=await runtime.get({owner,id:input.id,botId:input.botId,profile:input.profile});
        if(task.botId!==input.botId||task.profile!==input.profile) return json(res,404,{error:'task_not_found'});
        if(action==='detail') {
          if(task.pendingApproval?.kind==='approval') {
            try { task.pendingApproval.timeoutSeconds=await auth.approvalTimeout(owner,input.profile); } catch { /* Official config is optional; never expose its failure. */ }
          }
          return json(res,200,{task});
        }
        if(action==='clarify'&&req.method==='POST') return json(res,200,{task:await runtime.clarify({owner,id:input.id,botId:input.botId,profile:input.profile,text:input.text,questionId:input.questionId,attachments:input.attachments})});
        if(action==='approval'&&req.method==='POST') return json(res,200,{task:await runtime.respondApproval({owner,id:input.id,botId:input.botId,profile:input.profile,decision:input.decision})});
        if(action==='interrupt'&&req.method==='POST') return json(res,200,{task:await runtime.interrupt({owner,id:input.id,botId:input.botId,profile:input.profile})});
        if(action==='reply'&&req.method==='POST') {
          const attachments=await resolveSessionAttachments({attachments:input.attachments,target,authorization,fetchImpl});
          return json(res,200,{task:await runtime.reply({owner,id:input.id,botId:input.botId,profile:input.profile,text:input.text,attachments,requestId:input.requestId})});
        }
        return json(res,404,{error:'not_found'});
      } catch (error) {
        if (['invalid_task_ids','invalid_botId','invalid_profile','invalid_request_id','task_clarify_attachments_unsupported'].includes(error.message)) return json(res,400,{error:error.message});
        if (error.message === 'task_not_found') return json(res,404,{error:'task_not_found'});
        if (error.message === 'task_attachment_outcome_unknown') return json(res,409,{error:'task_attachment_outcome_unknown'});
        if (error.message === 'task_submit_outcome_unknown') return json(res,409,{error:'task_submit_outcome_unknown'});
        if (error.message === 'task_must_stop_first') return json(res,409,{error:'task_must_stop_first'});
        if (error.message === 'task_request_conflict') return json(res,409,{error:'task_request_conflict'});
        if (['invalid_task_mode','invalid_task_context','independent_context_forbidden','task_context_too_large'].includes(error.message)) return json(res,400,{error:error.message});
        const safe = new Set(['session_heic_unsupported','invalid_attachments','invalid_attachment_id','attachment_unavailable','invalid_attachment_name','unsupported_attachment_type','attachment_too_large','attachment_empty','invalid_image_bytes','task_attachment_rejected','invalid_attachment_reference']);
        return json(res,safe.has(error.message)?400:502,{error:safe.has(error.message)?error.message:'session_operation_failed'});
      }
    },
    isTaskEventCurrent(payload,target,authorization){
      const owner=createHash('sha256').update(`${target}\n${authorization}`).digest('hex');
      return runtime.taskEventIsCurrent({...payload,owner});
    },
    events(after,target,authorization){
      const owner=createHash('sha256').update(`${target}\n${authorization}`).digest('hex');
      return {events:(state.reports||[]).filter(e=>e.owner===owner&&e.seq>after&&(e.kind!=='approval_request'||runtime.approvalIsCurrent({owner,id:e.taskId,requestId:e.payload?.request_id}))).map(({owner:_owner,...event})=>event)};
    },
    resultContext,
    close(){closed=true;clearInterval(timer);for(const c of clients.values())c.close();clients.clear();},
  };
}
