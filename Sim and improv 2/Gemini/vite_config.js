import fs from 'node:fs';
import path from 'node:path';
import { locationTables, locations, timeSlots } from './src/js/data.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'reservations.json');
const TURN_MINUTES = 90;
const VALID_STATUSES = new Set(['confirmed', 'seated', 'completed', 'cancelled', 'no-show']);
const BOOKING_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Universal IST (UTC+05:30) YYYY-MM-DD formatter.
 * Works identically on Windows, macOS, and minimal Linux Docker containers without full ICU locale data.
 */
export function getISTDateString(offsetDays = 0) {
  const istMs = Date.now() + 19800000 + offsetDays * 86400000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function timeToMinutes(time) {
  if (!time || typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [h, m] = time.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return NaN;
  return h * 60 + m;
}

export function containsHtmlInjection(str) {
  if (typeof str !== 'string') return false;
  return /[<>]/.test(str) || /javascript\s*:/i.test(str) || /on\w+\s*=/i.test(str);
}

export function sanitizeText(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

export function generateServerCode(existingRecords, preferredCode = '') {
  const existingCodes = new Set(existingRecords.map(r => (r.code || r.id || '').toUpperCase()));
  const cleanPref = String(preferredCode || '').toUpperCase().trim();
  if (/^(T?BF)-[A-Z0-9]{4,8}$/.test(cleanPref) && !existingCodes.has(cleanPref)) {
    return cleanPref;
  }
  for (let attempt = 0; attempt < 40; attempt++) {
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
 * Prevents race-condition double-bookings when multiple customers book simultaneously.
 */
export function allocateTableAtomic(records, locationId, date, time, guests, seatingPref = 'any', requestedTableId = null, isWalkIn = false) {
  const tables = locationTables[locationId];
  if (!tables) {
    return { available: false, status: 400, error: 'Invalid outlet location' };
  }

  const reqMinutes = timeToMinutes(time);
  if (Number.isNaN(reqMinutes)) {
    return { available: false, status: 400, error: 'Invalid time slot format' };
  }

  let allTables = [];
  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const t of zoneTables) {
      allTables.push({ ...t, zone });
    }
  }

  // If walk-in requested a specific physical table, validate capacity and collision on that exact table
  if (requestedTableId && isWalkIn) {
    const exactTable = allTables.find(t => t.id === requestedTableId);
    if (!exactTable) {
      return { available: false, status: 400, error: `Table ${requestedTableId} does not exist at ${locationId}` };
    }
    if (exactTable.capacity < guests) {
      return { available: false, status: 400, error: `Table ${requestedTableId} capacity (${exactTable.capacity}) cannot fit ${guests} guests` };
    }
    const hasCollision = records.some(r => {
      if (['cancelled', 'no-show', 'completed'].includes(r.status)) return false;
      if (r.locationId !== locationId || r.date !== date || r.tableId !== exactTable.id) return false;
      const bMin = timeToMinutes(r.time);
      return Math.abs(reqMinutes - bMin) < TURN_MINUTES;
    });
    if (!hasCollision) {
      return { available: true, table: exactTable };
    }
    return { available: false, status: 409, error: `Table ${requestedTableId} is already occupied for this window.` };
  }

  if (seatingPref && seatingPref !== 'any') {
    const prefMap = {
      indoor: ['indoor'],
      outdoor: ['outdoor', 'beachside', 'rooftop'],
      beachside: ['beachside', 'outdoor'],
      rooftop: ['rooftop', 'outdoor']
    };
    const allowedZones = prefMap[seatingPref] || [seatingPref];
    const filtered = allTables.filter(t => allowedZones.includes(t.zone));
    if (filtered.length > 0) {
      allTables = filtered;
    }
  }

  allTables = allTables
    .filter(t => t.capacity >= guests)
    .sort((a, b) => a.capacity - b.capacity);

  if (allTables.length === 0) {
    return {
      available: false,
      status: 400,
      error: `No single table accommodates ${guests} guests at this outlet.`
    };
  }

  for (const table of allTables) {
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
    status: 409,
    error: 'All suitable tables are booked for this 90-minute window.'
  };
}

export function getInitialSeed() {
  const todayStr = getISTDateString(0);
  const tomorrowStr = getISTDateString(1);

  return [
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
      locationName: 'New Delhi, Greater Kailash',
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
}

function ensureDbFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(getInitialSeed(), null, 2), 'utf8');
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
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

export function burgerFactoryApiPlugin() {
  const sseClients = new Set();
  // Serialized mutex queue to guarantee zero race conditions on concurrent requests
  let writeLock = Promise.resolve();

  function withMutex(fn) {
    const next = writeLock.then(fn, fn);
    writeLock = next.catch(() => {});
    return next;
  }

  function broadcastSse(event, payload) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  return {
    name: 'burger-factory-lan-api',
    configureServer(server) {
      ensureDbFile();

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/v1')) {
          return next();
        }

        const urlObj = new URL(req.url, 'http://localhost:3000');

        // Health Endpoint for readiness & monitoring
        if (req.method === 'GET' && urlObj.pathname === '/api/v1/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            status: 'healthy',
            outlets: locations.length,
            timestamp: new Date().toISOString()
          }));
          return;
        }

        // Real-Time Server-Sent Events Stream (supports both /api/v1/events and /api/v1/stream)
        if (req.method === 'GET' && (urlObj.pathname === '/api/v1/events' || urlObj.pathname === '/api/v1/stream')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
          sseClients.add(res);
          req.on('close', () => sseClients.delete(res));
          return;
        }

        // Read Reservations Ledger
        if (req.method === 'GET' && urlObj.pathname === '/api/v1/reservations') {
          const records = readDb();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reservations: records }));
          return;
        }

        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          let body = '';
          let bodyTooLarge = false;
          req.on('data', chunk => {
            body += chunk;
            if (body.length > 65536) {
              bodyTooLarge = true;
            }
          });
          req.on('end', () => {
            if (bodyTooLarge) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Payload exceeds maximum allowed size' }));
              return;
            }

            withMutex(async () => {
              try {
                const payload = body ? JSON.parse(body) : {};
                const records = readDb();

                // TEST & SIMULATION RESET ENDPOINT
                if (req.method === 'POST' && urlObj.pathname === '/api/v1/reservations/reset') {
                  const nextRecords = Array.isArray(payload.reservations)
                    ? payload.reservations
                    : getInitialSeed();
                  writeDb(nextRecords);
                  broadcastSse('reservations:changed', {
                    action: 'reset',
                    reservations: nextRecords
                  });
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true, reservations: nextRecords }));
                  return;
                }

                // ATOMIC SERVER-SIDE BOOKING CREATION WITH VALIDATION & COLLISION LOCK
                if (req.method === 'POST' && urlObj.pathname === '/api/v1/reservations') {
                  const raw = payload.reservation || payload;
                  if (!raw || typeof raw !== 'object') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing reservation object' }));
                    return;
                  }

                  // 1. Strict XSS & Injection Perimeter Rejection (ERR-SEC-001)
                  const textFields = [raw.name, raw.email, raw.phone, raw.occasion, raw.notes];
                  if (textFields.some(f => containsHtmlInjection(f))) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Security violation: HTML or script tags are not permitted in reservation fields'
                    }));
                    return;
                  }

                  if (typeof raw.notes === 'string' && raw.notes.length > 500) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Notes field exceeds maximum length of 500 characters'
                    }));
                    return;
                  }

                  // 2. Guest Count Validation (ERR-VAL-001)
                  const guests = Number(raw.guests);
                  if (!Number.isInteger(guests) || guests < 1 || guests > 12) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Guests must be an integer between 1 and 12'
                    }));
                    return;
                  }

                  // 3. Outlet Validation
                  const locObj = locations.find(l => l.id === raw.locationId);
                  if (!locObj || !locationTables[raw.locationId]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Invalid outlet location'
                    }));
                    return;
                  }

                  // 4. Date Validation in IST (ERR-VAL-002 / ERR-TZ-001)
                  const dateStr = String(raw.date || '');
                  const todayStr = getISTDateString(0);
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr < todayStr) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Invalid or past reservation date (IST)'
                    }));
                    return;
                  }

                  // 5. Time Slot & Per-Outlet Operating Hours Validation (ERR-VAL-002 / HOURS_VIOLATION)
                  const isWalkIn = raw.status === 'seated';
                  const timeStr = String(raw.time || '');
                  const reqMin = timeToMinutes(timeStr);
                  if (Number.isNaN(reqMin)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Invalid reservation time format'
                    }));
                    return;
                  }

                  if (!isWalkIn) {
                    if (!timeSlots.includes(timeStr)) {
                      res.writeHead(400, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        success: false,
                        message: 'Invalid reservation time slot'
                      }));
                      return;
                    }
                    const minOpen = timeToMinutes(locObj.openTime || '12:30');
                    const maxSlot = timeToMinutes(locObj.lastSlot || '22:00');
                    if (reqMin < minOpen || reqMin > maxSlot) {
                      res.writeHead(400, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        success: false,
                        message: `Selected time ${timeStr} is outside operating hours for ${locObj.name} (${locObj.hours})`
                      }));
                      return;
                    }
                  }

                  // 6. Guest Name Validation
                  const cleanName = sanitizeText(raw.name, 80);
                  if (cleanName.length < 2) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Valid guest name (minimum 2 characters) is required'
                    }));
                    return;
                  }

                  // 7. Server-Side Atomic Table Allocation (Prevents Concurrent Double-Booking ERR-CONC-001)
                  const alloc = allocateTableAtomic(
                    records,
                    raw.locationId,
                    dateStr,
                    timeStr,
                    guests,
                    raw.seating || 'any',
                    raw.tableId,
                    isWalkIn
                  );

                  if (!alloc.available) {
                    res.writeHead(alloc.status || 409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: alloc.error
                    }));
                    return;
                  }

                  const code = generateServerCode(records, raw.code || raw.id);
                  const nowIso = new Date().toISOString();

                  const verifiedReservation = {
                    id: code,
                    code,
                    name: cleanName,
                    email: sanitizeText(raw.email || '', 120),
                    phone: sanitizeText(raw.phone || '', 30),
                    locationId: raw.locationId,
                    locationName: `${locObj.name}, ${locObj.area}`,
                    date: dateStr,
                    time: timeStr,
                    guests,
                    seating: sanitizeText(raw.seating || 'any', 20),
                    occasion: sanitizeText(raw.occasion || '', 40),
                    notes: sanitizeText(raw.notes || '', 500),
                    tableId: alloc.table.id,
                    tableLabel: alloc.table.id,
                    tableType: alloc.table.type,
                    tableZone: alloc.table.zone,
                    status: isWalkIn ? 'seated' : 'confirmed',
                    createdAt: nowIso,
                    ...(isWalkIn ? { seatedAt: nowIso } : {})
                  };

                  records.push(verifiedReservation);
                  writeDb(records);
                  broadcastSse('reservations:changed', {
                    action: 'created',
                    reservation: verifiedReservation,
                    reservations: records
                  });

                  res.writeHead(201, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    success: true,
                    reservation: verifiedReservation,
                    reservations: records
                  }));
                  return;
                }

                // STATUS TRANSITION & CANCELLATION ENDPOINT (ERR-FSM-001)
                if (req.method === 'PATCH' && urlObj.pathname === '/api/v1/reservations/status') {
                  const targetCode = String(payload.code || '').toUpperCase().trim();
                  const newStatus = String(payload.status || '').toLowerCase().trim();

                  if (!VALID_STATUSES.has(newStatus)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: `Invalid status transition target: ${newStatus}`
                    }));
                    return;
                  }

                  const idx = records.findIndex(
                    r => (r.code || '').toUpperCase() === targetCode || (r.id || '').toUpperCase() === targetCode
                  );

                  if (idx === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: 'Reservation not found'
                    }));
                    return;
                  }

                  const currentStatus = records[idx].status;

                  // Enforce State Machine Transition Rules:
                  // Terminal states ('completed', 'cancelled', 'no-show') cannot jump directly to 'seated' or 'completed'
                  if (['completed', 'cancelled', 'no-show'].includes(currentStatus) && ['seated', 'completed'].includes(newStatus)) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: false,
                      message: `Illegal state transition from ${currentStatus} directly to ${newStatus}`
                    }));
                    return;
                  }

                  // If restoring a cancelled/no-show/completed booking back to 'confirmed', ensure no collision on its table
                  if (currentStatus !== 'confirmed' && newStatus === 'confirmed') {
                    const target = records[idx];
                    const tMin = timeToMinutes(target.time);
                    const hasCollision = records.some((r, otherIdx) => {
                      if (otherIdx === idx) return false;
                      if (!['confirmed', 'seated'].includes(r.status)) return false;
                      if (r.locationId !== target.locationId || r.date !== target.date || r.tableId !== target.tableId) return false;
                      return Math.abs(tMin - timeToMinutes(r.time)) < TURN_MINUTES;
                    });
                    if (hasCollision) {
                      res.writeHead(409, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        success: false,
                        message: `Cannot restore ${targetCode}: Table ${target.tableId} has since been booked by another party.`
                      }));
                      return;
                    }
                  }

                  const nowIso = new Date().toISOString();
                  records[idx].status = newStatus;
                  if (newStatus === 'seated') records[idx].seatedAt = nowIso;
                  if (newStatus === 'completed') records[idx].completedAt = nowIso;
                  if (newStatus === 'no-show') records[idx].noShowAt = nowIso;
                  if (newStatus === 'cancelled') {
                    records[idx].cancelledAt = nowIso;
                    if (payload.reason) {
                      if (containsHtmlInjection(payload.reason)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Invalid characters in cancel reason' }));
                        return;
                      }
                      records[idx].cancelReason = sanitizeText(payload.reason, 200);
                    }
                  }

                  writeDb(records);
                  broadcastSse('reservations:changed', {
                    action: 'status_updated',
                    code: targetCode,
                    status: newStatus,
                    reservation: records[idx],
                    reservations: records
                  });

                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    success: true,
                    reservation: records[idx],
                    reservations: records
                  }));
                  return;
                }

                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Endpoint not found' }));
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request payload' }));
              }
            });
          });
          return;
        }

        next();
      });
    }
  };
}

export default {
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
    port: 3000,
    open: false
  }
};