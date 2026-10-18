# The Burger Factory — Complete Codebase Audit, Multi-Day Simulation Pipeline & Antigravity Master Prompt

This blueprint covers two major deliverables:
1. **A 7-Point Architectural & Codebase Audit** of your 73-file snapshot (`PROJECT_STATE_DUMP.txt`), detailing exact bugs found in `vite.config.js`, `src/js/booking.js`, `src/js/manager.js`, and `manager.html`, along with their fixes.
2. **A Full-Scale, Multi-Day, Multi-Customer Simulation & Chaos Testing Pipeline** (`scripts/run_simulation.mjs`) that simulates hundreds of concurrent customers, walk-in parties, host check-ins, table turns, and edge-case/chaos attacks across all **7 outlets** and **104 physical tables**, writing every detected failure and stack trace to `D:\Burger_factory\SIMULATION_ERROR_REPORT.txt`.

## Part 1: Codebase Audit & 7 Critical Improvements

| Issue ID | Severity | File(s) Affected | What Happens Under Real Load | Exact Engineering Fix |
| :--- | :--- | :--- | :--- | :--- |
| **ERR-CONC-001** | **CRITICAL** | `vite.config.js`, `src/js/booking.js` | **Concurrent Double-Booking Race Condition**: `POST /api/v1/reservations` blindly pushes `payload.reservation` into `data/reservations.json` without checking if the table is free on the server. When 10 customers book Anjuna at 19:30 simultaneously, their browsers all pick `ANJ-I1` from the same snapshot and the server saves all 10 to the same table. | Move Best-Fit table allocation (`allocateTableAtomic`) into `vite.config.js` behind an in-memory promise mutex (`withMutex`) and atomic temp-file rename (`reservations.json.tmp` -> `reservations.json`), returning `HTTP 409 Conflict` if a slot fills up mid-flight. |
| **ERR-VAL-001 / CAP-001** | **HIGH** | `vite.config.js` | **Zero Server-Side Input & Capacity Validation**: Direct `POST` requests bypass UI limits—allowing `guests: -5`, `guests: 999` on a 2-seater table, past dates (`1999-01-01`), or invalid times (`25:99`). | Enforce strict server-side validation on `locationId`, `date`, `time`, `guests` (`1..12`), `phone` (10-digit Indian mobile), and table capacity before writing to disk. |
| **ERR-FSM-001** | **HIGH** | `vite.config.js` | **Unvalidated Status Transitions**: `PATCH /api/v1/reservations/status` accepts any arbitrary string (e.g., `status: "hacked_status"`), corrupting dashboard KPI counters and filters. | Validate `status` against the allowed state machine set (`confirmed`, `seated`, `completed`, `cancelled`, `no-show`). |
| **ERR-SEC-001** | **HIGH** | `src/js/main.js`, `src/js/manager.js`, `src/js/thermalTicket.js`, `vite.config.js` | **Stored XSS Injection**: Guest `name` and `notes` are interpolated directly into `.innerHTML` templates without escaping. A booking with `<img src=x onerror=alert(1)>` executes script in the manager's browser when opening the Staff Portal. | Add `escapeHtml()` sanitization at both the API ingestion boundary (`vite.config.js`) and frontend DOM rendering (`main.js`, `manager.js`, `thermalTicket.js`). |
| **ERR-AUTH-001** | **MEDIUM** | `manager.html` (Line 30) | **Hardcoded Passcode in Password Input**: `<input type="password" id="staff-gate-pass" value="burger123">` pre-fills the password in the DOM so anyone can click "Unlock Staff Portal" without knowing the passcode. | Remove `value="burger123"` from `#staff-gate-pass` in `manager.html` so staff must enter the passcode (or use your dev shortcut). |
| **ERR-TZ-001** | **MEDIUM** | `src/js/booking.js`, `src/js/main.js`, `src/js/manager.js` | **UTC vs. IST Midnight Date Drift**: `new Date().toISOString().split('T')[0]` uses UTC (5.5 hours behind IST). Between 12:00 AM and 5:30 AM IST, "today" resolves to yesterday's date. | Replace UTC `.toISOString().split('T')[0]` with a dedicated `getTodayIST()` helper (`new Date(Date.now() + 19800000).toISOString().split('T')[0]`). |
| **ERR-FLOOR-001 & WARN-SYNC-001** | **MEDIUM** | `src/js/manager.js`, `/apps/web/`, `/NEW/` | **Floor Map Future-Date Bug & Workspace Drift**: `renderFloorCanvas()` compares future/past date bookings against today's live wall-clock hour, and `.find()` on unsorted `upcoming` bookings shows a 21:00 booking before an 18:30 booking. Also, `/apps/web/index.html` is out of sync with root `/index.html`. | Sort `upcoming` reservations chronologically before `.find()`, handle future/past dates cleanly on the floor map, sync `/apps/web/` with root, and remove the redundant `/NEW/` folder. |

