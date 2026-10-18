#!/usr/bin/env node
// ==========================================================================
// THE BURGER FACTORY - MULTI-DAY RESTAURANT SIMULATOR
// --------------------------------------------------------------------------
// Drives hundreds/thousands of virtual customers + hosts + a chaos prober
// against the LAN/dev API (vite.config.js) over virtual days, then audits the
// resulting database with an "oracle" and writes everything to .txt logs.
//
// Usage (run from the repo root, where vite.config.js + src/js/data.js live):
//   node tools/simulate.mjs --spawn --days 7 --seed 42
//
// Flags:
//   --spawn            start an ISOLATED vite server on a scratch DB (recommended)
//   --target URL       use an already-running server (default http://127.0.0.1:3100)
//   --force            allow running against a server whose DB is your real data
//   --days N           virtual days to simulate (default 7)
//   --seed N           RNG seed; same seed => same customer plan (default 1234)
//   --scale X          demand multiplier (default 1.0; try 0.3 .. 3)
//   --rush N           customers in each Fri/Sat 17:00 booking stampede (default 40)
//   --race-ms N        real-ms jitter window for actions in the same virtual minute (default 25)
//   --drop P           probability a request is lost before reaching the server (default 0.004)
//   --start YYYY-MM-DD first virtual date (default: today)
//   --out DIR          log directory (default sim_logs)
// ==========================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { locationTables, locations } from '../src/js/data.js';

// ----------------------------- config ------------------------------------
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) o[k] = true; else { o[k] = nxt; i++; }
  }
  return o;
}
const A = parseArgs(process.argv.slice(2));
const todayStr = new Date().toISOString().slice(0, 10);
const CFG = {
  spawn: !!A.spawn,
  force: !!A.force,
  target: (A.target || 'http://127.0.0.1:3100').replace(/\/$/, ''),
  days: +(A.days ?? 7),
  seed: +(A.seed ?? 1234),
  scale: +(A.scale ?? 1),
  rush: +(A.rush ?? 40),
  raceMs: +(A['race-ms'] ?? 25),
  drop: +(A.drop ?? 0.004),
  start: A.start || todayStr,
  out: A.out || 'sim_logs'
};
const DRAIN_MIN = 360; // let the last evening finish
const TOTAL_MIN = CFG.days * 1440 + DRAIN_MIN;
const TURN = 90; // mirrors TURN_MINUTES in booking.js
const TIME_SLOTS = ['12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00',
  '17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30','22:00'];
const SLOT_W = [3,5,6,4,2,1,.7,.5,.7,1,2,3,5,8,10,10,8,5,2.5,1];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOW_MULT = [1.3, .6, .6, .7, .8, 1.2, 1.6];
const POP = { anjuna: 1.3, vagator: 1.2, morjim: 1.2, 'dona-paula': .9, panaji: .9, nerul: .8, delhi: 1.0 };
const BASE_BOOKINGS_PER_TABLE = 2.4; // booked turns per table per average day at --scale 1
const LOC_IDS = Object.keys(locationTables);

// ----------------------------- RNG ---------------------------------------
class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  rand() { let t = (this.s += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  int(a, b) { return a + Math.floor(this.rand() * (b - a + 1)); }
  chance(p) { return this.rand() < p; }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
  gauss() { let u = 0, v = 0; while (!u) u = this.rand(); while (!v) v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  poisson(l) { if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * this.gauss())); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= this.rand(); } while (p > L); return k - 1; }
  weighted(items, w) { const tot = w.reduce((a, b) => a + b, 0); let x = this.rand() * tot; for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; } return items[items.length - 1]; }
}
const PLAN = new Rng(CFG.seed);

// ----------------------------- time helpers ------------------------------
const sp = CFG.start.split('-').map(Number);
const dayDate = d => new Date(Date.UTC(sp[0], sp[1] - 1, sp[2] + d));
const dateOfDay = d => dayDate(d).toISOString().slice(0, 10);
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const vt = m => `D${String(Math.floor(m / 1440) + 1).padStart(2, '0')} ${DOW[dayDate(Math.floor(m / 1440)).getUTCDay()]} ${hhmm(m % 1440)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let NOW = 0; // current virtual minute

// ----------------------------- logging -----------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(CFG.out, `run-${stamp}-seed${CFG.seed}`);
fs.mkdirSync(OUT, { recursive: true });
const evStream = fs.createWriteStream(path.join(OUT, 'simulation_events.txt'));
const ev = (tag, msg) => evStream.write(`[${vt(NOW)}] ${tag.padEnd(9)} ${msg}\n`);
const clip = (x, n = 700) => { const s = typeof x === 'string' ? x : JSON.stringify(x); return s && s.length > n ? s.slice(0, n) + `...(+${s.length - n} chars)` : s; };
const errors = []; const catCount = {}; const seenKeys = new Set();
const SEV_RANK = { CRITICAL: 0, ERROR: 1, WARN: 2, INFO: 3 };
function finding({ cat, sev = 'ERROR', actor = '-', action = '-', detail, request, response, key }) {
  if (key) { if (seenKeys.has(key)) return; seenKeys.add(key); }
  catCount[cat] = (catCount[cat] || 0) + 1;
  const e = { id: errors.length + 1, cat, sev, vt: vt(NOW), wall: new Date().toISOString(), actor, action, detail, request: request && clip(request), response: response && clip(response) };
  if (catCount[cat] <= 200) errors.push(e);
  ev(sev, `${cat} #${e.id} ${detail}`);
}

// ----------------------------- http + stats ------------------------------
const lat = {}; const M = {
  attempts: 0, firstChoice: 0, alternative: 0, lost: 0, rejectedClient: 0, booked: 0, cancelled: 0, cancelWrongPhone: 0,
  cancelNotFound: 0, noShow: 0, seated: 0, completed: 0, lateAfterNoShow: 0, walkInSeated: 0, walkInTurnedAway: 0,
  walkouts: 0, overstayBlocks: 0, drops: 0, doubleClicks: 0, lookups: 0, expectedBroadcasts: 0, seatedMinutes: {}, covers: {}
};
async function http(method, p, body, { raw = false } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(CFG.target + p, {
      method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)), signal: AbortSignal.timeout(20000)
    });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    const ms = performance.now() - t0; const key = `${method} ${p.split('?')[0]}`;
    (lat[key] ||= []).push({ ms, bytes: text.length, day: Math.floor(NOW / 1440) });
    return { ok: res.ok, status: res.status, json, text, ms, bytes: text.length };
  } catch (err) { return { ok: false, status: 0, error: String(err.message || err), ms: performance.now() - t0, bytes: 0 }; }
}
const brief = p => `HTTP ${p.status} ${p.json && Array.isArray(p.json.reservations) ? `{success:${p.json.success},reservations:[${p.json.reservations.length} records]}` : clip(p.text || p.error || '', 160)}`;
const getAll = async () => { const r = await http('GET', '/api/v1/reservations'); return r.ok && Array.isArray(r.json?.reservations) ? r.json.reservations : null; };

// ----------------------------- inventory ---------------------------------
const tableIndex = {};
for (const [loc, zones] of Object.entries(locationTables)) for (const [zone, ts] of Object.entries(zones)) for (const t of ts) tableIndex[t.id] = { loc, zone, ...t };
const tablesOf = loc => Object.entries(locationTables[loc]).flatMap(([zone, ts]) => ts.map(t => ({ ...t, zone })));
const locName = id => { const l = locations.find(x => x.id === id); return l ? `${l.name}, ${l.area}` : id; };
const ACTIVE = new Set(['confirmed', 'seated']);

