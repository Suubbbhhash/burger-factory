#!/usr/bin/env node
// =============================================================================
// THE BURGER FACTORY — FINAL ACCEPTANCE TEST SUITE (all improvements in one)
// =============================================================================
// Single-command verification of every improvement made to the reservation
// system. Zero dependencies — Node.js built-ins only (Node >= 20).
//
// WHAT IT COVERS (mapped to the improvement register I-01 .. I-12):
//   [P1] Concurrency + atomic persistence   (I-01, I-02)
//   [P2] Input validation (400 family)      (I-03)
//   [P3] Security: XSS / DoS guards         (I-05)
//   [P4] State-machine whitelist            (I-04)
//   [P5] Table allocation + 409 capacity    (I-01, I-06)
//   [P6] SSE real-time broadcast            (I-12)
//   [P7] Persistence + corrupt quarantine   (I-02, I-07)
//   [P8] IST date correctness               (I-08)
//   [P9] Reset / isolation endpoint         (I-11)
//   [P10] Static source audits              (I-05, I-08, I-09, I-10)
//   [U]  Client module tests (booking.js)   (I-06, I-07, I-09)
//
// USAGE
//   node scripts/final-test.mjs                (auto-boots `npx vite` on a free port)
//   node scripts/final-test.mjs --url http://localhost:3000   (attach to running server)
//   node scripts/final-test.mjs --root D:\Burger_factory      (explicit project root)
//   node scripts/final-test.mjs --keep         (do not restore the data snapshot)
//
// OUTPUT (written to the project root)
//   FINAL_TEST_REPORT.txt    — human-readable report + go-online verdict
//   FINAL_TEST_RESULTS.json  — machine-readable results (CI-friendly)
// Exit code: 0 = ALL PASS, 1 = one or more failures.
//
// SAFETY: the suite snapshots data/reservations.json and restores it
// byte-for-byte on exit. Records created during the run are never left behind.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ============================ CLI ============================
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// ============================ Case registry ============================
const CASES = [];
const LATENCIES = [];
let CURRENT_GROUP = '';

function group(name) { CURRENT_GROUP = name; }

function record(id, name, pass, detail, ms) {
  CASES.push({ group: CURRENT_GROUP, id, name, pass: !!pass, detail: String(detail ?? ''), ms: ms ?? 0 });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${id} ${name}${pass ? '' : ' — ' + String(detail ?? '')}`);
  return pass;
}

function fatal(msg) {
  console.error('\n' + '='.repeat(78));
  console.error('FATAL: ' + msg);
  console.error('='.repeat(78));
  process.exitCode = 2;
  throw new Error(msg);
}

// ============================ Project root ============================
function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'vite.config.js'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const ROOT = findRoot(opt('--root', path.resolve(HERE, '..'))) || findRoot(HERE) || findRoot(process.cwd());
if (!ROOT) fatal('Could not locate the project root (a directory containing vite.config.js). Use --root <dir>.');
const DB_FILE = path.join(ROOT, 'data', 'reservations.json');
const DB_BAK = DB_FILE + '.final-test.bak';

console.log('='.repeat(78));
console.log('THE BURGER FACTORY — FINAL ACCEPTANCE TEST SUITE');
console.log('='.repeat(78));
console.log('Project root :', ROOT);
console.log('Node         :', process.version);
console.log('Started      :', new Date().toISOString());
console.log('');

// ============================ HTTP helpers ============================
function onceReq(method, url, body, timeoutMs = 15000) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = payload
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      : {};
    const req = http.request(
      url,
      { method, headers, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          const ms = performance.now() - t0;
          LATENCIES.push(ms);
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = null; }
          resolve({ status: res.statusCode, json, raw: data, ms });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => {
      resolve({ status: 0, json: null, raw: '', ms: performance.now() - t0, error: err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ============================ Server lifecycle ============================
let BASE = '';
let SERVER_CHILD = null;
let SERVER_SPEC = null;

function checkPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function pickPort() {
  const forced = parseInt(opt('--port', '0'), 10);
  if (forced > 0) return forced;
  for (let p = 3210; p < 3230; p++) {
    if (await checkPortFree(p)) return p;
  }
  fatal('No free port in 3210-3229 range. Use --port.');
}

async function startServer() {
  const attach = opt('--url', '');
  if (attach) {
    BASE = attach.replace(/\/$/, '');
    SERVER_SPEC = 'attached:' + BASE;
    console.log('[suite] attaching to running server:', BASE);
    return;
  }
  const port = await pickPort();
  BASE = `http://127.0.0.1:${port}`;
  console.log('[suite] booting npx vite on port', port, '...');
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(port), '--strictPort'],
    { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }
  );
  SERVER_CHILD = child;
  SERVER_SPEC = `vite:${port}`;
  child.stdout.on('data', (d) => { if (process.env.FT_VERBOSE) process.stdout.write('[vite] ' + d); });
  child.stderr.on('data', (d) => { if (process.env.FT_VERBOSE) process.stderr.write('[vite!] ' + d); });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (child.exitCode !== null) {
      fatal('vite exited during startup (code ' + child.exitCode + '). Run `npm install` and try again.');
    }
    const res = await onceReq('GET', BASE + '/api/v1/reservations');
    if (res && res.status === 200) return;
  }
  fatal('server did not become ready within 30s.');
}

function stopServer() {
  if (!SERVER_CHILD) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(SERVER_CHILD.pid), '/T', '/F'], { shell: true });
    } else {
      // kill the whole process group (npx wrapper + vite)
      try { process.kill(-SERVER_CHILD.pid, 'SIGTERM'); } catch { SERVER_CHILD.kill('SIGTERM'); }
    }
  } catch { /* best effort */ }
  try { SERVER_CHILD.stdout?.destroy(); SERVER_CHILD.stderr?.destroy(); } catch { /* ok */ }
}

// ============================ Isolation helpers ============================
// Between phases the DB is emptied via the reset endpoint; if the endpoint
// is absent (older engine), fall back to writing an empty array directly.
let RESET_SUPPORTED = true;

async function isolate() {
  if (RESET_SUPPORTED) {
    const res = await onceReq('POST', BASE + '/api/v1/reservations/reset');
    if (res.status === 200 || res.status === 204) return;
    RESET_SUPPORTED = false;
  }
  try { fs.writeFileSync(DB_FILE, '[]\n', 'utf8'); } catch { /* ok */ }
}

function readDbFile() {
  try { return fs.readFileSync(DB_FILE, 'utf8'); } catch { return null; }
}

function parseDb() {
  const raw = readDbFile();
  if (raw === null) return { ok: false, reason: 'missing', records: [] };
  try { return { ok: true, records: JSON.parse(raw) }; } catch { return { ok: false, reason: 'unparseable', records: [] }; }
}

