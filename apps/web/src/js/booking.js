// ============================================
// THE BURGER FACTORY — SHARED LAN + SSE BOOKING ENGINE
// Synchronizes Customer Portal & Staff Portal across Phone + PC
// ============================================

import { locationTables, locations, timeSlots, slotsForLocation } from './data.js';

const STORAGE_KEY = 'bf_reservations';
const BOOKING_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TURN_MINUTES = 90;

const syncChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('bf_reservations_sync')
  : null;

export const TIME_SLOTS = timeSlots; // master list; each outlet offers slotsForLocation(id) (derived from its opening hours)

// ---- staff session (token comes from POST /api/v1/staff/login; never a passcode in the browser) ----
const TOKEN_KEY = 'bf_staff_token';
export function getStaffToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setStaffToken(token) {
  try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch {}
}
function authHeaders(extra = {}) {
  const t = getStaffToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}
function handleUnauthorized() {
  setStaffToken('');
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bf-auth-required'));
}
export async function staffLogin(passcode) {
  try {
    const res = await fetch('/api/v1/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) { setStaffToken(data.token); return { success: true }; }
    return { success: false, message: data.message || 'Login failed' };
  } catch { return { success: false, message: 'Cannot reach the server' }; }
}
export async function staffLogout() {
  try { await fetch('/api/v1/staff/logout', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{}' }); } catch {}
  setStaffToken('');
  try { localStorage.removeItem(STORAGE_KEY); } catch {} // do not leave guest data on a shared tablet
}

export function generateBookingCode() {
  let id = 'BF-';
  for (let i = 0; i < 6; i++) {
    id += BOOKING_CHARS.charAt(Math.floor(Math.random() * BOOKING_CHARS.length));
  }
  return id;
}

export function getReservations() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveReservationsLocal(reservations) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reservations));
}

export async function syncReservationsFromServer() {
  try {
    const res = await fetch('/api/v1/reservations', { cache: 'no-store', headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); return getReservations(); }
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.reservations)) {
        saveReservationsLocal(data.reservations);
        return data.reservations;
      }
    }
  } catch {}
  return getReservations();
}

export function subscribeToLiveUpdates(onUpdate, onConnectionChange = null) {
  try {
    const es = new EventSource('/api/v1/events');
    es.addEventListener('connected', () => {
      if (onConnectionChange) onConnectionChange(true);
    });
    es.addEventListener('reservations:changed', () => {
      // the event is only a "something changed" ping; fetch the data this device is allowed to see
      syncReservationsFromServer().then(() => onUpdate());
    });
    es.onerror = () => {
      if (onConnectionChange) onConnectionChange(false);
    };
  } catch {}

  if (syncChannel) {
    syncChannel.onmessage = () => {
      syncReservationsFromServer().then(() => onUpdate());
    };
  }

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      onUpdate();
    }
  });
}

function notifyPeers() {
  if (syncChannel) {
    try {
      syncChannel.postMessage({ updatedAt: Date.now() });
    } catch {}
  }
}

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function formatTime(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function getLocationName(locationId) {
  const loc = locations.find(l => l.id === locationId);
  return loc ? `${loc.name}, ${loc.area}` : locationId;
}

const SEATING_PREF_MAP = {
  indoor: ['indoor'],
  outdoor: ['outdoor', 'beachside', 'rooftop'],
  beachside: ['beachside', 'outdoor'],
  rooftop: ['rooftop', 'outdoor']
};

function candidateTables(locationId, guestCount, seatingPref) {
  const tables = locationTables[locationId];
  if (!tables) return null;
  let all = [];
  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const table of zoneTables) all.push({ ...table, zone });
  }
  if (seatingPref && seatingPref !== 'any') {
    const allowedZones = SEATING_PREF_MAP[seatingPref] || [seatingPref];
    const filtered = all.filter(t => allowedZones.includes(t.zone));
    if (filtered.length > 0) all = filtered;
  }
  return all.filter(t => t.capacity >= guestCount).sort((a, b) => a.capacity - b.capacity);
}

