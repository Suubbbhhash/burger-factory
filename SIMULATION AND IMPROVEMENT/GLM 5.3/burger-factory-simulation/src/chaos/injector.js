// ============================================
// SIMULATION — CHAOS INJECTOR
// Deliberate fault scenarios, each aimed at a known
// weakness of the current engine:
//   race pairs      -> no server-side overlap guard (A3-4)
//   double submit   -> no idempotency / dup codes   (A4-3)
//   invalid payload -> zero server-side validation  (A3-1)
//   abandon mid-req -> ghost bookings on disconnect (A4-2)
//   rapid fire      -> throughput & race stress
//   clock skew      -> client-trusted timestamps    (A3-1)
//   illegal trans.  -> no state machine on PATCH    (A4-5)
//   table sniper    -> post-cancellation stampede
// Modes: off | standard | aggressive (x3)
// ============================================

import { locationTables, TIME_SLOTS, getTable } from '../demand/outlets.js';
import { makeIdentity, makeBookingCode } from '../demand/names.js';
import { toMin, TURN_MINUTES, j, dateOf, istMidnight } from '../util.js';

const ACTIVE = (st) => !['cancelled', 'no-show', 'completed'].includes(st);

const RACE_OUTLETS = [['anjuna', 30], ['morjim', 20], ['delhi', 20], ['panaji', 12], ['vagator', 10], ['dona-paula', 5], ['nerul', 3]];
const RACE_SLOTS = ['13:00', '13:30', '19:00', '19:30', '20:00', '20:30'];

export class ChaosInjector {
  constructor({ mode = 'standard', worldRng, adapter, logger, clock, ledger }) {
    this.mode = mode;
    this.rng = worldRng.fork('chaos');
    this.adapter = adapter;
    this.log = logger;
    this.clock = clock;
    this.ledger = ledger;
    this.pool = null;                  // set by orchestrator after pool exists
    this.scheduled = [];               // [{at, kind, arg}]
    this.dayPlanIndex = 0;
    this.counters = { racePairs: 0, raceBothAccepted: 0, illegalTransitions: 0, snipers: 0, attachCounts: {} };
    this._snipersToday = 0;
    this._firing = false;
  }

  get factor() { return this.mode === 'aggressive' ? 3 : this.mode === 'standard' ? 1 : 0; }

  /** Schedule the standalone scenarios for one virtual day. Accepts any ms within that day. */
  planDay(anyMsInDay) {
    if (this.factor === 0) return;
    const dayStart = istMidnight(anyMsInDay); // midnight IST anchor
    const n = 3 * this.factor;
    for (let i = 0; i < n; i++) {
      const at = dayStart + (12 * 60 + 45) * 60000 + this.rng.int(0, (21 * 60 + 30) - (12 * 60 + 45)) * 60000;
      this.scheduled.push({ at, kind: 'racePair' });
    }
    for (let i = 0; i < n; i++) {
      const at = dayStart + (13 * 60) * 60000 + this.rng.int(0, 8 * 60) * 60000;
      this.scheduled.push({ at, kind: 'illegalTransition' });
    }
    this.scheduled.sort((a, b) => a.at - b.at);
  }

  /** Engine tick — fire due events. */
  tick(now) {
    if (this.factor === 0) return;
    while (this.scheduled.length && this.scheduled[0].at <= now) {
      const ev = this.scheduled.shift();
      if (ev.kind === 'racePair') this.racePair().catch(e => this.log.error('CHAOS', 'CHAOS', 'CLIENT', '', `racePair failed: ${e && e.message}`));
      if (ev.kind === 'illegalTransition') this.illegalTransition().catch(e => this.log.error('CHAOS', 'CHAOS', 'CLIENT', '', `illegalTransition failed: ${e && e.message}`));
    }
  }

  onNewDay() { this._snipersToday = 0; }