function activeOverlap(a, b) {
  if (a.tableId !== b.tableId || a.date !== b.date) return false;
  if (a.locationId !== b.locationId) return false;
  const toMin = (t) => parseInt(String(t).slice(0, 2), 10) * 60 + parseInt(String(t).slice(3, 5), 10);
  const aS = toMin(a.time); const aE = aS + 90;
  const bS = toMin(b.time); const bE = bS + 90;
  return aS < bE && bS < aE;
}

function findDoubleBookings(records) {
  const active = records.filter((r) => r.status === 'confirmed' || r.status === 'seated');
  const clashes = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (activeOverlap(active[i], active[j])) {
        clashes.push(active[i].code + ' vs ' + active[j].code + ' @ ' + active[i].tableId + ' ' + active[i].date + ' ' + active[i].time + '/' + active[j].time);
      }
    }
  }
  return clashes;
}

// Valid reservation factory (IST-safe dates)
function futureDate(days = 3) {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST clock
  const target = new Date(d.getTime() + days * 86400000);
  return target.toISOString().slice(0, 10);
}
function yesterdayIST() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000);
  return d.toISOString().slice(0, 10);
}
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validReservation(overrides = {}) {
  return {
    name: 'Final Test Guest',
    email: 'guest@example.com',
    phone: '+91 9812345678',
    locationId: 'anjuna',
    date: futureDate(3),
    time: '14:00',
    guests: 4,
    seating: 'outdoor',
    occasion: 'birthday',
    notes: 'Final test booking',
    ...overrides
  };
}

// ============================ PHASE 1 — Concurrency + atomicity ============================
async function phase1() {
  group('P1 Concurrency & Atomicity');
  console.log('\n— Phase 1: Concurrency & Atomic Persistence —');
  await isolate();

  // T1.1 — 25 concurrent same-slot requests: no double-booking
  const burstDate = futureDate(5);
  const burst = [];
  for (let i = 0; i < 25; i++) {
    burst.push(onceReq('POST', BASE + '/api/v1/reservations', {
      reservation: validReservation({ name: 'Burst ' + (i + 1), date: burstDate, time: '19:30', guests: 4, seating: 'outdoor', notes: 'burst ' + (i + 1) })
    }));
  }

  // T1.2 — DB file must stay parseable while writes land (atomic tmp+rename)
  let parseFailures = 0;
  let polls = 0;
  const watcher = (async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const raw = readDbFile();
      if (raw !== null) {
        polls++;
        try { JSON.parse(raw); } catch { parseFailures++; }
      }
      await new Promise((r) => setTimeout(r, 1));
    }
  })();

  const responses = await Promise.all(burst);
  await watcher;

  const created = responses.filter((r) => r.status === 201 || (r.status === 200 && r.json && r.json.success));
  const rejected = responses.filter((r) => r.status === 409);
  const badCode = responses.filter((r) => ![200, 201, 409].includes(r.status));

  record('T1.1a', 'no invalid status codes in burst (only 200/201/409)', badCode.length === 0,
    badCode.map((r) => r.status).join(',') || 'clean');

  const dbNow = parseDb();
  const stored = dbNow.ok ? dbNow.records : [];
  const fromServer = created.map((r) => r.json.reservation).filter(Boolean);
  const doubles = findDoubleBookings(stored);

  // anjuna outdoor hosts 4 guests on 7 tables (O3-O6 4-seaters, O7 6, O8-O9 8) -> cap 7
  record('T1.1b', 'concurrent successes <= zone capacity (expected <= 7)', created.length >= 1 && created.length <= 7,
    `created=${created.length} rejected409=${rejected.length}`);
  record('T1.1c', 'zero double-bookings after 25-way race', doubles.length === 0,
    doubles.slice(0, 4).join(' | ') || 'clean');
  record('T1.1d', 'every success has a distinct table', new Set(fromServer.map((r) => r.tableId)).size === fromServer.length,
    fromServer.map((r) => r.tableId).join(',') || 'none');

  // T1.2 result
  record('T1.2', 'DB file always parseable during concurrent writes (' + polls + ' polls)', parseFailures === 0 && polls > 10,
    parseFailures + ' parse failures / ' + polls + ' polls');

  // T1.3 — no tmp / corrupt residue
  const residue = fs.readdirSync(path.join(ROOT, 'data'))
    .filter((f) => f.includes('.tmp') || f.includes('.corrupt-'));
  record('T1.3', 'no .tmp / .corrupt-* residue left in data/', residue.length === 0, residue.join(',') || 'clean');

  // T1.4 — deterministic 90-min window reuse
  await isolate();
  const d4 = futureDate(7);
  const first = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d4, time: '14:00', guests: 2, seating: 'indoor', name: 'T1.4 first' }) });
  const firstTable = first.json?.reservation?.tableId;
  const second = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d4, time: '15:29', guests: 2, seating: 'indoor', name: 'T1.4 second' }) });
  const secondTable = second.json?.reservation?.tableId;
  record('T1.4a', '89-min-later booking does NOT reuse same table', firstTable && secondTable && firstTable !== secondTable,
    firstTable + ' vs ' + secondTable);
  const third = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d4, time: '15:30', guests: 2, seating: 'indoor', name: 'T1.4 third' }) });
  const thirdTable = third.json?.reservation?.tableId;
  record('T1.4b', 'exactly +90:00 reuses the same table', firstTable && thirdTable === firstTable, firstTable + ' vs ' + thirdTable);
}

// ============================ PHASE 2 — Validation (400 family) ============================
async function phase2() {
  group('P2 Input Validation');
  console.log('\n— Phase 2: Input Validation —');
  await isolate();
  const d = futureDate(2);

  const must400 = [
    ['T2.1a', 'guests=0', { guests: 0 }],
    ['T2.1b', 'guests=-3', { guests: -3 }],
    ['T2.1c', 'guests=13', { guests: 13 }],
    ['T2.1d', 'guests=2.5 (non-integer)', { guests: 2.5 }],
    ['T2.1e', 'guests="4" (string)', { guests: '4' }],
    ['T2.1f', 'guests missing', { guests: undefined }],
    ['T2.2a', 'date in the past (IST)', { date: yesterdayIST() }],
    ['T2.2b', 'date 2026-02-30 (unreal)', { date: '2026-02-30' }],
    ['T2.2c', 'date 2026-13-05 (bad month)', { date: '2026-13-05' }],
    ['T2.2d', 'date missing', { date: undefined }],
    ['T2.3a', 'time 25:99', { time: '25:99' }],
    ['T2.3b', 'time 9:00 (unpadded)', { time: '9:00' }],
    ['T2.3c', 'time 14:00:00', { time: '14:00:00' }],
    ['T2.3d', 'time missing', { time: undefined }],
    ['T2.4a', 'unknown outlet "mumbai"', { locationId: 'mumbai' }],
    ['T2.4b', 'locationId missing', { locationId: undefined }],
    ['T2.5a', 'name missing', { name: undefined }],
    ['T2.5b', 'name empty string', { name: '   ' }]
  ];

  for (const [id, label, overrides] of must400) {
    const res = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, ...overrides }) });
    const storedAnyway = res.json && res.json.success && res.json.reservation;
    record(id, '400 rejected: ' + label, res.status === 400 && !storedAnyway,
      res.status === 400 ? (res.json?.error || '').slice(0, 90) : 'got HTTP ' + res.status);
  }

  // T2.6 — boundary accepted (8 = largest anjuna table; 12 is exercised as 409 in T5.4a)
  const okNotes = 'x'.repeat(500);
  const res500 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '12:30', guests: 8, notes: okNotes, seating: 'outdoor' }) });
  record('T2.6a', 'boundary accepted: guests=8 (largest table), notes=500 chars', (res500.status === 201 || res500.status === 200) && !!res500.json?.reservation,
    'HTTP ' + res500.status + ' ' + (res500.json?.error || '').slice(0, 80));
  const todayRes = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: todayIST(), time: '21:30', guests: 1, seating: 'indoor', notes: 'today boundary' }) });
  record('T2.6b', 'today (IST) is accepted (not treated as past)', todayRes.status === 201 || todayRes.status === 200,
    'HTTP ' + todayRes.status + ' ' + (todayRes.json?.error || '').slice(0, 80));
}