// Port of booking.js checkAvailability() - same collision rule, same zone map, same fallback.
function checkAvailability(reservations, { locationId, date, time, guests, seating }) {
  const tables = locationTables[locationId]; if (!tables) return { available: false, message: 'Location not found' };
  let all = tablesOf(locationId);
  if (seating && seating !== 'any') {
    const prefMap = { indoor: ['indoor'], outdoor: ['outdoor', 'beachside', 'rooftop'], beachside: ['beachside', 'outdoor'], rooftop: ['rooftop', 'outdoor'] };
    const allowed = prefMap[seating] || [seating]; const f = all.filter(t => allowed.includes(t.zone)); if (f.length) all = f;
  }
  all = all.filter(t => t.capacity >= guests).sort((a, b) => a.capacity - b.capacity);
  if (!all.length) return { available: false, message: `No single table accommodates ${guests} guests` };
  const rm = toMin(time);
  for (const t of all) {
    const hit = reservations.some(r => !['cancelled', 'no-show', 'completed'].includes(r.status) && r.locationId === locationId && r.date === date && r.tableId === t.id && Math.abs(rm - toMin(r.time)) < TURN);
    if (!hit) return { available: true, table: t };
  }
  return { available: false, message: 'All suitable tables are booked for this time slot' };
}

// ----------------------------- ledger (ground truth) ---------------------
const ledger = new Map(); // code -> what the guest/host was TOLD happened
const mkCode = r => { const C = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = 'BF-'; for (let i = 0; i < 6; i++) s += C[r.int(0, C.length - 1)]; return s; };
function note(code, status, actor, res) {
  const L = ledger.get(code); if (!L) return;
  L.expected = status; L.writers.push({ vt: vt(NOW), min: NOW, actor, status, http: res?.status });
}
const FIRST = ['Arjun','Meera','Ravi','Sanjana','Aditya','Priya','Rohan','Ananya','Vikram','Neha','Karan','Isha','Sameer','Divya','Nikhil','Tanvi','Rahul','Pooja','Aman','Sneha','Dev','Kavya','Manish','Riya'];
const LAST = ['Kapoor','Nair','Desai','Reddy','Shetty','Fernandes','DSouza','Naik','Gupta','Mehta','Sharma','Patel','Kamat','Prabhu','Verma','Iyer'];
function customer(r) {
  const phone = `+91 ${r.int(6, 9)}${r.int(1000, 9999)} ${r.int(10000, 99999)}`;
  return { name: `${r.pick(FIRST)} ${r.pick(LAST)}`, phone, email: r.chance(.6) ? `guest${r.int(100, 99999)}@example.com` : '' };
}
const partySize = r => r.weighted([2, 3, 4, 5, 6, 7, 8, 9, 10, 12], [35, 12, 28, 8, 8, 3, 3, 1.5, 1, .5]);
const last4 = p => (p || '').replace(/\D/g, '').slice(-4);

// ----------------------------- virtual phone (client port) ---------------
class Phone {
  constructor() { this.local = []; }
  async sync() { const a = await getAll(); if (a) this.local = a; return !!a; }
  // port of createReservation(): sync -> check -> local push -> POST (errors swallowed, like the real client)
  async book(d, r, actor) {
    await this.sync();
    const av = checkAvailability(this.local, d);
    if (!av.available) return { success: false, message: av.message };
    const code = mkCode(r);
    const res = { id: code, code, name: d.name, email: d.email, phone: d.phone, locationId: d.locationId, locationName: locName(d.locationId), date: d.date, time: d.time,
      guests: d.guests, seating: d.seating, occasion: '', notes: '', tableId: av.table.id, tableLabel: av.table.id, tableType: av.table.type, tableZone: av.table.zone,
      status: 'confirmed', createdAt: new Date().toISOString() };
    this.local.push(res);
    const post = await postReservation(res, r, actor);
    return { success: true, reservation: res, post };
  }
}
async function postReservation(res, r, actor) {
  if (r && r.chance(CFG.drop)) { M.drops++; ev('NETDROP', `${actor}: POST ${res.code} lost before reaching server`); return { status: 0, dropped: true }; }
  const p = await http('POST', '/api/v1/reservations', { reservation: res });
  if (p.status === 201) M.expectedBroadcasts++;
  else finding({ cat: 'HTTP_FAILURE', actor, action: `POST reservation ${res.code}`, detail: `POST returned ${p.status} ${p.error || ''}`, request: res, response: brief(p) });
  return p;
}
async function patchStatus(code, status, reason, r, actor) {
  if (r && r.chance(CFG.drop)) { M.drops++; ev('NETDROP', `${actor}: PATCH ${code}->${status} lost before reaching server`); return { status: 0, dropped: true }; }
  const p = await http('PATCH', '/api/v1/reservations/status', { code, status, ...(reason ? { reason } : {}) });
  if (p.ok) M.expectedBroadcasts++;
  else if (p.status === 404 && ledger.get(code)?.serverAck === false) ev('GHOSTOP', `${actor}: PATCH ${code}->${status} 404 (booking never reached server)`);
  else finding({ cat: 'HTTP_FAILURE', actor, action: `PATCH ${code}->${status}`, detail: `PATCH returned ${p.status} ${p.error || ''}`, request: { code, status }, response: brief(p) });
  return p;
}

// ----------------------------- event queue -------------------------------
const buckets = new Array(TOTAL_MIN + 1); let nextId = 1;
function push(m, e) { if (m <= NOW) m = NOW + 1; if (m > TOTAL_MIN) return; e.id = nextId++; e.rng = new Rng(CFG.seed * 7919 + e.id * 104729); (buckets[m] ||= []).push(e); }
function pushPlan(m, e) { if (m > TOTAL_MIN) return; e.id = nextId++; e.rng = new Rng(CFG.seed * 7919 + e.id * 104729); (buckets[m] ||= []).push(e); }

