// ============================================
// SIMULATION — ACTOR POOL
// Spawns virtual customers from the demand plan,
// enforces the concurrency cap (queues arrivals),
// owns the ledger of successful bookings, schedules
// pre-arrival cancellations, and feeds the manager
// actors with per-outlet state.
// ============================================

import { VirtualCustomer } from './customer.js';
import { VirtualManager } from './manager.js';
import { locationTables, outletNames } from '../demand/outlets.js';

export class ActorPool {
  constructor({ clock, adapter, logger, worldRng, config, auditor, injector }) {
    this.clock = clock;
    this.adapter = adapter;
    this.log = logger;
    this.worldRng = worldRng;
    this.config = config;
    this.auditor = auditor;
    this.injector = injector;

    this.active = new Set();      // in-flight VirtualCustomers
    this.finished = [];           // completed customers
    this.queue = [];              // plan events waiting for a free slot (cap)
    this.ledger = new Map();      // code -> entry (shared with auditor/managers)
    this.custSeq = 0;

    this.managers = new Map();    // outlet -> VirtualManager

    this.counters = {
      spawned: 0, booked: 0, walkinSeated: 0, abandoned: 0, clientRejects: 0,
      postRejected: 0, cancels: 0, noShows: 0, seated: 0, completed: 0, queueWaits: 0
    };
    this.dayCounters = this._freshDay();
    this.stopped = false;
    this._drainResolve = null;
  }

  _freshDay() {
    return { spawned: 0, booked: 0, walkinSeated: 0, abandoned: 0, cancels: 0, noShows: 0, seated: 0, completed: 0, queueWaits: 0 };
  }

  noteClientReject() { this.counters.clientRejects++; }
  noteNoShow() { this.counters.noShows++; this.dayCounters.noShows++; }
  noteSeated() { this.counters.seated++; this.dayCounters.seated++; }
  noteCompleted() { this.counters.completed++; this.dayCounters.completed++; }

  /** Engine calls this with every due plan event. */
  spawn(planEvent) {
    if (this.stopped) return;
    this.counters.spawned++;
    this.dayCounters.spawned++;

    if (this.active.size >= (this.config.maxConcurrentActors || 800)) {
      this.counters.queueWaits++;
      this.dayCounters.queueWaits++;
      if (this.counters.queueWaits % 50 === 1) {
        this.log.warn('POOL', 'ENGINE', `concurrency cap reached (${this.active.size}) — arrivals queueing (total waits ${this.counters.queueWaits})`);
      }
      this.queue.push(planEvent);
      return;
    }
    this._spawnNow(planEvent);
  }

  _spawnNow(planEvent) {
    this.custSeq++;
    const id = `C-${String(this.custSeq).padStart(4, '0')}`;
    const rng = this.worldRng.fork(`${planEvent.salt}:run`);
    const cust = new VirtualCustomer({
      id, planEvent, clock: this.clock, adapter: this.adapter,
      logger: this.log, ledger: this.ledger, rng, pool: this
    });
    if (this.injector) {
      const chaos = this.injector.assignSpawn(planEvent, id);
      if (chaos) cust.chaos = chaos;
    }
    this.active.add(cust);
    cust.run().catch((e) => {
      this.log.error(id, 'CLIENT', 'CLIENT', '', `customer flow crashed: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`, { outlet: planEvent.outlet });
      this.done(cust, 'crashed');
    });
  }

  /** Customer finished its journey. */
  done(customer, outcomeOverride) {
    if (!this.active.delete(customer)) return;
    customer.outcome = outcomeOverride || customer.outcome || 'done';
    this.finished.push(customer);
    if (customer.outcome === 'booked' || customer.outcome === 'walkin-seated') {
      if (customer.outcome === 'booked') { this.counters.booked++; this.dayCounters.booked++; }
      else { this.counters.walkinSeated++; this.dayCounters.walkinSeated++; }
    } else if (String(customer.outcome).startsWith('abandoned') || String(customer.outcome).startsWith('walkin-left')) {
      this.counters.abandoned++;
      this.dayCounters.abandoned++;
    } else if (customer.outcome === 'post-rejected' || customer.outcome === 'post-aborted-may-ghost' || customer.outcome === 'walkin-post-rejected') {
      this.counters.postRejected++;
    }
    if (this._drainResolve && this.active.size === 0 && this.queue.length === 0) {
      const r = this._drainResolve; this._drainResolve = null; r();
    }
  }