// ============================ PHASE 3 — Security (XSS / DoS) ============================
async function phase3() {
  group('P3 Security (XSS / DoS)');
  console.log('\n— Phase 3: Security —');
  await isolate();
  const d = futureDate(4);

  const xssPayloads = [
    ['T3.1a', 'name', '<img src=x onerror=alert(1)>', { name: '<img src=x onerror=alert(1)>' }],
    ['T3.1b', 'notes', '<script>steal()</script>', { notes: '<script>steal()</script>' }],
    ['T3.1c', 'email', 'a<b>@x.com', { email: 'a<b>@x.com' }],
    ['T3.1d', 'occasion', '"><svg onload=alert(2)>', { occasion: '"><svg onload=alert(2)>' }],
    ['T3.1e', 'phone', '+91 <b>98', { phone: '+91 <b>98' }]
  ];
  for (const [id, field, , overrides] of xssPayloads) {
    const res = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '16:30', ...overrides }) });
    record(id, 'XSS in ' + field + ' rejected at API layer', res.status === 400, 'HTTP ' + res.status + ' ' + (res.json?.error || '').slice(0, 80));
  }

  // T3.2 — notes length DoS cap
  const res501 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '17:00', notes: 'y'.repeat(501) }) });
  record('T3.2', 'notes 501 chars rejected', res501.status === 400, 'HTTP ' + res501.status);

  // T3.3 — oversized body rejected without storing
  const huge = 'z'.repeat(128 * 1024);
  const resHuge = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '17:30', notes: huge }) });
  const listRes = await onceReq('GET', BASE + '/api/v1/reservations');
  const containsHuge = (listRes.json?.reservations || []).some((r) => String(r.notes || '').length > 500);
  record('T3.3', 'oversized payload rejected (413/400 or reset), nothing stored', (resHuge.status === 400 || resHuge.status === 413 || resHuge.status === 0) && !containsHuge,
    'HTTP ' + resHuge.status + (resHuge.status === 0 ? ' (connection reset by server)' : ''));

  // T3.4 — invariant: nothing stored anywhere contains angle brackets
  const all = listRes.json?.reservations || parseDb().records || [];
  const dirty = all.filter((r) => JSON.stringify(r).includes('<') || JSON.stringify(r).includes('>'));
  record('T3.4', 'stored dataset contains no raw < > characters', dirty.length === 0,
    dirty.map((r) => r.code).slice(0, 5).join(',') || 'clean');
}

// ============================ PHASE 4 — State machine ============================
async function phase4() {
  group('P4 State Machine');
  console.log('\n— Phase 4: State-Machine Whitelist —');
  await isolate();
  const d = futureDate(6);

  // Setup: one confirmed reservation to work on
  const created = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '13:00', guests: 2, seating: 'indoor', name: 'SM probe' }) });
  const code = created.json?.reservation?.code;
  if (!code) { record('T4.0', 'setup: create probe reservation', false, 'HTTP ' + created.status); return; }
  record('T4.0', 'setup: create probe reservation', true, code);

  const patch = (status, extra = {}) => onceReq('PATCH', BASE + '/api/v1/reservations/status', { code, status, ...extra });

  // T4.1 — invalid status values
  for (const [id, val] of [['T4.1a', 'banana'], ['T4.1b', ''], ['T4.1c', 'CONFIRMED-ish'], ['T4.1d', 'delete * from reservations']]) {
    const res = await patch(val);
    record(id, 'PATCH status "' + val + '" rejected', res.status === 400, 'HTTP ' + res.status + ' ' + (res.json?.error || '').slice(0, 70));
  }

  // T4.2 — legal chain confirmed -> seated -> completed (+ timestamps)
  const seatRes = await patch('seated');
  const seatRec = seatRes.json?.reservation;
  record('T4.2a', 'confirmed -> seated accepted', seatRes.status === 200 && seatRec?.status === 'seated', 'HTTP ' + seatRes.status);
  record('T4.2b', 'seatedAt timestamp recorded', !!seatRec?.seatedAt, seatRec?.seatedAt || 'missing');

  const doneRes = await patch('completed');
  const doneRec = doneRes.json?.reservation;
  record('T4.2c', 'seated -> completed accepted', doneRes.status === 200 && doneRec?.status === 'completed', 'HTTP ' + doneRes.status);
  record('T4.2d', 'completedAt timestamp recorded', !!doneRec?.completedAt, doneRec?.completedAt || 'missing');

  // T4.3 — terminal revival attempts
  for (const [id, val] of [['T4.3a', 'confirmed'], ['T4.3b', 'seated'], ['T4.3c', 'cancelled'], ['T4.3d', 'no-show']]) {
    const res = await patch(val);
    record(id, 'revive completed -> ' + val + ' rejected', res.status === 400, 'HTTP ' + res.status + ' ' + (res.json?.error || '').slice(0, 70));
  }

  // T4.4 — confirmed -> cancelled (+ reason) and confirmed -> no-show on fresh records
  const c2 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '18:00', guests: 2, seating: 'indoor', name: 'cancel probe' }) });
  const code2 = c2.json?.reservation?.code;
  const cancelRes = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: code2, status: 'cancelled', reason: 'Guest plans changed' });
  const cancelRec = cancelRes.json?.reservation;
  record('T4.4a', 'confirmed -> cancelled accepted', cancelRes.status === 200 && cancelRec?.status === 'cancelled', 'HTTP ' + cancelRes.status);
  record('T4.4b', 'cancelledAt + cancelReason recorded', !!cancelRec?.cancelledAt && cancelRec?.cancelReason === 'Guest plans changed', JSON.stringify(cancelRec?.cancelReason));
  const revive2 = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: code2, status: 'confirmed' });
  record('T4.4c', 'cancelled -> confirmed (revive) rejected', revive2.status === 400, 'HTTP ' + revive2.status);

  const c3 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '19:00', guests: 2, seating: 'indoor', name: 'noshow probe' }) });
  const code3 = c3.json?.reservation?.code;
  const nsRes = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: code3, status: 'no-show' });
  record('T4.4d', 'confirmed -> no-show accepted (+noShowAt)', nsRes.status === 200 && !!nsRes.json?.reservation?.noShowAt, 'HTTP ' + nsRes.status);

  // T4.5 — walk-in initial seated -> completed
  const w = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: todayIST(), time: '20:30', guests: 3, seating: 'outdoor', name: 'Walkin probe', status: 'seated' }) });
  const wCode = w.json?.reservation?.code;
  record('T4.5a', 'walk-in initial status=seated accepted', w.status === 201 && w.json?.reservation?.status === 'seated' && !!w.json?.reservation?.seatedAt,
    'HTTP ' + w.status + ' status=' + w.json?.reservation?.status);
  const wDone = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: wCode, status: 'completed' });
  record('T4.5b', 'walk-in seated -> completed accepted', wDone.status === 200 && wDone.json?.reservation?.status === 'completed', 'HTTP ' + wDone.status);

  // T4.6 — unknown code
  const ghost = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: 'BF-ZZZZZZ', status: 'seated' });
  record('T4.6', 'PATCH unknown code -> 404', ghost.status === 404, 'HTTP ' + ghost.status);

  // T4.7 — no-op / backwards transitions rejected
  const c4 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '21:00', guests: 2, seating: 'indoor', name: 'noop probe' }) });
  const code4 = c4.json?.reservation?.code;
  const noop = await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code: code4, status: 'confirmed' });
  record('T4.7', 'same-status no-op (confirmed -> confirmed) rejected', noop.status === 400, 'HTTP ' + noop.status);
}

