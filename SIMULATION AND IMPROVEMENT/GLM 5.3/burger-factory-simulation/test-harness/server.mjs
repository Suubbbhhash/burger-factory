// ============================================
// TEST HARNESS — STANDALONE REPLICA OF THE
// VITE EMBEDDED REST ENGINE (vite.config.js)
//
// This is the EXACT middleware logic from
// D:\Burger_factory\vite.config.js (burger-factory-lan-api
// plugin): same routes, same readDb/writeDb, same
// seed, same SSE broadcast — validation-free, the
// way the real engine is. It exists so the simulator
// can be validated WITHOUT the full app, and so you
// can later A/B the simulator against a FIXED engine.
//
// It is NOT a fix and adds no validation on purpose.
// Start: node test-harness/server.mjs [port]   (default 3100)
// ============================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 3100);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, 'data');
const DB_FILE = path.join(DATA_DIR, 'reservations.json');

// ---------- verbatim engine (from vite.config.js) ----------
function ensureDbFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const initialSeed = [
      {
        id: 'BF-7K9M2W', code: 'BF-7K9M2W', name: 'Arjun Kapoor', email: 'arjun@example.com',
        phone: '+91 98765 12345', locationId: 'anjuna', locationName: 'Anjuna, North Goa',
        date: todayStr, time: '13:00', guests: 4, seating: 'outdoor', occasion: 'birthday',
        notes: 'Garden table preferred, birthday dessert', tableId: 'ANJ-O3', tableLabel: 'ANJ-O3',
        tableType: '4-seater', tableZone: 'outdoor', status: 'confirmed',
        createdAt: new Date(today.getTime() - 7200000).toISOString()
      },
      {
        id: 'BF-4X8R5Q', code: 'BF-4X8R5Q', name: 'Meera Nair', email: 'meera@example.com',
        phone: '+91 87654 23456', locationId: 'morjim', locationName: 'Morjim, North Goa',
        date: todayStr, time: '18:30', guests: 2, seating: 'beachside', occasion: 'anniversary',
        notes: 'Sunset deck table', tableId: 'MOR-B1', tableLabel: 'MOR-B1', tableType: '2-seater',
        tableZone: 'beachside', status: 'confirmed',
        createdAt: new Date(today.getTime() - 14400000).toISOString()
      },
      {
        id: 'BF-9T2V6H', code: 'BF-9T2V6H', name: 'Ravi Desai', email: 'ravi@example.com',
        phone: '+91 76543 34567', locationId: 'anjuna', locationName: 'Anjuna, North Goa',
        date: todayStr, time: '12:30', guests: 6, seating: 'indoor', occasion: 'business',
        notes: 'Quiet indoor table for 6', tableId: 'ANJ-I8', tableLabel: 'ANJ-I8', tableType: '6-seater',
        tableZone: 'indoor', status: 'seated',
        createdAt: new Date(today.getTime() - 18000000).toISOString(),
        seatedAt: new Date(today.getTime() - 2400000).toISOString()
      },
      {
        id: 'BF-2K7P4N', code: 'BF-2K7P4N', name: 'Sanjana Reddy', email: 'sanjana@example.com',
        phone: '+91 65432 45678', locationId: 'delhi', locationName: 'New Delhi, NCR',
        date: tomorrowStr, time: '20:00', guests: 4, seating: 'outdoor', occasion: '',
        notes: 'Rooftop seating', tableId: 'DEL-R3', tableLabel: 'DEL-R3', tableType: '4-seater',
        tableZone: 'outdoor', status: 'confirmed',
        createdAt: new Date(today.getTime() - 36000000).toISOString()
      }
    ];
    fs.writeFileSync(DB_FILE, JSON.stringify(initialSeed, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDbFile();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}

function writeDb(records) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8');
}

const sseClients = new Set();
function broadcastSse(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (!url.pathname.startsWith('/api/v1')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body style="font-family:monospace;background:#1c1713;color:#f5efe6;padding:2rem">
      <h1 style="color:#d63b27">Burger Factory — Test Harness</h1>
      <p>Verbatim replica of the vite.config.js embedded REST engine.</p>
      <p>Endpoints: GET /api/v1/reservations · POST /api/v1/reservations · PATCH /api/v1/reservations/status · GET /api/v1/events (SSE)</p>
      <p>DB file: ${DB_FILE}</p>
    </body></html>`);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/events') {
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

  if (req.method === 'GET' && url.pathname === '/api/v1/reservations') {
    const records = readDb();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reservations: records }));
    return;
  }

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const records = readDb();

        if (req.method === 'POST' && url.pathname === '/api/v1/reservations') {
          const newRes = payload.reservation;
          if (newRes) {
            records.push(newRes);
            writeDb(records);
            broadcastSse('reservations:changed', { action: 'created', reservation: newRes, reservations: records });
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, reservations: records }));
          return;
        }

        if (req.method === 'PATCH' && url.pathname === '/api/v1/reservations/status') {
          const targetCode = (payload.code || '').toUpperCase().trim();
          const newStatus = payload.status;
          const idx = records.findIndex(r => (r.code || '').toUpperCase() === targetCode || (r.id || '').toUpperCase() === targetCode);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Reservation not found' }));
            return;
          }
          const nowIso = new Date().toISOString();
          records[idx].status = newStatus;
          if (newStatus === 'seated') records[idx].seatedAt = nowIso;
          if (newStatus === 'completed') records[idx].completedAt = nowIso;
          if (newStatus === 'no-show') records[idx].noShowAt = nowIso;
          if (newStatus === 'cancelled') {
            records[idx].cancelledAt = nowIso;
            if (payload.reason) records[idx].cancelReason = payload.reason;
          }
          writeDb(records);
          broadcastSse('reservations:changed', {
            action: 'status_updated', code: targetCode, status: newStatus,
            reservation: records[idx], reservations: records
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, reservation: records[idx], reservations: records }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  ensureDbFile();
  console.log(`[harness] Burger Factory engine replica on http://127.0.0.1:${PORT}`);
  console.log(`[harness] DB: ${DB_FILE}`);
  console.log(`[harness] Point the simulator at it: node run.mjs --target http://127.0.0.1:${PORT} --tag smoke`);
});
