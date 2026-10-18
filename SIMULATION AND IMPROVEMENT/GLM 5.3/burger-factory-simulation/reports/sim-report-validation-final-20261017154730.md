# Simulation Report — validation-final-20261017154730

| | |
|---|---|
| Target | http://127.0.0.1:3100 |
| Seed | BF-7A2C9K (reproduce with --seed BF-7A2C9K) |
| Virtual days | 3 @ 720x |
| Sim window | 2026-10-17T11:30:00.000+05:30 → 2026-10-20T11:30:00.000+05:30 |
| Wall time | 5.0 min |
| Chaos | standard |

## Demand
Planned population: **1313** ({"phone":101,"online":963,"walkin":249})

| Outlet | Planned | Tables | Seats |
|---|---|---|---|
| anjuna | 296 | 18 | 76 |
| morjim | 229 | 20 | 90 |
| delhi | 200 | 20 | 88 |
| panaji | 193 | 16 | 86 |
| vagator | 161 | 14 | 60 |
| dona-paula | 122 | 12 | 52 |
| nerul | 112 | 10 | 48 |

## Outcomes
| Metric | Value |
|---|---|
| Spawned customers | 1313 |
| Booked (online/phone) | 896 |
| Walk-ins seated | 225 |
| Abandoned | 192 |
| Client-side rejections | 89 |
| POST rejected/aborted | 0 |
| Cancellations | 62 |
| No-shows | 70 |
| Seated by managers | 786 |
| Completed turns | 1012 |
| Peak in-flight HTTP | 14 |
| HTTP requests total | 11436 (0 failed) |

## Server latency (real ms)
| Endpoint | n | p50 | p95 | p99 | max | errors |
|---|---|---|---|---|---|---|
| HTTP GET /api/v1/reservations | 8331 | 8 | 30 | 86 | 377 | 0 |
| HTTP PATCH /api/v1/reservations/status | 1941 | 14 | 74 | 142 | 496 | 0 |
| HTTP POST /api/v1/reservations | 1164 | 11 | 50 | 121 | 287 | 0 |

## Realtime (SSE)
Events received: 3105; expected mutations: 3105; reconnects: 0.

## Chaos
```json
{
  "mode": "standard",
  "racePairs": 14,
  "raceBothAccepted": 13,
  "illegalTransitions": 9,
  "snipers": 5,
  "attachCounts": {
    "invalid-payload": 7,
    "rapid-fire": 4,
    "abandoned-request": 10,
    "double-submit": 10,
    "clock-skew": 1
  }
}
```

## Invariant violations
Total distinct: 27
```json
{
  "double-book": 11,
  "dup-code": 6,
  "illegal-transition": 10
}
```

## Per-day summary
- D1 (2026-10-17): spawned 537, booked 377, walkins 114, cancelled 7, no-shows 10, seated 174, completed 289
- D2 (2026-10-18): spawned 469, booked 340, walkins 70, cancelled 30, no-shows 18, seated 213, completed 283
- D3 (2026-10-20): spawned 307, booked 179, walkins 41, cancelled 25, no-shows 42, seated 399, completed 440

## Errors
```
ERROR SUMMARY (grouped by category → signature → suggested fix)
  Data integrity: 31
  Concurrency race: 13
  Payload validation: 2

  Signatures (what to fix first):
    DBL-BOOK ×24 — finding A3-4 / A3-6 — fix: Move availability check + table allocation server-side; add Postgres EXCLUDE constraint (gist) on (table_id, tstzrange(starts_at, ends_at)) WHERE active; in LAN mode add a mutex + overlap re-check inside the write path.
    ILLEGAL-TR ×14 — finding A4-5 — fix: Server-side transition guard on PATCH.
    DUP-CODE ×6 — finding A4-3 — fix: Generate codes server-side with a retry loop on unique-violation; never trust client-generated codes.

```