function tableIsBusy(reservations, locationId, date, tableId, slotMinutes) {
  return reservations.some(r => {
    if (r.status === 'cancelled' || r.status === 'no-show' || r.status === 'completed') return false;
    if (r.locationId !== locationId || r.date !== date || r.tableId !== tableId) return false;
    return Math.abs(slotMinutes - timeToMinutes(r.time)) < TURN_MINUTES;
  });
}

// NOTE: this is a convenience preview only. The SERVER makes the final table decision.
export function checkAvailability(locationId, date, time, guests, seatingPref = 'any') {
  if (!locationTables[locationId]) return { available: false, table: null, message: 'Location not found' };
  if (!slotsForLocation(locationId).includes(time)) {
    return { available: false, table: null, message: 'That time slot is not offered at this outlet. Please choose another time.' };
  }
  const guestCount = parseInt(guests, 10);
  const candidates = candidateTables(locationId, guestCount, seatingPref);
  if (candidates.length === 0) {
    return { available: false, table: null, message: `No single table accommodates ${guestCount} guests at this outlet. Please call the outlet directly.` };
  }
  const reservations = getReservations();
  const slotMinutes = timeToMinutes(time);
  for (const table of candidates) {
    if (!tableIsBusy(reservations, locationId, date, table.id, slotMinutes)) {
      return { available: true, table, message: `Table ${table.id} (${table.type}, ${table.zone}) is available.` };
    }
  }
  return { available: false, table: null, message: 'All suitable tables are booked for this time slot. Please choose another time.' };
}

export function getSlotAvailabilityGrid(locationId, date, guests, seatingPref = 'any') {
  const slots = slotsForLocation(locationId);
  if (!locationTables[locationId]) return [];
  const guestCount = parseInt(guests, 10) || 2;
  const candidates = candidateTables(locationId, guestCount, seatingPref);
  if (candidates.length === 0) return slots.map(time => ({ time, status: 'full', availableCount: 0 }));
  const reservations = getReservations();
  return slots.map(time => {
    const slotMinutes = timeToMinutes(time);
    const freeCount = candidates.filter(t => !tableIsBusy(reservations, locationId, date, t.id, slotMinutes)).length;
    let status = 'available';
    if (freeCount === 0) status = 'full';
    else if (freeCount <= 2) status = 'last_tables';
    return { time, status, availableCount: freeCount };
  });
}

export function getTodayIST() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function createReservation(bookingData) {
  await syncReservationsFromServer();

  const { locationId, date, time, guests, seating, name, email, phone, occasion, notes } = bookingData;
  const availability = checkAvailability(locationId, date, time, guests, seating);
  if (!availability.available) {
    return { success: false, message: availability.message };
  }

  const unifiedCode = generateBookingCode(); // only a hint: the server issues the real code and table

  const candidateReservation = {
    id: unifiedCode,
    code: unifiedCode,
    name: name.trim(),
    email: email ? email.trim() : '',
    phone: phone.trim(),
    locationId,
    locationName: getLocationName(locationId),
    date,
    time,
    guests: parseInt(guests, 10),
    seating: seating || 'any',
    occasion: occasion || '',
    notes: notes || '',
    tableId: availability.table.id,
    tableLabel: availability.table.id,
    tableType: availability.table.type,
    tableZone: availability.table.zone,
    status: 'confirmed',
    createdAt: new Date().toISOString()
  };

  try {
    const res = await fetch('/api/v1/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation: candidateReservation })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, message: errData.message || errData.error || 'All suitable tables are booked for this time slot.' };
    }

    const data = await res.json();
    const finalReservation = data.reservation;
    if (!finalReservation) return { success: false, message: 'Unexpected server reply. Please try again.' };

    // the guest's own record is not kept in the shared availability cache; refresh it from the server
    await syncReservationsFromServer();
    notifyPeers();

    return { success: true, reservation: finalReservation };
  } catch (err) {
    return { success: false, message: 'Network connection failed. Please try again.' };
  }
}

