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
export function createPushService({ dataDir, fetchImpl = fetch, send = webpush.sendNotification.bind(webpush), pollMs = 3000, now = Date.now, nativeEvents } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stateCipher = createPrivateStateCipher({ dataDir });
  const state = stateCipher.read(() => ({ vapid: webpush.generateVAPIDKeys(), sources: {} }));
  const save = () => stateCipher.write(state);
  save();
  const presence = new Map(); // Ephemeral device/tab leases; never persist across restarts.
  let queue = Promise.resolve();
  const serial = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const request = async (source, path) => {
    const response = await fetchImpl(`${source.target.replace(/\/$/, '')}/${path}`, { headers: { Authorization: source.authorization }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error('Hermes connection unavailable'), { status: response.status });
    return response.json();
  };
  const presenceKey = (source, endpoint) => createHash('sha256').update(source.target + '\n' + source.authorization + '\n' + endpoint).digest('hex');
  async function deliver(source, id, payload) {
    const sub = source.subscriptions[id];
    if (!sub || !validPushSubscription(sub)) return false;
    const leases = presence.get(presenceKey(source, sub.endpoint));
    if (leases) {
      for (const [client, expires] of leases) if (expires <= now()) leases.delete(client);
      if (leases.size) return true; // Consumed by the foreground event stream, not deferred.
      presence.delete(presenceKey(source, sub.endpoint));
    }
    try {
      await send(sub, JSON.stringify(payload), { TTL: 300, timeout: 10000, vapidDetails: { subject: 'https://github.com/ChengLeH/AIOT-Hermes-Bot', ...state.vapid } });
      return true;
    } catch (error) {
      source.failedDeliveries = (source.failedDeliveries || 0) + 1;
      if (error.statusCode === 404 || error.statusCode === 410) delete source.subscriptions[id];
      return false;
    }
  }
  function processEvent(source, event, notify) {
    source.pending ||= [];
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
      source.pending.push({ payload, ids: Object.keys(source.subscriptions) });
    }
  }
  async function drainChannel(source, notify, path, cursorKey, optional = false) {
    for (let page = 0; page < 1000; page++) {
      let data;
      try {
        data = path === 'native/events' && nativeEvents
          ? await nativeEvents(source[cursorKey] || 0)
          : await request(source, `${path}?after=${source[cursorKey] || 0}`);
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
    // Drain both transports; initial enrollment skips old events without notifying.
    await drainChannel(source, notify, 'events', 'cursor');
    await drainChannel(source, notify, 'native/events', 'nativeCursor', true);
    source.sourceReady = true;
  }
  async function flush(source) {
    for (const item of source.pending || []) {
      for (const id of [...item.ids]) {
        if (!source.subscriptions[id] || await deliver(source, id, item.payload)) {
          item.ids = item.ids.filter(value => value !== id); save();
        }
      }
    }
    source.pending = (source.pending || []).filter(item => item.ids.length); save();
  }
  const tick = () => serial(async () => {
    for (const source of Object.values(state.sources)) {
      if (!Object.keys(source.subscriptions).length) continue;
      try { await drain(source, true); await flush(source); } catch { source.sourceReady = false; }
    }
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
      if (action === 'unsubscribe') { delete source.subscriptions[body.id]; save(); return json(res, 200, { ok: true }); }
      const ok = await deliver(source, body.id, { title: 'aiot', body: 'Notifications are enabled', tag: 'aiot:test' }); save();
      return json(res, ok ? 200 : 502, { ok, ...(!ok ? { error: 'Browser push service could not accept the notification' } : {}) });
    } catch (error) { return json(res, [401, 403].includes(error.status) ? error.status : 503, { error: 'Unable to connect to Hermes notification events' }); }
  }
  const handle = (req, res, target) => serial(() => handleUnsafe(req, res, target));
  return { handle, tick, close: () => clearInterval(timer) };
}
