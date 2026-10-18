# The Burger Factory — Master Improvement Register

All improvements from the debugging & hardening phase, consolidated into one
register. Every entry maps to the final acceptance test cases that verify it
(`scripts/final-test.mjs`). Status reflects the reference verification run:
**111/111 cases PASS**; the identical suite run against the pre-fix engine
produces 55 targeted failures across every category below.

| ID | Severity | Defect (before) | Fix (after) | Verified by |
|----|----------|-----------------|-------------|-------------|
| I-01 | CRITICAL | Concurrent double-booking race — 25 simultaneous clients could grab the same table (check-then-write with no serialization) | Server-side promise mutex serializing all writes; server-authoritative best-fit table allocation; 90-minute turn overlap check; honest capacity exhaustion returns HTTP 409 | T1.1a-d, T1.4a-b, T5.1a-d |
| I-02 | CRITICAL | Non-atomic persistence — direct `writeFileSync` could leave a truncated file; a corrupt file was silently treated as `[]` (data wipe) | Atomic commit via `.tmp` + `rename`; DB file stays parseable during concurrent writes; corrupt files are quarantined as `.corrupt-*` instead of wiped | T1.2, T1.3, T7.1, T7.1b, S10.4a-c |
| I-03 | HIGH | Zero input validation — negative guests, 999-person parties, past dates, `25:99` times all accepted | Server-side validation: integer guests 1-12, real calendar date >= today(IST), strict HH:MM, known outlet, required name — violations return HTTP 400 | T2.1a-f, T2.2a-d, T2.3a-d, T2.4a-b, T2.5a-b, T2.6a-b |
| I-04 | HIGH | PATCH accepted any status string (`banana`); terminal states could be revived (`completed` -> `confirmed`) | Status whitelist (confirmed/seated/completed/cancelled/no-show); legal transition map; terminal states have no outgoing edges; per-state timestamps (seatedAt, completedAt, cancelledAt, noShowAt) | T4.1a-d, T4.2a-d, T4.3a-d, T4.4a-d, T4.5a-b, T4.6, T4.7 |
| I-05 | HIGH | Stored XSS — `<img onerror=alert(1)>` in name/notes rendered straight into innerHTML | API layer rejects `<` and `>` in every text field; notes capped at 500 chars (DoS guard); `escapeHtml()` applied on every render path (manager table, arrivals, floor canvas, lookup card, thermal ticket, toasts) | T3.1a-e, T3.2, T3.3, T3.4, S10.2a-b, U1a-c |
| I-06 | CRITICAL | Ghost confirmations — client wrote localStorage first, then fired a fire-and-forget POST with an empty catch; network errors were swallowed | All mutations are server-first: await the server, gate on the result, only then mirror locally; failure leaves the local mirror byte-identical (no ghost records) | U3a-b, U4a-b, U5a-b, U7a-b, S10.6, S10.7 |
| I-07 | HIGH | Walk-ins bypassed collision checks entirely (no availability check, direct push) | Walk-ins go through the same server allocator and 90-minute overlap rules; odd-minute times (e.g. 20:07) are valid; initial status `seated` with seatedAt | T5.5, T4.5a-b, T8.2 |
| I-08 | MEDIUM | UTC/IST date drift — `toISOString().split('T')[0]` produced yesterday's date between 00:00 and 05:30 IST | `getTodayIST()` (UTC+5:30, host-timezone independent) on both server and client; the UTC idiom is gone from both files | T8.1a-c, T8.2, T8.3, T8.4, S10.3a-b, U2 |
| I-09 | HIGH | Phone last-4 verification bypass — an empty stored phone let anyone cancel/lookup any booking | Empty stored phone now fails verification explicitly; wrong last-4 fails; correct last-4 passes | U6a-c |
| I-10 | MEDIUM | Hardcoded staff passcode `burger123` prefilled in the DOM with a disclosure label | `value` attribute and disclosure text removed from the DOM; one-click Auto-Fill demo button kept; gate error no longer reveals the passcode | S10.1a-b |
| I-11 | MEDIUM | No clean way to reset state between test/dev runs | `POST /api/v1/reservations/reset` test endpoint (empty state + disk file); gate it behind an admin token in production | T9.1, T9.2, T9.3 |
| I-12 | HIGH | Floor-plan clock logic — unsorted `.find()` picked the wrong reservation for the current time slot; also bundled here: corrupt-DB resilience | Floor canvas sorts reservations by time before `.find()`; corrupt DB is quarantined and the server keeps serving | S10.5, T7.2a-b, T7.3 |

## Supporting hardening (engine-level, verified within the cases above)

- Server-generated booking codes with collision retry (no client-supplied ids).
- Client-supplied `tableId` / `status` / timestamps are ignored — the server is
  the single authority on allocation and state.
- 64KB request body cap (payload-too-large rejection).
- Unknown `/api/v1/*` paths return a JSON 404 instead of falling through.
- API responses are consistently `{ success, error | reservation, reservations }`.
- No-op transitions (same status) are rejected as illegal.
- Illegal-transition errors name the exact transition (`seated -> confirmed`).

## Simulation cross-reference (earlier phase)

The three simulation pipelines previously validated the same engine under
load; those results remain the stress-test evidence:

- `npm run simulate` — 7 days x 7 outlets x 104 tables, 2,055 HTTP requests,
  1,275 SSE events, p50 12.35ms / p95 28.19ms / p99 38.76ms,
  661 booking attempts -> 531 confirmed / 130 honest rejections,
  double-booking conflicts = 0, all 5 chaos payloads intercepted. PASS.
- `npm run simulate:claude` — Poisson arrivals + virtual personas.
- `npm run simulate:glm` — digital twin + SSE parity + chaos injection.

The final acceptance suite (`scripts/final-test.mjs`) is now the single
command that re-proves all of the above in one run, on demand, before every
deployment.