// ----------------------------- demand planning ---------------------------
function planBooking(T, loc, over = {}) {
  const slot = over.slot || PLAN.weighted(TIME_SLOTS, SLOT_W);
  const appt = T * 1440 + toMin(slot);
  const lead = over.lead ?? PLAN.weighted([0, 1, 2, 3, 5, 7, 14], [35, 15, 15, 12, 10, 8, 5]);
  let bookDay = T - lead; if (bookDay < 0) bookDay = PLAN.int(0, Math.min(2, T));
  let m;
  if (over.m !== undefined) m = over.m;
  else if (bookDay === T) m = T * 1440 + PLAN.int(Math.max(480, toMin(slot) - 300), toMin(slot) - 20);
  else { const band = PLAN.weighted([[540, 660], [660, 840], [840, 1020], [1020, 1320], [1320, 1440]], [.2, .2, .15, .38, .07]); m = bookDay * 1440 + PLAN.int(band[0], band[1] - 1); }
  pushPlan(m, { type: 'BOOK', loc, T, slot, appt, rush: !!over.rush });
}
function planAll() {
  for (let T = 0; T < CFG.days; T++) {
    const dow = dayDate(T).getUTCDay();
    for (const loc of LOC_IDS) {
      const n = PLAN.poisson(CFG.scale * BASE_BOOKINGS_PER_TABLE * tablesOf(loc).length * (POP[loc] || 1) * DOW_MULT[dow]);
      for (let i = 0; i < n; i++) planBooking(T, loc);
      // walk-in demand: every 15 min during service hours
      for (let m = 750; m <= 1290; m += 15) {
        const hw = (m >= 1110 && m <= 1290) ? 1.0 : (m >= 750 && m <= 870) ? .6 : .25;
        const k = PLAN.poisson(CFG.scale * tablesOf(loc).length * (POP[loc] || 1) * DOW_MULT[dow] * .022 * hw);
        for (let i = 0; i < k; i++) pushPlan(T * 1440 + m + PLAN.int(0, 14), { type: 'WALKIN', loc, tries: 0 });
      }
    }
    // booking stampede (viral post / Friday-Saturday dinner rush): same outlet, same slot, same minute
    if (CFG.rush > 0 && (dow === 5 || dow === 6)) {
      const loc = PLAN.pick(['anjuna', 'vagator', 'morjim']); const slot = PLAN.pick(['19:30', '20:00']);
      for (let i = 0; i < CFG.rush; i++) planBooking(T, loc, { slot, lead: 0, m: T * 1440 + 17 * 60 + (i % 3), rush: true });
    }
    // chaos prober
    pushPlan(T * 1440 + PLAN.int(600, 1000), { type: 'PROBE', suite: T === Math.min(1, CFG.days - 1) ? 'full' : 'mini' });
  }
}

// ----------------------------- event handlers ----------------------------
async function onBook(e) {
  const r = e.rng; M.attempts++;
  const cust = customer(r); const guests = partySize(r);
  const zones = Object.keys(locationTables[e.loc]);
  const seating = r.chance(.35) ? 'any' : r.pick(zones);
  const phone = new Phone(); const actor = `cust:${cust.name}`;
  const order = [e.slot, ...TIME_SLOTS.filter(s => s !== e.slot).sort((a, b) => Math.abs(toMin(a) - toMin(e.slot)) - Math.abs(toMin(b) - toMin(e.slot)))];
  const maxAlt = r.chance(.6) ? 3 : 0;
  let res = null, tries = 0;
  const dbl = r.chance(.02);
  for (; tries <= maxAlt; tries++) {
    const d = { ...cust, locationId: e.loc, date: dateOfDay(e.T), time: order[tries], guests, seating };
    if (e.T === Math.floor(NOW / 1440) && toMin(d.time) < (NOW % 1440) + 15) continue; // can't book a past slot
    if (dbl && tries === 0) { // impatient double-tap on "Confirm"
      M.doubleClicks++;
      const [a, b] = await Promise.all([phone.book(d, r, actor), phone.book(d, r, actor + '(2nd tap)')]);
      res = a.success ? a : b; if (b.success && a.success) registerBooking(b, e, d, actor + '(2nd tap)');
    } else res = await phone.book(d, r, actor);
    if (res.success) { registerBooking(res, e, d, actor); break; }
    M.rejectedClient++; ev('REJECT', `${actor} wanted ${d.locationId} ${d.date} ${d.time} x${guests}/${seating}: ${res.message}`); res = null;
  }
  if (res) { tries === 0 ? M.firstChoice++ : M.alternative++; } else { M.lost++; ev('LOST', `${actor} gave up (${e.loc} ${e.slot} x${guests})`); return; }
  const code = res.reservation.code; const appt = toMin(res.reservation.time) + toMin('00:00') + e.T * 1440; const lr = r;
  M.booked++;
  // ---- guest fate ----
  if (lr.chance(.12) && appt - 25 > NOW + 5) push(lr.int(NOW + 5, appt - 25), { type: 'CANCEL', code, wrongFirst: lr.chance(.08) });
  else if (lr.chance(.09)) { /* never turns up */ }
  else push(appt + Math.max(-10, Math.min(35, Math.round(lr.gauss() * 7 + 2))), { type: 'ARRIVE', code, tries: 0 });
  push(appt + 20, { type: 'NOSHOW_CHECK', code });
  if (lr.chance(.1)) push(Math.max(NOW + 1, appt - lr.int(30, 240)), { type: 'LOOKUP', code, wrong: lr.chance(.1) });
}
function registerBooking(res, e, d, actor) {
  const rec = res.reservation;
  ledger.set(rec.code, { code: rec.code, rec, actor, acked: true, serverAck: res.post.status === 201, expected: 'confirmed', writers: [{ vt: vt(NOW), min: NOW, actor, status: 'confirmed', http: res.post.status }], source: 'online' });
  ev('BOOKED', `${actor} ${rec.code} ${rec.locationId} ${rec.date} ${rec.time} x${rec.guests} -> ${rec.tableId}${e.rush ? ' [rush]' : ''}${res.post.dropped ? ' [POST DROPPED]' : ''}`);
}

async function onArrive(e) {
  const L = ledger.get(e.code); if (!L || L.expected === 'cancelled' || L.expected === 'seated' || L.expected === 'completed') return;
  const all = await getAll(); if (!all) return;
  const me = all.find(x => x.code === e.code); const rec = me || L.rec;
  if (L.expected === 'no-show' && e.tries === 0) { M.lateAfterNoShow++; ev('LATE', `${e.code} arrives after being marked no-show; host reinstates`); }
  const occ = all.find(x => x.status === 'seated' && x.locationId === rec.locationId && x.tableId === rec.tableId && x.code !== e.code);
  if (occ) {
    M.overstayBlocks++; L.waiting = true;
    finding({ cat: 'OVERSTAY_BLOCKS_ARRIVAL', sev: 'INFO', actor: 'host', action: `seat ${e.code}`, detail: `table ${rec.tableId} still occupied by ${occ.code} when ${e.code} arrived (turn=${TURN} min is a fixed assumption)` });
    if (e.tries < 4) { push(NOW + 5, { ...e, tries: e.tries + 1 }); return; }
    M.walkouts++; const p = await patchStatus(e.code, 'cancelled', 'walkout: table not freed', e.rng, 'host'); note(e.code, 'cancelled', 'host', p); ev('WALKOUT', `${e.code} left after waiting`); return;
  }
  const p = await patchStatus(e.code, 'seated', null, e.rng, 'host'); note(e.code, 'seated', 'host', p); L.seatedAt = NOW; M.seated++;
  M.covers[rec.locationId] = (M.covers[rec.locationId] || 0) + rec.guests;
  const dwell = Math.max(40, Math.min(170, Math.round(e.rng.gauss() * 18 + 66)));
  push(NOW + dwell, { type: 'COMPLETE', code: e.code });
  ev('SEATED', `${e.code} at ${rec.tableId} (dwell will be ${dwell}m)`);
}
async function onComplete(e) {
  const L = ledger.get(e.code); if (!L || L.expected !== 'seated') return;
  const p = await patchStatus(e.code, 'completed', null, e.rng, 'host'); note(e.code, 'completed', 'host', p); M.completed++;
  M.seatedMinutes[L.rec.locationId] = (M.seatedMinutes[L.rec.locationId] || 0) + (NOW - (L.seatedAt ?? NOW));
}
async function onNoShowCheck(e) {
  const L = ledger.get(e.code); if (!L || L.expected !== 'confirmed' || L.waiting) return;
  const p = await patchStatus(e.code, 'no-show', null, e.rng, 'host'); note(e.code, 'no-show', 'host', p); M.noShow++;
}
async function onCancel(e) {
  const L = ledger.get(e.code); if (!L || L.expected !== 'confirmed') return;
  const ph = new Phone(); await ph.sync();
  const found = ph.local.find(x => x.code === e.code);
  if (!found) {
    M.cancelNotFound++;
    finding({ cat: 'GHOST_CONFIRMATION', sev: 'CRITICAL', actor: L.actor, action: `cancel ${e.code}`, key: `GHOST:${e.code}`,
      detail: `guest was shown a confirmation for ${e.code} but the server has no such booking (customer tried to cancel: "not found")`, request: L.rec, response: `writers=${JSON.stringify(L.writers)}` });
    return;
  }
  if (e.wrongFirst) { M.cancelWrongPhone++; ev('CANCEL?', `${e.code} wrong last-4 entered, client rejects`); }
  if (last4(found.phone) !== last4(L.rec.phone)) return;
  const p = await patchStatus(e.code, 'cancelled', 'Cancelled by guest', e.rng, L.actor); note(e.code, 'cancelled', L.actor, p); M.cancelled++;
  ev('CANCELLED', `${e.code} by guest`);
}
async function onLookup(e) { M.lookups++; const ph = new Phone(); await ph.sync(); const f = ph.local.find(x => x.code === e.code); const L = ledger.get(e.code); if (!f && L) ev('LOOKUP', `${e.code} NOT FOUND for guest`); }

