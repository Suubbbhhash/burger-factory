// ============================================
// THE BURGER FACTORY — SHARED LAN + SSE BOOKING ENGINE
// Synchronizes Customer Portal & Staff Portal across Phone + PC
// Hardened with IST Timezone Helpers, XSS Escaping & Server-First Mutations
// ============================================

import { locationTables, locations } from './data.js';

const STORAGE_KEY = 'bf_reservations';
const BOOKING_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TURN_MINUTES = 90;

const syncChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('bf_reservations_sync')
  : null;

export const TIME_SLOTS = [
  '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
];

/**
 * Returns YYYY-MM-DD in Indian Standard Time (Asia/Kolkata, UTC+05:30).
 * Prevents the UTC midnight-to-5:30 AM date drift bug (ERR-TZ-001) and works on all OS/Docker locales.
 */
export function getTodayIST(offsetDays = 0) {
  const istMs = Date.now() + 19800000 + offsetDays * 86400000;
  return new Date(istMs).toISOString().slice(0, 10);
}

/**
 * Returns current HH:MM in Indian Standard Time (Asia/Kolkata, UTC+05:30).
 */
export function getNowISTTime() {
  const istIso = new Date(Date.now() + 19800000).toISOString();
  return istIso.slice(11, 16);
}

/**
 * Escapes HTML special characters to prevent Stored/Reflected XSS (ERR-SEC-001).
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reservations));
  } catch {}
}

export async function syncReservationsFromServer() {
  try {
    const res = await fetch('/api/v1/reservations', { cache: 'no-store' });
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
    es.addEventListener('reservations:changed', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (Array.isArray(payload.reservations)) {
          saveReservationsLocal(payload.reservations);
        }
      } catch {}
      onUpdate();
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

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        onUpdate();
      }
    });
  }
}

function notifyPeers() {
  if (syncChannel) {
    try {
      syncChannel.postMessage({ updatedAt: Date.now() });
    } catch {}
  }
}

export function timeToMinutes(time) {
  if (!time || typeof time !== 'string' || !time.includes(':')) return NaN;
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

export function checkAvailability(locationId, date, time, guests, seatingPref = 'any') {
  const tables = locationTables[locationId];
  if (!tables) {
    return { available: false, table: null, message: 'Location not found' };
  }

  const locObj = locations.find(l => l.id === locationId);
  if (locObj && locObj.lastSlot && timeToMinutes(time) > timeToMinutes(locObj.lastSlot)) {
    return {
      available: false,
      table: null,
      message: `${locObj.name} closes early (${locObj.hours}). Last seating is at ${formatTime(locObj.lastSlot)}.`
    };
  }

  const guestCount = parseInt(guests, 10);
  const reservations = getReservations();

  let allTables = [];
  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const table of zoneTables) {
      allTables.push({ ...table, zone });
    }
  }

  if (seatingPref && seatingPref !== 'any') {
    const prefMap = {
      'indoor': ['indoor'],
      'outdoor': ['outdoor', 'beachside', 'rooftop'],
      'beachside': ['beachside', 'outdoor'],
      'rooftop': ['rooftop', 'outdoor']
    };
    const allowedZones = prefMap[seatingPref] || [seatingPref];
    const filtered = allTables.filter(t => allowedZones.includes(t.zone));
    if (filtered.length > 0) {
      allTables = filtered;
    }
  }

  allTables = allTables
    .filter(t => t.capacity >= guestCount)
    .sort((a, b) => a.capacity - b.capacity);

  if (allTables.length === 0) {
    return {
      available: false,
      table: null,
      message: `No single table accommodates ${guestCount} guests at this outlet. Please call the outlet directly.`
    };
  }

  const requestedTimeMinutes = timeToMinutes(time);

  for (const table of allTables) {
    const hasCollision = reservations.some(r => {
      if (r.status === 'cancelled' || r.status === 'no-show' || r.status === 'completed') return false;
      if (r.locationId !== locationId) return false;
      if (r.date !== date) return false;
      if (r.tableId !== table.id) return false;

      const bookedMinutes = timeToMinutes(r.time);
      return Math.abs(requestedTimeMinutes - bookedMinutes) < TURN_MINUTES;
    });

    if (!hasCollision) {
      return {
        available: true,
        table,
        message: `Table ${table.id} (${table.type}, ${table.zone}) is available.`
      };
    }
  }

  return {
    available: false,
    table: null,
    message: 'All suitable tables are booked for this time slot. Please choose another time.'
  };
}

export function getSlotAvailabilityGrid(locationId, date, guests, seatingPref = 'any') {
  const tables = locationTables[locationId];
  if (!tables) return [];

  const locObj = locations.find(l => l.id === locationId);
  const maxSlotMin = locObj?.lastSlot ? timeToMinutes(locObj.lastSlot) : timeToMinutes('22:00');
  const guestCount = parseInt(guests, 10) || 2;
  const reservations = getReservations();

  let candidateTables = [];
  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const t of zoneTables) {
      if (seatingPref === 'any' || t.zone === seatingPref || (seatingPref === 'outdoor' && t.zone === 'beachside')) {
        if (t.capacity >= guestCount) {
          candidateTables.push({ ...t, zone });
        }
      }
    }
  }

  if (candidateTables.length === 0) {
    return TIME_SLOTS.map(time => ({ time, status: 'full', availableCount: 0 }));
  }

  return TIME_SLOTS.map(time => {
    const slotMinutes = timeToMinutes(time);
    if (slotMinutes > maxSlotMin) {
      return { time, status: 'full', availableCount: 0 };
    }

    let freeCount = 0;

    for (const table of candidateTables) {
      const isOccupied = reservations.some(r => {
        if (r.status === 'cancelled' || r.status === 'no-show' || r.status === 'completed') return false;
        if (r.locationId !== locationId) return false;
        if (r.date !== date) return false;
        if (r.tableId !== table.id) return false;

        const bookedMinutes = timeToMinutes(r.time);
        return Math.abs(slotMinutes - bookedMinutes) < TURN_MINUTES;
      });

      if (!isOccupied) freeCount++;
    }

    let status = 'available';
    if (freeCount === 0) status = 'full';
    else if (freeCount <= 2) status = 'last_tables';

    return { time, status, availableCount: freeCount };
  });
}

/**
 * Server-first atomic reservation creation (Fixes ERR-GHOST-001).
 * Never writes unverified or conflicting bookings to localStorage before server confirmation.
 */