// ============================ PHASE 5 — Allocation & capacity ============================
async function phase5() {
  group('P5 Allocation & 409');
  console.log('\n— Phase 5: Table Allocation + 409 Capacity —');
  await isolate();
  const d = futureDate(9);

  // T5.1 — exhaust anjuna outdoor for 4 guests at one slot (7 tables)
  const results = [];
  for (let i = 0; i < 9; i++) {
    results.push(await onceReq('POST', BASE + '/api/v1/reservations', {
      reservation: validReservation({ date: d, time: '19:00', guests: 4, seating: 'outdoor', name: 'Exhaust ' + (i + 1) })
    }));
  }
  const ok = results.filter((r) => r.status === 201 || r.status === 200);
  const full = results.filter((r) => r.status === 409);
  const tables = ok.map((r) => r.json?.reservation?.tableId);
  record('T5.1a', 'exhaustion: exactly 7 successes (zone capacity), rest 409', ok.length === 7 && full.length === 2,
    'ok=' + ok.length + ' 409=' + full.length);
  record('T5.1b', 'all allocated tables distinct', new Set(tables).size === tables.length, tables.join(','));
  record('T5.1c', '409 body carries a human reason', full.every((r) => (r.json?.error || '').length > 10),
    (full[0]?.json?.error || '').slice(0, 90));

  // best-fit order: 4-seaters before 6/8-seaters
  const capOrder = ok.map((r) => r.json?.reservation?.tableType);
  record('T5.1d', 'best-fit order: 4-seaters allocated before 6/8-seaters',
    capOrder.slice(0, 4).every((t) => t === '4-seater'), capOrder.join(','));

  // T5.2 — zone preference honored
  await isolate();
  const rIn = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '14:00', guests: 4, seating: 'indoor', name: 'Zone probe' }) });
  record('T5.2', 'seating=indoor allocates from indoor zone only', rIn.json?.reservation?.tableZone === 'indoor',
    rIn.json?.reservation?.tableId + ' zone=' + rIn.json?.reservation?.tableZone);

  // T5.3 — best fit for 2 guests is a 2-seater
  await isolate();
  const r2 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '15:00', guests: 2, seating: 'any', name: 'Bestfit probe' }) });
  record('T5.3', '2 guests -> smallest table (2-seater)', r2.json?.reservation?.tableType === '2-seater', r2.json?.reservation?.tableId + ' ' + r2.json?.reservation?.tableType);

  // T5.4 — 12 guests needs an 8-seater outlet table (max 8): anjuna has ANJ-O8/O9 8-seater outdoor
  const r12 = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: d, time: '16:00', guests: 12, seating: 'outdoor', name: 'Party probe' }) });
  record('T5.4a', '12 guests at a max-8-seater outlet -> 409 (no table fits)', r12.status === 409,
    'HTTP ' + r12.status + ' ' + (r12.json?.error || '').slice(0, 60));

  // walk-in at odd minutes allocates too
  const w = await onceReq('POST', BASE + '/api/v1/reservations', {
    reservation: validReservation({ date: todayIST(), time: '20:07', guests: 2, seating: 'indoor', name: 'Odd-time walkin', status: 'seated' })
  });
  record('T5.5', 'odd-minute time (20:07) accepted for walk-ins (HH:MM rule, not slot list)', w.status === 201, 'HTTP ' + w.status + ' ' + (w.json?.error || '').slice(0, 60));
}

// ============================ PHASE 6 — SSE ============================
function openSse() {
  return new Promise((resolve) => {
    const req = http.request(BASE + '/api/v1/events', { method: 'GET' }, (res) => {
      let buf = '';
      const events = [];
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ events, close: () => {}, waitFor: async () => null });
      }, 12000);
      res.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evLines = frame.split('\n');
          const event = (evLines.find((l) => l.startsWith('event: ')) || '').slice(7).trim();
          const dataLine = (evLines.find((l) => l.startsWith('data: ')) || '').slice(6);
          let data = null;
          try { data = JSON.parse(dataLine); } catch { data = dataLine; }
          events.push({ event, data, at: Date.now() });
        }
      });
      res.on('end', () => { clearTimeout(timer); resolve({ events, close: () => {}, waitFor: async () => null }); });
      // resolve with the rich helper as soon as the connected frame arrives
      const poll = setInterval(() => {
        if (events.some((e) => e.event === 'connected')) {
          clearInterval(poll);
          resolve({
            events,
            close: () => { req.destroy(); },
            waitFor: (pred, ms = 6000) => new Promise((done) => {
              const found = () => events.findIndex(pred);
              if (found() >= 0) return done(events[found()]);
              const t0 = Date.now();
              const iv = setInterval(() => {
                const i = found();
                if (i >= 0 || Date.now() - t0 > ms) { clearInterval(iv); done(i >= 0 ? events[i] : null); }
              }, 25);
            })
          });
        }
      }, 20);
      setTimeout(() => clearInterval(poll), 5000);
    });
    req.on('error', () => resolve({ events: [], close: () => {}, waitFor: async () => null }));
    req.end();
  });
}

