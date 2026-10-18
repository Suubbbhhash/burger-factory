// ============================================
// SIMULATION — VIRTUAL FLOOR MANAGER
// One per outlet. Mirrors manager.js behavior:
// refreshes the dashboard (GET), seats confirmed
// parties at their slot time (respecting persona
// punctuality), marks no-shows after the 15-minute
// grace, completes seated parties after their turn.
// Every action is a real PATCH against the server.
// ============================================

import { toMin, TURN_MINUTES, j, dateOf } from '../util.js';

const GRACE_MIN = 15;

export class VirtualManager {
  constructor({ outlet, clock, adapter, logger, ledger, rng, pool }) {
    this.outlet = outlet;
    this.clock = clock;
    this.adapter = adapter;
    this.log = logger;
    this.ledger = ledger;
    this.rng = rng;
    this.pool = pool;
    this.view = [];
    this.nextLoopAt = 0;         // virtual epoch of next loop iteration
    this.seatedByCode = new Set(); // codes this manager already seated
    this.noShowByCode = new Set();
    this.completedByCode = new Set();
    this.actions = 0;
    this.running = true;
  }

  actor() { return `MGR-${this.outlet}`; }

  /** Called from the engine tick loop. Non-blocking; returns true if it did work. */
  async tick() {
    if (!this.running) return false;
    const now = this.clock.now();
    if (now < this.nextLoopAt) return false;
    // schedule next loop: every 2-5 virtual minutes inside the service window
    this.nextLoopAt = now + this.rng.int(2, 5) * 60000;

    const dateStr = dateOf(now);
    const mins = toMin(this.clock.timeStr());

    // dashboard refresh (like refreshDashboard + syncReservationsFromServer)
    const sync = await this.adapter.getReservations();
    if (sync.list) this.view = sync.list;

    const todays = this.view.filter(r => r.locationId === this.outlet && r.date === dateStr);
    let did = false;

    for (const r of todays) {
      const code = r.code || r.id;
      const slotMin = toMin(r.time);
      const info = this.ledger.get(code);
      const persona = info?.persona || null;

      if (r.status === 'confirmed') {
        const isNoShowPersona = persona && persona.punctuality === 'no-show';
        // no-show decision (only once) — never for personas that will arrive
        if (isNoShowPersona && !this.noShowByCode.has(code) && mins >= slotMin + GRACE_MIN) {
          this.noShowByCode.add(code);
          const res = await this.adapter.patchStatus(code, 'no-show', 'Guest did not arrive within grace window');
          this.log.info(this.actor(), 'LIFECYCLE', `marked NO-SHOW ${code} (slot ${r.time}, grace ${GRACE_MIN}m passed)`, { http: res.status, latencyMs: res.latencyMs });
          this.pool.noteNoShow(); this.actions++;
          if (this.ledger.has(code)) this.ledger.get(code).statusVirtual = 'no-show';
          continue;
        }
        if (!persona && !this.noShowByCode.has(code) && mins >= slotMin + GRACE_MIN + 5) {
          // external record (pre-existing seed) that never showed up
          this.noShowByCode.add(code);
          await this.adapter.patchStatus(code, 'no-show', 'Guest did not arrive');
          this.log.info(this.actor(), 'LIFECYCLE', `marked NO-SHOW ${code} (external record)`);
          this.actions++;
          continue;
        }
        // seating decision (skip no-show personas entirely)
        if (!isNoShowPersona && !this.seatedByCode.has(code)) {
          let seatAt = slotMin;
          if (persona && persona.punctuality === 'late') seatAt = slotMin + persona.lateMin;
          if (mins >= seatAt && mins < 1440) {
            this.seatedByCode.add(code);
            const res = await this.adapter.patchStatus(code, 'seated');
            this.log.info(this.actor(), 'LIFECYCLE', `seated ${code} at ${this.clock.timeStr()} (slot ${r.time}${persona && persona.punctuality === 'late' ? `, arrived ${persona.lateMin}m late` : ''})`, { http: res.status, latencyMs: res.latencyMs });
            this.pool.noteSeated(); this.actions++;
            if (this.ledger.has(code)) {
              this.ledger.get(code).statusVirtual = 'seated';
              this.ledger.get(code).seatedAtVirt = this.clock.now();
            }
          }
        }
      } else if (r.status === 'seated') {
        if (!this.completedByCode.has(code)) {
          const seatedRef = info?.seatedAtVirt || (r.seatedAt ? Date.parse(r.seatedAt) : this.clock.now());
          const turn = persona?.turnMin || TURN_MINUTES;
          if (this.clock.now() >= seatedRef + turn * 60000) {
            this.completedByCode.add(code);
            const res = await this.adapter.patchStatus(code, 'completed');
            this.log.info(this.actor(), 'LIFECYCLE', `completed ${code} (turn ${turn}m done)`, { http: res.status, latencyMs: res.latencyMs });
            this.pool.noteCompleted(); this.actions++; did = true;
            if (this.ledger.has(code)) this.ledger.get(code).statusVirtual = 'completed';
          }
        }
      }
    }
    return did;
  }

  stop() { this.running = false; }
}
