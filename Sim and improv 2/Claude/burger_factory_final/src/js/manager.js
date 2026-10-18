// ============================================
// THE BURGER FACTORY — UNIFIED STAFF PORTAL CONTROLLER
// Real-Time SSE Sync + Hotel-Grade Printable Service Manifest
// ============================================

import { locations, locationTables } from './data.js';
import {
  getAllReservations,
  syncReservationsFromServer,
  subscribeToLiveUpdates,
  updateReservationStatus,
  createWalkInReservation,
  getStaffToken,
  staffLogin,
  staffLogout,
  seedDemoReservations,
  formatTime,
  formatDate,
  getTodayIST,
  escapeHtml
} from './booking.js';

let currentLocation = 'anjuna';
let currentDate = '';
let currentStatus = 'all';
let searchQuery = '';

function showManagerToast(message, type = 'info', undoCallback = null) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    ${undoCallback ? `<button type="button" class="btn btn-outline btn-sm" id="toast-undo-btn" style="padding: 2px 8px; font-size: 0.72rem; margin-left: 0.5rem;">Undo</button>` : ''}
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  if (undoCallback) {
    toast.querySelector('#toast-undo-btn')?.addEventListener('click', () => {
      undoCallback();
      toast.remove();
    });
  }

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

document.addEventListener('DOMContentLoaded', async () => {
  initStaffAuthGate();
  await seedDemoReservations();
  initClock();
  initFilters();
  initShortcuts();
  initWalkInModal();
  refreshDashboard();

  const liveBadge = document.getElementById('mgr-live-status');
  subscribeToLiveUpdates(
    () => {
      refreshDashboard();
    },
    (online) => {
      if (liveBadge) {
        liveBadge.textContent = online ? 'LIVE SYNC' : 'LOCAL MODE';
        liveBadge.classList.toggle('live', online);
        liveBadge.classList.toggle('reconnecting', !online);
      }
    }
  );

  setInterval(async () => {
    await syncReservationsFromServer();
    refreshDashboard();
  }, 10000);
});

function initStaffAuthGate() {
  const gate = document.getElementById('staff-auth-gate');
  const form = document.getElementById('staff-gate-form');
  const passInput = document.getElementById('staff-gate-pass');
  const errEl = document.getElementById('staff-gate-error');

  // The passcode is verified by the SERVER, which returns a session token. Nothing secret lives in this file.
  if (getStaffToken()) {
    gate?.classList.remove('open');
  } else {
    gate?.classList.add('open');
  }

  // token expired / rejected by the server -> back to the login screen
  window.addEventListener('bf-auth-required', () => {
    gate?.classList.add('open');
    if (errEl) { errEl.textContent = 'Session expired. Please log in again.'; errEl.style.display = 'block'; }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (passInput?.value || '').trim();
    const result = await staffLogin(val);
    if (result.success) {
      if (passInput) passInput.value = '';
      if (errEl) errEl.style.display = 'none';
      gate?.classList.remove('open');
      await syncReservationsFromServer();
      refreshDashboard();
    } else if (errEl) {
      errEl.textContent = result.message || 'Incorrect passcode.';
      errEl.style.display = 'block';
    }
  });

  document.getElementById('btn-mgr-logout')?.addEventListener('click', async () => {
    await staffLogout();
    gate?.classList.add('open');
    refreshDashboard();
  });
}

function initClock() {
  const clockEl = document.getElementById('mgr-live-clock');
  function updateTime() {
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
  updateTime();
  setInterval(updateTime, 1000);
}

function initFilters() {
  const locSelect = document.getElementById('mgr-location-filter');
  const dateInput = document.getElementById('mgr-date-filter');
  const statusTabs = document.getElementById('mgr-status-filters');
  const searchInput = document.getElementById('mgr-search');

  const todayStr = getTodayIST();
  currentDate = todayStr;
  if (dateInput) {
    dateInput.value = todayStr;
    dateInput.addEventListener('change', (e) => {
      currentDate = e.target.value;
      refreshDashboard();
    });
  }

  locSelect?.addEventListener('change', (e) => {
    currentLocation = e.target.value;
    refreshDashboard();
  });

  statusTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.status-filter-btn');
    if (!btn) return;

    statusTabs.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status;
    refreshDashboard();
  });

  let debounceTimer;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.trim().toLowerCase();
      refreshDashboard();
    }, 200);
  });

  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', async () => {
    await syncReservationsFromServer();
    refreshDashboard();
    showManagerToast('Synced latest reservations', 'info');
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);

  document.getElementById('btn-print-daysheet')?.addEventListener('click', () => {
    renderPrintDaySheet();
    window.print();
  });
}

