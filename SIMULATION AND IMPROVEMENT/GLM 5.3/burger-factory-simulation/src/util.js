// ============================================
// THE BURGER FACTORY SIMULATION — SHARED UTILITIES
// No dependencies. Node >= 18.
// ============================================

export const IST_OFFSET_MIN = 330; // +05:30 — the app serves Goa + New Delhi, both IST.

/** Format a wall-clock ms epoch as strict IST timestamp: 2026-10-18T14:02:11.482+05:30 */
export function fmtIST(ms) {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  return (
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` +
    `T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}.${String(d.getUTCMilliseconds()).padStart(3, '0')}+05:30`
  );
}

/** Compact clock string: 14:02:11 */
export function fmtClock(ms) {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Virtual-date parts in IST */
export function istParts(ms) {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  return {
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    hh: String(d.getUTCHours()).padStart(2, '0'),
    mm: String(d.getUTCMinutes()).padStart(2, '0'),
    ss: String(d.getUTCSeconds()).padStart(2, '0'),
    weekday: d.getUTCDay() // 0=Sun .. 6=Sat
  };
}

export function dateOf(ms) { return istParts(ms).date; }
export function timeOf(ms) { const p = istParts(ms); return `${p.hh}:${p.mm}`; }

/** 'HH:MM' -> minutes since midnight */
export function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** minutes since midnight -> 'HH:MM' */
export function toHHMM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const TURN_MINUTES = 90; // matches src/js/booking.js TURN_MINUTES

/** Epoch of midnight IST of the day containing ms. All day-anchored math MUST use this. */
export function istMidnight(ms) {
  const shifted = ms + IST_OFFSET_MIN * 60000;
  return ms - (shifted - Math.floor(shifted / 86400000) * 86400000);
}

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function pct(n, total) { return total ? ((100 * n) / total).toFixed(1) + '%' : '0.0%'; }

/** Poisson sampler (Knuth) — used by the demand engine. */
export function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // normal approximation for large rates
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.gauss()));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.float(); } while (p > L && k < 10000);
  return k - 1;
}

/** Percentile from a sorted-ascending array. */
export function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.ceil((q / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx];
}

/** Stable compact JSON for log contexts. */
export function j(obj, maxLen = 420) {
  if (obj === null || obj === undefined) return 'null';
  let s;
  try { s = JSON.stringify(obj); } catch { s = String(obj); }
  if (s.length > maxLen) s = s.slice(0, maxLen) + `…(+${s.length - maxLen}b)`;
  return s;
}

/** Minimal CLI parser: --key value | --flag (true) | --key=value */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
    else out[a.slice(2)] = true;
  }
  return out;
}
