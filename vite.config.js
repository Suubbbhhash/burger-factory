import { defineConfig } from 'vite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { locationTables, locations, slotsForLocation } from './src/js/data.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'reservations.json');
const TURN_MINUTES = 90;
const VALID_STATUSES = new Set(['confirmed', 'seated', 'completed', 'cancelled', 'no-show']);
const STAFF_PASSCODE = process.env.STAFF_PASSCODE || 'burger123';
const MAX_ADVANCE_DAYS = 90;
const TOKEN_TTL_MS = 12 * 3600 * 1000;
const BOOKING_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function getISTDateString(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function timeToMinutes(time) {
  if (!time || typeof time !== 'string' || !time.includes(':')) return NaN;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function sanitizeText(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function generateServerCode(existingRecords) {
  const existingCodes = new Set(existingRecords.map(r => (r.code || r.id || '').toUpperCase()));
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = 'BF-';
    for (let i = 0; i < 6; i++) {
      code += BOOKING_CHARS.charAt(Math.floor(Math.random() * BOOKING_CHARS.length));
    }
    if (!existingCodes.has(code)) return code;
  }
  return `BF-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Server-Side Atomic Best-Fit Table Allocator
 * Guarantees zero race-condition double-bookings under concurrent load!
 */
function allocateTableAtomic(records, locationId, date, time, guests, seatingPref = 'any', requestedTableId = null, isWalkIn = false) {
  const tables = locationTables[locationId];
  if (!tables) {
    return { available: false, error: 'Invalid outlet location' };
  }

  const reqMinutes = timeToMinutes(time);
  if (Number.isNaN(reqMinutes)) {
    return { available: false, error: 'Invalid time slot format' };
  }

  let allTables = [];
  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const t of zoneTables) {
      allTables.push({ ...t, zone });
    }
  }

  // If host/walk-in or probe requested a specific table, verify capacity & collision strictly
  if (requestedTableId) {
    const exactTable = allTables.find(t => t.id === requestedTableId);
    if (!exactTable) {
      return { available: false, error: `Table ${requestedTableId} does not exist at this outlet.` };
    }
    if (exactTable.capacity < guests) {
      return { available: false, error: `Table ${exactTable.id} capacity (${exactTable.capacity}) is smaller than party size (${guests}).` };
    }
    const hasCollision = records.some(r => {
      if (['cancelled', 'no-show', 'completed'].includes(r.status)) return false;
      if (r.locationId !== locationId || r.date !== date || r.tableId !== exactTable.id) return false;
      const bMin = timeToMinutes(r.time);
      return Math.abs(reqMinutes - bMin) < TURN_MINUTES;
    });
    if (hasCollision) {
      return { available: false, error: `Table ${exactTable.id} is already booked for this 90-minute window.` };
    }
    return { available: true, table: exactTable };
  }

  let candidateTables = allTables;
  if (seatingPref && seatingPref !== 'any') {
    const prefMap = {
      indoor: ['indoor'],
      outdoor: ['outdoor', 'beachside', 'rooftop'],
      beachside: ['beachside', 'outdoor'],
      rooftop: ['rooftop', 'outdoor']
    };
    const allowedZones = prefMap[seatingPref] || [seatingPref];
    const filtered = candidateTables.filter(t => allowedZones.includes(t.zone));
    if (filtered.length > 0) {
      candidateTables = filtered;
    }
  }

  candidateTables = candidateTables
    .filter(t => t.capacity >= guests)
    .sort((a, b) => a.capacity - b.capacity);

  if (candidateTables.length === 0) {
    return {
      available: false,
      error: `No single table accommodates ${guests} guests at this outlet.`
    };
  }

  for (const table of candidateTables) {
    const hasCollision = records.some(r => {
      if (['cancelled', 'no-show', 'completed'].includes(r.status)) return false;
      if (r.locationId !== locationId || r.date !== date || r.tableId !== table.id) return false;
      const bookedMinutes = timeToMinutes(r.time);
      return Math.abs(reqMinutes - bookedMinutes) < TURN_MINUTES;
    });

    if (!hasCollision) {
      return { available: true, table };
    }
  }

  return {
    available: false,
    error: 'All suitable tables are booked for this 90-minute window.'
  };
}

function ensureDbFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const todayStr = getISTDateString(0);
    const tomorrowStr = getISTDateString(1);

    const initialSeed = [
      {
        id: 'BF-7K9M2W',
        code: 'BF-7K9M2W',
        name: 'Arjun Kapoor',
        email: 'arjun@example.com',
        phone: '+91 98765 12345',
        locationId: 'anjuna',
        locationName: 'Anjuna, North Goa',
        date: todayStr,
        time: '13:00',
        guests: 4,
        seating: 'outdoor',
        occasion: 'birthday',
        notes: 'Garden table preferred, birthday dessert',
        tableId: 'ANJ-O3',
        tableLabel: 'ANJ-O3',
        tableType: '4-seater',
        tableZone: 'outdoor',
        status: 'confirmed',
        createdAt: new Date(Date.now() - 7200000).toISOString()
      },
      {
        id: 'BF-4X8R5Q',
        code: 'BF-4X8R5Q',
        name: 'Meera Nair',
        email: 'meera@example.com',
        phone: '+91 87654 23456',
        locationId: 'morjim',
        locationName: 'Morjim, North Goa',
        date: todayStr,
        time: '18:30',
        guests: 2,
        seating: 'beachside',
        occasion: 'anniversary',
        notes: 'Sunset deck table',
        tableId: 'MOR-B1',
        tableLabel: 'MOR-B1',
        tableType: '2-seater',
        tableZone: 'beachside',
        status: 'confirmed',
        createdAt: new Date(Date.now() - 14400000).toISOString()
      },
      {
        id: 'BF-9T2V6H',
        code: 'BF-9T2V6H',
        name: 'Ravi Desai',
        email: 'ravi@example.com',
        phone: '+91 76543 34567',
        locationId: 'anjuna',
        locationName: 'Anjuna, North Goa',
        date: todayStr,
        time: '12:30',
        guests: 6,
        seating: 'indoor',
        occasion: 'business',
        notes: 'Quiet indoor table for 6',
        tableId: 'ANJ-I8',
        tableLabel: 'ANJ-I8',
        tableType: '6-seater',
        tableZone: 'indoor',
        status: 'seated',
        createdAt: new Date(Date.now() - 18000000).toISOString(),
        seatedAt: new Date(Date.now() - 2400000).toISOString()
      },
      {
        id: 'BF-2K7P4N',
        code: 'BF-2K7P4N',
        name: 'Sanjana Reddy',
        email: 'sanjana@example.com',
        phone: '+91 65432 45678',
        locationId: 'delhi',
        locationName: 'New Delhi, NCR',
        date: tomorrowStr,
        time: '20:00',
        guests: 4,
        seating: 'outdoor',
        occasion: '',
        notes: 'Rooftop seating',
        tableId: 'DEL-R3',
        tableLabel: 'DEL-R3',
        tableType: '4-seater',
        tableZone: 'outdoor',
        status: 'confirmed',
        createdAt: new Date(Date.now() - 36000000).toISOString()
      }
    ];
    fs.writeFileSync(DB_FILE, JSON.stringify(initialSeed, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDbFile();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeDb(records) {
  ensureDbFile();
  const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  const data = JSON.stringify(records, null, 2);
  fs.writeFileSync(tmpFile, data, 'utf8');
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmpFile, DB_FILE);
      return;
    } catch (err) {
      if (attempt === 7) {
        try {
          fs.copyFileSync(tmpFile, DB_FILE);
          try { fs.unlinkSync(tmpFile); } catch {}
          return;
        } catch {
          fs.writeFileSync(DB_FILE, data, 'utf8');
          try { fs.unlinkSync(tmpFile); } catch {}
          return;
        }
      }
      const waitTill = Date.now() + 15;
      while (Date.now() < waitTill) {}
    }
  }
}

// ---------------------------------------------------------------------------
// Security helpers: staff sessions, brute-force limiter, public (PII-free) view
// ---------------------------------------------------------------------------
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const staffTokens = new Map(); // token -> expiry (memory only; restart = everyone logs in again)
const failures = new Map();    // limiter key -> { n, resetAt }

function issueToken() {
  const t = crypto.randomBytes(24).toString('hex');
  staffTokens.set(t, Date.now() + TOKEN_TTL_MS);
  return t;
}
/** 'none' = no credentials sent, 'invalid' = bad/expired token, 'staff' = ok */
function authState(req) {
  const h = String(req.headers.authorization || '');
  if (!h) return 'none';
  const m = /^Bearer ([a-f0-9]{48})$/.exec(h);
  if (!m) return 'invalid';
  const exp = staffTokens.get(m[1]);
  if (!exp || exp < Date.now()) { staffTokens.delete(m[1]); return 'invalid'; }
  return 'staff';
}
function limited(key, max) {
  const f = failures.get(key);
  if (!f) return false;
  if (f.resetAt < Date.now()) { failures.delete(key); return false; }
  return f.n >= max;
}
function noteFailure(key, windowMs) {
  const now = Date.now();
  const f = failures.get(key);
  if (!f || f.resetAt < now) failures.set(key, { n: 1, resetAt: now + windowMs });
  else f.n++;
}
// Behind a reverse proxy (Caddy) every request looks like it comes from the proxy. Set TRUST_PROXY=1 ONLY when the proxy
// overwrites X-Forwarded-For, otherwise the rate limiter would treat all visitors as one person.
const clientIp = req => {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
};
const last4 = p => String(p || '').replace(/\D/g, '').slice(-4);

/** Anonymous callers only learn which table is busy when - never who is sitting there. */
function publicView(records) {
  return records
    .filter(r => r.status === 'confirmed' || r.status === 'seated')
    .map(r => ({ locationId: r.locationId, date: r.date, time: r.time, tableId: r.tableId, status: r.status }));
}

function burgerFactoryApiPlugin() {
  const sseClients = new Set();
  let writeLock = Promise.resolve();

  function withMutex(fn) {
    const next = writeLock.then(fn, fn);
    writeLock = next.catch(() => {});
    return next;
  }

  // SSE carries NO personal data and no table dump: clients re-fetch what they are allowed to see.
  function broadcastSse(action) {
    const msg = `event: reservations:changed\ndata: ${JSON.stringify({ action, at: Date.now() })}\n\n`;
    for (const res of sseClients) {
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  return {
    name: 'burger-factory-lan-api',
    configureServer(server) {
      ensureDbFile();
      if (!process.env.STAFF_PASSCODE) {
        console.warn('[burger-factory] STAFF_PASSCODE is not set: using the default dev passcode. Set STAFF_PASSCODE before going online.');
      }
      // keep the sessions table from growing forever
      setInterval(() => { const n = Date.now(); for (const [t, e] of staffTokens) if (e < n) staffTokens.delete(t); }, 600000).unref();

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/v1')) return next();
        const urlObj = new URL(req.url, 'http://localhost:3000');
        const pathname = urlObj.pathname;

        // ---- SSE (no PII) ----
        if (req.method === 'GET' && pathname === '/api/v1/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive'
          });
          res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
          sseClients.add(res);
          const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
          req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
          return;
        }

        // ---- GET list: staff token => full records, no token => anonymous availability view ----
        if (req.method === 'GET' && pathname === '/api/v1/reservations') {
          const auth = authState(req);
          if (auth === 'invalid') return json(res, 401, { success: false, message: 'Session expired. Please log in again.' });
          const records = readDb();
          return json(res, 200, auth === 'staff'
            ? { reservations: records, scope: 'staff' }
            : { reservations: publicView(records), scope: 'public' });
        }

        if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
          return json(res, req.method === 'GET' ? 404 : 405, { success: false, message: 'Endpoint not found' });
        }

        let body = '';
        let bodyTooLarge = false;
        req.on('data', chunk => {
          if (bodyTooLarge) return;
          body += chunk;
          if (body.length > 20000) bodyTooLarge = true; // legitimate payloads are < 2 KB
        });
        req.on('end', () => {
          if (bodyTooLarge) return json(res, 413, { success: false, message: 'Payload size exceeds limit' });

          withMutex(async () => {
            try {
              let payload;
              try { payload = body ? JSON.parse(body) : {}; } catch { return json(res, 400, { success: false, message: 'Malformed JSON payload' }); }
              if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(res, 400, { success: false, message: 'Invalid payload' });
              const ip = clientIp(req);
              const auth = authState(req);

              // ---------------- staff login / logout ----------------
              if (req.method === 'POST' && pathname === '/api/v1/staff/login') {
                const key = `login:${ip}`;
                if (limited(key, 5)) return json(res, 429, { success: false, message: 'Too many attempts. Try again in a few minutes.' });
                const given = sha(payload.passcode || '');
                if (!crypto.timingSafeEqual(given, sha(STAFF_PASSCODE))) {
                  noteFailure(key, 5 * 60 * 1000);
                  return json(res, 401, { success: false, message: 'Incorrect passcode.' });
                }
                failures.delete(key);
                return json(res, 200, { success: true, token: issueToken(), expiresInMs: TOKEN_TTL_MS });
              }
              if (req.method === 'POST' && pathname === '/api/v1/staff/logout') {
                const m = /^Bearer ([a-f0-9]{48})$/.exec(String(req.headers.authorization || ''));
                if (m) staffTokens.delete(m[1]);
                return json(res, 200, { success: true });
              }

              const records = readDb();

              // ---------------- guest lookup (server-side phone verification) ----------------
              if (req.method === 'POST' && pathname === '/api/v1/reservations/lookup') {
                const code = String(payload.code || '').toUpperCase().trim();
                const digits = String(payload.phoneLast4 || '').trim();
                const codeKey = `code:${ip}:${code}`, ipKey = `ipfail:${ip}`;
                if (limited(codeKey, 5) || limited(ipKey, 60)) return json(res, 429, { success: false, message: 'Too many attempts. Please try again later.' });
                const found = records.find(r => (r.code || '').toUpperCase() === code);
                if (!found || !/^\d{4}$/.test(digits) || last4(found.phone) !== digits) {
                  noteFailure(codeKey, 10 * 60 * 1000); noteFailure(ipKey, 10 * 60 * 1000);
                  return json(res, 404, { success: false, message: 'No reservation found for that reference and phone digits.' });
                }
                failures.delete(codeKey);
                return json(res, 200, { success: true, reservation: found });
              }

              // ---------------- create booking / walk-in ----------------
              if (req.method === 'POST' && pathname === '/api/v1/reservations') {
                const raw = payload.reservation;
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json(res, 400, { success: false, message: 'Missing reservation object' });

                const isWalkIn = raw.status === 'seated';
                if (raw.status !== undefined && raw.status !== 'confirmed' && raw.status !== 'seated') {
                  return json(res, 400, { success: false, message: 'Invalid initial status' });
                }
                // Walk-ins are a staff action
                if (isWalkIn && auth !== 'staff') return json(res, 401, { success: false, message: 'Staff login required for walk-ins' });

                const guests = Number(raw.guests);
                if (!Number.isInteger(guests) || guests < 1 || guests > 12) return json(res, 400, { success: false, message: 'Guests must be an integer between 1 and 12' });

                const dateStr = String(raw.date || '');
                const todayStr = getISTDateString(0);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr < todayStr) return json(res, 400, { success: false, message: 'Invalid or past reservation date' });
                if (dateStr > getISTDateString(MAX_ADVANCE_DAYS)) return json(res, 400, { success: false, message: `Bookings open ${MAX_ADVANCE_DAYS} days ahead` });

                if (!raw.locationId || !locationTables[raw.locationId]) return json(res, 400, { success: false, message: 'Invalid or unknown outlet location' });

                const timeStr = String(raw.time || '');
                if (!isWalkIn) {
                  if (!slotsForLocation(raw.locationId).includes(timeStr)) return json(res, 400, { success: false, message: 'That time slot is not offered at this outlet' });
                  // the slot must not already be in the past (IST)
                  if (dateStr === todayStr) {
                    const nowIst = new Date(Date.now() + 5.5 * 3600e3);
                    const nowMin = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
                    if (!process.env.SIM_MODE && timeToMinutes(timeStr) < nowMin - 15) return json(res, 400, { success: false, message: 'That time has already passed today' });
                  }
                } else {
                  if (!/^\d{2}:\d{2}$/.test(timeStr)) return json(res, 400, { success: false, message: 'Invalid walk-in time format (expected HH:MM)' });
                  const [h, m] = timeStr.split(':').map(Number);
                  if (h > 23 || m > 59) return json(res, 400, { success: false, message: 'Impossible walk-in clock time' });
                }

                const cleanName = sanitizeText(raw.name, 80);
                if (!raw.name || cleanName.length < 2) return json(res, 400, { success: false, message: 'Valid guest name required (minimum 2 characters)' });
                if (/[<>]/.test(String(raw.name || '')) || /[<>]/.test(String(raw.notes || '')) || /[<>]/.test(String(raw.email || '')) || /[<>]/.test(String(raw.occasion || ''))) {
                  return json(res, 400, { success: false, message: 'HTML tags and angle brackets are not allowed in booking fields' });
                }
                if (raw.notes && String(raw.notes).length > 500) return json(res, 400, { success: false, message: 'Notes field cannot exceed 500 characters' });
                const phoneDigits = String(raw.phone || '').replace(/\D/g, '');
                if (!isWalkIn && (phoneDigits.length < 10 || phoneDigits.length > 15)) return json(res, 400, { success: false, message: 'Valid phone number required' });

                // Idempotency: an identical active booking by the same guest is returned instead of duplicated (double-tap protection)
                if (!isWalkIn) {
                  const dup = records.find(r => r.status === 'confirmed' && r.locationId === raw.locationId && r.date === dateStr && r.time === timeStr
                    && last4(r.phone) === phoneDigits.slice(-4) && String(r.name).toLowerCase() === cleanName.toLowerCase());
                  if (dup) return json(res, 200, { success: true, duplicate: true, reservation: dup });
                }

                // Server ALWAYS decides the table for online bookings (best-fit); only staff may pick a table for a walk-in
                const alloc = allocateTableAtomic(records, raw.locationId, dateStr, timeStr, guests, raw.seating || 'any', isWalkIn ? raw.tableId : null, isWalkIn);
                if (!alloc.available) return json(res, 409, { success: false, message: alloc.error });

                const locObj = locations.find(l => l.id === raw.locationId);
                const code = generateServerCode(records); // codes are always server-made, unique
                const verifiedReservation = {
                  id: code, code,
                  name: cleanName,
                  email: sanitizeText(raw.email || '', 120),
                  phone: sanitizeText(raw.phone || '', 30),
                  locationId: raw.locationId,
                  locationName: locObj ? `${locObj.name}, ${locObj.area}` : raw.locationId,
                  date: dateStr, time: timeStr, guests,
                  seating: sanitizeText(raw.seating || 'any', 20),
                  occasion: sanitizeText(raw.occasion || '', 40),
                  notes: sanitizeText(raw.notes || '', 300),
                  tableId: alloc.table.id, tableLabel: alloc.table.id, tableType: alloc.table.type, tableZone: alloc.table.zone,
                  status: isWalkIn ? 'seated' : 'confirmed',
                  createdAt: new Date().toISOString(),
                  ...(isWalkIn ? { seatedAt: new Date().toISOString() } : {})
                };
                records.push(verifiedReservation);
                writeDb(records);
                broadcastSse('created');
                return json(res, 201, { success: true, reservation: verifiedReservation });
              }

              // ---------------- status change ----------------
              if (req.method === 'PATCH' && pathname === '/api/v1/reservations/status') {
                if (auth === 'invalid') return json(res, 401, { success: false, message: 'Session expired. Please log in again.' });
                const targetCode = String(payload.code || '').toUpperCase().trim();
                const newStatus = String(payload.status || '').toLowerCase().trim();
                if (!VALID_STATUSES.has(newStatus)) return json(res, 400, { success: false, message: `Invalid status: ${newStatus}` });

                const idx = records.findIndex(r => (r.code || '').toUpperCase() === targetCode || (r.id || '').toUpperCase() === targetCode);

                if (auth !== 'staff') {
                  // guests may ONLY cancel their own confirmed booking, proven by the phone's last 4 digits (checked here, not in the browser)
                  if (newStatus !== 'cancelled') return json(res, 401, { success: false, message: 'Staff login required' });
                  const codeKey = `code:${ip}:${targetCode}`, ipKey = `ipfail:${ip}`;
                  if (limited(codeKey, 5) || limited(ipKey, 60)) return json(res, 429, { success: false, message: 'Too many attempts. Please try again later.' });
                  const digits = String(payload.phoneLast4 || '').trim();
                  if (idx === -1 || !/^\d{4}$/.test(digits) || last4(records[idx].phone) !== digits) {
                    noteFailure(codeKey, 10 * 60 * 1000); noteFailure(ipKey, 10 * 60 * 1000);
                    return json(res, 403, { success: false, message: 'Phone verification failed or reservation not found.' });
                  }
                  failures.delete(codeKey);
                  if (records[idx].status !== 'confirmed') return json(res, 409, { success: false, message: `Only confirmed bookings can be cancelled (this one is ${records[idx].status}).` });
                } else if (idx === -1) {
                  return json(res, 404, { success: false, message: 'Reservation not found' });
                }

                const currentStatus = records[idx].status;
                if (currentStatus === 'completed' && newStatus === 'seated') return json(res, 400, { success: false, message: 'Cannot transition completed reservation back to seated' });
                if (currentStatus === 'cancelled' && newStatus === 'seated') return json(res, 400, { success: false, message: 'Cannot transition cancelled reservation directly to seated' });

                const nowIso = new Date().toISOString();
                records[idx].status = newStatus;
                if (newStatus === 'seated' && !records[idx].seatedAt) records[idx].seatedAt = nowIso;
                if (newStatus === 'completed') records[idx].completedAt = nowIso;
                if (newStatus === 'no-show') records[idx].noShowAt = nowIso;
                if (newStatus === 'cancelled') {
                  records[idx].cancelledAt = nowIso;
                  if (payload.reason) records[idx].cancelReason = sanitizeText(payload.reason, 200);
                }
                writeDb(records);
                broadcastSse('status_updated');
                return json(res, 200, { success: true, reservation: auth === 'staff' ? records[idx] : { code: records[idx].code, status: records[idx].status } });
              }

              return json(res, 404, { success: false, message: 'Endpoint not found' });
            } catch (err) {
              console.error('[burger-factory-api ERROR]', err);
              return json(res, 500, { success: false, message: 'Internal server error' });
            }
          });
        });
      });
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [burgerFactoryApiPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: './index.html',
        manager: './manager.html'
      }
    }
  },
  server: {
  host: '0.0.0.0',
  port: Number(process.env.PORT) || 3000,
  open: false,
  watch: {
    ignored: ['**/data/**', '**/*.tmp', '**/sim_runtime*/**', '**/sim_logs/**']
  },
  allowedHosts: ['the-burger-factory.onrender.com'],
}
});
