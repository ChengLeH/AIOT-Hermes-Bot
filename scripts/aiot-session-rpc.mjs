import { randomUUID } from 'node:crypto';

export const GATEWAY_PROTOCOL = 'hermes-gateway-v1';
export const TICKET_PROTOCOL_PREFIX = 'hermes-gateway-ticket.';

/** Server-only official Dashboard RPC transport. Never serialize the socket or its URL. */
export class SessionRpcClient {
  constructor({ dashboardBase, ticketProvider, WebSocketImpl = globalThis.WebSocket,
    onEvent = () => {}, onDisconnect = () => {}, requestTimeoutMs = 30_000, connectTimeoutMs = 30_000,
    maxFrameBytes = 1_048_576, maxFrameMessages = 4096 } = {}) {
    const url = new URL(dashboardBase);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid Dashboard base URL');
    }
    if (url.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Dashboard requires HTTPS outside loopback');
    }
    if (typeof ticketProvider !== 'function' || typeof WebSocketImpl !== 'function') throw new Error('RPC dependencies unavailable');
    for (const value of [requestTimeoutMs, connectTimeoutMs, maxFrameBytes, maxFrameMessages]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid RPC limit');
    }
    this.dashboardOrigin = url.origin;
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/ws`;
    this.url = url.href;
    Object.assign(this, { ticketProvider, WebSocketImpl, onEvent, onDisconnect, requestTimeoutMs, connectTimeoutMs, maxFrameBytes, maxFrameMessages });
    this.pending = new Map();
    this.closed = false;
    this.ready = false;
  }

  connect() {
    if (this.closed) return Promise.reject(new Error('RPC client closed'));
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.connectTimer = setTimeout(() => this._fail(new Error('RPC connection timed out')), this.connectTimeoutMs);
      Promise.resolve().then(() => this.ticketProvider()).then(value => {
        if (this.closed) return;
        if (value?.authMode === 'legacy') {
          if (value.authRequired !== false || value.dashboardOrigin !== this.dashboardOrigin ||
              !this.dashboardOrigin.startsWith('https://') || typeof value.loopbackToken !== 'string' ||
              !/^[A-Za-z0-9_-]{16,512}$/.test(value.loopbackToken)) throw new Error('Invalid Dashboard credential');
          const connection = new URL(this.url);
          // The official nongated transport accepts ONLY ?token=. Keep this transient URL
          // out of client.url, logs, thrown errors and browser-facing status responses.
          connection.searchParams.set('token', value.loopbackToken);
          this.socket = new this.WebSocketImpl(connection.href);
        } else {
          const ticket = typeof value === 'string' ? value : value?.ticket;
          if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ticket)) throw new Error('Invalid Dashboard ticket');
          this.socket = new this.WebSocketImpl(this.url, [GATEWAY_PROTOCOL, `${TICKET_PROTOCOL_PREFIX}${ticket}`]);
        }
        this.socket.addEventListener('message', event => this._receive(event.data));
        this.socket.addEventListener('error', () => this._fail(new Error('RPC connection failed')));
        this.socket.addEventListener('close', () => this._fail(new Error('RPC connection closed')));
      }).catch(() => this._fail(new Error('RPC connection failed')));
    });
    return this.connectPromise;
  }

  _receive(data) {
    if (this.closed) return;
    // Hermes sends complete JSON records, sometimes several NDJSON records per frame.
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > this.maxFrameBytes) {
      this._fail(new Error('Invalid RPC frame')); return;
    }
    const lines = data.split('\n').filter(line => line.trim());
    if (lines.length > this.maxFrameMessages) { this._fail(new Error('RPC frame limit exceeded')); return; }
    for (const line of lines) {
      let frame;
      try { frame = JSON.parse(line); } catch { this._fail(new Error('Invalid RPC JSON')); return; }
      if (!frame || Array.isArray(frame) || frame.jsonrpc !== '2.0') { this._fail(new Error('Invalid RPC envelope')); return; }
      if (Object.hasOwn(frame, 'id')) {
        const pending = this.pending.get(frame.id);
        if (!pending) continue;
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.error) {
          const error = new Error('Dashboard RPC request failed');
          error.code = frame.error.code;
          pending.reject(error);
        } else if (Object.hasOwn(frame, 'result')) pending.resolve(frame.result);
        else pending.reject(new Error('Invalid RPC response'));
      } else if (frame.method === 'event' && frame.params && typeof frame.params.type === 'string') {
        if (frame.params.type === 'gateway.ready' && !this.ready) {
          this.ready = true;
          clearTimeout(this.connectTimer);
          this.connectResolve(this);
        }
        // Consumers receive the official {type, session_id?, payload?, ...} envelope.
        try { this.onEvent(frame.params); } catch { /* A consumer must not corrupt transport state. */ }
      }
      if (this.closed) return;
    }
  }

  async request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (typeof method !== 'string' || !method || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid RPC request');
    await this.connect();
    if (this.closed || !this.ready) throw new Error('RPC client closed');
    const id = randomUUID();
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    if (Buffer.byteLength(payload, 'utf8') > this.maxFrameBytes) throw new Error('RPC request limit exceeded');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC request timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(payload); } catch { this._fail(new Error('RPC send failed')); }
    });
  }

  _fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    clearTimeout(this.connectTimer);
    this.connectReject?.(error);
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    try { this.socket?.close(); } catch { /* Already disconnected. */ }
    try { Promise.resolve(this.onDisconnect()).catch(() => {}); } catch { /* Observer isolation. */ }
  }

  close() { this._fail(new Error('RPC client closed')); }
}

export function createSessionRpcClient(options) { return new SessionRpcClient(options); }