  /** Ledger entry after a POST (successful or not). Called by the customer. */
  registerBooking(customer, record, res, opts = {}) {
    const entry = {
      code: record.code,
      customerId: customer.id,
      outlet: record.locationId,
      date: record.date,
      time: record.time,
      tableId: record.tableId,
      party: record.guests,
      channel: customer.plan.channel,
      persona: customer.plan.persona,
      posted: true,
      postedOk: (res.ok || res.status === 201),
      postedAtStr: new Date(this.clock.now()).toISOString(),
      statusVirtual: record.status,
      cancelAt: null,
      cancelDone: false,
      reportedLost: false,
      seatedAtVirt: record.status === 'seated' ? this.clock.now() : null,
      walkin: !!opts.walkin
    };
    this.ledger.set(record.code, entry);
    if (this.auditor) this.auditor.onMutation();
    // schedule realistic pre-arrival cancellation (only clean bookings)
    if (entry.postedOk && entry.statusVirtual === 'confirmed' && entry.persona?.cancelAt) {
      const at = entry.persona.cancelAt;
      if (at > this.clock.now() && at < Date.parse(`${entry.date}T${entry.time}:00`) - 30 * 60000) {
        entry.cancelAt = at;
      }
    }
  }

  /** Engine tick: cancellations due now. */
  async checkDueCancels() {
    if (this.stopped) return;
    const now = this.clock.now();
    for (const entry of this.ledger.values()) {
      if (entry.cancelAt && !entry.cancelDone && entry.statusVirtual === 'confirmed' && now >= entry.cancelAt) {
        entry.cancelDone = true;
        const res = await this.adapter.patchStatus(entry.code, 'cancelled', 'Cancelled by customer online');
        if (res.ok) {
          entry.statusVirtual = 'cancelled';
          this.counters.cancels++;
          this.dayCounters.cancels++;
          this.log.info(entry.customerId, 'CANCEL', `self-cancelled ${entry.code} (${entry.outlet} ${entry.date} ${entry.time}, table ${entry.tableId})`, { http: res.status, latencyMs: res.latencyMs });
          if (this.auditor) this.auditor.onMutation();
          if (this.injector) this.injector.maybeSniper(entry);
        } else {
          this.log.error(entry.customerId, 'CANCEL', 'SERVER', '', `cancel PATCH failed for ${entry.code}`, { status: res.status, body: res.body });
        }
      }
    }
  }

  /** Create the 7 floor managers. */
  createManagers() {
    for (const outlet of Object.keys(locationTables)) {
      const rng = this.worldRng.fork(`mgr:${outlet}`);
      this.managers.set(outlet, new VirtualManager({
        outlet, clock: this.clock, adapter: this.adapter,
        logger: this.log, ledger: this.ledger, rng, pool: this
      }));
    }
    return this.managers;
  }

  async tickManagers() {
    for (const mgr of this.managers.values()) {
      try { await mgr.tick(); } catch (e) {
        this.log.error(mgr.actor(), 'CLIENT', 'CLIENT', '', `manager loop error: ${e && e.message}`, { outlet: mgr.outlet });
      }
    }
  }

  resetDay() { this.dayCounters = this._freshDay(); }

  get stats() {
    return {
      ...this.counters,
      active: this.active.size,
      queued: this.queue.length,
      finished: this.finished.length,
      ledgerSize: this.ledger.size
    };
  }

  /** Wait for all in-flight customers (teardown). */
  drain(timeoutMs = 15000) {
    if (this.active.size === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._drainResolve = resolve;
      setTimeout(resolve, timeoutMs);
    });
  }

  stop() { this.stopped = true; for (const m of this.managers.values()) m.stop(); }
}
