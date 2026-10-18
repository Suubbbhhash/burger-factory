// ============================================
// SIMULATION — VIRTUAL CUSTOMER
// A faithful replica of what the REAL client does
// (src/js/booking.js), bugs included — on purpose.
// The point is to generate authentic traffic and
// authentic failure modes, not idealized ones.
//
// Flow (mirrors the web app):
//   arrival (page load + GET sync)
//   -> browse (virtual think time)
//   -> slot chips grid (getSlotAvailabilityGrid replica)
//   -> submit: sync GET -> checkAvailability replica
//      -> build record -> POST {reservation}
// The client-side code IGNORES the POST response —
// exactly like booking.js. We log it, though.
// ============================================

import { locationTables, outletNames, TIME_SLOTS, getTable } from '../demand/outlets.js';
import { toMin, toHHMM, TURN_MINUTES, j, dateOf, timeOf } from '../util.js';
import { makeBookingCode } from '../demand/names.js';

// --- booking.js zone preference map (verbatim) ---
const PREF_MAP = {
  indoor: ['indoor'],
  outdoor: ['outdoor', 'beachside', 'rooftop'],
  beachside: ['beachside', 'outdoor'],
  rooftop: ['rooftop', 'outdoor']
};

const ACTIVE_STATUSES = (st) => !['cancelled', 'no-show', 'completed'].includes(st);

export class VirtualCustomer {
  constructor({ id, planEvent, clock, adapter, logger, ledger, rng, pool }) {
    this.id = id;                       // C-0001
    this.plan = planEvent;              // {at, outlet, channel, persona}
    this.clock = clock;
    this.adapter = adapter;
    this.log = logger;
    this.ledger = ledger;
    this.rng = rng;                     // forked, deterministic
    this.pool = pool;
    this.view = [];                     // localStorage mirror (last sync)
    this.state = 'arrived';
    this.outcome = null;                // final outcome tag
    this.record = null;                 // the reservation record we POSTed
  }

  tag() { return this.id; }

  /** --- replica: booking.js checkAvailability --- */
  replicaCheck(locationId, date, time, guests, seating) {
    const tables = locationTables[locationId];
    if (!tables) return { available: false, table: null, message: 'Location not found' };
    let all = [];
    for (const [zone, zoneTables] of Object.entries(tables)) {
      for (const t of zoneTables) all.push({ ...t, zone });
    }
    if (seating && seating !== 'any') {
      const allowed = PREF_MAP[seating] || [seating];
      const filtered = all.filter(t => allowed.includes(t.zone));
      if (filtered.length > 0) all = filtered;
    }
    all = all.filter(t => t.capacity >= guests).sort((a, b) => a.capacity - b.capacity);
    if (all.length === 0) {
      return { available: false, table: null, message: `No single table accommodates ${guests} guests at this outlet. Please call the outlet directly.` };
    }
    const want = toMin(time);
    for (const table of all) {
      const collision = this.view.some(r => {
        if (!ACTIVE_STATUSES(r.status)) return false;
        if (r.locationId !== locationId || r.date !== date) return false;
        if (r.tableId !== table.id) return false;
        return Math.abs(want - toMin(r.time)) < TURN_MINUTES;
      });
      if (!collision) return { available: true, table, message: `Table ${table.id} (${table.type}, ${table.zone}) is available.` };
    }
    return { available: false, table: null, message: 'All suitable tables are booked for this time slot. Please choose another time.' };
  }

  /** --- replica: booking.js getSlotAvailabilityGrid (with its narrower zone filter) --- */
  replicaGrid(locationId, date, guests, seating) {
    const tables = locationTables[locationId];
    if (!tables) return [];
    const gc = Number(guests) || 2;
    let candidates = [];
    for (const [zone, zoneTables] of Object.entries(tables)) {
      for (const t of zoneTables) {
        if (seating === 'any' || t.zone === seating || (seating === 'outdoor' && t.zone === 'beachside')) {
          if (t.capacity >= gc) candidates.push({ ...t, zone });
        }
      }
    }
    if (candidates.length === 0) return TIME_SLOTS.map(time => ({ time, status: 'full', freeCount: 0 }));
    return TIME_SLOTS.map(time => {
      const slotMin = toMin(time);
      let free = 0;
      for (const table of candidates) {
        const occupied = this.view.some(r => {
          if (!ACTIVE_STATUSES(r.status)) return false;
          if (r.locationId !== locationId || r.date !== date) return false;
          if (r.tableId !== table.id) return false;
          return Math.abs(slotMin - toMin(r.time)) < TURN_MINUTES;
        });
        if (!occupied) free++;
      }
      const status = free === 0 ? 'full' : free <= 2 ? 'last_tables' : 'available';
      return { time, status, freeCount: free };
    });
  }

