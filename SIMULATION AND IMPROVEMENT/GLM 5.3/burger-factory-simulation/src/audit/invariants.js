// ============================================
// SIMULATION — INVARIANT AUDITOR
// The simulation continuously re-reads the server's
// own data file (GET /api/v1/reservations) and checks
// invariants that MUST hold in a correct system:
//   1. no table double-booked (90-min turn rule)
//   2. booking codes unique
//   3. guests never exceed the table's capacity
//   4. status transitions follow the state machine
//   5. every successful POST survives on the server
//   6. online/phone records use real TIME_SLOTS
//   7. SSE broadcast parity with mutations
// Violations are logged as DATA/VALIDATION/SSE errors
// with the offending records attached — this is the
// "txt file that helps resolving the errors".
// ============================================

import { getTable, TIME_SLOTS, outletIds, tablesByOutlet } from '../demand/outlets.js';
import { toMin, TURN_MINUTES, j } from '../util.js';

const ACTIVE = (st) => !['cancelled', 'no-show', 'completed'].includes(st);
const WALKIN_NOTE = 'Walk-in seated from floor plan';

// Legal single-hop transitions (from -> allowed set)
const LEGAL = {
  confirmed: new Set(['seated', 'cancelled', 'no-show', 'confirmed']),
  seated: new Set(['completed', 'seated']),
  completed: new Set(['completed']),
  cancelled: new Set(['cancelled']),
  'no-show': new Set(['no-show'])
};

/**
 * Reachability closure: every status reachable from `from` through ANY
 * number of legal hops. Snapshots under-sample (a record can legally
 * pass confirmed->seated->completed between two audits), so a violation
 * is only real when the new status is NOT in the closure of the old one.
 */
const CLOSURE = {};
for (const key of Object.keys(LEGAL)) {
  const seen = new Set([key]);
  const queue = [key];
  while (queue.length) {
    const cur = queue.shift();
    for (const nxt of LEGAL[cur] || []) {
      if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
    }
  }
  seen.delete(key);
  CLOSURE[key] = seen;
}

export class Auditor {
  constructor({ adapter, logger, clock, ledger, auditCfg }) {
    this.adapter = adapter;
    this.log = logger;
    this.clock = clock;
    this.ledger = ledger;               // Map code -> {posted, postedOk, channel, ...}
    this.cfg = auditCfg || {};
    this.mutations = 0;
    this.prevStatuses = new Map();      // code -> status at last audit
    this.baselineCodes = new Set();     // codes that existed before the run
    this._reported = new Set();         // dedupe of invariant violations
    this.violations = [];               // {kind, detail, atVirt}
    this.lastResult = null;
  }

  onMutation() {
    this.mutations++;
    const every = this.cfg.everyMutations || 250;
    if (this.mutations % every === 0) return this.audit(`rolling #${this.mutations}`);
    return null;
  }