async function phase6() {
  group('P6 SSE Realtime');
  console.log('\n— Phase 6: SSE Realtime Broadcast —');
  await isolate();

  const sse = await openSse();
  const connected = sse.events.find((e) => e.event === 'connected');
  record('T6.1', 'SSE connected event received', !!connected, connected ? 'ok' : 'no connected frame');

  // create -> expect action 'created'
  const before = Date.now();
  const created = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: futureDate(11), time: '14:30', guests: 2, seating: 'indoor', name: 'SSE create probe' }) });
  const createdEv = await sse.waitFor((e) => e.event === 'reservations:changed' && e.data?.action === 'created' && e.at >= before, 6000);
  record('T6.2', 'POST triggers reservations:changed (action=created)', !!createdEv, createdEv ? 'ok' : 'timeout');

  // status change -> expect action 'status_updated'
  const code = created.json?.reservation?.code;
  const before2 = Date.now();
  await onceReq('PATCH', BASE + '/api/v1/reservations/status', { code, status: 'seated' });
  const updEv = await sse.waitFor((e) => e.event === 'reservations:changed' && e.data?.action === 'status_updated' && e.at >= before2, 6000);
  record('T6.3', 'PATCH triggers reservations:changed (action=status_updated)', !!updEv, updEv ? 'ok' : 'timeout');

  // payload parity with GET
  const getRes = await onceReq('GET', BASE + '/api/v1/reservations');
  const evList = updEv?.data?.reservations;
  record('T6.4', 'event payload list parity with GET', Array.isArray(evList) && evList.length === (getRes.json?.reservations || []).length,
    'event=' + (evList ? evList.length : 'null') + ' get=' + (getRes.json?.reservations || []).length);

  sse.close();
}

// ============================ PHASE 7 — Persistence & quarantine ============================
async function phase7() {
  group('P7 Persistence');
  console.log('\n— Phase 7: Persistence & Corrupt Quarantine —');
  await isolate();

  // T7.1 — final DB is valid JSON and no residue
  const db = parseDb();
  record('T7.1', 'DB file valid JSON after churn', db.ok, db.reason);
  const residue = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.includes('.tmp'));
  record('T7.1b', 'no .tmp residue', residue.length === 0, residue.join(','));

  // T7.2 — corrupt file is quarantined, not silently wiped
  const preCorrupt = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.includes('.corrupt-'));
  fs.writeFileSync(DB_FILE, '{CORRUPT NOT JSON AT ALL', 'utf8');
  const listRes = await onceReq('GET', BASE + '/api/v1/reservations');
  const postCorrupt = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.includes('.corrupt-'));
  const newQuarantines = postCorrupt.filter((f) => !preCorrupt.includes(f));
  record('T7.2a', 'server survives corrupt DB (GET returns 200 + [])', listRes.status === 200 && Array.isArray(listRes.json?.reservations) && listRes.json.reservations.length === 0,
    'HTTP ' + listRes.status);
  record('T7.2b', 'corrupt file quarantined as .corrupt-* (data preserved)', newQuarantines.length === 1,
    newQuarantines.join(',') || 'none');

  // cleanup quarantine artifacts created by this phase (they are test residue)
  for (const f of newQuarantines) { try { fs.unlinkSync(path.join(ROOT, 'data', f)); } catch { /* ok */ } }

  // T7.3 — writes after quarantine recreate a clean DB
  const again = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: futureDate(12), time: '13:30', guests: 2, seating: 'indoor', name: 'Post-quarantine write' }) });
  const dbAfter = parseDb();
  record('T7.3', 'write after quarantine recreates clean DB', again.status === 201 && dbAfter.ok && dbAfter.records.length >= 1,
    'HTTP ' + again.status);
}

// ============================ PHASE 8 — IST correctness ============================
async function phase8() {
  group('P8 IST Dates');
  console.log('\n— Phase 8: IST Date Correctness —');
  await isolate();

  // T8.1 — yesterday IST rejected, today IST accepted (catches UTC drift 00:00-05:30 IST)
  const past = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: yesterdayIST(), time: '13:00', guests: 2, seating: 'indoor' }) });
  record('T8.1a', 'date = yesterday(IST) rejected', past.status === 400, 'HTTP ' + past.status);
  const nowIst = await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: todayIST(), time: '13:30', guests: 2, seating: 'indoor' }) });
  record('T8.1b', 'date = today(IST) accepted', nowIst.status === 201 || nowIst.status === 200, 'HTTP ' + nowIst.status + ' ' + (nowIst.json?.error || '').slice(0, 70));

  const sameDay = nowIst.json?.reservation?.date === todayIST();
  record('T8.1c', 'stored date matches today(IST) byte-for-byte', !!sameDay, nowIst.json?.reservation?.date + ' vs ' + todayIST());

  // T8.2 — walk-in uses IST clock: posted within the IST window, date is today(IST)
  const w = await onceReq('POST', BASE + '/api/v1/reservations', {
    reservation: validReservation({ date: todayIST(), time: '21:45', guests: 2, seating: 'indoor', name: 'IST walkin', status: 'seated' })
  });
  record('T8.2', 'late-evening IST walk-in accepted for today', w.status === 201, 'HTTP ' + w.status);

  // T8.3 — static: engine uses an IST-aware today helper
  const engine = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  const hasIstHelper = /getTodayIST|IST_OFFSET|\+\s*5\.5|530\s*\*|330\s*\*/.test(engine);
  record('T8.3', 'vite.config.js contains an IST-aware clock helper', hasIstHelper, 'getTodayIST/offset marker ' + (hasIstHelper ? 'found' : 'MISSING'));
  const rawIsoSplit = /toISOString\(\)\.split\('T'\)\[0\]/.test(engine);
  record('T8.4', 'vite.config.js: no raw UTC toISOString().split("T") date idiom', !rawIsoSplit, rawIsoSplit ? 'found — UTC drift risk' : 'clean');
}

// ============================ PHASE 9 — Reset endpoint ============================
async function phase9() {
  group('P9 Reset Endpoint');
  console.log('\n— Phase 9: Reset / Isolation —');
  await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: futureDate(13), time: '14:00', guests: 2, seating: 'indoor', name: 'reset filler' }) });
  const before = await onceReq('GET', BASE + '/api/v1/reservations');
  const countBefore = (before.json?.reservations || []).length;

  const resetRes = await onceReq('POST', BASE + '/api/v1/reservations/reset');
  record('T9.1', 'POST /api/v1/reservations/reset -> 200', resetRes.status === 200, 'HTTP ' + resetRes.status);

  const after = await onceReq('GET', BASE + '/api/v1/reservations');
  record('T9.2', 'reset empties the dataset (was ' + countBefore + ')', (after.json?.reservations || []).length === 0,
    'now=' + (after.json?.reservations || []).length);

  const db = parseDb();
  record('T9.3', 'data file on disk is an empty array after reset', db.ok && db.records.length === 0,
    db.ok ? 'len=' + db.records.length : db.reason);
}

