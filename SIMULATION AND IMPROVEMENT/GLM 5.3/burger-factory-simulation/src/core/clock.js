// ============================================
// SIMULATION — VIRTUAL CLOCK
// Dual-time model:
//   * VIRTUAL time drives the story (arrivals, think
//     times, manager loops, service windows) at
//     `acceleration` x real time.
//   * REAL time is what the server experiences; every
//     HTTP round-trip is measured in real ms and
//     stamped into the log next to the virtual time.
// A response that arrives "late" in virtual terms is
// REAL server latency — that is the point.
// ============================================

import { istParts, dateOf, timeOf } from '../util.js';

const MIN_TICK = 50; // ms real per engine tick

export class SimClock {
  constructor({ startEpochMs, acceleration }) {
    this.startEpochMs = startEpochMs;      // virtual epoch of simulation start (11:30 IST anchor)
    this.acceleration = Math.max(1, acceleration);
    this._realStart = Date.now();
    this._waiters = [];                    // {deadline, resolve, tag}
    this._timer = null;
    this._stopped = false;
  }

  /** Current virtual epoch ms. */
  now() { return this.startEpochMs + (Date.now() - this._realStart) * this.acceleration; }

  /** Real ms elapsed since start. */
  realElapsed() { return Date.now() - this._realStart; }

  /** Virtual ms elapsed since start. */
  virtElapsed() { return this.now() - this.startEpochMs; }

  dayIndex() { return Math.floor(this.virtElapsed() / 86400000) + 1; }
  dateStr() { return dateOf(this.now()); }
  timeStr() { return timeOf(this.now()); }

  /** 'D2 19:04:37' for log lines. */
  stamp() {
    const p = istParts(this.now());
    return `D${this.dayIndex()} ${p.hh}:${p.mm}:${p.ss}`;
  }

  /** Wait `virtualMs` of simulated time. */
  waitVirtual(virtualMs, tag = '') {
    const deadline = this.now() + Math.max(0, virtualMs);
    return new Promise((resolve) => {
      this._waiters.push({ deadline, resolve, tag });
      this._waiters.sort((a, b) => a.deadline - b.deadline);
    });
  }

  /** Engine tick pump. Resolves waiters whose deadline has passed. */
  _tick() {
    if (this._stopped) return;
    const now = this.now();
    while (this._waiters.length && this._waiters[0].deadline <= now) {
      this._waiters.shift().resolve();
    }
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), MIN_TICK);
  }

  stop() {
    this._stopped = true;
    if (this._timer) clearInterval(this._timer);
    const w = this._waiters; this._waiters = [];
    for (const x of w) x.resolve();
  }

  /** Epoch of the next 04:00 IST day-roll strictly after `afterMs` (virtual). */
  nextDayRollAfter(afterMs) {
    const ist = afterMs + 330 * 60000;      // IST frame
    const day = Math.floor(ist / 86400000);
    const next0400IstFrame = (day + 1) * 86400000 + 4 * 3600000; // next day 04:00
    return next0400IstFrame - 330 * 60000;
  }
}

/** Resolve config.startDate into an epoch. Default: today 11:30 IST (service opens 12:30). */
export function resolveStartEpoch(startDateRaw) {
  const todayIst = new Date(Date.now() + 330 * 60000);
  if (startDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(String(startDateRaw))) {
    const [y, m, d] = String(startDateRaw).split('-').map(Number);
    return Date.UTC(y, m - 1, d, 6, 0, 0); // 06:00 UTC == 11:30 IST
  }
  return Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate(), 6, 0, 0);
}
