// ============================================
// SIMULATION — DEMAND ENGINE
// Non-homogeneous arrival process per outlet:
//   * 30-minute buckets across the 12:00-23:00 service window
//   * lunch / shoulder / dinner shape
//   * weekend + season multipliers (Goa high season default)
//   * channel mix (online / walk-in / phone)
// Full persona is generated at PLAN time from a forked
// rng so every run with the same seed produces the
// exact same population and the exact same story.
// ============================================

import { outletIds, TIME_SLOTS } from './outlets.js';
import { makeIdentity, makeNotes, makeOccasion } from './names.js';
import { poisson, clamp, toMin, toHHMM, istParts, istMidnight, TURN_MINUTES } from '../util.js';

/** Weekday baseline booking attempts per outlet per day (high season, all channels). */
const OUTLET_BASE = {
  anjuna: 58, morjim: 48, vagator: 34, nerul: 21,
  'dona-paula': 27, panaji: 40, delhi: 44
};

/** 21 buckets 12:00..22:30, share of daily volume (normalized in code). */
const BUCKETS = [
  { from: 12 * 60, share: 0.020, walkin: 0.10 },  // 12:00-12:30
  { from: 12.5 * 60, share: 0.075, walkin: 0.13 }, // 12:30-13:00
  { from: 13 * 60, share: 0.080, walkin: 0.14 },
  { from: 13.5 * 60, share: 0.065, walkin: 0.14 },
  { from: 14 * 60, share: 0.050, walkin: 0.13 },
  { from: 14.5 * 60, share: 0.040, walkin: 0.12 },
  { from: 15 * 60, share: 0.032, walkin: 0.11 },
  { from: 15.5 * 60, share: 0.030, walkin: 0.11 },
  { from: 16 * 60, share: 0.028, walkin: 0.12 },
  { from: 16.5 * 60, share: 0.025, walkin: 0.13 },
  { from: 17 * 60, share: 0.030, walkin: 0.15 },
  { from: 17.5 * 60, share: 0.038, walkin: 0.17 },
  { from: 18 * 60, share: 0.048, walkin: 0.20 },
  { from: 18.5 * 60, share: 0.062, walkin: 0.23 },
  { from: 19 * 60, share: 0.080, walkin: 0.27 },
  { from: 19.5 * 60, share: 0.085, walkin: 0.30 },
  { from: 20 * 60, share: 0.070, walkin: 0.30 },
  { from: 20.5 * 60, share: 0.055, walkin: 0.28 },
  { from: 21 * 60, share: 0.035, walkin: 0.24 },
  { from: 21.5 * 60, share: 0.020, walkin: 0.18 },
  { from: 22 * 60, share: 0.008, walkin: 0.12 }   // 22:00-22:30 last stragglers
];

/** Slot weights over TIME_SLOTS (normalized in code). */
const SLOT_W = [
  0.075, 0.075, 0.075, 0.050, 0.040,
  0.030, 0.020, 0.020, 0.020, 0.020,
  0.025, 0.040, 0.060, 0.080, 0.090,
  0.075, 0.055, 0.035, 0.020, 0.012
];

const TEMPERAMENTS = [['impulsive', 30], ['balanced', 50], ['picky', 20]];
const PARTY_ONLINE = [[1, 4], [2, 34], [3, 10], [4, 28], [5, 6], [6, 12], [7, 2], [8, 4]];
const PARTY_WALKIN = [[1, 6], [2, 40], [3, 14], [4, 26], [5, 6], [6, 6], [7, 1], [8, 1]];

/** Seating preferences per outlet (weights). */
const PREFS = {
  default: [['any', 38], ['indoor', 20], ['outdoor', 22], ['beachside', 10], ['rooftop', 10]],
  morjim: [['any', 30], ['indoor', 12], ['outdoor', 22], ['beachside', 30], ['rooftop', 6]],
  delhi: [['any', 30], ['indoor', 22], ['outdoor', 16], ['beachside', 2], ['rooftop', 30]],
  panaji: [['any', 34], ['indoor', 40], ['outdoor', 18], ['beachside', 4], ['rooftop', 4]],
  nerul: [['any', 34], ['indoor', 44], ['outdoor', 16], ['beachside', 2], ['rooftop', 4]]
};

function dayFactorFor(weekday, weekendFactor) {
  // weekday: 0=Sun..6=Sat
  if (weekday === 6) return weekendFactor;        // Saturday peak
  if (weekday === 5) return weekendFactor * 0.82; // Friday
  if (weekday === 0) return weekendFactor * 0.88; // Sunday
  return 1.0;
}

export class DemandEngine {
  constructor(worldRng, config, clock) {
    this.rng = worldRng;
    this.config = config;
    this.clock = clock;
    this.plan = [];       // sorted [{at, outlet, channel, persona}]
  }