  /** Full audit pass. Returns {records, active, newViolations}. */
  async audit(reason) {
    const { list, res } = await this.adapter.getReservations();
    if (list === null) {
      if (!this._reported.has('audit-get-fail')) {
        this._reported.add('audit-get-fail');
        this.log.error('AUDIT', 'AUDIT', 'SERVER', '', `audit "${reason}" could not read server state`, { status: res.status, error: res.error });
      }
      return null;
    }
    let newViolations = 0;
    const seen = new Set();

    // ---- 1. double-booking (90-min rule, same outlet+date+table) ----
    const byTable = new Map(); // key -> [record]
    for (const r of list) {
      if (!ACTIVE(r.status)) continue;
      if (!r.tableId || !r.date || !r.time) continue;
      const key = `${r.locationId}|${r.date}|${r.tableId}`;
      if (!byTable.has(key)) byTable.set(key, []);
      byTable.get(key).push(r);
    }
    for (const [key, recs] of byTable) {
      for (let a = 0; a < recs.length; a++) {
        for (let b = a + 1; b < recs.length; b++) {
          const ra = recs[a], rb = recs[b];
          if (Math.abs(toMin(ra.time) - toMin(rb.time)) < TURN_MINUTES) {
            const sig = `dbl:${ra.code}|${rb.code}`;
            if (!this._reported.has(sig)) {
              this._reported.add(sig);
              newViolations++;
              this.violations.push({ kind: 'double-book', atVirt: this.clock.now(), detail: { table: key, a: pick(ra), b: pick(rb) } });
              this.log.error('AUDIT', 'AUDIT', 'DATA', 'DBL-BOOK',
                `table ${key} double-booked: ${ra.code} (${ra.time}, ${ra.status}) overlaps ${rb.code} (${rb.time}, ${rb.status})`,
                { a: pick(ra), b: pick(rb), reason });
            }
          }
        }
      }
    }

    // ---- 2. duplicate codes ----
    const codeCount = new Map();
    for (const r of list) {
      const c = r.code || r.id;
      if (!c) continue;
      codeCount.set(c, (codeCount.get(c) || 0) + 1);
    }
    for (const [code, n] of codeCount) {
      if (n > 1) {
        const sig = `dup:${code}`;
        if (!this._reported.has(sig)) {
          this._reported.add(sig);
          newViolations++;
          this.violations.push({ kind: 'dup-code', atVirt: this.clock.now(), detail: { code, count: n } });
          this.log.error('AUDIT', 'AUDIT', 'DATA', 'DUP-CODE', `booking code ${code} exists on ${n} records`, { code, count: n, reason });
        }
      }
    }

    // ---- 3. capacity + 4. transitions + 6. slot sanity ----
    for (const r of list) {
      if (seen.has(r.code || r.id)) continue;
      seen.add(r.code || r.id);
      const table = getTable(r.locationId, r.tableId);
      const guests = Number(r.guests) || 0;

      if (table && guests > table.capacity) {
        const sig = `cap:${r.code || r.id}:${guests}`;
        if (!this._reported.has(sig)) {
          this._reported.add(sig);
          newViolations++;
          this.violations.push({ kind: 'over-capacity', atVirt: this.clock.now(), detail: { rec: pick(r), tableCap: table.capacity } });
          this.log.error('AUDIT', 'AUDIT', 'VALIDATION', 'OVER-CAP',
            `record ${r.code || r.id} has ${guests} guests on table ${r.tableId} (capacity ${table.capacity})`,
            { rec: pick(r), reason });
        }
      }

      const isWalkin = String(r.notes || '').includes(WALKIN_NOTE) || r.status === 'seated' && !TIME_SLOTS.includes(r.time);
      if (!isWalkin && r.time && !TIME_SLOTS.includes(r.time)) {
        const sig = `slot:${r.code || r.id}:${r.time}`;
        if (!this._reported.has(sig)) {
          this._reported.add(sig);
          newViolations++;
          this.log.error('AUDIT', 'AUDIT', 'VALIDATION', '',
            `record ${r.code || r.id} time ${r.time} is outside the published slot grid (and is not a walk-in)`, { rec: pick(r), reason });
        }
      }

      // timestamps sanity: seated must carry seatedAt
      if (r.status === 'seated' && !r.seatedAt) {
        const sig = `ts:${r.code || r.id}`;
        if (!this._reported.has(sig)) {
          this._reported.add(sig);
          newViolations++;
          this.log.error('AUDIT', 'AUDIT', 'DATA', '', `seated record ${r.code || r.id} is missing seatedAt`, { rec: pick(r), reason });
        }
      }
    }

    // ---- 4b. transition legality vs previous snapshot (closure-aware) ----
    for (const r of list) {
      const code = r.code || r.id;
      const prev = this.prevStatuses.get(code);
      if (prev && prev !== r.status) {
        const reachable = CLOSURE[prev];
        if (reachable && !reachable.has(r.status)) {
          const sig = `tr:${code}:${prev}->${r.status}`;
          if (!this._reported.has(sig)) {
            this._reported.add(sig);
            newViolations++;
            this.violations.push({ kind: 'illegal-transition', atVirt: this.clock.now(), detail: { code, from: prev, to: r.status } });
            this.log.error('AUDIT', 'AUDIT', 'DATA', 'ILLEGAL-TR',
              `record ${code} transitioned ${prev} -> ${r.status} (not reachable through any legal path)`, { from: prev, to: r.status, reason });
          }
        }
      }
      this.prevStatuses.set(code, r.status);
    }

    // ---- 5. lost records: our successful POSTs that vanished ----
    for (const [code, info] of this.ledger) {
      if (!info.postedOk) continue;
      if (this.baselineCodes.has(code)) continue;
      const onServer = seen.has(code);
      if (!onServer && !info.reportedLost) {
        info.reportedLost = true;
        newViolations++;
        this.violations.push({ kind: 'lost-record', atVirt: this.clock.now(), detail: { code } });
        this.log.error('AUDIT', 'AUDIT', 'DATA', 'LOST-REC',
          `booking ${code} (POST accepted ${info.postedAtStr}) is no longer present on the server`, { code, outlet: info.outlet, reason });
      }
    }

    // ---- 7. SSE parity ----
    const parity = this.adapter.sseParity(this.cfg.sseGraceMs || 2500);
    if (parity.missing.length) {
      const isFinal = String(reason).includes('teardown');
      const sig = 'sse-parity';
      if (!this._reported.has(sig) || isFinal) {
        this._reported.add(sig);
        if (isFinal) newViolations++; // count the final gap as a real violation
        const byAction = {};
        for (const m of parity.missing) byAction[m.action] = (byAction[m.action] || 0) + 1;
        this.violations.push({ kind: 'sse-gap', atVirt: this.clock.now(), detail: { count: parity.missing.length, byAction } });
        this.log.error('AUDIT', 'AUDIT', 'SSE', 'SSE-GAP',
          `${parity.missing.length} accepted mutations never produced an SSE reservations:changed event`,
          { missing: parity.missing.slice(0, 15), byAction, expected: parity.expected, received: parity.received, reason });
      }
    }

    const active = list.filter(r => ACTIVE(r.status)).length;
    this.lastResult = { records: list.length, active, newViolations, reason };
    this.log.info('AUDIT', 'AUDIT', `audit "${reason}": ${list.length} records, ${active} active, ${newViolations} new violation(s), errors so far ${this.log.errorCount}`);
    return this.lastResult;
  }
}

function pick(r) {
  return {
    code: r.code || r.id, name: r.name, outlet: r.locationId, date: r.date, time: r.time,
    guests: r.guests, table: r.tableId, zone: r.tableZone, status: r.status,
    seatedAt: r.seatedAt || null, createdAt: r.createdAt || null, notes: r.notes || ''
  };
}

/** Ledger factory (owned by orchestrator, shared with auditor + managers). */
export function newLedger() {
  return new Map();
}