async function onWalkIn(e) {
  const r = e.rng; const party = Math.min(8, partySize(r)); const host = new Phone(); const actor = `host:${e.loc}`;
  await host.sync(); const date = dateOfDay(Math.floor(NOW / 1440)); const nowHM = hhmm(NOW % 1440); const nm = NOW % 1440;
  const free = tablesOf(e.loc).filter(t => t.capacity >= party).sort((a, b) => a.capacity - b.capacity).find(t =>
    !host.local.some(x => x.locationId === e.loc && x.tableId === t.id && x.date === date && ((x.status === 'seated') || (x.status === 'confirmed' && Math.abs(toMin(x.time) - nm) < TURN))));
  if (!free) {
    if (e.tries < 2 && r.chance(.5)) { push(NOW + 15, { ...e, tries: e.tries + 1 }); return; }
    M.walkInTurnedAway++; ev('TURNAWAY', `walk-in x${party} at ${e.loc}: no table`); return;
  }
  const c = customer(r); const code = mkCode(r);
  const rec = { id: code, code, name: c.name, email: '', phone: c.phone, locationId: e.loc, locationName: locName(e.loc), date, time: nowHM, guests: party, seating: free.zone,
    occasion: '', notes: 'Walk-in seated from floor plan', tableId: free.id, tableLabel: free.id, tableType: free.type, tableZone: free.zone, status: 'seated', createdAt: new Date().toISOString(), seatedAt: new Date().toISOString() };
  const post = await postReservation(rec, r, actor);
  ledger.set(code, { code, rec, actor, acked: true, serverAck: post.status === 201, expected: 'seated', seatedAt: NOW, writers: [{ vt: vt(NOW), min: NOW, actor, status: 'seated', http: post.status }], source: 'walkin' });
  M.walkInSeated++; M.covers[e.loc] = (M.covers[e.loc] || 0) + party;
  push(NOW + Math.max(40, Math.min(170, Math.round(r.gauss() * 18 + 66))), { type: 'COMPLETE', code });
  ev('WALKIN', `${code} x${party} seated at ${free.id}${post.dropped ? ' [POST DROPPED]' : ''}`);
}

// ---- chaos prober: things a real attacker, a buggy client or a clumsy host will do ----
let piiReported = false;
async function onProbe(e) {
  const r = e.rng; const mk = (over = {}) => { const code = `PROBE-${r.int(10000, 99999)}`; return { id: code, code, name: '__SIM_PROBE__', email: '', phone: '+91 90000 00000', locationId: 'anjuna', locationName: 'Anjuna', date: '2099-01-01', time: '19:00', guests: 2, seating: 'any', occasion: '', notes: '', tableId: 'ANJ-I1', tableLabel: 'ANJ-I1', tableType: '2-seater', tableZone: 'indoor', status: 'confirmed', createdAt: new Date().toISOString(), ...over }; };
  const neutralise = async code => { await http('PATCH', '/api/v1/reservations/status', { code, status: 'cancelled' }); };
  const a = 'prober'; const full = e.suite === 'full';
  // P1 invalid payloads must be rejected
  const bad = mk({ guests: -5, date: '1999-01-01', locationId: 'atlantis', phone: 'abc', name: '' });
  let p = await http('POST', '/api/v1/reservations', { reservation: bad }); if (p.status === 201) M.expectedBroadcasts++;
  if (p.status === 201) { finding({ cat: 'SERVER_ACCEPTS_INVALID', actor: a, action: 'POST garbage reservation', key: 'P1', detail: 'server stored a booking with guests=-5, date in 1999, unknown outlet, bad phone, empty name (should be 400)', request: bad, response: brief(p) }); await neutralise(bad.code); }
  p = await http('POST', '/api/v1/reservations', {}); if (p.status === 201) finding({ cat: 'SERVER_ACCEPTS_INVALID', actor: a, action: 'POST {}', key: 'P1b', detail: 'POST with an empty body returns 201 success:true although nothing was saved (clients will believe it worked)', request: '{}', response: brief(p) });
  p = await http('POST', '/api/v1/reservations', '{not json', { raw: true }); if (p.status !== 400) finding({ cat: 'SERVER_ACCEPTS_INVALID', actor: a, action: 'POST malformed JSON', key: 'P1c', detail: `malformed JSON should be 400, got ${p.status}`, response: brief(p) });
  // P2 conflicting booking sent straight to the API (bypassing client-side check) must be refused
  const victims = [...ledger.values()].filter(L => L.expected === 'confirmed' && L.serverAck && L.source === 'online'); const v = victims.length ? r.pick(victims) : null;
  if (v) {
    const dup = mk({ locationId: v.rec.locationId, date: v.rec.date, time: v.rec.time, tableId: v.rec.tableId, tableLabel: v.rec.tableId, tableZone: v.rec.tableZone, guests: v.rec.guests });
    p = await http('POST', '/api/v1/reservations', { reservation: dup });
    if (p.status === 201) { M.expectedBroadcasts++; finding({ cat: 'SERVER_NO_CONFLICT_CHECK', sev: 'CRITICAL', actor: a, action: `POST duplicate of ${v.code}`, key: 'P2', detail: `server accepted a 2nd booking for ${v.rec.tableId} ${v.rec.date} ${v.rec.time} which is already held by ${v.code}; only the browser prevents double-booking`, request: dup, response: brief(p) }); await neutralise(dup.code); }
  }
  // P3 auth + state machine on a throw-away record
  const t = mk({ date: '2099-02-02' }); p = await http('POST', '/api/v1/reservations', { reservation: t }); if (p.status === 201) M.expectedBroadcasts++;
  p = await http('PATCH', '/api/v1/reservations/status', { code: t.code, status: 'completed' });
  if (p.ok) finding({ cat: 'SECURITY_NO_AUTH', sev: 'CRITICAL', actor: a, action: 'PATCH status with no credentials/phone', key: 'P3', detail: 'any unauthenticated caller can change any booking status; the staff passcode and the phone-last-4 check exist only in browser JavaScript', request: { code: t.code, status: 'completed' }, response: brief(p) });
  p = await http('PATCH', '/api/v1/reservations/status', { code: t.code, status: 'seated' });
  if (p.ok) finding({ cat: 'STATE_MACHINE', actor: a, action: 'completed -> seated', key: 'P4', detail: 'server allows resurrecting a COMPLETED booking (terminal states are not enforced)', request: { code: t.code, status: 'seated' } });
  p = await http('PATCH', '/api/v1/reservations/status', { code: t.code, status: 'banana' });
  if (p.ok) finding({ cat: 'STATE_MACHINE', actor: a, action: 'status=banana', key: 'P5', detail: 'server accepts arbitrary status strings (no enum validation)', request: { code: t.code, status: 'banana' } });
  await neutralise(t.code);
  // P4 privacy: does the public list leak other guests' personal data?
  const all = await getAll();
  if (all && !piiReported && all.some(x => x.phone && !String(x.code).startsWith('PROBE'))) { piiReported = true; finding({ cat: 'SECURITY_PII_EXPOSURE', sev: 'CRITICAL', actor: a, action: 'GET /api/v1/reservations (anonymous)', key: 'P6', detail: `anonymous GET returns name+phone+email of all ${all.length} bookings; every customer phone downloads every other customer's data`, response: clip(all.find(x => x.phone), 300) }); }
  if (full) ev('PROBE', 'full probe suite finished');
}

