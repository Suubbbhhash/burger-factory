// ============================================
// SIMULATION — SERVER ADAPTER
// Real HTTP against the running app (LAN/Vite mode).
// Measures real latency, tracks in-flight requests,
// keeps an SSE monitor with event parity accounting.
// Every call is logged through the SimLogger.
// ============================================

import { j } from '../util.js';

export class Metrics {
  constructor() {
    this.byEndpoint = {};         // name -> {count, samples[], errors, max}
    this.inFlight = 0;
    this.peakInFlight = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
  }
  record(name, latencyMs, ok) {
    const m = this.byEndpoint[name] || (this.byEndpoint[name] = { count: 0, samples: [], errors: 0, max: 0 });
    m.count++; m.samples.push(latencyMs); m.max = Math.max(m.max, latencyMs);
    this.totalRequests++;
    if (!ok) { m.errors++; this.totalErrors++; }
  }
  enter() { this.inFlight++; this.peakInFlight = Math.max(this.peakInFlight, this.inFlight); }
  exit() { this.inFlight = Math.max(0, this.inFlight - 1); }
}

export class ServerAdapter {
  constructor({ target, timeoutMs, logger, clock, metrics }) {
    this.target = String(target || 'http://localhost:3000').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs || 8000;
    this.log = logger;
    this.clock = clock;
    this.metrics = metrics || new Metrics();

    // SSE monitor state
    this.sse = {
      connected: false, reconnects: 0, events: 0,
      received: [],           // {action, code, atReal}
      expected: [],           // {action, code, atReal} — registered on each mutation
      controller: null,
      monitorOn: false
    };
    this._sseAbort = null;
  }

  /** Core request. opts: {body, timeoutMs, abortAtMs (chaos), silent} */
  async request(method, path, opts = {}) {
    const url = `${this.target}${path}`;
    const controller = new AbortController();
    let abortTimer = null, timeoutTimer = null, aborted = false;
    if (opts.abortAtMs) {
      abortTimer = setTimeout(() => { aborted = true; controller.abort('chaos:abandoned-request'); }, opts.abortAtMs);
    }
    const tLimit = opts.timeoutMs || this.timeoutMs;
    timeoutTimer = setTimeout(() => { aborted = true; controller.abort('timeout'); }, tLimit);
    const t0 = Date.now();
    this.metrics.enter();
    try {
      const res = await fetch(url, {
        method,
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        cache: 'no-store'
      });
      let body = null;
      const text = await res.text();
      try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text ? text.slice(0, 200) : '' }; }
      const latency = Date.now() - t0;
      this.metrics.record(`HTTP ${method} ${path}`, latency, true);
      return { ok: res.ok, status: res.status, body, latencyMs: latency, aborted: false };
    } catch (err) {
      const latency = Date.now() - t0;
      this.metrics.record(`HTTP ${method} ${path}`, latency, false);
      return { ok: false, status: 0, body: null, latencyMs: latency, aborted, error: String(err && err.message || err), url };
    } finally {
      clearTimeout(abortTimer); clearTimeout(timeoutTimer);
      this.metrics.exit();
    }
  }

  async getReservations() {
    const r = await this.request('GET', '/api/v1/reservations');
    if (r.ok && r.body && Array.isArray(r.body.reservations)) return { list: r.body.reservations, res: r };
    return { list: null, res: r };
  }

  async postReservation(reservation, opts = {}) {
    const r = await this.request('POST', '/api/v1/reservations', { body: { reservation }, ...opts });
    if (r.ok || r.status === 201) this.registerSse('created', reservation.code);
    return r;
  }

  async patchStatus(code, status, reason, opts = {}) {
    const r = await this.request('PATCH', '/api/v1/reservations/status', { body: { code, status, ...(reason ? { reason } : {}) }, ...opts });
    if (r.ok) this.registerSse('status_updated:' + status, code);
    return r;
  }

  async probe() {
    const r = await this.getReservations();
    return r;
  }

  // ---------- SSE monitoring ----------
  registerSse(action, code) {
    if (!this.sse.monitorOn) return;
    this.sse.expected.push({ action, code, atReal: Date.now() });
    if (this.sse.expected.length > 4000) this.sse.expected.splice(0, 2000);
  }

  async startSse() {
    if (this.sse.monitorOn) return;
    this.sse.monitorOn = true;
    this._sseLoop().catch(() => {});
  }

  async _sseLoop() {
    // auto-reconnect with backoff; counts reconnects and gaps
    while (this.sse.monitorOn) {
      const controller = new AbortController();
      this._sseAbort = controller;
      let lastFrameReal = Date.now();
      try {
        const res = await fetch(`${this.target}/api/v1/events`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' }
        });
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        this.sse.connected = true;
        if (this.sse.reconnects > 0) {
          this.log.info('SSE', 'SSE', `stream re-established after ${Date.now() - lastFrameReal}ms gap`, { reconnects: this.sse.reconnects });
        }
        let buf = '';
        let eventName = '';
        const decoder = new TextDecoder('utf-8');
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) {
                const dataRaw = line.slice(5).trim();
                let data = null; try { data = JSON.parse(dataRaw); } catch { data = { _raw: dataRaw?.slice(0, 120) }; }
                this._onSseEvent(eventName || 'message', data);
              }
            }
            eventName = '';
          }
          lastFrameReal = Date.now();
        }
        throw new Error('SSE stream ended by server');
      } catch (e) {
        this.sse.connected = false;
        if (!this.sse.monitorOn) return;
        this.sse.reconnects++;
        this.log.warn('SSE', 'SSE', `stream down (${String(e && e.message || e).slice(0, 80)}) — reconnect #${this.sse.reconnects} in 1s`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  _onSseEvent(type, data) {
    if (type === 'connected') { this.sse.connected = true; return; }
    if (type === 'reservations:changed') {
      this.sse.events++;
      const code = data?.reservation?.code || data?.code || null;
      const action = data?.action || 'unknown';
      this.sse.received.push({ action, code, atReal: Date.now() });
      if (this.sse.received.length > 4000) this.sse.received.splice(0, 2000);
    }
  }

  stopSse() {
    this.sse.monitorOn = false;
    if (this._sseAbort) this._sseAbort.abort('stop');
  }

  /**
   * Event parity: every successful mutation should produce exactly one
   * reservations:changed. Returns missing list (graceMs for stream lag).
   */
  sseParity(graceMs = 2500) {
    const cutoff = Date.now() - graceMs;
    const have = new Set(this.sse.received.filter(r => r.atReal <= cutoff).map(r => `${r.action}~${r.code}`));
    const missing = [];
    for (const e of this.sse.expected) {
      if (e.atReal > cutoff) continue;
      const key = e.action.includes(':') ? `${e.action.split(':')[0]}~${e.code}` : `${e.action}~${e.code}`;
      if (!have.has(key) && e.code) missing.push(e);
    }
    return { expected: this.sse.expected.length, received: this.sse.received.length, missing };
  }
}
