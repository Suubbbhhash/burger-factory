# The Burger Factory — Real-Life Simulation Pipeline

A zero-dependency (Node >= 18) digital-twin simulator for **The Burger Factory** LAN/Vite mode.
It generates realistic multi-day, multi-outlet, multi-customer traffic against the running app,
drives the full reservation lifecycle (book -> seat -> complete / cancel / no-show), injects
chaos, and writes everything — including every error with a resolution hint — to
`SIMULATION_LOG.txt`.

Drop this folder into `D:\Burger_factory\simulation\`. It does not touch your package.json
(it has its own) and installs nothing.

## Quick start

```bat
:: 1. Start your app (vite on :3000)          start-burger-factory.bat
::    …or use the built-in test harness (:3100)
node simulation\test-harness\server.mjs

:: 2. Probe the target
node simulation\run.mjs --probe-only --target http://localhost:3000

:: 3. Smoke run (1 virtual day, ~2 real minutes)
node simulation\run.mjs --tag smoke --days 1 --accel 600 --target http://localhost:3000

:: 4. Standard run (7 virtual days)
node simulation\run.mjs --tag standard --days 7 --accel 240

:: 5. Soak (30 virtual days, 3x demand, aggressive chaos)
node simulation\run.mjs --tag soak --days 30 --accel 480 --multiplier 3 --chaos aggressive

:: 6. Reproduce any run exactly (same population, same story)
node simulation\run.mjs --seed BF-7A2C9K --days 3 --accel 720 --target http://localhost:3000
```

Everything lands in `SIMULATION_LOG.txt` (append-only across runs) and
`reports/sim-report-<runid>.md` + `reports/simulation_errors_<runid>.json`.

## CLI reference

| Flag | Default | Meaning |
|---|---|---|
| `--target URL` | `http://localhost:3000` | Base URL of the app or harness |
| `--days N` | 7 | Virtual days to simulate |
| `--accel N` | 240 | Time compression (1 = real time) |
| `--seed TAG` | random (echoed) | Deterministic world seed |
| `--cap N` | 800 | Max concurrent actors (arrivals queue above this) |
| `--chaos MODE` | standard | `off` / `standard` / `aggressive` |
| `--multiplier N` | 1 | Demand volume multiplier |
| `--start-date DATE` | today | First simulated day (YYYY-MM-DD) |
| `--tag NAME` | run | Used in run ids and filenames |
| `--probe-only` | — | Probe GET + SSE handshake, then exit |
| `--log-level` | info | `debug` logs every FSM step |
| `--fresh` | — | Start a new log instead of appending |

## What it models (digital twin)

- **7 outlets, 110 tables** — verbatim replica of `src/js/data.js` `locationTables`.
- **20 time slots** (12:30-22:00) and the **90-minute turn rule** — same as `booking.js`.
- **Arrivals**: non-homogeneous per-30-minute process; lunch and dinner peaks; Sat 1.7x /
  Fri 1.4x / Sun 1.5x weekend factors; Goa high-season factor 1.15.
- **Channels**: online ~68%, walk-in ~22%, phone ~10% (walk-in share rises in the evening).
- **Personas**: party size, seating preference, temperament (impulsive/balanced/picky),
  punctuality (77% on-time, 15% late 5-14m, 8% no-show), turn duration 90±15m,
  pre-arrival cancellation 12%, abandonment behavior by temperament.
- **7 virtual floor managers** (one per outlet) who sync, seat, complete, and mark no-shows
  exactly the way `manager.js` does.
- **The client replica** reimplements `checkAvailability`, `getSlotAvailabilityGrid`,
  `createReservation` and `createWalkInReservation` **verbatim — bugs included** — so the
  traffic it generates is authentic, including the parts that hurt.

## Chaos catalog (each targets a known weakness)

