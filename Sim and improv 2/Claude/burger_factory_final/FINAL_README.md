# The Burger Factory - Final Release Package

Copy these files over your repo (same paths), then run:

    npm install
    npm run test:final          # must print: OVERALL VERDICT: PASS

Start the LAN server with your own passcode (never ship the default):

    Windows (PowerShell):  $env:STAFF_PASSCODE="your-long-passcode"; npm run dev
    Linux/macOS:           STAFF_PASSCODE="your-long-passcode" npm run dev

## What changed (all covered by the final test)

| Area | Before | Now |
|---|---|---|
| Double-booking | browser picked the table, server trusted it | server picks the table (best fit) under a lock; client table choice ignored for online bookings |
| Double-tap on Confirm | two bookings / two tables | same booking returned (idempotent) |
| Fake confirmations | errors swallowed, success shown | success shown only after server says 201 |
| Staff login | passcode list + `burger123` hard-coded in browser JS/HTML | server checks passcode (STAFF_PASSCODE), returns 12 h session token; 5 wrong tries -> lockout |
| Staff actions (seat/complete/no-show/walk-in) | open to anyone | need the staff token |
| Guest cancel / lookup | phone digits checked in the browser | checked on the server; 5 wrong guesses per booking -> 429; same answer for "wrong phone" and "unknown code" |
| Guest data | every phone downloaded every guest's name/phone/email | anonymous list = {outlet, date, time, table, status} only; full data needs staff token; logout wipes the device cache |
| Live updates (SSE) | whole table (up to 460 KB) per change | tiny "something changed" ping (< 100 bytes), no personal data; heartbeat every 20 s |
| Test-only /reset wipe endpoint | open to anyone | removed |
| Booking rules | past dates, 1999, 40 guests, `<script>`, 1 MB notes accepted | all refused; max 90 days ahead; slot must exist for that outlet; body limit 20 KB |
| Opening hours | one global slot list (Panaji/Nerul accepted a 22:00 booking at close) | slots derived per outlet: opening time .. closing - 30 min (Delhi gets 12:00..22:30) |
| Outlet cards | seats/tables typed by hand and wrong (Anjuna 72 vs 76 ...) | computed from the real table list |
| Availability grid vs booking check | two different seating rules | one shared rule |

## Test commands
- `npm run test:final`   contract test + 7-day simulation (about 1-2 minutes). Exit code 0 = ship.
- `npm run test:contract` only the client/server contract test (31 checks).
- `npm run simulate`      only the simulation; add `--days 14 --scale 2 --seed 7` to stress harder.
  Same `--seed` = same customers, so a failure can be replayed. Logs: `sim_logs/run-*/simulation_errors.txt` (what broke, likely cause, fix) and `simulation_events.txt` (everything that happened).

## Delete / ignore
- `scripts/run_simulation.mjs` and the `SIMULATION AND IMPROVEMENT` folder: its "PASS" only greps your source for known bugs; it cannot find new ones.
- add `sim_logs/`, `sim_runtime*/`, `FINAL_TEST_REPORT.txt` to `.gitignore`.

## Known limits (be honest with yourself before going online)
1. This package fixes and tests the LAN/dev server (`vite.config.js`) and the browser code. `vite build` + static hosting does NOT include this API (it only exists while `vite` runs). For a real online launch you need the Fastify + PostgreSQL service in `apps/api` - see the checklist below. I could not run that service here (no database), so none of its code was changed or tested.
2. One restaurant day of unusual behaviour is only as realistic as the model: customer volumes, 66-min average stay and no-show rate are estimates. Replace them with your real numbers.
3. Overstay: the fixed 90-minute table turn still blocks the next party when guests stay long (simulation: ~5% of arrivals). Consider duration by party size + a "move table" action.
4. Staff list grows with total history (870 KB after 7 busy days); add date filtering before leaving it running for months.

## Port to apps/api (Fastify + Postgres) - required before going online
Every rule in the table above must exist in the real backend. Minimum list:
- `preHandler: jwtVerify + role check` on ALL floor routes (walk-in, status PATCH, /events, /manifest, CSV). Today only /auth/me checks the token.
- Postgres exclusion constraint (the schema enables btree_gist but never uses it):
  `ALTER TABLE reservations ADD CONSTRAINT no_table_overlap EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN ('CONFIRMED','SEATED'));` then catch SQLSTATE 23P01 and retry the next table.
- Guest cancel/lookup: verify phone last-4 on the server (the lookup route already does; accept codes with and without the `BF-` prefix).
- Format times with `timeZone: 'Asia/Kolkata'` (UTC servers show wrong times otherwise).
- Rate limit (`@fastify/rate-limit`) on login, lookup, cancel and booking creation; CORS locked to your domain; HTTPS only (Caddy file exists in infra/).
- Run the same simulator logic against it by writing a small adapter, or at minimum repeat the probes in `tools/simulate.mjs` (onProbe) by hand.
- If the app runs behind Caddy and you keep using this LAN server, set `TRUST_PROXY=1` so rate limits count real visitor IPs.