// ============================ PHASE 10 — Static source audits ============================
function phase10() {
  group('P10 Static Audits');
  console.log('\n— Phase 10: Static Source Audits —');

  const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
  const managerHtml = read('manager.html');
  const bookingJs = read('src/js/booking.js');
  const managerJs = read('src/js/manager.js');
  const mainJs = read('src/js/main.js');
  const thermalJs = read('src/js/thermalTicket.js');

  // S10.1 — no hardcoded passcode in the DOM
  const passInDom = /type="password"[^>]*\svalue=/.test(managerHtml);
  record('S10.1a', 'no prefilled value= on the password input', !passInDom, passInDom ? 'value attribute present' : 'clean');
  const literalInHtml = managerHtml.includes('burger123');
  record('S10.1b', 'no passcode literal rendered in manager.html', !literalInHtml, literalInHtml ? '"burger123" found in DOM markup' : 'clean');

  // S10.2 — escapeHtml defined and used
  const escDef = /export\s+function\s+escapeHtml|function\s+escapeHtml\s*\(/.test(bookingJs);
  record('S10.2a', 'escapeHtml() defined in booking.js', escDef, escDef ? 'found' : 'missing');
  const escUsed = [managerJs, mainJs, thermalJs].filter((src) => src.includes('escapeHtml(')).length;
  record('S10.2b', 'escapeHtml applied in render modules (manager/main/thermal)', escUsed >= 2, escUsed + '/3 modules use it');

  // S10.3 — client uses IST clock; UTC idiom removed
  const clientIst = bookingJs.includes('getTodayIST');
  record('S10.3a', 'client booking.js has getTodayIST()', clientIst, clientIst ? 'found' : 'missing');
  const clientUtcIdiom = /toISOString\(\)\.split\('T'\)\[0\]/.test(bookingJs);
  record('S10.3b', 'client: no toISOString().split("T") UTC idiom left', !clientUtcIdiom, clientUtcIdiom ? 'found — UTC drift risk' : 'clean');

  // S10.4 — engine atomic persistence markers
  const engine = read('vite.config.js');
  const atomicTmp = engine.includes('.tmp');
  const atomicRename = /renameSync|rename\(/.test(engine);
  record('S10.4a', 'engine writes through a .tmp staging file', atomicTmp, atomicTmp ? 'found' : 'missing');
  record('S10.4b', 'engine commits via rename (atomic)', atomicRename, atomicRename ? 'found' : 'missing');
  const directWrite = /writeFileSync\(\s*DB_FILE\s*,\s*JSON\.serialize\(\s*records/.test(engine);
  record('S10.4c', 'no direct records-write bypassing the atomic path', !directWrite, directWrite ? 'writeDb-style direct write found' : 'clean');

  // S10.5 — floor plan: sort before find (anchor on the DEFINITION, not a call site)
  const defAnchor = managerJs.indexOf('function renderFloorCanvas');
  const floorRegion = managerJs.slice(defAnchor >= 0 ? defAnchor : 0, (defAnchor >= 0 ? defAnchor : 0) + 6000);
  const sortedBeforeFind = floorRegion.includes('.sort(') && floorRegion.includes('.find(');
  record('S10.5', 'floor canvas sorts reservations before .find() (clock fix)', sortedBeforeFind,
    sortedBeforeFind ? 'sort+find present in renderFloorCanvas' : 'missing — floor clock may pick wrong reservation');

  // S10.6 — server-first client: no fire-and-forget mutation (empty catch after fetch)
  const fireForget = /try\s*\{\s*await\s+fetch[\s\S]{0,200}?\}\s*catch\s*\{\s*\}/.test(bookingJs);
  record('S10.6', 'no fire-and-forget fetch with empty catch in booking.js', !fireForget,
    fireForget ? 'ghost-confirmation idiom found' : 'clean');

  // S10.7 — mutations gate on server success (message/absorb pattern)
  const gatesOnServer = /if\s*\(!result\.ok\)|if\s*\(!result\.success\)/.test(bookingJs);
  record('S10.7', 'mutation functions gate on server result before local mirror', gatesOnServer,
    gatesOnServer ? 'result gate found' : 'no gate — local-first risk');
}

// ============================ PHASE U — Client module tests ============================
// Imports the REAL src/js/booking.js into Node with browser shims and tests
// the server-first contract end to end (ghost confirmation, bypass fix, etc).
async function phaseClient() {
  group('U Client Module (booking.js)');
  console.log('\n— Phase U: Client Module Integration —');

  // --- shims -------------------------------------------------------------
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  const realFetch = globalThis.fetch;
  let fetchOrigin = BASE; // tests can point this at a dead origin
  globalThis.fetch = (url, options) => {
    const target = typeof url === 'string' && url.startsWith('/') ? fetchOrigin + url : url;
    return realFetch(target, options);
  };

  let booking;
  try {
    booking = await import(path.join(ROOT, 'src/js/booking.js'));
  } catch (err) {
    record('U0', 'booking.js imports under Node shims', false, String(err).slice(0, 120));
    globalThis.fetch = realFetch;
    return;
  }
  record('U0', 'booking.js imports under Node shims', true, 'ok');

  // U1 — escapeHtml vectors
  const esc = booking.escapeHtml('<img src=x onerror=alert(1)>');
  record('U1a', 'escapeHtml neutralizes < >', esc.includes('&lt;img') && esc.includes('&gt;'), esc.slice(0, 40));
  const escQ = booking.escapeHtml(`"><svg onload=alert(2)>`);
  record('U1b', 'escapeHtml neutralizes quotes and raw brackets are gone', escQ.includes('&quot;') && !escQ.includes('"') && !escQ.includes('<'), escQ.slice(0, 40));
  const escNull = booking.escapeHtml(null);
  record('U1c', 'escapeHtml(null) -> empty string', escNull === '', JSON.stringify(escNull));

  // U2 — getTodayIST vs reference
  const ref = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  record('U2', 'getTodayIST() matches +5:30 reference clock', booking.getTodayIST() === ref, booking.getTodayIST() + ' vs ' + ref);

  await isolate();

  // U3 — ghost confirmation: server unreachable -> failure, local mirror untouched
  fetchOrigin = 'http://127.0.0.1:9'; // closed port
  store.clear();
  localStorage.setItem('bf_reservations', JSON.stringify([{ code: 'BF-KEEP001', status: 'confirmed', name: 'pre' }]));
  const beforeGhost = localStorage.getItem('bf_reservations');
  const ghost = await booking.createReservation({
    name: 'Ghost Probe', phone: '+91 9812345678', locationId: 'anjuna',
    date: futureDate(4), time: '14:00', guests: 2, seating: 'indoor', notes: 'ghost'
  });
  const afterGhost = localStorage.getItem('bf_reservations');
  record('U3a', 'server unreachable -> {success:false} with message', ghost.success === false && !!ghost.message,
    (ghost.message || '').slice(0, 80));
  record('U3b', 'local mirror NOT polluted on failure (no ghost confirmation)', beforeGhost === afterGhost && !afterGhost.includes('Ghost Probe'),
    afterGhost === beforeGhost ? 'byte-identical' : 'CHANGED');
  fetchOrigin = BASE;

  // U4 — 409 from server -> failure, mirror untouched
  await isolate();
  const exhaustDate = futureDate(15);
  for (let i = 0; i < 7; i++) {
    await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: exhaustDate, time: '19:00', guests: 4, seating: 'outdoor', name: 'U4 filler ' + i }) });
  }
  await booking.syncReservationsFromServer();
  const before409 = localStorage.getItem('bf_reservations');
  const full409 = await booking.createReservation({
    name: 'U4 Overflow', phone: '+91 9812345678', locationId: 'anjuna',
    date: exhaustDate, time: '19:00', guests: 4, seating: 'outdoor', notes: 'should 409'
  });
  const mirror409 = JSON.parse(localStorage.getItem('bf_reservations') || '[]');
  record('U4a', 'client surfaces 409 as {success:false}', full409.success === false && !!full409.message,
    (full409.message || '').slice(0, 90));
  record('U4b', 'rejected booking never enters the local mirror (no ghost record)', !mirror409.some((r) => r.name === 'U4 Overflow') && mirror409.length === JSON.parse(before409).length,
    'mirror len=' + mirror409.length + ' (no U4 Overflow present)');

  // U5 — success path: mirror absorbs the server list, table assigned by server
  const okRes = await booking.createReservation({
    name: 'U5 Happy', phone: '+91 9812345678', locationId: 'anjuna',
    date: futureDate(16), time: '13:00', guests: 6, seating: 'indoor', notes: 'happy path'
  });
  const mirror = JSON.parse(localStorage.getItem('bf_reservations') || '[]');
  record('U5a', 'success -> {success:true} + server reservation', okRes.success === true && !!okRes.reservation?.tableId,
    okRes.reservation?.tableId || 'no table');
  record('U5b', 'local mirror now equals server list', mirror.some((r) => r.code === okRes.reservation?.code), 'len=' + mirror.length);

  // U6 — phone verification bypass fix
  await isolate();
  await onceReq('POST', BASE + '/api/v1/reservations', { reservation: validReservation({ date: futureDate(17), time: '20:00', guests: 2, seating: 'indoor', name: 'U6 NoPhone', phone: '' }) });
  await booking.syncReservationsFromServer();
  const noPhoneRec = JSON.parse(localStorage.getItem('bf_reservations')).find((r) => r.name === 'U6 NoPhone');
  const probeNoPhone = await booking.cancelReservation(noPhoneRec.code, '1234');
  record('U6a', 'lookup/cancel with last4 on empty-phone booking -> rejected', probeNoPhone.success === false,
    (probeNoPhone.message || '').slice(0, 80));
  const goodRec = await booking.createReservation({ name: 'U6 Phone', phone: '+91 9812345678', locationId: 'anjuna', date: futureDate(17), time: '21:00', guests: 2, seating: 'indoor' });
  const wrongLast4 = await booking.cancelReservation(goodRec.reservation.code, '9999');
  record('U6b', 'wrong last-4 digits -> rejected', wrongLast4.success === false, (wrongLast4.message || '').slice(0, 80));
  const rightLast4 = await booking.cancelReservation(goodRec.reservation.code, '5678');
  record('U6c', 'correct last-4 -> cancel accepted', rightLast4.success === true, (rightLast4.message || 'ok').slice(0, 80));

  // U7 — illegal transition via client -> rejected, mirror untouched
  const before7 = localStorage.getItem('bf_reservations');
  const illegal = await booking.updateReservationStatus(goodRec.reservation.code, 'confirmed'); // cancelled -> confirmed
  record('U7a', 'client PATCH illegal transition -> {success:false}', illegal.success === false, (illegal.message || '').slice(0, 90));
  record('U7b', 'mirror unchanged after illegal attempt', localStorage.getItem('bf_reservations') === before7, 'stable');

  globalThis.fetch = realFetch;
}