export async function createWalkInReservation(walkInData) {
  await syncReservationsFromServer();

  const { locationId, tableId, tableType, tableZone, guests, name, phone, notes } = walkInData;
  const now = new Date();
  const dateStr = getTodayIST();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${min}`;

  const unifiedCode = generateBookingCode();

  const candidateReservation = {
    id: unifiedCode,
    code: unifiedCode,
    name: name || 'Walk-in Guest',
    email: '',
    phone: phone || '',
    locationId,
    locationName: getLocationName(locationId),
    date: dateStr,
    time: timeStr,
    guests: parseInt(guests, 10) || 2,
    seating: (tableZone || 'indoor').toLowerCase(),
    occasion: '',
    notes: notes || 'Walk-in seated from floor plan',
    tableId,
    tableLabel: tableId,
    tableType: tableType || 'Table',
    tableZone: tableZone || 'indoor',
    status: 'seated',
    createdAt: now.toISOString(),
    seatedAt: now.toISOString()
  };

  try {
    const res = await fetch('/api/v1/reservations', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reservation: candidateReservation })
    });

    if (res.status === 401) { handleUnauthorized(); return { success: false, message: 'Staff session expired. Please log in again.' }; }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, message: errData.message || errData.error || 'Walk-in could not be seated on this table' };
    }

    const data = await res.json();
    const finalReservation = data.reservation;
    if (!finalReservation) return { success: false, message: 'Unexpected server reply. Please try again.' };

    await syncReservationsFromServer();
    notifyPeers();

    return { success: true, reservation: finalReservation };
  } catch (err) {
    return { success: false, message: 'Network connection failed. Please try again.' };
  }
}

export async function lookupReservation(bookingCode, phoneLast4) {
  const cleanCode = String(bookingCode || '').toUpperCase().trim();
  try {
    const res = await fetch('/api/v1/reservations/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, phoneLast4: String(phoneLast4 || '').trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) return { success: false, message: data.message || 'Too many attempts. Please try again later.' };
    if (!res.ok || !data.reservation) {
      return { success: false, message: data.message || 'No reservation found for that reference and phone digits.' };
    }
    return { success: true, reservation: data.reservation };
  } catch {
    return { success: false, message: 'Network connection failed. Please try again.' };
  }
}

export async function cancelReservation(bookingCode, phoneLast4, reason = 'Cancelled by guest') {
  const cleanCode = String(bookingCode || '').toUpperCase().trim();
  try {
    const res = await fetch('/api/v1/reservations/status', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: cleanCode, status: 'cancelled', reason, phoneLast4: String(phoneLast4 || '').trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data.message || 'Cancellation failed on server' };

    await syncReservationsFromServer();
    notifyPeers();
    return { success: true, reservation: data.reservation };
  } catch (err) {
    return { success: false, message: 'Network connection failed during cancellation' };
  }
}

export async function updateReservationStatus(bookingId, status) {
  const cleanCode = bookingId.toUpperCase().trim();
  const reservations = getReservations();
  const idx = reservations.findIndex(
    r => (r.id || '').toUpperCase() === cleanCode || (r.code || '').toUpperCase() === cleanCode
  );
  if (idx === -1) return false;

  try {
    const res = await fetch('/api/v1/reservations/status', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: cleanCode, status })
    });

    if (res.status === 401) { handleUnauthorized(); return false; }
    if (!res.ok) return false;

    reservations[idx].status = status;
    const now = new Date().toISOString();

    if (status === 'seated') reservations[idx].seatedAt = now;
    else if (status === 'completed') reservations[idx].completedAt = now;
    else if (status === 'no-show') reservations[idx].noShowAt = now;
    else if (status === 'cancelled') reservations[idx].cancelledAt = now;

    saveReservationsLocal(reservations);
    notifyPeers();
    return true;
  } catch {
    return false;
  }
}

export function getAllReservations() {
  return getReservations();
}

export async function seedDemoReservations() {
  await syncReservationsFromServer();
}