function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      document.getElementById('mgr-search')?.focus();
    }
    if (e.key === 'Escape') {
      document.getElementById('walkin-modal-overlay')?.classList.remove('open');
    }
  });
}

function refreshDashboard() {
  if (!getStaffToken()) return; // nothing to show (and no guest data is held) until staff have logged in
  const allReservations = getAllReservations();
  let filtered = allReservations.filter(r => r.locationId === currentLocation && r.date === currentDate);

  updateCounts(filtered);

  if (currentStatus !== 'all') {
    filtered = filtered.filter(r => r.status === currentStatus);
  }

  if (searchQuery) {
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(searchQuery) ||
      (r.code && r.code.toLowerCase().includes(searchQuery)) ||
      (r.id && r.id.toLowerCase().includes(searchQuery)) ||
      r.phone.includes(searchQuery)
    );
  }

  filtered.sort((a, b) => {
    const order = { seated: 0, confirmed: 1, completed: 2, 'no-show': 3, cancelled: 4 };
    const sa = order[a.status] ?? 5;
    const sb = order[b.status] ?? 5;
    if (sa !== sb) return sa - sb;
    return a.time.localeCompare(b.time);
  });

  renderTable(filtered);
  renderArrivingSoon(allReservations);
  renderFloorCanvas(allReservations);
  renderPrintDaySheet();
}

function updateCounts(reservations) {
  const total = reservations.filter(r => r.status !== 'cancelled' && r.status !== 'no-show').length;
  const confirmed = reservations.filter(r => r.status === 'confirmed').length;
  const seated = reservations.filter(r => r.status === 'seated').length;
  const completed = reservations.filter(r => r.status === 'completed').length;
  const noshow = reservations.filter(r => r.status === 'no-show').length;
  const cancelled = reservations.filter(r => r.status === 'cancelled').length;
  const guests = reservations
    .filter(r => r.status !== 'cancelled' && r.status !== 'no-show')
    .reduce((sum, r) => sum + (parseInt(r.guests, 10) || 0), 0);

  document.getElementById('stat-active').textContent = total;
  document.getElementById('stat-confirmed').textContent = confirmed;
  document.getElementById('stat-seated').textContent = seated;
  document.getElementById('stat-guests').textContent = guests;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-noshow').textContent = cancelled + noshow;

  document.getElementById('count-all').textContent = reservations.length;
  document.getElementById('count-confirmed').textContent = confirmed;
  document.getElementById('count-seated').textContent = seated;
  document.getElementById('count-completed').textContent = completed;
  document.getElementById('count-noshow').textContent = noshow;
  document.getElementById('count-cancelled').textContent = cancelled;
}