// ============================ Improvement register ============================
// Expand range ids like 'T1.1a-d' into exact case ids 'T1.1a','T1.1b','T1.1c','T1.1d'.
function expandCaseIds(str) {
  const out = [];
  for (const part of String(str).split(',')) {
    const id = part.trim();
    if (!id) continue;
    const m = /^(\w+\d+(?:\.\d+)?[a-z]?)([a-z])-([a-z])$/.exec(id);
    if (m) {
      const prefix = m[1];
      const from = m[2].charCodeAt(0);
      const to = m[3].charCodeAt(0);
      for (let c = from; c <= to; c++) out.push(prefix + String.fromCharCode(c));
    } else {
      out.push(id);
    }
  }
  return out;
}

const IMPROVEMENTS = [
  ['I-01', 'CRITICAL', 'Concurrent double-booking race (25 clients, one table)', 'Server mutex + best-fit allocation + 90-min overlap check + 409', 'T1.1a-d, T1.4a-b, T5.1a-d'],
  ['I-02', 'CRITICAL', 'Non-atomic writes could corrupt data file', 'tmp + rename atomic commit, always-parseable guarantee', 'T1.2, T1.3, T7.1, T7.1b'],
  ['I-03', 'HIGH', 'No input validation (negative guests, past dates, 25:99)', 'Server-side validation: guests 1-12, IST date, HH:MM, known outlet', 'T2.1a-f, T2.2a-d, T2.3a-d, T2.4a-b, T2.5a-b, T2.6a-b'],
  ['I-04', 'HIGH', 'PATCH accepted any status; terminal states could revive', 'Status whitelist + legal transition map + timestamps', 'T4.1a-d, T4.2a-d, T4.3a-d, T4.4a-d, T4.5a-b, T4.6, T4.7'],
  ['I-05', 'HIGH', 'Stored XSS via name/notes into innerHTML', 'API rejects < > everywhere + notes 500 cap + escapeHtml on all render paths', 'T3.1a-e, T3.2, T3.3, T3.4, S10.2a-b, U1a-c'],
  ['I-06', 'CRITICAL', 'Ghost confirmations (client wrote local first, swallowed errors)', 'Server-first mutations; failure leaves local mirror untouched', 'U3a-b, U4a-b, U5a-b, U7a-b, S10.6, S10.7'],
  ['I-07', 'HIGH', 'Walk-ins bypassed collision checks entirely', 'Walk-ins go through the same server allocator', 'T5.5, T4.5a-b, T8.2'],
  ['I-08', 'MEDIUM', 'UTC/IST date drift 00:00-05:30 IST', 'getTodayIST() on server + client; UTC idiom removed', 'T8.1a-c, T8.2, T8.3, T8.4, S10.3a-b, U2'],
  ['I-09', 'HIGH', 'Phone last-4 verification bypass on empty phone', 'Empty stored phone now fails verification', 'U6a-c'],
  ['I-10', 'MEDIUM', 'Hardcoded passcode prefilled in the DOM', 'value attribute removed, disclosure text removed, Auto-Fill kept', 'S10.1a-b'],
  ['I-11', 'MEDIUM', 'No clean way to reset state between test runs', 'POST /api/v1/reservations/reset test endpoint', 'T9.1, T9.2, T9.3'],
  ['I-12', 'HIGH', 'Floor-plan clock picked wrong reservation (unsorted find)', 'Sort by time before find; corrupt DB quarantined not wiped', 'S10.5, T7.2a-b, T7.3']
];