## Part 2: Complete Multi-Day, Multi-Customer Simulation Pipeline Architecture

To test your project under realistic restaurant conditions without corrupting your live reservations, the simulation pipeline (`scripts/run_simulation.mjs`) runs a **5-Stage Automated Stress & Chaos Harness**:

1. **Stage 0 — Snapshot &Backup**:
   - Backs up your existing `data/reservations.json` into memory (and restores it automatically at the end of the run unless you pass `--keep-data`).
2. **Stage 1 — Concurrent Peak-Hour Stampede (Race Condition & Lock Testing)**:
   - Fires **25 simultaneous `POST /api/v1/reservations` requests** via `Promise.all()` at the exact same millisecond for `Anjuna`, `today`, `19:30`, `2 guests`, `indoor` (where only **3 indoor 2-seater tables** exist: `ANJ-I1`, `ANJ-I2`, `ANJ-I3`, plus fallback to 4/6-seaters up to 9 indoor tables total).
   - Audits the database afterwards to verify that **zero physical tables** have overlapping bookings within the 90-minute turn window.
3. **Stage 2 — 7-Day, 7-Outlet Full Restaurant Lifecycle Simulation**:
   - Simulates **7 consecutive days** across all **7 outlets** (`anjuna`, `morjim`, `dona-paula`, `panaji`, `vagator`, `nerul`, `delhi`) and **20 daily time slots** (`12:30` to `22:00`).
   - Spawns **350+ virtual customer agents** in concurrent waves (Lunch rush `12:30–14:30` and Dinner rush `19:00–21:30`), plus **walk-in parties** seated directly from the floor map.
   - Simulates realistic guest & host actions:
     - **65%** arrive on time -> Host transitions `confirmed` -> `seated` -> `completed` (releasing the table for the next turn!).
     - **15%** self-cancel online -> Customer calls `PATCH /api/v1/reservations/status` (`cancelled`), freeing the table for another guest.
     - **10%** fail to arrive -> Host marks `no-show`, freeing the table.
     - **10%** remain `confirmed` for upcoming slots.
4. **Stage 3 — Chaos, Security & Boundary Fuzzing**:
   - Injects malformed and malicious payloads (`guests: -5`, `guests: 999`, `date: "1999-01-01"`, `time: "25:99"`, `status: "hacked_status"`, and `<script>alert("XSS")</script>` in guest names/notes) and verifies whether the server rejects or sanitizes them.
5. **Stage 4 — Database Invariant Audit & `SIMULATION_ERROR_REPORT.txt` Generation**:
   - Scans every reservation record in `data/reservations.json` for 90-minute overlap collisions, capacity violations, duplicate booking codes, and missing lifecycle timestamps (`seatedAt`, `completedAt`, `cancelledAt`, `noShowAt`).
   - Writes a structured, human-readable diagnostic log to `D:\Burger_factory\SIMULATION_ERROR_REPORT.txt` with exact reproduction payloads, root causes, and file/line fix instructions.

## Part 3: Single Copy-Paste Master Prompt for Antigravity AI

Copy and paste the block below directly into **Antigravity AI** in your `D:\Burger_factory` workspace:

```text
Please perform a complete reliability, concurrency, security, and simulation upgrade on "The Burger Factory" in D:\Burger_factory:

1. FIX SERVER-SIDE CONCURRENCY, DOUBLE-BOOKING & VALIDATION IN `vite.config.js` (AND `apps/web/vite.config.js`):
   - Add an in-memory async mutex lock (`withMutex`) around all `/api/v1/reservations` POST/PATCH mutations so concurrent requests are serialized atomically.
   - Add atomic file writing (`writeDb` writes to `data/reservations.json.tmp` and renames to `data/reservations.json`).
   - Import `locationTables` and `locations` from `./src/js/data.js` inside `vite.config.js` and perform server-side Best-Fit table allocation (`allocateTableAtomic`) inside the mutex lock on `POST /api/v1/reservations`:
     * Validate `locationId` (must exist in `locationTables`), `date` (`YYYY-MM-DD`, not in the past in IST), `time` (valid slot or `HH:MM` for walk-ins), `guests` (integer `1..12`), `name` (min 2 chars), and `phone`.
     * Escape HTML entities (`<`, `>`, `&`, `"`, `'`) on `name`, `email`, `phone`, `occasion`, and `notes` to block Stored XSS (`ERR-SEC-001`).
     * Filter candidate tables by `seating` preference (with zone fallback), `capacity >= guests`, sorted ascending by `capacity`.
     * Check 90-minute turn collision (`Math.abs(reqMin - bookedMin) < 90`) against all active (`confirmed` or `seated`) bookings in `data/reservations.json`.
     * For walk-in bookings (`status === 'seated'` with an explicit `tableId`), verify the requested table has `capacity >= guests` and no active collision.
     * If no table is free, return HTTP 409 `{ error: 'All suitable tables are booked for this time slot.' }`.
     * Ensure unique `BF-XXXXXX` booking codes with zero collisions.
   - On `PATCH /api/v1/reservations/status`, validate `status` against `['confirmed', 'seated', 'completed', 'cancelled', 'no-show']` (return HTTP 400 otherwise).
   - Add `POST /api/v1/reservations/reset` (accepting `{ reservations: [...] }`) so the simulation harness can cleanly seed and restore state.

