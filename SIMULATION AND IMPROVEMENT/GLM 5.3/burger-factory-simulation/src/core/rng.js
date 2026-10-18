// ============================================
// SIMULATION — SEEDED RNG (deterministic worlds)
// mulberry32 core + fork derivation.
// Same seed => same narrative (arrivals, personas,
// decisions). HTTP latency stays real-world.
// ============================================

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple string hash for fork derivation. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed, tag = 'root') {
    this.seed = typeof seed === 'string' ? hashStr(seed) : (seed >>> 0);
    this.tag = tag;
    this._f = mulberry32(this.seed);
    this._calls = 0;
  }

  /** float [0,1) */
  float() { this._calls++; return this._f(); }

  /** int min..max inclusive */
  int(min, max) { return min + Math.floor(this.float() * (max - min + 1)); }

  /** true with probability p */
  chance(p) { return this.float() < p; }

  /** pick one element */
  pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }

  /** pick from [[value, weight], ...] */
  weighted(pairs) {
    let total = 0;
    for (const p of pairs) total += p[1];
    let r = this.float() * total;
    for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }

  /** approx normal, mean sd */
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.float(), v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Fisher-Yates */
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const k = Math.floor(this.float() * (i + 1));
      [a[i], a[k]] = [a[k], a[i]];
    }
    return a;
  }

  /** Derive an independent child rng — deterministic from (seed, tag, salt). */
  fork(salt) { return new Rng(hashStr(`${this.seed}:${this.tag}:${salt}`), `${this.tag}/${salt}`); }
}

/** Random 6-char seed like BF-9F3A2C */
export function randomSeedTag() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `BF-${s}`;
}