  /** Per-spawn attached chaos (returns assignment or null). */
  assignSpawn(planEvent, customerId) {
    if (this.factor === 0) return null;
    const r = this.rng.float();
    const s = this.factor; // 1 or 3
    // cumulative rates (standard, per spawn)
    const rates = [
      ['invalid-payload', 0.008 * s],
      ['abandoned-request', 0.010 * s],
      ['double-submit', 0.004 * s],
      ['rapid-fire', 0.002 * s],
      ['clock-skew', 0.003 * s]
    ];
    let acc = 0;
    for (const [kind, p] of rates) {
      acc += Math.min(p, 0.03);
      if (r < acc) {
        this.counters.attachCounts[kind] = (this.counters.attachCounts[kind] || 0) + 1;
        this.log.warn('CHAOS', 'CHAOS', `attached [${kind}] to ${customerId} (${planEvent.channel}, outlet ${planEvent.outlet})`);
        return this._makeAssignment(kind);
      }
    }
    return null;
  }

  _makeAssignment(kind) {
    const self = this;
    if (kind === 'invalid-payload') {
      return {
        kind,
        mutate(record, rng) {
          const variant = rng.int(0, 6);
          const v = [
            () => ({ ...record, guests: 99 }),
            () => ({ ...record, name: 'X'.repeat(300) }),
            () => ({ ...record, phone: 'not-a-phone-number' }),
            () => ({ ...record, time: '25:99' }),
            () => ({ ...record, date: '2026-13-45' }),
            () => ({ ...record, notes: 'N'.repeat(2000) }),
            () => { const c = { ...record }; delete c.name; return c; }
          ][variant];
          const m = v();
          self.log.warn('CHAOS', 'CHAOS', `invalid payload variant #${variant} (guests=${m.guests}, time=${m.time}, date=${m.date}, nameLen=${(m.name || '').length}) — expecting server validation to reject`);
          return m;
        }
      };
    }
    if (kind === 'abandoned-request') {
      return { kind, abortAtMs: 30 + Math.floor(Math.random() * 120) };
    }
    if (kind === 'double-submit') return { kind };
    if (kind === 'rapid-fire') return { kind, count: 12 };
    if (kind === 'clock-skew') {
      return {
        kind,
        skew(record, rng) {
          const variant = rng.int(0, 2);
          if (variant === 0) return { ...record, createdAt: '2031-01-01T00:00:00.000Z' };
          if (variant === 1) return { ...record, date: '2020-01-01' };
          return { ...record, time: '03:00' };
        }
      };
    }
    return null;
  }