  /** --- replica: booking.js record construction --- */
  buildRecord({ table, timeStr, dateStr, status, notes, seating, occasionOverride }) {
    const p = this.plan.persona;
    const code = makeBookingCode(this.rng);
    const nowIso = new Date(this.clock.now()).toISOString();
    const seatingFinal = seating || p.pref || 'any';
    return {
      id: code,
      code,
      name: p.name,
      email: p.email || '',
      phone: p.phone,
      locationId: this.plan.outlet,
      locationName: outletNames[this.plan.outlet],
      date: dateStr,
      time: timeStr,
      guests: p.party,
      seating: seatingFinal,
      occasion: occasionOverride !== undefined ? occasionOverride : (p.occasion || ''),
      notes: notes !== undefined && notes !== null ? notes : (p.notes || ''),
      tableId: table ? table.id : null,
      tableLabel: table ? table.id : null,
      tableType: table ? table.type : null,
      tableZone: table ? table.zone : null,
      status: status || 'confirmed',
      createdAt: nowIso
    };
  }

  /** Run the whole customer journey. Resolves when the customer leaves. */
  async run() {
    const p = this.plan.persona;
    const outlet = this.plan.outlet;

    this.log.info(this.tag(), 'LIFECYCLE',
      `arrival outlet=${outlet} channel=${this.plan.channel} party=${p.party} pref=${p.pref} temperament=${p.temperament}` +
      (p.slot ? ` target=${p.slotDate} ${p.slot}` : ' (walk-in at the door)'));

    // page-load sync (real client does this on DOMContentLoaded)
    const sync0 = await this.adapter.getReservations();
    if (sync0.list) this.view = sync0.list;

    // browse / think
    let think;
    if (this.plan.channel === 'walkin') think = this.rng.int(2, 8) * 1000;
    else if (this.plan.channel === 'phone') think = this.rng.int(5, 20) * 1000;
    else if (p.temperament === 'impulsive') think = this.rng.int(8, 35) * 1000;
    else if (p.temperament === 'picky') think = this.rng.int(60, 180) * 1000;
    else think = this.rng.int(20, 120) * 1000;
    await this.clock.waitVirtual(think, this.tag());
    if (this.pool.stopped) { this.outcome = 'stopped'; return; }

    if (this.plan.channel === 'walkin') return this.runWalkIn();

    // ---------- online / phone booking flow ----------
    const dateStr = p.slotDate;
    const wantSlot = p.slot;

    // slot chips the customer is willing to try, in order
    const trySlots = [wantSlot];
    if (p.temperament !== 'impulsive') {
      const idx = TIME_SLOTS.indexOf(wantSlot);
      for (const off of [1, -1, 2, -2]) {
        const t = TIME_SLOTS[idx + off];
        if (t) trySlots.push(t);
      }
    } else if (TIME_SLOTS.indexOf(wantSlot) + 1 < TIME_SLOTS.length) {
      trySlots.push(TIME_SLOTS[TIME_SLOTS.indexOf(wantSlot) + 1]);
    }

    let attempts = 0;
    const maxAttempts = p.temperament === 'picky' ? 3 : p.temperament === 'balanced' ? 2 : 1;

    for (const slot of trySlots) {
      if (attempts >= maxAttempts) break;
      attempts++;

      // the customer looks at the chip grid (stale local view)
      const grid = this.replicaGrid(outlet, dateStr, p.party, p.pref);
      const chip = grid.find(g => g.time === slot);
      if (chip && chip.status === 'full' && this.rng.chance(p.temperament === 'impulsive' ? 0.65 : p.temperament === 'balanced' ? 0.35 : 0.15)) {
        this.outcome = 'abandoned-grid-full';
        this.log.info(this.tag(), 'BOOKING', `abandoned: grid shows ${slot} full for party=${p.party} pref=${p.pref} (view ${this.view.length} records)`, { slot, date: dateStr });
        return this.finish();
      }

      // submit path == createReservation(): sync, then client-side check, then POST
      const sync = await this.adapter.getReservations();
      if (sync.list) this.view = sync.list;
      const check = this.replicaCheck(outlet, dateStr, slot, p.party, p.pref);

      if (!check.available) {
        this.log.info(this.tag(), 'BOOKING', `client-side rejection at ${slot}: ${check.message}`);
        this.pool.noteClientReject();
        continue; // next slot
      }

      const table = check.table;
      let record = this.buildRecord({ table, timeStr: slot, dateStr, status: 'confirmed' });

      // chaos mutation of the payload, if assigned
      if (this.chaos && this.chaos.kind === 'invalid-payload') record = this.chaos.mutate(record, this.rng);
      if (this.chaos && this.chaos.kind === 'clock-skew') record = this.chaos.skew(record, this.rng);

      // POST (the real client ignores the response — we log it)
      const postOpts = {};
      if (this.chaos && this.chaos.kind === 'abandoned-request') postOpts.abortAtMs = this.chaos.abortAtMs;
      const res = await this.adapter.postReservation(record, postOpts);

      if (this.chaos && this.chaos.kind === 'double-submit') {
        // impatient double-click: same payload again ~80ms later
        await new Promise(r => setTimeout(r, 80));
        const res2 = await this.adapter.postReservation(record);
        this.log.warn(this.tag(), 'CHAOS', `double-submit: second POST returned HTTP ${res2.status} (server has no idempotency — expect duplicate code)`, { code: record.code });
      }
      if (this.chaos && this.chaos.kind === 'rapid-fire') {
        this.log.warn(this.tag(), 'CHAOS', `rapid-fire: hammering ${this.chaos.count} POSTs`, {});
        const burst = [];
        for (let i = 0; i < this.chaos.count; i++) {
          burst.push(this.adapter.postReservation(record));
          await new Promise(r => setTimeout(r, 25));
        }
        await Promise.all(burst);
      }

      if (!res.ok && res.status !== 201) {
        if (res.aborted && res.status === 0) {
          this.log.error(this.tag(), 'NETWORK', 'NETWORK', 'GHOST',
            `POST aborted mid-flight (chaos). The real server may still have processed it — watch for a ghost booking of ${record.code}.`,
            { code: record.code, abortAtMs: postOpts.abortAtMs, error: res.error });
          this.outcome = 'post-aborted-may-ghost';
        } else {
          this.log.error(this.tag(), 'SERVER', 'SERVER', '',
            `POST rejected with HTTP ${res.status}`, { code: record.code, body: res.body, latencyMs: res.latencyMs });
          this.outcome = 'post-rejected';
        }
      } else {
        this.outcome = 'booked';
      }

      this.record = record;
      this.pool.registerBooking(this, record, res);
      return this.finish();
    }

    this.outcome = 'abandoned-no-slot';
    this.log.info(this.tag(), 'BOOKING', `abandoned after ${attempts} attempt(s): no acceptable slot`, {});
    return this.finish();
  }

