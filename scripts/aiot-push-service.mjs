import webpush from 'web-push';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createPrivateStateCipher } from './aiot-private-state.mjs';

export function validPushSubscription(sub) {
  try {
    const url = new URL(sub.endpoint);
    const host = url.hostname;
    const allowed = (host === 'fcm.googleapis.com' || host === 'jmt17.google.com') || host === 'updates.push.services.mozilla.com' ||
      host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
    return allowed && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      /^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh || '') && /^[A-Za-z0-9_-]{20,30}$/.test(sub.keys?.auth || '');
  } catch { return false; }
}

/** Local AIOT service; stores credentials only in its private data directory. */
export function createPushService({ dataDir, fetchImpl = fetch, send = webpush.sendNotification.bind(webpush), pollMs = 3000, eventTimeoutMs = 10_000, now = Date.now, nativeEvents, taskEvents, taskNotificationCurrent } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stateCipher = createPrivateStateCipher({ dataDir });
  const state = stateCipher.read(() => ({ vapid: webpush.generateVAPIDKeys(), sources: {} }));
  const save = () => stateCipher.write(state);
  save();
  const presence = new Map(); // Ephemeral device/tab leases; never persist across restarts.
  const sourceLoads = new WeakMap(); // Source-object keyed only; never retain untrusted identifiers.
  let queue = Promise.resolve();
  const serial = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const request = async (source, path) => {
    const response = await fetchImpl(`${source.target.replace(/\/$/, '')}/${path}`, { headers: { Authorization: source.authorization }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error('Hermes connection unavailable'), { status: response.status });
    return response.json();
  };
  const presenceKey = (source, endpoint) => createHash('sha256').update(source.target + '\n' + source.authorization + '\n' + endpoint).digest('hex');
  const taskMode = event => ['independent', 'fork'].includes(event.taskMode) ? event.taskMode : ['independent', 'fork'].includes(event.payload?.mode) ? event.payload.mode : '';
  function preview(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '').replace(/^\s*(?:tool|function|@(?:file|image):).*$/gim, ' ').replace(/[\r\n]+/g, ' ')
      .replace(/(?:file:\/\/|https?:\/\/|~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])[^\s<>(){}[\]]+/gi, '')
      .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b(?:\s*[:=]\s*|\s+)\S+/gi, '')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, '')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '')
      .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b/gi, '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function localizedBody(payload, locale) {
    const zh = locale === 'zh-Hant'; const mode = payload.taskMode;
    const base = payload.kind === 'approval_request'
      ? mode === 'fork' ? (zh ? '分支任務需要你批准' : 'Forked task needs approval') : mode === 'independent' ? (zh ? '獨立任務需要你批准' : 'Independent task needs approval') : (zh ? '需要你批准' : 'Approval requested')
      : mode === 'fork' ? (zh ? '分支任務已完成' : 'Forked task complete') : payload.taskId ? (zh ? '獨立任務已完成' : 'Independent task complete') : (zh ? '有新的回覆' : 'New reply');
    return payload.preview ? `${base}：${payload.preview}` : base;
  }
  function removeSubscription(source, id) {
    const sub = source.subscriptions[id];
    if (sub) presence.delete(presenceKey(source, sub.endpoint));
    delete source.subscriptions[id];
    if (source.localeBySubscription) delete source.localeBySubscription[id];
    for (const item of source.pending || []) item.ids = item.ids.filter(value => value !== id);
    if (!Object.keys(source.subscriptions).length) sourceLoads.delete(source);
  }
  async function deliver(source, id, payload, { ignorePresence = false } = {}) {
    const sub = source.subscriptions[id];
    if (!sub || !validPushSubscription(sub)) return false;
    const leases = presence.get(presenceKey(source, sub.endpoint));
    if (leases && !ignorePresence) {
      for (const [client, expires] of leases) if (expires <= now()) leases.delete(client);
      if (leases.size) return true; // Consumed by the foreground event stream, not deferred.
      presence.delete(presenceKey(source, sub.endpoint));
    }
    try {
      const locale = source.localeBySubscription?.[id] === 'zh-Hant' ? 'zh-Hant' : 'en';
      const localized = { ...payload, locale };
      if (payload.kind === 'approval_request' || payload.kind === 'complete') localized.body = localizedBody(payload, locale);
      await send(sub, JSON.stringify(localized), { TTL: 300, timeout: 10000, vapidDetails: { subject: 'https://github.com/ChengLeH/AIOT-Hermes-Bot', ...state.vapid } });
      return true;
    } catch (error) {
      source.failedDeliveries = (source.failedDeliveries || 0) + 1;
      if (error.statusCode === 404 || error.statusCode === 410) removeSubscription(source, id);
      return false;
    }
  }
  function processEvent(source, event, notify) {
    source.pending ||= [];
    const requestId = event.requestId || event.payload?.request_id;
    if (['approval_resolved', 'approval_expired', 'turn_complete', 'complete'].includes(event.kind)) {
      source.pending = source.pending.filter(item => item.payload.kind !== 'approval_request' ||
        item.payload.profile !== event.profile || item.payload.sessionId !== event.conversation ||
        (event.taskId ? item.payload.taskId !== event.taskId : Boolean(item.payload.taskId)) ||
        (event.kind.startsWith('approval_') && (!requestId || item.payload.requestId !== requestId)));
    }
    const completion = event.kind === 'complete' || event.kind === 'turn_complete';
    // Hermes' notify flag controls its native notifier, not the user's AIOT subscription.
    // Both protocol versions can announce the same turn; persist their shared identity
    // even during enrollment so a later legacy terminal cannot replay skipped history.
    const turnId = JSON.stringify([event.profile, event.conversation, event.event_id || `${event.source || 'legacy'}:${event.seq}`]);
    source.completedTurns ||= [];
    const duplicate = completion && source.completedTurns.includes(turnId);
    if (completion && !duplicate) {
      source.completedTurns.push(turnId);
      source.completedTurns = source.completedTurns.slice(-2048);
    }
    const successful = completion && (!event.payload?.outcome || event.payload.outcome === 'success');
    if (notify && (event.kind === 'approval_request' || (successful && !duplicate))) {
      const kind = event.kind === 'approval_request' ? 'approval_request' : 'complete';
      const payload = { title: 'aiot', body: kind === 'approval_request' ? 'Approval requested' : 'New reply', kind, profile: event.profile, sessionId: event.conversation, tag: `aiot:${kind}:${event.profile}:${event.conversation}:${event.event_id || event.seq}` };
      if (typeof event.taskId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(event.taskId)) payload.taskId = event.taskId;
      const mode = taskMode(event); if (mode) payload.taskMode = mode;
      const text = preview(event.payload?.text || event.payload?.output || event.payload?.summary); if (text) payload.preview = text;
      if (kind === 'approval_request' && typeof requestId === 'string') payload.requestId = requestId;
      source.pending.push({ payload, ids: Object.keys(source.subscriptions) });
    }
  }
  async function eventPage(source, channel, load) {
    let loads = sourceLoads.get(source);
    if (!loads) { loads = new Map(); sourceLoads.set(source, loads); }
    let pending = loads.get(channel);
    if (!pending) {
      pending = Promise.resolve().then(load);
      loads.set(channel, pending);
      void pending.finally(() => {
        if (loads.get(channel) !== pending) return;
        loads.delete(channel); if (!loads.size) sourceLoads.delete(source);
      }).catch(() => {});
    }
    let timeout;
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Notification source timed out')), eventTimeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function drainChannel(source, notify, path, cursorKey, optional = false) {
    for (let page = 0; page < 1000; page++) {
      let data;
      try {
        data = await eventPage(source, cursorKey, () => path === 'task/events' && taskEvents ? taskEvents(source[cursorKey] || 0, source.target, source.authorization) : path === 'native/events' && nativeEvents
          ? nativeEvents(source[cursorKey] || 0)
          : request(source, `${path}?after=${source[cursorKey] || 0}`));
      }
      catch (error) { if (optional && error.status === 404) return; throw error; }
      if (!Array.isArray(data.events)) throw new Error('Invalid Hermes events response');
      for (const event of data.events) {
        if (!Number.isSafeInteger(event.seq) || event.seq <= (source[cursorKey] || 0)) continue;
        source[cursorKey] = event.seq;
        processEvent(source, event, notify);
        save();
      }
      if (data.events.length < 100) return;
    }
    throw new Error('Hermes event backlog is still loading');
  }
  async function drain(source, notify) {
    // Independent channels must not block one another. Enrollment still requires
    // every available channel to catch up before enabling notifications.
    const channels = [
      drainChannel(source, notify, 'events', 'cursor'),
      drainChannel(source, notify, 'native/events', 'nativeCursor', true),
      ...(taskEvents ? [drainChannel(source, notify, 'task/events', 'taskCursor', true)] : []),
    ];
    const results = await Promise.allSettled(channels);
    // The Bot event feed is the required notification source. Official Runs and
    // Session task feeds add richer events, but older Hermes installs may not
    // expose them and must not prevent a browser from enrolling.
    source.sourceReady = results[0]?.status === 'fulfilled';
    if (!source.sourceReady && !notify) throw new Error('Notification history unavailable');
  }
  async function flush(source, approvals = true) {
    for (const item of source.pending || []) {
      if (item.payload.kind === 'approval_request' && (!approvals || (!item.payload.taskId && !source.sourceReady))) continue;
      if (item.payload.taskId && taskNotificationCurrent) {
        let current;
        try { current = await eventPage(source, `current:${item.payload.taskId}`, () => taskNotificationCurrent(item.payload, source.target, source.authorization)); }
        catch { continue; } // Unknown state retains the durable obligation for retry.
        if (current === false) { item.ids = []; save(); continue; }
        if (current !== true) continue;
      }
      for (const id of [...item.ids]) {
        if (!source.subscriptions[id] || await deliver(source, id, item.payload)) {
          item.ids = item.ids.filter(value => value !== id); save();
        }
      }
    }
    source.pending = (source.pending || []).filter(item => item.ids.length); save();
  }
  const tick = () => serial(async () => {
    await Promise.allSettled(Object.values(state.sources).map(async source => {
      if (!Object.keys(source.subscriptions).length) return;
      // Retry durable outbox first, including while Hermes is unreachable.
      await flush(source, false);
      try { await drain(source, true); } catch { source.sourceReady = false; }
      await flush(source);
    }));
  });
  let scheduled = false;
  const timer = setInterval(() => {
    if (scheduled) return;
    scheduled = true;
    void tick().catch(() => {}).finally(() => { scheduled = false; });
  }, pollMs); timer.unref();
  async function handleUnsafe(req, res, target) {
    const action = new URL(req.url, 'http://localhost').pathname.split('/').pop();
    if (!['status', 'subscribe', 'test', 'unsubscribe', 'lookup', 'presence'].includes(action)) return json(res, 404, { error: 'Not found' });
    if (req.method !== (action === 'status' ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed' });
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) return json(res, 401, { error: 'Connection key required' });
    if (!target) return json(res, 503, { error: 'Configure Hermes first' });
    const key = createHash('sha256').update(target + '\n' + authorization).digest('hex');
    try {
      const candidate = { target, authorization };
      // Presence can only address an already authenticated source/subscription.
      // Avoid probing Hermes every heartbeat; enrollment and other operations revalidate.
      if (action === 'presence' && !state.sources[key]) return json(res, 401, { error: 'Unknown subscription source' });
      if (action !== 'presence') {
        const profiles = await request(candidate, 'profiles');
        if (!Array.isArray(profiles.profiles)) throw new Error('Invalid Hermes profile response');
      }
      const source = state.sources[key] ||= { ...candidate, subscriptions: {}, cursor: 0, sourceReady: false, failedDeliveries: 0 };
      if (action === 'status') {
        try { const probe = await request(source, `events?after=${source.cursor || 0}`); source.sourceReady = Array.isArray(probe.events); } catch { source.sourceReady = false; }
        return json(res, 200, { publicKey: state.vapid.publicKey, sourceReady: source.sourceReady, subscriptions: Object.keys(source.subscriptions).length, failedDeliveries: source.failedDeliveries });
      }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return json(res, 413, { error: 'Request too large' }); }
      let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (action === 'subscribe') {
        if (!validPushSubscription(body.subscription)) return json(res, 400, { error: 'Unsupported or invalid browser push subscription' });
        if (!Object.keys(source.subscriptions).length) await drain(source, false);
        const old = Object.entries(source.subscriptions).find(([, sub]) => sub.endpoint === body.subscription.endpoint);
        const id = old?.[0] || randomUUID(); source.subscriptions[id] = body.subscription; save();
        return json(res, 200, { id, sourceReady: source.sourceReady });
      }
      if (action === 'lookup') return json(res, 200, { id: Object.entries(source.subscriptions).find(([, sub]) => sub.endpoint === body.endpoint)?.[0] || '' });
      if (!source.subscriptions[body.id]) return json(res, 404, { error: 'Subscription not found' });
      if (action === 'presence') {
        if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.clientId) || typeof body.visible !== 'boolean') return json(res, 400, { error: 'Invalid presence' });
        if (body.locale !== undefined && !['en', 'zh-Hant'].includes(body.locale)) return json(res, 400, { error: 'Invalid locale' });
        if (body.locale && source.localeBySubscription?.[body.id] !== body.locale) {
          source.localeBySubscription ||= {}; source.localeBySubscription[body.id] = body.locale; save();
        }
        const endpoint = presenceKey(source, source.subscriptions[body.id].endpoint);
        const leases = presence.get(endpoint) || new Map();
        for (const [client, expires] of leases) if (expires <= now()) leases.delete(client);
        if (body.visible) {
          if (!leases.has(body.clientId) && leases.size >= 32) return json(res, 429, { error: 'Too many active tabs' });
          leases.set(body.clientId, now() + 15000);
        } else leases.delete(body.clientId);
        if (leases.size) presence.set(endpoint, leases); else presence.delete(endpoint);
        return json(res, 200, { ok: true });
      }
      if (action === 'unsubscribe') { removeSubscription(source, body.id); save(); return json(res, 200, { ok: true }); }
      const ok = await deliver(source, body.id, { title: 'aiot', body: 'Notifications are enabled', tag: 'aiot:test' }, { ignorePresence: true }); save();
      return json(res, ok ? 200 : 502, { ok, ...(!ok ? { error: 'Browser push service could not accept the notification' } : {}) });
    } catch (error) { return json(res, [401, 403].includes(error.status) ? error.status : 503, { error: 'Unable to connect to Hermes notification events' }); }
  }
  const handle = (req, res, target) => serial(() => handleUnsafe(req, res, target));
  return { handle, tick, close: () => clearInterval(timer) };
}