  /**
   * RACE PAIR — the signature double-booking scenario.
   * Two groups sync at the same instant, both see the same
   * free table, both POST. The engine writes both.
   */
  async racePair(target = null) {
    this.counters.racePairs++;
    const outlet = target?.outlet || this.rng.weighted(RACE_OUTLETS);
    const slot = target?.slot || this.rng.pick(RACE_SLOTS);
    const date = target?.date || dateOf(this.clock.now() + this.rng.int(0, 1) * 86400000);
    const party = this.rng.pick([2, 4]);
    const pref = 'any';

    // both devices sync at the same moment — shared view
    const sync = await this.adapter.getReservations();
    if (!sync.list) { this.log.warn('CHAOS', 'CHAOS', 'race pair aborted: could not sync'); return; }
    const view = sync.list;

    // first-fit table pick (same logic as the client)
    const all = [];
    for (const [zone, tables] of Object.entries(locationTables[outlet] || {})) {
      for (const t of tables) all.push({ ...t, zone });
    }
    const fits = all.filter(t => t.capacity >= party).sort((a, b) => a.capacity - b.capacity);
    const want = toMin(slot);
    const table = fits.find(t => !view.some(r => {
      if (!ACTIVE(r.status)) return false;
      if (r.locationId !== outlet || r.date !== date) return false;
      if (r.tableId !== t.id) return false;
      return Math.abs(want - toMin(r.time)) < TURN_MINUTES;
    }));
    if (!table) {
      this.log.info('CHAOS', 'CHAOS', `race pair skipped: no free table at ${outlet} ${date} ${slot} for party=${party}`);
      return;
    }

    const mk = (n) => {
      const code = makeBookingCode(this.rng);
      return {
        id: code, code, name: n.name, email: n.email || '', phone: n.phone,
        locationId: outlet, locationName: '', date, time: slot, guests: party,
        seating: pref, occasion: '', notes: 'Racing for the same table',
        tableId: table.id, tableLabel: table.id, tableType: table.type, tableZone: table.zone,
        status: 'confirmed', createdAt: new Date(this.clock.now()).toISOString()
      };
    };
    const idA = makeIdentity(this.rng), idB = makeIdentity(this.rng);
    const recA = mk(idA), recB = mk(idB);

    this.log.warn('CHAOS', 'RACE', `race pair armed: ${outlet} ${date} ${slot} table=${table.id} party=${party} — firing both POSTs ${'~'}simultaneously`, { a: recA.code, b: recB.code });

    const t0 = Date.now();
    const [resA, resB] = await Promise.all([
      this.adapter.postReservation(recA),
      new Promise(r => setTimeout(r, 5 + Math.floor(Math.random() * 20))).then(() => this.adapter.postReservation(recB))
    ]);

    const both = (resA.ok || resA.status === 201) && (resB.ok || resB.status === 201);
    if (both) {
      this.counters.raceBothAccepted++;
      this.log.error('CHAOS', 'RACE', 'RACE', 'DBL-BOOK',
        `race pair: BOTH POSTs accepted — ${recA.code} and ${recB.code} now hold the SAME table ${table.id} at ${slot}. Server performed no overlap check.`,
        { a: resA.status, b: resB.status, outlet, date, slot, table: table.id, realGapMs: Date.now() - t0 });
    } else {
      this.log.info('CHAOS', 'RACE', `race pair outcome: A=${resA.status} B=${resB.status} (a guard may exist)`, { outlet, slot, table: table.id });
    }

    // register both in the ledger so managers run their lifecycle
    if (this.pool) {
      const fakeA = { id: 'CHAOS-RP', plan: { channel: 'online', persona: { turnMin: 90, punctuality: 'on-time', lateMin: 0, cancelAt: null } } };
      const fakeB = { id: 'CHAOS-RP', plan: { channel: 'online', persona: { turnMin: 90, punctuality: 'on-time', lateMin: 0, cancelAt: null } } };
      if (resA.ok || resA.status === 201) this.pool.registerBooking(fakeA, recA, resA);
      if (resB.ok || resB.status === 201) this.pool.registerBooking(fakeB, recB, resB);
    }
  }

  /** ILLEGAL TRANSITION — the manager 'Restore' bug, driven directly. */
  async illegalTransition() {
    this.counters.illegalTransitions++;
    const { list } = await this.adapter.getReservations();
    if (!list) return;
    const pool = list.filter(r => ['completed', 'cancelled', 'no-show'].includes(r.status));
    if (pool.length === 0) { this.log.info('CHAOS', 'CHAOS', 'illegal transition skipped: no terminal records yet'); return; }
    const victim = this.rng.pick(pool);
    const to = this.rng.pick(['confirmed', 'seated', 'completed']);
    const res = await this.adapter.patchStatus(victim.code || victim.id, to, 'chaos: restore attempt');
    this.log.warn('CHAOS', 'CHAOS',
      `illegal transition attempt: ${victim.code || victim.id} ${victim.status} -> ${to} (server responded HTTP ${res.status}). A correct server must reject this.`,
      { from: victim.status, to, http: res.status });
    if (res.ok && victim.status !== to) {
      this.log.error('CHAOS', 'CHAOS', 'DATA', 'ILLEGAL-TR',
        `server ACCEPTED illegal transition ${victim.status} -> ${to} on ${victim.code || victim.id}. PATCH has no state machine (finding A4-5).`,
        { code: victim.code || victim.id, from: victim.status, to });
    }
  }

  /** TABLE SNIPER — stampede on a just-freed table. */
  maybeSniper(cancelledEntry) {
    if (this.factor === 0) return;
    if (this._snipersToday >= 2) return;
    if (!this.rng.chance(0.25)) return;
    this._snipersToday++;
    this.counters.snipers++;
    this.log.warn('CHAOS', 'CHAOS', `table sniper: two groups will race for just-freed ${cancelledEntry.tableId} at ${cancelledEntry.outlet} ${cancelledEntry.date} ${cancelledEntry.time}`);
    this.racePair({ outlet: cancelledEntry.outlet, slot: cancelledEntry.time, date: cancelledEntry.date }).catch(() => {});
  }

  describe() { return { mode: this.mode, ...this.counters }; }
}