// ----------------------------- oracle ------------------------------------
const parseHours = s => { const m = (s || '').match(/(\d+):(\d+)\s*(AM|PM)\s*[–-]\s*(\d+):(\d+)\s*(AM|PM)/i); if (!m) return null; const f = (h, mi, ap) => ((+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0)) * 60 + +mi; return { open: f(m[1], m[2], m[3]), close: f(m[4], m[5], m[6]) }; };
const slim = r => ({ code: r.code, name: r.name, phone: r.phone, loc: r.locationId, date: r.date, time: r.time, guests: r.guests, table: r.tableId, status: r.status, createdAt: r.createdAt });
async function oracle(label) {
  const all = await getAll();
  if (!all) { finding({ cat: 'SERVER_UNREACHABLE', sev: 'CRITICAL', actor: 'oracle', detail: `could not read reservations at ${label}` }); return; }
  const recs = all.filter(r => !String(r.code || r.id).startsWith('PROBE-'));
  const byCode = new Map(); const REQ = ['id', 'code', 'name', 'phone', 'locationId', 'date', 'time', 'guests', 'tableId', 'status', 'createdAt'];
  for (const r of recs) {
    if (byCode.has(r.code)) finding({ cat: 'DUPLICATE_CODE', actor: 'oracle', key: `DUP:${r.code}`, detail: `booking code ${r.code} exists twice`, request: [slim(byCode.get(r.code)), slim(r)] });
    byCode.set(r.code, r);
    const miss = REQ.filter(k => r[k] === undefined || r[k] === null || r[k] === ''); if (miss.length) finding({ cat: 'SCHEMA_VIOLATION', actor: 'oracle', key: `SCH:${r.code}`, detail: `${r.code} missing fields ${miss.join(',')}`, request: r });
    const t = tableIndex[r.tableId];
    if (!t || t.loc !== r.locationId) finding({ cat: 'TABLE_INTEGRITY', actor: 'oracle', key: `TI:${r.code}`, detail: `${r.code}: table ${r.tableId} does not belong to outlet ${r.locationId}`, request: slim(r) });
    else if (r.guests > t.capacity) finding({ cat: 'TABLE_INTEGRITY', actor: 'oracle', key: `CAP:${r.code}`, detail: `${r.code}: ${r.guests} guests on ${t.capacity}-seat table ${t.id}`, request: slim(r) });
    const loc = locations.find(l => l.id === r.locationId); const h = parseHours(loc?.hours);
    if (h && r.time && (toMin(r.time) >= h.close || toMin(r.time) < h.open)) finding({ cat: 'HOURS_VIOLATION', sev: 'WARN', actor: 'oracle', key: `HRS:${r.locationId}:${r.time}`, detail: `booking at ${r.time} at ${r.locationId} falls outside opening hours "${loc.hours}" (slot list is global, not per outlet)`, request: slim(r) });
  }
  // double booking
  const groups = new Map();
  for (const r of recs) if (ACTIVE.has(r.status)) { const k = `${r.locationId}|${r.date}|${r.tableId}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  for (const [k, arr] of groups) {
    arr.sort((a, b) => toMin(a.time) - toMin(b.time));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length && toMin(arr[j].time) - toMin(arr[i].time) < TURN; j++) {
      const a = arr[i], b = arr[j]; const dt = Math.abs(new Date(a.createdAt) - new Date(b.createdAt));
      const same = last4(a.phone) === last4(b.phone) && a.name === b.name;
      finding({ cat: 'DOUBLE_BOOKING', sev: 'CRITICAL', actor: 'oracle', action: `audit ${label}`, key: `DB:${[a.code, b.code].sort().join('/')}`,
        detail: `${a.code} (${a.time}) and ${b.code} (${b.time}) both hold ${a.tableId} on ${a.date} at ${a.locationId}; created ${dt} ms apart${same ? '; SAME GUEST (double-submit)' : ''}${dt < 500 ? ' => classic race' : ''}`, request: [slim(a), slim(b)] });
    }
  }
  // ledger comparison
  for (const [code, L] of ledger) {
    const s = byCode.get(code);
    if (!s) { if (L.acked) finding({ cat: 'GHOST_CONFIRMATION', sev: 'CRITICAL', actor: L.actor, action: 'audit', key: `GHOST:${code}`, detail: `${code} was confirmed to the guest/host but is missing on the server (client swallows network errors)`, request: L.rec, response: JSON.stringify(L.writers) }); continue; }
    if (s.status !== L.expected) {
      const w = L.writers.slice(-2); const concurrent = w.length === 2 && Math.abs(w[1].min - w[0].min) <= 1 && w[0].actor !== w[1].actor;
      finding({ cat: concurrent ? 'LAST_WRITE_WINS' : 'LOST_UPDATE', sev: concurrent ? 'WARN' : 'ERROR', actor: 'oracle', action: `audit ${label}`, key: `LU:${code}:${L.expected}:${s.status}`,
        detail: `${code}: UI/host was told "${L.expected}" but server says "${s.status}"`, request: slim(s), response: `writers=${JSON.stringify(L.writers)}` });
    }
  }
}

// ----------------------------- SSE listeners -----------------------------
const sseAbort = new AbortController(); const sse = [];
function startSse(name) {
  const st = { name, events: 0, bytes: 0, max: 0, connected: false }; sse.push(st);
  (async () => {
    try {
      const res = await fetch(CFG.target + '/api/v1/events', { signal: sseAbort.signal }); st.connected = true;
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); if (c.includes('reservations:changed')) { st.events++; st.bytes += c.length; st.max = Math.max(st.max, c.length); } } }
    } catch { /* aborted */ }
  })();
}

// ----------------------------- hints -------------------------------------
const HINTS = {
  DOUBLE_BOOKING: ['Availability is checked in the browser, then the result is POSTed. Two phones can both see the same table as free. The dev server (vite.config.js, POST /api/v1/reservations) appends whatever it receives; in production the findFirst-then-create in reservation.routes.ts runs at READ COMMITTED so two transactions can still both pass, and schema.prisma enables btree_gist but never declares the exclusion constraint.', 'vite.config.js POST handler; src/js/booking.js createReservation(); apps/api/src/modules/reservations/reservation.routes.ts ($transaction); prisma schema/migrations', 'Let the SERVER choose the table inside a lock/transaction. In Postgres add: ALTER TABLE reservations ADD CONSTRAINT no_table_overlap EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN (\'CONFIRMED\',\'SEATED\')); catch SQLSTATE 23P01 and retry the next candidate table. In the dev server add an async mutex and re-run checkAvailability() before pushing. Disable the Confirm button after first tap and send an idempotency key.'],
  SERVER_NO_CONFLICT_CHECK: ['The server trusts the client completely and never validates overlap.', 'vite.config.js POST /api/v1/reservations', 'Move checkAvailability() into the server handler and return 409 on conflict; client should re-fetch and offer another slot.'],
  GHOST_CONFIRMATION: ['The client wraps every fetch in try { ... } catch {} and shows success regardless, so a dropped/failed request still produces a confirmation screen and a booking code that the restaurant never received.', 'src/js/booking.js createReservation / createWalkInReservation / cancelReservation / updateReservationStatus (all "catch {}")', 'Show the confirmation only after a 201 from the server; on failure show an error + retry; keep an outbox with retry/backoff for the host tablet; never write to localStorage before the server acknowledges.'],
  LOST_UPDATE: ['Same swallowed-error pattern for status changes: the UI updates localStorage first, the PATCH may fail silently, and the next sync reverts the screen.', 'src/js/booking.js updateReservationStatus / cancelReservation', 'Update UI only after the server replies; surface failures to the host; add If-Match/version (or updatedAt) to PATCH to detect stale writes.'],
  LAST_WRITE_WINS: ['Two actors changed the same booking at nearly the same time (e.g. guest cancels while host marks no-show). No version check, last write wins.', 'PATCH /api/v1/reservations/status', 'Add optimistic concurrency (version column) and a transition table.'],
  HTTP_FAILURE: ['Server returned an error or timed out under load.', 'See response body in the example', 'Check server logs at the same wall-clock time; large payloads/timeouts usually mean the JSON-file store or SSE fan-out is saturated.'],
  SERVER_ACCEPTS_INVALID: ['The dev server stores payload.reservation unvalidated and even returns 201 for an empty body.', 'vite.config.js POST handler', 'Reuse packages/shared zod schemas (createReservationSchema) in the dev middleware; return 400/409/422 properly.'],
  STATE_MACHINE: ['No status transition rules on the server.', 'vite.config.js PATCH handler; apps/api floor.routes.ts PATCH /reservations/:code/status', 'Whitelist transitions: confirmed->seated|cancelled|no-show, seated->completed, no-show->seated (reinstate). completed/cancelled are terminal. Validate status against the enum.'],
  SECURITY_NO_AUTH: ['Mutation endpoints have no authentication. The passcode "burger123" is in client JS; phone-last-4 verification is performed in the browser only. In the Fastify API only /auth/me calls jwtVerify; floor routes (/walkin, status PATCH, /events, /manifest) have no preHandler.', 'vite.config.js; apps/api/src/modules/floor/floor.routes.ts; src/js/manager.js passcode gate', 'Add a Fastify preHandler (request.jwtVerify + role check) to the floor plugin; verify phoneLast4 server-side for guest cancel/lookup (already done in /reservations/cancel); remove hard-coded passcodes from shipped JS.'],
  SECURITY_PII_EXPOSURE: ['GET /api/v1/reservations returns the full reservation table (names, phones, emails) to anybody, because the browser needs it to compute availability.', 'vite.config.js GET handler; booking.js syncReservationsFromServer', 'Expose only an /availability endpoint (anonymous) and a staff-only list; never ship other guests\' PII to a customer browser.'],
  SERVER_UNREACHABLE: ['The server stopped answering.', 'Server console', 'Check crash logs / memory.'],
  DUPLICATE_CODE: ['Booking codes are generated client-side with Math.random and never checked for uniqueness on the server.', 'booking.js generateBookingCode', 'Generate on the server with a UNIQUE constraint and retry on conflict.'],
  SCHEMA_VIOLATION: ['Stored record lacks required fields.', 'POST handler', 'Validate on write.'],
  TABLE_INTEGRITY: ['A booking references a table that does not exist at that outlet or is too small.', 'POST handler / walk-in modal', 'Validate tableId/capacity on the server.'],
  HOURS_VIOLATION: ['TIME_SLOTS is one global list (12:30-22:00) but outlets have different hours (e.g. Panaji/Nerul close 10:00 PM, Delhi opens 12:00 and closes 11:00 PM).', 'booking.js TIME_SLOTS; packages/shared/constants.ts; data.js locations[].hours', 'Generate slots per outlet from its hours; make the last seating = close - turn time.'],
  OVERSTAY_BLOCKS_ARRIVAL: ['TURN_MINUTES is fixed at 90 for every party, but real dwell times vary (sim: ~66 +/- 18 min; calibrate to your real data). When a party overstays, the next booking arrives to an occupied table and there is no table-reassign endpoint or waitlist.', 'booking.js TURN_MINUTES; manager.js seat flow', 'Duration by party size, buffer time, a "move to another table" action, and a waitlist/ETA display for hosts.'],
  PERF_DEGRADATION: ['Every GET returns the whole reservation history and every write rewrites the whole JSON file and broadcasts the whole array over SSE, so cost grows with total records.', 'vite.config.js readDb/writeDb/broadcastSse; booking.js syncReservationsFromServer', 'Query by outlet+date, paginate, send SSE diffs (id + status) instead of full arrays, and move to Postgres.'],
  SSE_PAYLOAD_O_N: ['Each SSE event carries the entire reservations array (O(n) per event x number of connected screens).', 'vite.config.js broadcastSse payload', 'Broadcast {action, reservation} only; clients patch their local state.'],
  SSE_MISSED_EVENTS: ['Some connected screens did not receive all change events (no event ids/Last-Event-ID, no heartbeat, no replay).', 'vite.config.js SSE endpoint', 'Add event ids, heartbeats (": ping" every 15 s) and replay via Last-Event-ID.'],
  DATA_INCONSISTENT: ['Different parts of the code disagree on facts about the restaurant (e.g. declared seats vs real table sizes).', 'data.js locations[] vs locationTables; docs', 'Derive counts from one source of truth.']
};

// ----------------------------- static checks -----------------------------
function staticChecks() {
  for (const l of locations) {
    const ts = tablesOf(l.id); const seats = ts.reduce((s, t) => s + t.capacity, 0);
    if (l.tables !== ts.length || l.capacity !== seats) finding({ cat: 'DATA_INCONSISTENT', sev: 'WARN', actor: 'static', key: `SC:${l.id}`, detail: `${l.id}: card says ${l.tables} tables / ${l.capacity} seats, but locationTables has ${ts.length} tables / ${seats} seats` });
    const h = parseHours(l.hours);
    if (h) { const lastSlot = Math.max(...TIME_SLOTS.map(toMin)); const first = Math.min(...TIME_SLOTS.map(toMin));
      if (lastSlot >= h.close) finding({ cat: 'HOURS_VIOLATION', sev: 'WARN', actor: 'static', key: `SCH:${l.id}`, detail: `${l.id} closes ${hhmm(h.close)} but the last bookable slot is ${hhmm(lastSlot)} (a party seated then eats ${TURN} min after closing)` });
      if (first < h.open) finding({ cat: 'HOURS_VIOLATION', sev: 'WARN', actor: 'static', key: `SCO:${l.id}`, detail: `${l.id} opens ${hhmm(h.open)} but first slot is ${hhmm(first)}` });
      else if (first - h.open >= 30 || h.close - lastSlot >= 60) finding({ cat: 'HOURS_VIOLATION', sev: 'INFO', actor: 'static', key: `SCU:${l.id}`, detail: `${l.id} hours ${hhmm(h.open)}-${hhmm(h.close)} but slots only cover ${hhmm(first)}-${hhmm(lastSlot)} (lost bookable time)` }); }
  }
}

// ----------------------------- report ------------------------------------
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function perfFindings() {
  const g = lat['GET /api/v1/reservations'] || []; if (g.length < 20) return;
  const byDay = {}; for (const x of g) (byDay[x.day] ||= []).push(x);
  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b); const first = byDay[days[0]], lastd = byDay[days[days.length - 1]];
  const p95a = pct(first.map(x => x.ms), .95), p95b = pct(lastd.map(x => x.ms), .95); const bytesB = pct(lastd.map(x => x.bytes), .5);
  if (p95b > 150 || p95b > p95a * 3) finding({ cat: 'PERF_DEGRADATION', sev: 'WARN', actor: 'perf', key: 'PERF', detail: `GET /reservations p95 went from ${p95a.toFixed(0)} ms (day 1) to ${p95b.toFixed(0)} ms (day ${days[days.length - 1] + 1}); payload now ~${(bytesB / 1024).toFixed(0)} KB per call` });
}
function writeReports(wallSec, cfgLine) {
  const sev = { CRITICAL: 0, ERROR: 0, WARN: 0, INFO: 0 }; for (const e of errors) sev[e.sev]++;
  const totalByCat = Object.entries(catCount);
  const byCat = {}; for (const e of errors) (byCat[e.cat] ||= []).push(e);
  const cats = Object.keys(byCat).sort((a, b) => SEV_RANK[byCat[a][0].sev] - SEV_RANK[byCat[b][0].sev] || catCount[b] - catCount[a]);
  let t = `BURGER FACTORY SIMULATION - ERROR REPORT\n${'='.repeat(78)}\nRun finished : ${new Date().toISOString()}  (wall time ${wallSec.toFixed(0)} s)\nReproduce    : ${cfgLine}\nVirtual span : ${CFG.days} days from ${CFG.start} against ${CFG.target}\n\n`;
  t += `TOTALS: ${sev.CRITICAL} critical, ${sev.ERROR} error, ${sev.WARN} warning, ${sev.INFO} info  (distinct findings logged; raw counts per category below)\n\n`;
  t += `HOW TO USE THIS FILE\n  1. Fix top-to-bottom: CRITICAL first. Each category has: likely cause, files to open, suggested fix.\n  2. Re-run with the SAME --seed after fixing; the customer plan is identical, so a fixed bug disappears from this file.\n  3. simulation_events.txt has the full minute-by-minute story; search it for a booking code or the "#id" of a finding.\n\n`;
  t += `FINDINGS BY CATEGORY\n${'-'.repeat(78)}\n`;
  for (const c of cats) { const list = byCat[c]; const h = HINTS[c]; t += `[${list[0].sev}] ${c} - ${catCount[c]} occurrence(s), first at ${list[0].vt}\n`; if (h) t += `  Likely cause : ${h[0]}\n  Where to look: ${h[1]}\n  Suggested fix: ${h[2]}\n`; }
  t += `\nDETAILED EXAMPLES (first 3 per category)\n${'='.repeat(78)}\n`;
  for (const c of cats) { t += `\n### ${c}  (${catCount[c]} total)\n`; for (const e of byCat[c].slice(0, 3)) { t += `\n#${e.id} [${e.sev}] ${e.vt}  actor=${e.actor}  action=${e.action}\n  ${e.detail}\n`; if (e.request) t += `  request : ${e.request}\n`; if (e.response) t += `  response: ${e.response}\n`; } }
  t += `\n\nFULL CHRONOLOGICAL FINDING LIST\n${'='.repeat(78)}\n`;
  for (const e of errors) t += `#${String(e.id).padStart(4, '0')} ${e.vt} [${e.sev}] ${e.cat}: ${e.detail}\n`;
  fs.writeFileSync(path.join(OUT, 'simulation_errors.txt'), t);
  fs.writeFileSync(path.join(OUT, 'simulation_errors.json'), JSON.stringify({ config: CFG, counts: catCount, findings: errors }, null, 2));

  // summary
  let s = `BURGER FACTORY SIMULATION - SUMMARY\n${'='.repeat(78)}\nConfig: ${cfgLine}\n\nCUSTOMER FUNNEL\n  booking attempts        ${M.attempts}\n  first-choice success    ${M.firstChoice}\n  took alternative slot   ${M.alternative}\n  gave up (lost revenue)  ${M.lost}\n  client-side rejections  ${M.rejectedClient}\n  double-tap submits      ${M.doubleClicks}\nLIFECYCLE\n  cancelled ${M.cancelled} (wrong-phone retries ${M.cancelWrongPhone}) | no-show ${M.noShow} | seated ${M.seated} | completed ${M.completed}\n  late arrivals after no-show ${M.lateAfterNoShow} | arrivals blocked by overstay ${M.overstayBlocks} | walkouts ${M.walkouts}\nWALK-INS\n  seated ${M.walkInSeated} | turned away ${M.walkInTurnedAway}\nNETWORK\n  requests dropped by fault injector ${M.drops}\n\nPER-OUTLET (covers served, table utilisation of service hours 12:30-22:30)\n`;
  for (const loc of LOC_IDS) { const n = tablesOf(loc).length; const util = (M.seatedMinutes[loc] || 0) / (n * 600 * CFG.days) * 100; s += `  ${loc.padEnd(11)} tables ${String(n).padStart(2)}  covers ${String(M.covers[loc] || 0).padStart(5)}  utilisation ${util.toFixed(1)}%\n`; }
  s += `\nLATENCY (ms) / PAYLOAD\n`;
  for (const [k, a] of Object.entries(lat)) s += `  ${k.padEnd(36)} n=${String(a.length).padStart(6)}  p50=${pct(a.map(x => x.ms), .5).toFixed(0).padStart(4)}  p95=${pct(a.map(x => x.ms), .95).toFixed(0).padStart(4)}  p99=${pct(a.map(x => x.ms), .99).toFixed(0).padStart(4)}  max=${Math.max(...a.map(x => x.ms)).toFixed(0).padStart(5)}  avg bytes=${Math.round(a.reduce((q, x) => q + x.bytes, 0) / a.length)}\n`;
  const g = lat['GET /api/v1/reservations'] || []; if (g.length) { s += `\nGET /reservations GROWTH BY VIRTUAL DAY\n`; const byDay = {}; for (const x of g) (byDay[x.day] ||= []).push(x); for (const d of Object.keys(byDay).map(Number).sort((a, b) => a - b)) s += `  day ${String(d + 1).padStart(2)}  calls ${String(byDay[d].length).padStart(5)}  p95 ${pct(byDay[d].map(x => x.ms), .95).toFixed(0).padStart(4)} ms  median payload ${(pct(byDay[d].map(x => x.bytes), .5) / 1024).toFixed(0)} KB\n`; }
  s += `\nSSE LISTENERS (simulated manager tablets / customer pages)\n`; for (const x of sse) s += `  ${x.name.padEnd(16)} connected=${x.connected} events=${x.events} (server accepted ${M.expectedBroadcasts} broadcasting writes) avg ${(x.bytes / Math.max(1, x.events) / 1024).toFixed(0)} KB/event, max ${(x.max / 1024).toFixed(0)} KB\n`;
  s += `\nFINDING COUNTS: ${totalByCat.map(([c, n]) => `${c}=${n}`).join(', ') || 'none'}\n`;
  fs.writeFileSync(path.join(OUT, 'simulation_summary.txt'), s);
  return { sev, s };
}

// ----------------------------- server lifecycle --------------------------
let child = null;
async function startServer() {
  const rt = path.resolve('sim_runtime'); fs.rmSync(rt, { recursive: true, force: true }); fs.mkdirSync(path.join(rt, 'data'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'data', 'reservations.json'), '[]'); // empty DB: no seed rows
  fs.copyFileSync(path.resolve('vite.config.js'), path.join(rt, 'vite.config.js'));
  const port = new URL(CFG.target).port || '3100';
  child = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--port', port, '--host', '127.0.0.1', '--strictPort'], { cwd: rt, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(OUT, 'server_console.txt')); child.stdout.pipe(log); child.stderr.pipe(log);
  child.on('exit', c => { if (!stopping) finding({ cat: 'SERVER_UNREACHABLE', sev: 'CRITICAL', actor: 'harness', detail: `vite server process exited with code ${c} during the run` }); });
  for (let i = 0; i < 60; i++) { const r = await http('GET', '/api/v1/reservations'); if (r.ok) return; await sleep(500); }
  throw new Error('server did not start; see server_console.txt');
}
let stopping = false;

// ----------------------------- main --------------------------------------
async function main() {
  const t0 = Date.now();
  const cfgLine = `node tools/simulate.mjs ${CFG.spawn ? '--spawn ' : ''}--days ${CFG.days} --seed ${CFG.seed} --scale ${CFG.scale} --rush ${CFG.rush} --race-ms ${CFG.raceMs} --drop ${CFG.drop} --start ${CFG.start}`;
  console.log(`Output folder: ${OUT}\n${cfgLine}`);
  if (CFG.spawn) await startServer();
  else {
    const all = await getAll(); if (!all) throw new Error(`cannot reach ${CFG.target}`);
    if (all.length && !CFG.force) throw new Error(`server at ${CFG.target} already holds ${all.length} reservations (real data?). Use --spawn for an isolated DB, or --force to pollute it.`);
  }
  staticChecks(); planAll();
  ['manager-tablet-1', 'manager-tablet-2', 'customer-page'].forEach(startSse); await sleep(300);
  const HANDLERS = { BOOK: onBook, ARRIVE: onArrive, COMPLETE: onComplete, NOSHOW_CHECK: onNoShowCheck, CANCEL: onCancel, LOOKUP: onLookup, WALKIN: onWalkIn };
  let processed = 0, lastPrint = 0;
  for (let m = 0; m <= TOTAL_MIN; m++) {
    NOW = m; const evs = buckets[m]; buckets[m] = undefined;
    if (evs && evs.length) {
      const normal = evs.filter(e => e.type !== 'PROBE'); const probes = evs.filter(e => e.type === 'PROBE');
      await Promise.all(normal.map(async e => {
        if (normal.length > 1 && CFG.raceMs > 0) await sleep(e.rng.rand() * CFG.raceMs);
        try { await HANDLERS[e.type](e); } catch (err) { finding({ cat: 'HARNESS_EXCEPTION', sev: 'ERROR', actor: 'harness', action: e.type, detail: String(err.stack || err).split('\n').slice(0, 4).join(' | ') }); }
      }));
      for (const p of probes) { try { await onProbe(p); } catch (err) { finding({ cat: 'HARNESS_EXCEPTION', sev: 'ERROR', actor: 'harness', action: 'PROBE', detail: String(err) }); } }
      processed += evs.length;
    }
    if ((m + 1) % 1440 === 0 || m === TOTAL_MIN) {
      await oracle(`end of ${vt(m)}`);
      if (Date.now() - lastPrint > 1000) { lastPrint = Date.now(); console.log(`  ${vt(m)}  events=${processed}  findings=${errors.length}  attempts=${M.attempts}`); }
    }
  }
  perfFindings();
  // end-game probe: oversized body (run last so it cannot skew earlier measurements)
  NOW = TOTAL_MIN; { const big = { reservation: { id: 'PROBE-BIG', code: 'PROBE-BIG', name: '__SIM_PROBE__', phone: '+91 90000 00000', locationId: 'anjuna', date: '2099-03-03', time: '19:00', guests: 2, tableId: 'ANJ-I1', status: 'confirmed', notes: 'x'.repeat(1_000_000), createdAt: new Date().toISOString() } };
    const p = await http('POST', '/api/v1/reservations', big); if (p.status === 201) { M.expectedBroadcasts++; finding({ cat: 'SERVER_ACCEPTS_INVALID', actor: 'prober', key: 'P7', detail: 'server accepted a 1 MB "notes" field (schema says max 300 chars; no body-size limit => trivial DoS / DB bloat)', response: brief(p) }); await http('PATCH', '/api/v1/reservations/status', { code: 'PROBE-BIG', status: 'cancelled' }); } }
  await sleep(1500);
  for (const x of sse) {
    if (!x.connected) finding({ cat: 'SSE_MISSED_EVENTS', actor: x.name, key: `SSEC:${x.name}`, detail: `${x.name} never connected to /api/v1/events` });
    else if (x.events < M.expectedBroadcasts * 0.995) finding({ cat: 'SSE_MISSED_EVENTS', actor: x.name, key: `SSE:${x.name}`, detail: `${x.name} received ${x.events} of ~${M.expectedBroadcasts} change events` });
    if (x.max > 200 * 1024) finding({ cat: 'SSE_PAYLOAD_O_N', sev: 'WARN', actor: x.name, key: 'SSEP', detail: `largest SSE event was ${(x.max / 1024).toFixed(0)} KB (whole table sent on every change)` });
  }
  sseAbort.abort(); stopping = true; if (child) child.kill();
  const { sev, s } = writeReports((Date.now() - t0) / 1000, cfgLine);
  evStream.end();
  console.log(`\n${s}\nFINDINGS: ${sev.CRITICAL} critical, ${sev.ERROR} error, ${sev.WARN} warn, ${sev.INFO} info\nReports in ${OUT}`);
  process.exit(sev.CRITICAL > 0 ? 2 : 0);
}
process.on('SIGINT', () => { try { stopping = true; child && child.kill(); writeReports(0, 'interrupted'); } finally { process.exit(130); } });
main().catch(err => { console.error(err); try { child && child.kill(); } catch {} process.exit(1); });
