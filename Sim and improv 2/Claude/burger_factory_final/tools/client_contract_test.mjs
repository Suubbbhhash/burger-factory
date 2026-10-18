#!/usr/bin/env node
// Client <-> server contract test: runs the REAL src/js/booking.js (the code your browser runs) against a throw-away server.
// Usage (repo root):  node tools/client_contract_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 3190, BASE = `http://127.0.0.1:${PORT}`, PASS = 'contract-test-pass';
const rt = path.resolve('sim_runtime_contract');
fs.rmSync(rt, { recursive: true, force: true }); fs.mkdirSync(path.join(rt, 'data'), { recursive: true });
fs.writeFileSync(path.join(rt, 'data', 'reservations.json'), '[]');
fs.copyFileSync('vite.config.js', path.join(rt, 'vite.config.js'));
fs.cpSync('src', path.join(rt, 'src'), { recursive: true });
const child = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
  { cwd: rt, stdio: 'ignore', env: { ...process.env, STAFF_PASSCODE: PASS } });
const stop = code => { try { child.kill(); } catch {} fs.rmSync(rt, { recursive: true, force: true }); process.exit(code); };

// ---- browser shims ----
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
globalThis.localStorage = store(); globalThis.sessionStorage = store();
const listeners = {}; globalThis.window = { addEventListener: (t, f) => (listeners[t] ||= []).push(f), dispatchEvent: e => (listeners[e.type] || []).forEach(f => f(e)) };
const realFetch = globalThis.fetch; globalThis.fetch = (u, o) => realFetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);

let failed = 0, n = 0;
const check = (name, ok, extra = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <-- ' + extra}`); };

for (let i = 0; i < 60; i++) { try { if ((await realFetch(BASE + '/api/v1/reservations')).ok) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
const B = await import('../src/js/booking.js');
const D = await import('../src/js/data.js');
const tomorrow = new Date(Date.now() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10);
const today = B.getTodayIST();

// 1. data consistency + outlet hours
for (const l of D.locations) { const t = Object.values(D.locationTables[l.id]).flat(); check(`card numbers match tables (${l.id})`, l.tables === t.length && l.capacity === t.reduce((s, x) => s + x.capacity, 0)); }
check('Panaji has no 22:00 slot (closes 10 PM)', !D.slotsForLocation('panaji').includes('22:00'));
check('Delhi offers 12:00 (opens at noon)', D.slotsForLocation('delhi').includes('12:00'));
check('slot grid follows outlet hours', B.getSlotAvailabilityGrid('nerul', tomorrow, 2, 'any').every(s => D.slotsForLocation('nerul').includes(s.time)));

// 2. anonymous customer: availability list has no personal data
await B.syncReservationsFromServer();
check('anonymous sync works and holds no guest data', JSON.stringify(B.getAllReservations()).indexOf('phone') === -1);

// 3. booking
const phone = '+91 98765 43210';
const r1 = await B.createReservation({ locationId: 'anjuna', date: tomorrow, time: '19:30', guests: 4, seating: 'any', name: 'Contract Tester', email: 'ct@example.com', phone });
check('online booking succeeds', r1.success && /^BF-[0-9A-Z]{6}$/.test(r1.reservation?.code || ''), JSON.stringify(r1));
check('server (not browser) chose the table', !!r1.reservation?.tableId);
check('guest data NOT stored in shared browser cache', !JSON.stringify(B.getAllReservations()).includes('Contract Tester'));
const r2 = await B.createReservation({ locationId: 'anjuna', date: tomorrow, time: '19:30', guests: 4, seating: 'any', name: 'Contract Tester', email: 'ct@example.com', phone });
check('double tap returns the SAME booking (no second table)', r2.success && r2.reservation.code === r1.reservation.code, JSON.stringify(r2));
const bad = await B.createReservation({ locationId: 'panaji', date: tomorrow, time: '22:00', guests: 2, seating: 'any', name: 'Late Guest', phone });
check('slot after closing is refused', !bad.success);

// 4. lookup + cancel with server-side phone proof
const code = r1.reservation.code;
check('lookup with wrong digits fails', !(await B.lookupReservation(code, '0000')).success);
const lk = await B.lookupReservation(code, '3210');
check('lookup with right digits shows the booking', lk.success && lk.reservation.name === 'Contract Tester');
check('cancel with wrong digits fails', !(await B.cancelReservation(code, '1111')).success);
check('guest cannot mark own booking completed (staff action)', !(await B.updateReservationStatus(code, 'completed')));
check('cancel with right digits works', (await B.cancelReservation(code, '3210')).success);
check('lookup now shows cancelled', (await B.lookupReservation(code, '3210')).reservation?.status === 'cancelled');

// 5. staff
check('staff login with wrong passcode fails', !(await B.staffLogin('nope')).success);
check('staff login works', (await B.staffLogin(PASS)).success && !!B.getStaffToken());
const w = await B.createWalkInReservation({ locationId: 'anjuna', tableId: 'ANJ-I1', tableType: '2-seater', tableZone: 'indoor', guests: 2, name: 'Walk In', phone: '', notes: '' });
check('staff walk-in works', w.success && w.reservation.status === 'seated', JSON.stringify(w));
check('staff sees full records', JSON.stringify(await B.syncReservationsFromServer()).includes('Walk In'));
check('staff can complete a booking', await B.updateReservationStatus(w.reservation.code, 'completed'));
check('completed cannot be re-seated', !(await B.updateReservationStatus(w.reservation.code, 'seated')));
await B.staffLogout();
check('logout clears token and cached guest data', !B.getStaffToken() && B.getAllReservations().length === 0 || !JSON.stringify(B.getAllReservations()).includes('Walk In'));
// expired / forged session -> auth-required event fires
let fired = false; window.addEventListener('bf-auth-required', () => { fired = true; });
B.setStaffToken('a'.repeat(48)); await B.syncReservationsFromServer();
check('expired/forged token triggers re-login', fired && !B.getStaffToken());
check('walk-in without login is refused', !(await B.createWalkInReservation({ locationId: 'anjuna', tableId: 'ANJ-I2', tableType: '2-seater', tableZone: 'indoor', guests: 2, name: 'X' })).success);

console.log(`\n${n - failed}/${n} checks passed`);
stop(failed ? 1 : 0);