function renderTable(reservations) {
  const tbody = document.getElementById('mgr-table-body');
  const emptyEl = document.getElementById('mgr-table-empty');
  const table = document.getElementById('mgr-reservations-table');

  if (!tbody) return;

  if (reservations.length === 0) {
    table.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  table.style.display = '';
  emptyEl.style.display = 'none';

  tbody.innerHTML = reservations.map(r => {
    const code = r.code || r.id;
    let actionButtons = '';

    if (r.status === 'confirmed') {
      actionButtons = `
        <button class="btn btn-mustard btn-sm" data-action="seated" data-id="${code}">Seat</button>
        <button class="btn btn-outline btn-sm" data-action="no-show" data-id="${code}">No-Show</button>
        <button class="btn btn-outline btn-sm" data-action="cancelled" data-id="${code}">Cancel</button>
      `;
    } else if (r.status === 'seated') {
      actionButtons = `
        <button class="btn btn-sea btn-sm" data-action="completed" data-id="${code}">Complete</button>
      `;
    } else {
      actionButtons = `
        <button class="btn btn-outline btn-sm" data-action="confirmed" data-id="${code}">Restore</button>
      `;
    }

    return `
      <tr>
        <td data-label="REF"><strong style="font-family: var(--font-mono); color: var(--ketchup);">${escapeHtml(code)}</strong></td>
        <td data-label="GUEST">
          <strong>${escapeHtml(r.name)}</strong><br/>
          <span style="font-size: 0.75rem; color: var(--ink-soft); font-family: var(--font-mono);">${escapeHtml(r.phone)}</span>
          ${r.notes ? `<div style="font-size: 0.72rem; color: var(--sea); margin-top: 2px;">Note: ${escapeHtml(r.notes)}</div>` : ''}
        </td>
        <td data-label="TIME"><span style="font-family: var(--font-mono); font-weight: 700;">${formatTime(r.time)}</span></td>
        <td data-label="PAX"><strong style="font-family: var(--font-mono);">${r.guests}</strong></td>
        <td data-label="TABLE"><strong style="font-family: var(--font-mono);">${r.tableLabel || r.tableId}</strong></td>
        <td data-label="ZONE"><span style="font-size: 0.75rem; text-transform: uppercase; font-family: var(--font-mono);">${r.tableZone}</span></td>
        <td data-label="STATUS"><span class="status-pill ${r.status}">${r.status.toUpperCase()}</span></td>
        <td data-label="ACTIONS"><div class="table-action-group">${actionButtons}</div></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const prevRes = getAllReservations().find(res => (res.code === id || res.id === id));
      const previousStatus = prevRes ? prevRes.status : 'confirmed';

      await updateReservationStatus(id, action);
      refreshDashboard();

      showManagerToast(
        `Reservation ${id} marked as ${action.toUpperCase()}`,
        'info',
        async () => {
          await updateReservationStatus(id, previousStatus);
          refreshDashboard();
          showManagerToast(`Restored ${id} to ${previousStatus.toUpperCase()}`, 'success');
        }
      );
    });
  });
}

function renderArrivingSoon(allReservations) {
  const container = document.getElementById('arriving-lane-container');
  if (!container) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const arriving = allReservations.filter(r => {
    if (r.locationId !== currentLocation || r.date !== currentDate || r.status !== 'confirmed') return false;
    const [h, m] = r.time.split(':').map(Number);
    const diff = (h * 60 + m) - currentMinutes;
    return diff >= -15 && diff <= 45;
  });

  if (arriving.length === 0) {
    container.innerHTML = '<span style="font-size: 0.8rem; color: var(--ink-soft);">No confirmed arrivals scheduled within the next 30 minutes.</span>';
    return;
  }

  container.innerHTML = arriving.map(r => `
    <div class="arriving-card">
      <div>
        <span class="arriving-time">${formatTime(r.time)}</span>
        <div style="font-weight: 700; font-size: 0.84rem;">${escapeHtml(r.name)} (${r.guests} pax)</div>
        <div style="font-size: 0.72rem; color: var(--ink-soft); font-family: var(--font-mono);">${escapeHtml(r.tableLabel || r.tableId)} · ${escapeHtml(r.tableZone.toUpperCase())}</div>
      </div>
      <button class="btn btn-mustard btn-sm" data-arrive-seat="${r.code || r.id}">
        Seat Now
      </button>
    </div>
  `).join('');

  container.querySelectorAll('[data-arrive-seat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.arriveSeat;
      await updateReservationStatus(id, 'seated');
      refreshDashboard();
      showManagerToast(`Seated reservation ${id}`, 'success');
    });
  });
}

function renderFloorCanvas(allReservations) {
  const canvas = document.getElementById('mgr-floor-canvas');
  if (!canvas) return;

  const tables = locationTables[currentLocation];
  if (!tables) {
    canvas.innerHTML = '<p>No table map configured for this outlet.</p>';
    return;
  }

  const todayStr = getTodayIST();
  const isToday = currentDate === todayStr;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let html = '';

  const outletReservations = allReservations
    .filter(r => r.locationId === currentLocation && r.date === currentDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  for (const [zone, zoneTables] of Object.entries(tables)) {
    for (const table of zoneTables) {
      const active = outletReservations.find(r => {
        if (r.tableId !== table.id) return false;
        if (['cancelled', 'completed', 'no-show'].includes(r.status)) return false;

        const [h, m] = r.time.split(':').map(Number);
        const startMin = h * 60 + m;
        const endMin = startMin + 90;

        if (r.status === 'seated') return true;
        if (isToday) {
          return startMin <= currentMinutes && currentMinutes < endMin;
        }
        return false;
      });

      const upcoming = outletReservations.find(r => {
        if (r.tableId !== table.id) return false;
        if (r.status !== 'confirmed') return false;

        if (isToday) {
          const [h, m] = r.time.split(':').map(Number);
          return (h * 60 + m) > currentMinutes;
        }
        return true;
      });

      let status = 'available';
      let guestName = '';
      let timerText = '';
      let isOvertime = false;

      if (active && active.status === 'seated') {
        status = 'occupied';
        guestName = active.name;

        const seatedTime = active.seatedAt ? new Date(active.seatedAt).getTime() : (now.getTime() - 20 * 60000);
        const elapsedMin = Math.max(1, Math.floor((now.getTime() - seatedTime) / 60000));
        timerText = `${elapsedMin}m / 90m`;

        if (elapsedMin > 90) {
          isOvertime = true;
          timerText = `OVERTIME (${elapsedMin}m)`;
        }
      } else if (active || upcoming) {
        status = 'reserved';
        const res = active || upcoming;
        guestName = `${formatTime(res.time)} · ${res.name}`;
      }

      const isRound = table.type === '2-seater';

      html += `
        <div class="floor-table-card ${status} ${isOvertime ? 'overtime' : ''} ${isRound ? 'shape-round' : ''}"
             data-table-id="${table.id}"
             data-table-type="${table.type}"
             data-table-zone="${zone}"
             data-table-capacity="${table.capacity}"
             data-status="${status}"
             data-res-id="${active ? (active.code || active.id) : (upcoming ? (upcoming.code || upcoming.id) : '')}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <span class="table-code">${table.id}</span>
            <span class="table-capacity">${table.capacity}P</span>
          </div>

          <div style="margin: 4px 0; width: 100%;">
            <span class="table-status-tag">${status.toUpperCase()}</span>
            ${guestName ? `<div class="table-guest-name">${guestName}</div>` : ''}
            ${timerText ? `<div class="table-turn-timer ${isOvertime ? 'warning' : ''}">${timerText}</div>` : ''}
          </div>

          <div style="font-size: 0.65rem; color: var(--ink-soft); text-transform: uppercase; font-family: var(--font-mono);">
            ${zone}
          </div>
        </div>
      `;
    }
  }

  canvas.innerHTML = html;

  canvas.querySelectorAll('.floor-table-card').forEach(card => {
    card.addEventListener('click', () => {
      const status = card.dataset.status;
      const tableId = card.dataset.tableId;
      const type = card.dataset.tableType;
      const zone = card.dataset.tableZone;
      const resId = card.dataset.resId;

      if (status === 'available') {
        openWalkInModal(tableId, type, zone);
      } else if (resId) {
        showManagerToast(`Table ${tableId} assigned to booking ${resId}`, 'info');
      }
    });
  });
}

let selectedWalkInTable = null;

function initWalkInModal() {
  const overlay = document.getElementById('walkin-modal-overlay');
  const closeBtn = document.getElementById('btn-close-walkin');
  const form = document.getElementById('walkin-form');

  closeBtn?.addEventListener('click', () => overlay.classList.remove('open'));
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedWalkInTable) return;

    const name = document.getElementById('walkin-name').value.trim() || 'Walk-in Guest';
    const guests = document.getElementById('walkin-guests').value;
    const phone = document.getElementById('walkin-phone').value.trim();

    await createWalkInReservation({
      locationId: currentLocation,
      tableId: selectedWalkInTable.id,
      tableType: selectedWalkInTable.type,
      tableZone: selectedWalkInTable.zone,
      guests,
      name,
      phone
    });

    overlay.classList.remove('open');
    refreshDashboard();
    showManagerToast(`Walk-in party seated at Table ${selectedWalkInTable.id}`, 'success');
  });
}

function openWalkInModal(tableId, type, zone) {
  selectedWalkInTable = { id: tableId, type, zone };
  const overlay = document.getElementById('walkin-modal-overlay');
  const title = document.getElementById('walkin-table-title');
  const desc = document.getElementById('walkin-table-desc');

  if (title) title.textContent = `Seat Walk-In at Table ${tableId}`;
  if (desc) desc.textContent = `${type} · ${zone.toUpperCase()} ZONE · Immediate 90-min turn`;

  overlay.classList.add('open');
}

function renderPrintDaySheet() {
  const mount = document.getElementById('print-daysheet-container');
  if (!mount) return;

  const locObj = locations.find(l => l.id === currentLocation) || locations[0];
  const dayRecords = getAllReservations()
    .filter(r => r.locationId === currentLocation && r.date === currentDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  const activeRecords = dayRecords.filter(r => r.status !== 'cancelled' && r.status !== 'no-show');
  const totalCovers = activeRecords.reduce((s, r) => s + (parseInt(r.guests, 10) || 0), 0);

  const lunchCovers = activeRecords
    .filter(r => parseInt(r.time.split(':')[0], 10) < 17)
    .reduce((s, r) => s + (parseInt(r.guests, 10) || 0), 0);

  const dinnerCovers = totalCovers - lunchCovers;

  const specialBriefing = activeRecords.filter(
    r => r.guests >= 6 || (r.occasion && r.occasion !== '') || (r.notes && r.notes !== '')
  );

  const outletZones = locationTables[currentLocation] || {};
  const allOutletTables = [];
  for (const [z, list] of Object.entries(outletZones)) {
    for (const t of list) allOutletTables.push({ ...t, zone: z.toUpperCase() });
  }

  const printedAt = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  mount.innerHTML = `
    <div class="daysheet-page">
      <header class="ds-header">
        <div>
          <div class="ds-kicker">THE BURGER FACTORY · DAILY HOST STAND & PRE-SHIFT BRIEFING SHEET</div>
          <h1 class="ds-title">${locObj.name.toUpperCase()} (${locObj.area.toUpperCase()}) — SERVICE MANIFEST</h1>
          <div class="ds-subtitle">${locObj.address} · Operating Hours: ${locObj.hours}</div>
        </div>
        <div class="ds-meta-box">
          <div><strong>SERVICE DATE:</strong> ${formatDate(currentDate)}</div>
          <div><strong>PRINTED AT:</strong> ${printedAt}</div>
          <div><strong>DUTY MANAGER:</strong> ______________________</div>
        </div>
      </header>

      <table class="ds-summary-table">
        <thead>
          <tr>
            <th>TOTAL BOOKINGS</th>
            <th>EXPECTED COVERS</th>
            <th>LUNCH COVERS (12:30-16:30)</th>
            <th>DINNER COVERS (17:00-22:00)</th>
            <th>CONFIRMED</th>
            <th>SEATED</th>
            <th>COMPLETED</th>
            <th>CANCELLED / NO-SHOW</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${activeRecords.length}</td>
            <td>${totalCovers} PAX</td>
            <td>${lunchCovers} PAX</td>
            <td>${dinnerCovers} PAX</td>
            <td>${dayRecords.filter(r => r.status === 'confirmed').length}</td>
            <td>${dayRecords.filter(r => r.status === 'seated').length}</td>
            <td>${dayRecords.filter(r => r.status === 'completed').length}</td>
            <td>${dayRecords.filter(r => ['cancelled', 'no-show'].includes(r.status)).length}</td>
          </tr>
        </tbody>
      </table>

      <div class="ds-section-heading">SECTION A — VIP, LARGE PARTIES (6+ PAX) & SPECIAL OCCASION BRIEFING</div>
      ${specialBriefing.length === 0 ? `
        <div class="ds-empty-box">No large groups (6+ pax) or special occasion requests logged for this date.</div>
      ` : `
        <table class="ds-manifest-table" style="margin-bottom: 14px;">
          <thead>
            <tr>
              <th style="width: 10%;">TIME</th>
              <th style="width: 14%;">REF CODE</th>
              <th style="width: 22%;">GUEST NAME</th>
              <th style="width: 8%;">PAX</th>
              <th style="width: 14%;">TABLE / ZONE</th>
              <th style="width: 14%;">OCCASION</th>
              <th>KITCHEN / SETUP / DIETARY NOTES</th>
            </tr>
          </thead>
          <tbody>
            ${specialBriefing.map(r => `
              <tr>
                <td><strong>${formatTime(r.time)}</strong></td>
                <td class="ds-mono">${r.code || r.id}</td>
                <td><strong>${r.name}</strong></td>
                <td><strong>${r.guests}</strong></td>
                <td class="ds-mono">${r.tableLabel || r.tableId} (${r.tableZone.toUpperCase()})</td>
                <td>${r.occasion ? r.occasion.toUpperCase() : '—'}</td>
                <td>${r.notes || 'Standard table setup'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

      <div class="ds-section-heading">SECTION B — CHRONOLOGICAL RESERVATIONS RUN-SHEET (PODIUM CHECK-IN LOG)</div>
      <table class="ds-manifest-table">
        <thead>
          <tr>
            <th style="width: 5%;">ARR</th>
            <th style="width: 10%;">SLOT TIME</th>
            <th style="width: 12%;">REF CODE</th>
            <th style="width: 22%;">GUEST NAME & PHONE</th>
            <th style="width: 6%;">PAX</th>
            <th style="width: 13%;">TABLE / ZONE</th>
            <th style="width: 11%;">STATUS</th>
            <th style="width: 13%;">NOTES / OCCASION</th>
            <th style="width: 8%;">TIME IN</th>
          </tr>
        </thead>
        <tbody>
          ${dayRecords.length === 0 ? `
            <tr>
              <td colspan="9" style="text-align: center; padding: 12px;">No reservations recorded for this date.</td>
            </tr>
          ` : dayRecords.map(r => `
            <tr class="${r.status === 'cancelled' ? 'ds-row-cancelled' : ''}">
              <td style="text-align: center;">${r.status === 'seated' || r.status === 'completed' ? '[X]' : '[ ]'}</td>
              <td><strong>${formatTime(r.time)}</strong></td>
              <td class="ds-mono">${r.code || r.id}</td>
              <td><strong>${r.name}</strong><br/><span class="ds-mono" style="font-size: 8pt;">${r.phone}</span></td>
              <td style="text-align: center;"><strong>${r.guests}</strong></td>
              <td class="ds-mono">${r.tableLabel || r.tableId} · ${r.tableZone.toUpperCase()}</td>
              <td class="ds-mono">${r.status.toUpperCase()}</td>
              <td>${[r.occasion ? r.occasion.toUpperCase() : '', r.notes || ''].filter(Boolean).join(' — ') || '—'}</td>
              <td>${r.seatedAt ? new Date(r.seatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '____'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="ds-section-heading" style="margin-top: 14px;">SECTION C — FLOOR TABLE TURN & WALK-IN HANDWRITTEN SHEET</div>
      <table class="ds-manifest-table">
        <thead>
          <tr>
            <th style="width: 12%;">TABLE ID</th>
            <th style="width: 12%;">ZONE</th>
            <th style="width: 10%;">CAPACITY</th>
            <th style="width: 22%;">TURN 1 (12:30 - 15:30)</th>
            <th style="width: 22%;">TURN 2 (18:30 - 20:30)</th>
            <th style="width: 22%;">TURN 3 (20:30 - CLOSE)</th>
          </tr>
        </thead>
        <tbody>
          ${allOutletTables.map(t => {
            const tableBookings = activeRecords.filter(r => (r.tableLabel || r.tableId) === t.id);
            const t1 = tableBookings.find(r => parseInt(r.time.split(':')[0], 10) < 17);
            const t2 = tableBookings.find(r => {
              const h = parseInt(r.time.split(':')[0], 10);
              return h >= 17 && h < 20;
            });
            const t3 = tableBookings.find(r => parseInt(r.time.split(':')[0], 10) >= 20);

            return `
              <tr>
                <td class="ds-mono"><strong>${t.id}</strong></td>
                <td class="ds-mono">${t.zone}</td>
                <td>${t.capacity} Pax</td>
                <td>${t1 ? `${formatTime(t1.time)} ${escapeHtml(t1.name)} (${t1.guests}p)` : '__________________'}</td>
                <td>${t2 ? `${formatTime(t2.time)} ${escapeHtml(t2.name)} (${t2.guests}p)` : '__________________'}</td>
                <td>${t3 ? `${formatTime(t3.time)} ${escapeHtml(t3.name)} (${t3.guests}p)` : '__________________'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <footer class="ds-footer">
        <div><strong>86'D / SOLD-OUT ITEMS TODAY:</strong> ___________________________________________________________</div>
        <div><strong>HOST / CLOSING MANAGER SIGN-OFF:</strong> ___________________________ <strong>DATE:</strong> ______________</div>
      </footer>
    </div>
  `;
}

function exportCSV() {
  const all = getAllReservations().filter(r => r.locationId === currentLocation && r.date === currentDate);
  if (all.length === 0) {
    showManagerToast('No reservations to export for this date.', 'warning');
    return;
  }

  const headers = ['Ref', 'Guest Name', 'Phone', 'Date', 'Time', 'Covers', 'Table', 'Zone', 'Status', 'Occasion', 'Notes'];
  const rows = all.map(r => [
    r.code || r.id,
    `"${r.name}"`,
    `"${r.phone}"`,
    r.date,
    r.time,
    r.guests,
    r.tableLabel || r.tableId,
    r.tableZone,
    r.status,
    `"${r.occasion || ''}"`,
    `"${(r.notes || '').replace(/"/g, '""')}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `burger-factory-${currentLocation}-${currentDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showManagerToast('Exported CSV report', 'success');
}