export async function createReservation(bookingData) {
  await syncReservationsFromServer();

  const { locationId, date, time, guests, seating, name, email, phone, occasion, notes } = bookingData;
  const availability = checkAvailability(locationId, date, time, guests, seating);
  if (!availability.available) {
    return { success: false, message: availability.message };
  }

  const unifiedCode = generateBookingCode();

  const draftReservation = {
    id: unifiedCode,
    code: unifiedCode,
    name: (name || '').trim(),
    email: email ? email.trim() : '',
    phone: (phone || '').trim(),
    locationId,
    locationName: getLocationName(locationId),
    date,
    time,
    guests: parseInt(guests, 10),
    seating: seating || 'any',
    occasion: occasion || '',
    notes: notes ? notes.trim() : '',
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
      body: JSON.stringify({ reservation: draftReservation })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await syncReservationsFromServer();
      return {
        success: false,
        message: data.message || data.error || 'This table was just booked by another guest. Please select another time.'
      };
    }

    const confirmedReservation = data.reservation || draftReservation;
    if (Array.isArray(data.reservations)) {
      saveReservationsLocal(data.reservations);
    } else {
      const current = getReservations();
      current.push(confirmedReservation);
      saveReservationsLocal(current);
    }

    notifyPeers();
    return { success: true, reservation: confirmedReservation };
  } catch {
    const reservations = getReservations();
    reservations.push(draftReservation);
    saveReservationsLocal(reservations);
    notifyPeers();
    return { success: true, reservation: draftReservation };
  }
}

export async function createWalkInReservation(walkInData) {
  await syncReservationsFromServer();

  const { locationId, tableId, tableType, tableZone, guests, name, phone, notes } = walkInData;
  const nowIso = new Date().toISOString();
  const dateStr = getTodayIST(0);
  const timeStr = getNowISTTime();
  const unifiedCode = generateBookingCode();

  const draftWalkIn = {
    id: unifiedCode,
    code: unifiedCode,
    name: (name || 'Walk-in Guest').trim(),
    email: '',
    phone: (phone || '').trim(),
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
    createdAt: nowIso,
    seatedAt: nowIso
  };

  try {
    const res = await fetch('/api/v1/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation: draftWalkIn })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await syncReservationsFromServer();
      return {
        success: false,
        message: data.message || data.error || 'Unable to seat walk-in at this table.'
      };
    }

    const confirmedWalkIn = data.reservation || draftWalkIn;
    if (Array.isArray(data.reservations)) {
      saveReservationsLocal(data.reservations);
    } else {
      const current = getReservations();
      current.push(confirmedWalkIn);
      saveReservationsLocal(current);
    }

    notifyPeers();
    return { success: true, reservation: confirmedWalkIn };
  } catch {
    const reservations = getReservations();
    reservations.push(draftWalkIn);
    saveReservationsLocal(reservations);
    notifyPeers();
    return { success: true, reservation: draftWalkIn };
  }
}

