// ============================================
// SIMULATION — ERROR KNOWLEDGE BASE
// Every logged error carries a category, a hint for
// resolution, and a cross-reference to the code
// review finding it exposes. This is what turns
// SIMULATION_LOG.txt into a debugging tool.
// ============================================

export const CATEGORIES = {
  VALIDATION: {
    label: 'Payload validation',
    hint: 'The server accepted or rejected a payload in an unexpected way. The LAN REST engine performs zero server-side validation (finding A3-1); compare the accepted payload against packages/shared Zod schemas to see what SHOULD have been enforced.'
  },
  RACE: {
    label: 'Concurrency race',
    hint: 'Two actors converged on the same table/slot and both writes succeeded. Root cause is client-side availability checking with a trust-the-client POST (finding A3-4) and, in production mode, the missing btree_gist exclusion constraint (finding A3-6).'
  },
  DATA: {
    label: 'Data integrity',
    hint: 'An invariant audit found corrupted state: double-booked tables, duplicate codes, illegal status transitions, or records that vanished. Cross-reference the two audit snapshots around the first occurrence to find the mutation that caused it.'
  },
  NETWORK: {
    label: 'Network behavior',
    hint: 'A request was aborted or timed out. Note whether the server still processed it (the vite middleware keeps running after client disconnect — ghost bookings, finding A3-1/A4-2). If a POST was aborted but the record later appears, that is the ghost-booking signature.'
  },
  SERVER: {
    label: 'Server error',
    hint: 'A 5xx or malformed response body. In the current engine, business failures (no availability) also surface as 500s because there is no error handler (finding A4-7). Check the response body logged with the error.'
  },
  CLIENT: {
    label: 'Simulator fault',
    hint: 'The SIMULATOR produced an invalid request or inconsistent internal state. These should stay near zero — if they climb, the bug is in simulation/, not in the app. Report with the ERR id and the reproduce seed.'
  },
  SSE: {
    label: 'Realtime stream',
    hint: 'The SSE monitor detected missing reservations:changed events, an unstable stream, or broadcast gaps. The LAN engine has no heartbeat (finding A4-8); long idle gaps are expected under proxies but event parity violations are real.'
  }
};

/** Error signature registry: code -> finding cross-ref. Used in the end-of-run summary. */
export const SIGNATURES = {
  'DBL-BOOK':   { ref: 'A3-4 / A3-6', fix: 'Move availability check + table allocation server-side; add Postgres EXCLUDE constraint (gist) on (table_id, tstzrange(starts_at, ends_at)) WHERE active; in LAN mode add a mutex + overlap re-check inside the write path.' },
  'DUP-CODE':   { ref: 'A4-3', fix: 'Generate codes server-side with a retry loop on unique-violation; never trust client-generated codes.' },
  'BAD-STATUS': { ref: 'A3-1 / A4-5', fix: 'Whitelist statuses server-side and enforce a transition matrix (confirmed->seated->completed; ->cancelled/no-show only from confirmed).' },
  'GHOST':      { ref: 'A3-1', fix: 'Check req destroyed/aborted state before persisting; discard writes for disconnected clients.' },
  'OVER-CAP':   { ref: 'A4-4', fix: 'Validate guests <= table.capacity (and <= 12) server-side before insert.' },
  'LOST-REC':   { ref: 'A3-7', fix: 'Atomic writeDb via temp-file + rename; never let readDb return [] on parse failure (halt instead).' },
  'ILLEGAL-TR': { ref: 'A4-5', fix: 'Server-side transition guard on PATCH.' },
  'SSE-GAP':    { ref: 'A4-8', fix: 'Add a 25s heartbeat like apps/api/src/realtime/hub.ts already does; consider delta events instead of full-array broadcasts.' },
  'PHANTOM':    { ref: 'A4-2', fix: 'Check response of POST client-side; on failure roll back the optimistic local record (the current client ignores POST failures). Keep server as single source of truth.' }
};