2. FIX FRONTEND BUGS (`src/js/booking.js`, `src/js/main.js`, `src/js/manager.js`, `src/js/thermalTicket.js`, `manager.html`):
   - In `src/js/booking.js`:
     * Add `export function getTodayIST() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0]; }` and use it instead of `new Date().toISOString().split('T')[0]` across `booking.js`, `main.js`, and `manager.js`.
     * In `createReservation()` and `createWalkInReservation()`, await the `fetch('/api/v1/reservations', { method: 'POST', ... })` response FIRST; if `!res.ok`, return `{ success: false, message: errData.error || 'Slot no longer available' }` instead of optimistically saving a conflicting booking to `localStorage`. Use the server-returned `data.reservation` as the canonical reservation record.
   - In `manager.html`:
     * Remove `value="burger123"` from `<input type="password" class="form-input" id="staff-gate-pass" ...>` so the password is not pre-filled for unauthorized visitors (keep the `#btn-gate-autofill` helper button for quick demo testing).
   - In `src/js/manager.js`:
     * In `renderFloorCanvas()`, sortreservations by `a.time.localeCompare(b.time)` before finding `active` and `upcoming` bookings so the earliest upcoming booking is always displayed on the table card, and only compare against current wall-clock minutes when `currentDate === getTodayIST()` (for future dates, show the earliest confirmed booking on each table as `reserved`).
   - Add an `escapeHtml(str)` helper in `main.js`, `manager.js`, and `thermalTicket.js` to sanitize guest-supplied strings (`name`, `phone`, `notes`, `occasion`) before interpolating into `.innerHTML`.
   - Sync all updated files to `/apps/web/` so `/apps/web/` and root `/` are 100% identical, and remove the leftover `/NEW/` directory.

3. CREATE & RUN THE MULTI-DAY, MULTI-CUSTOMER SIMULATION ENGINE (`scripts/run_simulation.mjs`):
   - Create `scripts/run_simulation.mjs` and add `"simulate": "node scripts/run_simulation.mjs"` to `package.json`.
   - The script must:
     * Backup `data/reservations.json` before starting and restore it in a `finally` block (unless `--keep-data` is passed).
     * Stage 1 (Concurrent Stampede): Fire 25 parallel `POST /api/v1/reservations` requests at the exact same millisecond for `anjuna`, `19:30`, `2 guests`, `indoor` and verify zero double-booked tables.
     * Stage 2 (7-Day Multi-Outlet Lifecycle): Simulate 7 days across all 7 outlets (`anjuna`, `morjim`, `dona-paula`, `panaji`, `vagator`, `nerul`, `delhi`) with 350+ concurrent customer bookings, walk-ins, online cancellations, no-shows, and host check-ins (`confirmed` -> `seated` -> `completed`).
     * Stage 3 (Chaos & Fuzzing): Test negative guests (`-5`), over-capacity guests (`999`), past dates (`1999-01-01`), invalid times (`25:99`), invalid status transitions (`hacked_status`), and XSS payloads (`<script>alert("XSS")</script>`).
     * Stage 4 (Invariant Audit): Scan all reservations in `data/reservations.json` for 90-minute overlap collisions on the same table, capacity violations, duplicate codes, and missing timestamps.
     * Stage 5 (Static Code Audit): Verify `manager.html` has no pre-filled `value="burger123"` and `booking.js` uses IST date helpers.
     * Output a complete diagnostic report to `D:\Burger_factory\SIMULATION_ERROR_REPORT.txt` listing every test stage, latency metrics (avg, p95, max), outlet utilization, and detailed error cards (Error Code, Severity, Endpoint, Payload, Expected vs. Actual, and Root Cause & Fix).
   - Run `npm run simulate` and verify that `SIMULATION_ERROR_REPORT.txt` is generated with 0 errors.
```