| Scenario | What it proves |
|---|---|
| Race pair (two groups, same table+slot, simultaneous POSTs) | No server-side overlap guard -> double booking (A3-4) |
| Double submit (double-click) | No idempotency -> duplicate booking codes (A4-3) |
| Invalid payloads (guests 99, time 25:99, date 2026-13-45, 300-char names...) | Zero server-side validation (A3-1) |
| Abandoned request (abort mid-POST) | Ghost bookings on client disconnect (A4-2) |
| Rapid fire (12 POSTs / 300ms) | Throughput + race stress |
| Clock skew (createdAt 2031, past dates) | Client-trusted timestamps (A3-1) |
| Illegal transitions (completed -> confirmed, cancelled -> seated) | PATCH has no state machine (A4-5) |
| Table sniper (stampede on a just-cancelled table) | Post-cancellation race window |

## SIMULATION_LOG.txt grammar

```
[R 2026-10-17T21:22:31.040+05:30][V D3 19:31:12][C-0812][BOOKING] [INFO ] arrival outlet=anjuna ...
[R 2026-10-17T21:22:31.041+05:30][V D3 19:31:15][CHAOS][RACE] [ERROR] ERR-0031/DBL-BOOK race pair: BOTH POSTs accepted — ...
      ctx: {...}
      finding: A3-4 / A3-6
      hint: Move availability check + table allocation server-side; ...
```

Every error line carries: ERR id, category, signature, context dump, the **code-review finding
it maps to**, and a **fix hint**. The end-of-run block groups errors by category and signature
and tells you what to fix first.

## Validated in this repository (evidence)

Run `validation-final` — 3 virtual days (Sat/Sun/Mon), seed `BF-7A2C9K`, accel 720x against
the included test harness:

- 1,313 virtual customers (deterministic: same seed = same population, verified across 3 runs)
- 896 online/phone bookings + 225 walk-ins; 62 cancellations; 70 no-shows; 1,012 completed turns
- 11,436 HTTP requests, 0 failures; **SSE parity clean: 3,105 events for 3,105 mutations**
- 27 invariant violations caught with fix hints:
  DBL-BOOK x (race pairs + organic walk-ins), ILLEGAL-TR x17, DUP-CODE x7, OVER-CAP, SSE-GAP

Full evidence: `SIMULATION_LOG.txt` and `reports/` in this folder.

## Test harness (`test-harness/`)

A byte-faithful standalone replica of the vite.config.js embedded REST engine (same routes,
same seed, same validation-free behavior). Use it to validate the simulator without the full
app, or later as the "broken engine" side of an A/B test against a fixed engine.

```bat
node test-harness\server.mjs 3100
node run.mjs --target http://127.0.0.1:3100 --tag smoke --days 1 --accel 600
```

## Files

```
simulation/
├── run.mjs                    CLI entrypoint
├── sim.config.json            defaults (overridden by CLI flags)
├── src/
│   ├── util.js                time/math/format helpers (IST-anchored)
│   ├── core/rng.js            seeded deterministic RNG (mulberry32 + forks)
│   ├── core/clock.js          dual-time virtual clock (virtual story, real HTTP)
│   ├── log/logger.js          SIMULATION_LOG.txt writer + error registry
│   ├── log/errors.js          error knowledge base (category -> hint -> finding)
│   ├── demand/outlets.js      7 outlets / 110 tables / 20 slots (data.js replica)
│   ├── demand/names.js        persona identity pools
│   ├── demand/curves.js       arrival curves, channel mix, lead times, personas
│   ├── server/adapter.js      HTTP client (latency metrics) + SSE parity monitor
│   ├── actors/customer.js     customer FSM (booking.js replica, bugs included)
│   ├── actors/manager.js      7 floor managers (manager.js replica)
│   ├── actors/pool.js         actor pool, ledger, cancellations
│   ├── chaos/injector.js      race pairs, illegal transitions, snipers, payloads
│   ├── audit/invariants.js    double-book / dup-code / capacity / transition / lost-record / SSE audits
│   ├── report/report.js       markdown report + errors.json + log footer
│   └── engine/orchestrator.js preflight -> main -> day-rolls -> teardown
└── test-harness/server.mjs    standalone engine replica (:3100)
```