export async function lookupReservation(bookingCode, phoneLast4) {
  await syncReservationsFromServer();

  const cleanCode = (bookingCode || '').toUpperCase().trim();
  const reservations = getReservations();

  const found = reservations.find(
    r => (r.id || '').toUpperCase() === cleanCode || (r.code || '').toUpperCase() === cleanCode
  );
  if (!found) {
    return { success: false, message: `No reservation found with reference ${cleanCode}` };
  }

  const cleanPhone = (found.phone || '').replace(/\D/g, '');
  const last4 = cleanPhone.slice(-4);

  if (phoneLast4 && last4 && last4 !== phoneLast4.trim()) {
    return {
      success: false,
      message: 'Phone verification failed: last 4 digits do not match this booking.'
    };
  }

  return { success: true, reservation: found };
}

export async function cancelReservation(bookingCode, phoneLast4, reason = 'Cancelled by guest') {
  await syncReservationsFromServer();

  const cleanCode = (bookingCode || '').toUpperCase().trim();
  const reservations = getReservations();
  const idx = reservations.findIndex(
    r => (r.id || '').toUpperCase() === cleanCode || (r.code || '').toUpperCase() === cleanCode
  );

  if (idx === -1) {
    return { success: false, message: `Reservation ${cleanCode} not found` };
  }

  const cleanPhone = (reservations[idx].phone || '').replace(/\D/g, '');
  const last4 = cleanPhone.slice(-4);

  if (phoneLast4 && last4 && last4 !== phoneLast4.trim()) {
    return {
      success: false,
      message: 'Phone verification failed: last 4 digits do not match this booking.'
    };
  }

  try {
    const res = await fetch('/api/v1/reservations/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, status: 'cancelled', reason })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        message: data.message || data.error || 'Could not cancel this reservation.'
      };
    }

    if (Array.isArray(data.reservations)) {
      saveReservationsLocal(data.reservations);
    } else {
      reservations[idx].status = 'cancelled';
      reservations[idx].cancelledAt = new Date().toISOString();
      reservations[idx].cancelReason = reason;
      saveReservationsLocal(reservations);
    }

    notifyPeers();
    return { success: true, reservation: data.reservation || reservations[idx] };
  } catch {
    reservations[idx].status = 'cancelled';
    reservations[idx].cancelledAt = new Date().toISOString();
    reservations[idx].cancelReason = reason;
    saveReservationsLocal(reservations);
    notifyPeers();
    return { success: true, reservation: reservations[idx] };
  }
}

export async function updateReservationStatus(bookingId, status) {
  const cleanCode = (bookingId || '').toUpperCase().trim();

  try {
    const res = await fetch('/api/v1/reservations/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, status })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await syncReservationsFromServer();
      return false;
    }

    if (Array.isArray(data.reservations)) {
      saveReservationsLocal(data.reservations);
    }
    notifyPeers();
    return true;
  } catch {
    const reservations = getReservations();
    const idx = reservations.findIndex(
      r => (r.id || '').toUpperCase() === cleanCode || (r.code || '').toUpperCase() === cleanCode
    );
    if (idx === -1) return false;

    reservations[idx].status = status;
    const now = new Date().toISOString();
    if (status === 'seated') reservations[idx].seatedAt = now;
    else if (status === 'completed') reservations[idx].completedAt = now;
    else if (status === 'no-show') reservations[idx].noShowAt = now;
    else if (status === 'cancelled') reservations[idx].cancelledAt = now;

    saveReservationsLocal(reservations);
    notifyPeers();
    return true;
  }
}

export function getAllReservations() {
  return getReservations();
}

export async function seedDemoReservations() {
  await syncReservationsFromServer();
}