  /** Build the entire multi-day arrival plan (deterministic). */
  buildPlan() {
    const days = this.config.days;
    const startDay = this.clock.startEpochMs;
    const season = this.config.demand.seasonFactor ?? 1.15;
    const mult = this.config.demand.multiplier ?? 1;

    for (let d = 0; d < days; d++) {
      const dayStart = istMidnight(this.clock.startEpochMs) + d * 86400000; // midnight IST anchor
      const weekday = istParts(dayStart + 3600000).weekday; // mid-day, safe
      const dayFactor = dayFactorFor(weekday, this.config.demand.weekendFactor ?? 1.7);

      for (const outlet of outletIds) {
        const expected = OUTLET_BASE[outlet] * dayFactor * season * mult;
        // per-bucket poisson
        for (const b of BUCKETS) {
          const n = poisson(expected * b.share, this.rng);
          for (let i = 0; i < n; i++) {
            const at = dayStart + b.from * 60000 + this.rng.int(0, 29) * 60000 + this.rng.int(0, 59) * 1000;
            const channel = this._channel(b, this.rng);
            const salt = `p:${d}:${outlet}:${b.from}:${i}`;
            const persona = this._persona(outlet, channel, at, salt, d, days);
            this.plan.push({ at, outlet, channel, persona, salt });
          }
        }
      }
    }

    // warmup bookings: a handful of phone bookings minutes after open
    const warm = this.config.warmup || { minutes: 30, bookings: 4 };
    for (let i = 0; i < (warm.bookings ?? 4); i++) {
      const outlet = outletIds[i % outletIds.length];
      const at = this.clock.startEpochMs + this.rng.int(2, Math.max(3, warm.minutes ?? 30)) * 60000;
      const salt = `w:${i}`;
      const persona = this._persona(outlet, 'phone', at, salt, 0, days);
      this.plan.push({ at, outlet, channel: 'phone', persona, salt });
    }

    this.plan.sort((x, y) => x.at - y.at);
    return this.plan;
  }

  _channel(bucket, rng) {
    const r = rng.float();
    const phoneP = 0.09;
    if (r < phoneP) return 'phone';
    if (r < phoneP + bucket.walkin) return 'walkin';
    return 'online';
  }

  _persona(outlet, channel, atArrival, salt, dayIndex, totalDays) {
    const rng = this.rng.fork(salt);
    const identity = makeIdentity(rng);
    const party = channel === 'walkin' ? rng.weighted(PARTY_WALKIN) : rng.weighted(PARTY_ONLINE);
    const pref = rng.weighted(PREFS[outlet] || PREFS.default);
    const temperament = rng.weighted(TEMPERAMENTS);
    const punctRoll = rng.float();
    const punctuality = punctRoll < 0.08 ? 'no-show' : punctRoll < 0.23 ? 'late' : 'on-time';
    const lateMin = punctuality === 'late' ? rng.int(5, 14) : 0;
    const turnMin = clamp(Math.round(rng.gauss(TURN_MINUTES, 10)), 70, 115);

    const p = {
      ...identity, party, pref, temperament, punctuality, lateMin, turnMin,
      occasion: makeOccasion(rng), notes: makeNotes(rng),
      channel, outlet, salt
    };

    if (channel === 'walkin') {
      p.slot = null; p.slotDate = null; p.cancelAt = null;
      return p;
    }

    // ---- pick target slot/date ----
    const offWeights = [[0, 45], [1, 25], [2, 12], [3, 8], [4, 4], [5, 3], [6, 3]];
    let off = rng.weighted(offWeights);
    off = Math.min(off, totalDays - 1 - dayIndex);
    if (off < 0) off = 0;
    const slotIdx = rng.weighted(SLOT_W.map((w, i) => [i, w]));
    const slot = TIME_SLOTS[slotIdx];
    const slotDayStart = istMidnight(this.clock.startEpochMs) + (dayIndex + off) * 86400000; // midnight IST
    const slotEpoch = slotDayStart + toMin(slot) * 60000;

    // ---- lead time -> arrival ----
    let leadMin;
    if (off === 0) leadMin = rng.int(45, 360);
    else if (off === 1) leadMin = rng.int(20 * 60, 28 * 60);
    else leadMin = rng.int(44 * 60, Math.min(156 * 60, off * 1440 + 60));
    if (channel === 'phone' && off === 0 && rng.chance(0.6)) leadMin = rng.int(25, 120);

    let arrival = slotEpoch - leadMin * 60000;
    // clamp: nobody books before 10:45 local; keep inside sim window
    const dayOfArrival = Math.floor((arrival + 330 * 60000) / 86400000);
    const earliestOk = dayOfArrival * 86400000 - 330 * 60000 + (10 * 60 + 45) * 60000;
    if (arrival < earliestOk) arrival = earliestOk + rng.int(0, 90) * 60000;
    if (arrival < this.clock.startEpochMs + 60000) arrival = this.clock.startEpochMs + rng.int(1, 8) * 60000;
    if (arrival > slotEpoch - 30 * 60000) arrival = slotEpoch - 30 * 60000;
    p.at = arrival;

    p.slot = slot;
    p.slotDate = istParts(slotEpoch).date;
    p.slotEpoch = slotEpoch;

    // pre-arrival cancellation scheduling
    if (rng.chance(0.12)) {
      const lo = arrival + 5 * 60000;
      const hi = slotEpoch - 40 * 60000;
      p.cancelAt = hi > lo ? lo + rng.float() * (hi - lo) : null;
    } else p.cancelAt = null;

    return p;
  }

  /** Plan digest for the run header / report. */
  describe() {
    const byOutlet = {}; const byChannel = {}; const byDay = {};
    for (const e of this.plan) {
      byOutlet[e.outlet] = (byOutlet[e.outlet] || 0) + 1;
      byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
      const d = istParts(e.at).date;
      byDay[d] = (byDay[d] || 0) + 1;
    }
    return { total: this.plan.length, byOutlet, byChannel, byDay };
  }
}

export const CURVES_DOC = { OUTLET_BASE, BUCKETS, SLOT_W, TEMPERAMENTS, PARTY_ONLINE, PARTY_WALKIN, PREFS };