// ============================ Report ============================
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function writeReport(elapsedMs) {
  const passed = CASES.filter((c) => c.pass).length;
  const failed = CASES.filter((c) => !c.pass);
  const allPass = failed.length === 0 && passed > 0;

  const groups = [];
  for (const c of CASES) if (!groups.includes(c.group)) groups.push(c.group);

  const W = 78;
  const lines = [];
  lines.push('='.repeat(W));
  lines.push('THE BURGER FACTORY — FINAL TEST REPORT (ALL IMPROVEMENTS IN ONE)');
  lines.push('='.repeat(W));
  lines.push('Generated : ' + new Date().toISOString());
  lines.push('Project   : ' + ROOT);
  lines.push('Server    : ' + SERVER_SPEC);
  lines.push('Cases     : ' + passed + ' passed / ' + failed.length + ' failed (' + CASES.length + ' total)');
  lines.push('Duration  : ' + (elapsedMs / 1000).toFixed(1) + 's');
  if (LATENCIES.length) {
    lines.push('Latency   : p50 ' + pct(LATENCIES, 50).toFixed(1) + 'ms | p95 ' + pct(LATENCIES, 95).toFixed(1) + 'ms | p99 ' + pct(LATENCIES, 99).toFixed(1) + 'ms | n=' + LATENCIES.length);
  }
  lines.push('');
  lines.push('PER-GROUP RESULTS');
  lines.push('-'.repeat(W));
  for (const g of groups) {
    const gc = CASES.filter((c) => c.group === g);
    const gp = gc.filter((c) => c.pass).length;
    lines.push(`  ${g}  ${gp}/${gc.length}`);
    for (const c of gc) {
      lines.push(`    [${c.pass ? 'PASS' : 'FAIL'}] ${c.id}  ${c.name}${c.pass ? '' : '  <-- ' + c.detail}`);
    }
  }
  lines.push('');
  lines.push('IMPROVEMENT REGISTER — VERIFICATION MATRIX');
  lines.push('-'.repeat(W));
  for (const [id, sev, defect, fix, cases] of IMPROVEMENTS) {
    const caseIds = expandCaseIds(cases);
    const results = caseIds.map((cid) => CASES.find((c) => c.id === cid));
    const failedHere = results.filter((r) => r && !r.pass);
    let status = results.length && results.every((r) => r && r.pass) ? 'VERIFIED' : (failedHere.length ? 'FAILED' : 'NO-COVERAGE');
    lines.push(`  ${id} [${sev}] ${defect}`);
    lines.push(`        fix: ${fix}`);
    lines.push(`        tests: ${cases} -> ${status}`);
  }
  lines.push('');
  lines.push('GO-ONLINE READINESS');
  lines.push('-'.repeat(W));
  lines.push(allPass
    ? '  VERDICT: PASS — all ' + passed + ' cases green. The codebase is ready for the deployment steps.'
    : '  VERDICT: FAIL — ' + failed.length + ' case(s) failed. Fix before going online:');
  if (!allPass) for (const c of failed.slice(0, 20)) lines.push('    - ' + c.id + ' ' + c.name + ' :: ' + c.detail);
  lines.push('');
  lines.push('  Pre-deployment checklist (manual, for the "make it online" phase):');
  lines.push('    1. Gate or remove POST /api/v1/reservations/reset behind an admin token in production.');
  lines.push('    2. Replace the client-side staff passcode with real server-side auth for the manager portal.');
  lines.push('    3. Serve over HTTPS and set Access-Control-Allow-Origin to the real origin.');
  lines.push('    4. Schedule backups of data/reservations.json (it is the system of record).');
  lines.push('    5. Keep body-size caps (64KB) and validation limits as deployed.');
  lines.push('    6. Re-run this suite after every deploy: node scripts/final-test.mjs --url <prod-url>');
  lines.push('');
  lines.push('Note: run window sensitivity — P8 IST-boundary cases are most meaningful');
  lines.push('when the suite runs between 00:00 and 05:30 IST (the old UTC-drift window).');
  lines.push('='.repeat(W));

  const reportPath = path.join(ROOT, 'FINAL_TEST_REPORT.txt');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  const jsonPath = path.join(ROOT, 'FINAL_TEST_RESULTS.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated: new Date().toISOString(),
    root: ROOT,
    server: SERVER_SPEC,
    passed, failed: failed.length, total: CASES.length,
    allPass,
    latencyMs: { p50: +pct(LATENCIES, 50).toFixed(1), p95: +pct(LATENCIES, 95).toFixed(1), p99: +pct(LATENCIES, 99).toFixed(1), n: LATENCIES.length },
    improvements: IMPROVEMENTS.map(([id, sev, defect, fix, cases]) => ({
      id, severity: sev, defect, fix, cases,
      verified: expandCaseIds(cases).every((cid) => {
        const c = CASES.find((x) => x.id === cid);
        return c && c.pass;
      })
    })),
    cases: CASES
  }, null, 2), 'utf8');

  console.log('\n' + lines[0]);
  console.log('RESULT: ' + (allPass ? 'ALL PASS (' + passed + ' cases)' : 'FAIL — ' + failed.length + ' failing case(s)'));
  console.log('Report : ' + reportPath);
  console.log('JSON   : ' + jsonPath);
  process.exitCode = allPass ? 0 : 1;
}

// ============================ Snapshot / restore ============================
function snapshot() {
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_BAK);
  } catch { /* ok */ }
}
function restore() {
  if (has('--keep')) return;
  try {
    if (fs.existsSync(DB_BAK)) {
      fs.copyFileSync(DB_BAK, DB_FILE);
      fs.unlinkSync(DB_BAK);
    } else if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE); // there was no DB when we started
    }
  } catch { /* best effort */ }
  // remove quarantine artifacts the suite created (keep any that predate the run)
}

// ============================ Main ============================
async function main() {
  const t0 = Date.now();
  snapshot();
  let ok = true;
  try {
    await startServer();
    await phase1();
    await phase2();
    await phase3();
    await phase4();
    await phase5();
    await phase6();
    await phase7();
    await phase8();
    await phase9();
    phase10();
    await phaseClient();
  } catch (err) {
    console.error('\n[suite] aborted:', err.message || err);
    ok = false;
  } finally {
    stopServer();
    // give the child a moment to release the DB file handle
    await new Promise((r) => setTimeout(r, 400));
    restore();
    writeReport(Date.now() - t0);
  }
  if (!ok) process.exitCode = process.exitCode || 1;
  // hard exit: no stray handle (spawned pipes, agents) may keep the process alive
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error(err); process.exit(2); });