  /** Walk-in flow — replica of booking.js createWalkInReservation: NO collision check at all. */
  async runWalkIn() {
    const p = this.plan.persona;
    const outlet = this.plan.outlet;
    const dateStr = dateOf(this.clock.now());
    const timeStr = timeOf(this.clock.now()); // HH:MM now

    // the host glances at the floor canvas (local view) and picks a table
    const all = [];
    for (const [zone, zoneTables] of Object.entries(locationTables[outlet])) {
      for (const t of zoneTables) all.push({ ...t, zone });
    }
    const fits = all.filter(t => t.capacity >= p.party).sort((a, b) => a.capacity - b.capacity);
    if (fits.length === 0) {
      this.outcome = 'walkin-left-no-table';
      this.log.info(this.tag(), 'WALKIN', `left: no table fits ${p.party} at ${outlet}`);
      return this.finish();
    }
    const nowMin = toMin(timeStr);
    const looksFree = fits.filter(t => !this.view.some(r => {
      if (!ACTIVE_STATUSES(r.status)) return false;
      if (r.locationId !== outlet || r.date !== dateStr) return false;
      if (r.tableId !== t.id) return false;
      return Math.abs(nowMin - toMin(r.time)) < TURN_MINUTES;
    }));

    let table;
    if (looksFree.length > 0) {
      table = looksFree[0]; // best-fit first-free (like a host scanning the map)
    } else if (this.rng.chance(0.3)) {
      // busy host seats a walk-in on a table that looks busy (real-world mistake)
      table = fits[0];
      this.log.warn(this.tag(), 'WALKIN', `host seated walk-in on ${table.id} although the (stale) view shows it busy — no check performed, like the real client`);
    } else {
      this.outcome = 'walkin-left-floor-full';
      this.log.info(this.tag(), 'WALKIN', `left: floor looks full for party=${p.party} (view-based)`);
      return this.finish();
    }

    const record = this.buildRecord({
      table, timeStr, dateStr,
      status: 'seated',
      notes: 'Walk-in seated from floor plan',
      seating: table.zone
    });
    record.seatedAt = new Date(this.clock.now()).toISOString();

    const res = await this.adapter.postReservation(record);
    if (!res.ok && res.status !== 201) {
      this.log.error(this.tag(), 'SERVER', 'SERVER', '', `walk-in POST rejected HTTP ${res.status}`, { code: record.code, body: res.body });
      this.outcome = 'walkin-post-rejected';
    } else {
      this.outcome = 'walkin-seated';
      this.log.info(this.tag(), 'WALKIN', `seated at ${table.id} (${table.zone}) for ${p.party}, time=${timeStr} — no availability check was performed (faithful to createWalkInReservation)`);
    }
    this.record = record;
    this.pool.registerBooking(this, record, res, { walkin: true });
    return this.finish();
  }

  finish() {
    this.state = 'done';
    this.pool.done(this);
    this.log.debug(this.tag(), 'LIFECYCLE', `done outcome=${this.outcome}`);
    return this.outcome;
  }
}
