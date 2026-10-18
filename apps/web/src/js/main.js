// FILE: /src/js/main.js
import { menuItems, locations, reviews, burgerJokes } from './data.js';
import {
  seedDemoReservations,
  subscribeToLiveUpdates,
  getSlotAvailabilityGrid,
  createReservation,
  lookupReservation,
  cancelReservation,
  formatDate,
  formatTime,
  getLocationName,
  getTodayIST,
  escapeHtml
} from './booking.js';
import { renderThermalTicket, attachTicketListeners } from './thermalTicket.js';

export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const labels = {
    success: 'OK',
    error: 'ERR',
    info: 'INFO',
    warning: 'NOTE'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span style="font-weight: 800; font-family: var(--font-mono); font-size: 0.72rem; padding: 2px 6px; border: 1px solid currentColor; border-radius: 3px;">${labels[type] || 'INFO'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

let refreshStripSlotsFn = () => {};

// ---- Burger Jokes Rotator ----
function initRandomBurgerJoke() {
  const headlineEl = document.getElementById('hero-joke-headline');
  const punchlineEl = document.getElementById('hero-joke-punchline');
  const authorEl = document.getElementById('hero-joke-author');
  const shuffleBtn = document.getElementById('btn-shuffle-joke');

  if (!headlineEl || !punchlineEl || !authorEl) return;

  let lastIndex = -1;

  function pickJoke() {
    let idx;
    do {
      idx = Math.floor(Math.random() * burgerJokes.length);
    } while (idx === lastIndex && burgerJokes.length > 1);
    lastIndex = idx;
    return burgerJokes[idx];
  }

  function displayJoke(joke) {
    headlineEl.style.opacity = '0';
    punchlineEl.style.opacity = '0';
    setTimeout(() => {
      headlineEl.textContent = `"${joke.headline}"`;
      punchlineEl.textContent = joke.punchline;
      authorEl.textContent = `BOARD NOTE · ${joke.author.toUpperCase()}`;
      headlineEl.style.opacity = '1';
      punchlineEl.style.opacity = '1';
    }, 180);
  }

  // Show initial joke
  displayJoke(pickJoke());

  shuffleBtn?.addEventListener('click', () => {
    displayJoke(pickJoke());
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await seedDemoReservations();
  initNavbar();
  initRandomBurgerJoke();
  initHeroAvailabilityStrip();
  renderMenu('all');
  initMenuFilters();
  renderLocations();
  renderReviews();
  initBookingFlow();
  initLookupSection();

  // Keep customer availability slots in sync when bookings/cancellations happen
  subscribeToLiveUpdates(() => {
    refreshStripSlotsFn();
    renderBookingSlotChips();
  });
});

function initNavbar() {
  const navbar = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileClose = document.getElementById('mobile-menu-close');

  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 30);
  }, { passive: true });

  hamburger?.addEventListener('click', () => {
    mobileMenu?.classList.toggle('open');
  });

  mobileClose?.addEventListener('click', () => {
    mobileMenu?.classList.remove('open');
  });

  mobileMenu?.querySelector('.mobile-menu-overlay')?.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
  });

  document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', () => mobileMenu?.classList.remove('open'));
  });

  // Also close mobile menu when mobile bottom bar links are tapped
  document.querySelectorAll('.mobile-bottom-bar a').forEach(link => {
    link.addEventListener('click', () => mobileMenu?.classList.remove('open'));
  });

  initNavActiveTracking();
}

function initNavActiveTracking() {
  const sectionIds = ['hero', 'about', 'menu', 'locations', 'reviews', 'lookup-section'];
  const sections = sectionIds
    .map(id => ({ id, el: document.getElementById(id) }))
    .filter(s => s.el !== null);

  const desktopLinks = document.querySelectorAll('.nav-link[href^="#"]');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link[href^="#"]');

  function setActiveLink(activeId) {
    desktopLinks.forEach(link => {
      const target = link.getAttribute('href')?.replace('#', '');
      link.classList.toggle('active', target === activeId);
    });
    mobileLinks.forEach(link => {
      const target = link.getAttribute('href')?.replace('#', '');
      link.classList.toggle('active', target === activeId);
    });
  }

  let isScrolling = false;
  function handleScroll() {
    const scrollPos = window.scrollY;
    const headerOffset = 160;

    let currentId = 'hero';
    for (const { id, el } of sections) {
      const top = el.offsetTop - headerOffset;
      if (scrollPos >= top) {
        currentId = id;
      }
    }
    setActiveLink(currentId);
  }

  window.addEventListener('scroll', () => {
    if (!isScrolling) {
      window.requestAnimationFrame(() => {
        handleScroll();
        isScrolling = false;
      });
      isScrolling = true;
    }
  }, { passive: true });
}

function initHeroAvailabilityStrip() {
  const locSelect = document.getElementById('strip-location');
  const minusBtn = document.getElementById('strip-guest-minus');
  const plusBtn = document.getElementById('strip-guest-plus');
  const guestVal = document.getElementById('strip-guest-val');
  const slotsContainer = document.getElementById('strip-slots-container');

  if (!locSelect || !slotsContainer) return;

  let currentGuests = 2;
  const todayStr = getTodayIST();

  function refreshStripSlots() {
    const locId = locSelect.value;
    const slots = getSlotAvailabilityGrid(locId, todayStr, currentGuests, 'any');
    const displaySlots = slots.slice(0, 8);

    slotsContainer.innerHTML = displaySlots.map(s => `
      <div class="chip-slot ${s.status}" data-time="${s.time}">
        <span class="slot-time">${formatTime(s.time).replace(':00', '')}</span>
        <span class="slot-hint">${s.status === 'full' ? 'Full' : s.status === 'last_tables' ? 'Last 2' : 'Open'}</span>
      </div>
    `).join('');

    slotsContainer.querySelectorAll('.chip-slot:not(.full)').forEach(chip => {
      chip.addEventListener('click', () => {
        const selectedTime = chip.dataset.time;
        const bookLoc = document.getElementById('book-location');
        if (bookLoc) bookLoc.value = locId;

        setBookingGuests(currentGuests);

        const timeInput = document.getElementById('book-selected-time');
        if (timeInput) timeInput.value = selectedTime;

        const sumOutlet = document.getElementById('sum-outlet');
        if (sumOutlet) sumOutlet.textContent = getLocationName(locId).split(',')[0];
        const sumTime = document.getElementById('sum-time');
        if (sumTime) sumTime.textContent = formatTime(selectedTime);

        renderBookingSlotChips();
        document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  refreshStripSlotsFn = refreshStripSlots;

  minusBtn?.addEventListener('click', () => {
    if (currentGuests > 1) {
      currentGuests--;
      guestVal.textContent = `${currentGuests} Guest${currentGuests > 1 ? 's' : ''}`;
      refreshStripSlots();
    }
  });

  plusBtn?.addEventListener('click', () => {
    if (currentGuests < 10) {
      currentGuests++;
      guestVal.textContent = `${currentGuests} Guests`;
      refreshStripSlots();
    }
  });

  locSelect.addEventListener('change', refreshStripSlots);
  refreshStripSlots();
}

// ---- Card-based menu renderer (no dotted leaders) ----
function renderMenu(category = 'all') {
  const container = document.getElementById('menu-items-container');
  if (!container) return;

  const filtered = category === 'all' ? menuItems : menuItems.filter(item => item.category === category);

  container.innerHTML = filtered.map(item => {
    const isVeg = item.diet === 'veg' || item.category === 'veg';
    const dietClass = isVeg ? 'veg' : 'non-veg';

    const badgeHtml = item.badge === 'popular'
      ? `<span class="menu-tag-pill menu-badge-popular">Bestseller</span>`
      : item.badge === 'new'
        ? `<span class="menu-tag-pill menu-badge-new">New</span>`
        : item.badge === 'veg'
          ? `<span class="menu-tag-pill menu-badge-veg">Pure Veg</span>`
          : '';

    return `
      <article class="menu-item-block">
        <div class="menu-row">
          <div class="menu-title-wrap">
            <span class="diet-badge ${dietClass}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
            <h3 class="menu-name">${item.name}</h3>
          </div>
          <span class="menu-price">&#8377;${item.price}</span>
        </div>
        <p class="menu-item-desc">${item.description}</p>
        <div class="menu-item-tags">
          ${item.tags.map(t => `<span class="menu-tag-pill">${t}</span>`).join('')}
          ${badgeHtml}
        </div>
      </article>
    `;
  }).join('');
}

function initMenuFilters() {
  const tabs = document.getElementById('menu-category-tabs');
  tabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;

    tabs.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMenu(btn.dataset.cat);
  });
}

function renderLocations() {
  const container = document.getElementById('locations-container');
  if (!container) return;

  const flagship = locations.find(l => l.id === 'anjuna');
  const others = locations.filter(l => l.id !== 'anjuna');

  const flagshipHtml = `
    <div class="location-flagship-card">
      <img 
        src="${flagship.image}" 
        alt="The Burger Factory ${flagship.name}" 
        class="location-flagship-img"
        loading="lazy" 
        width="600" 
        height="338"
      />
      <div class="location-flagship-body">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
          <div>
            <span class="section-tag">${flagship.tag}</span>
            <h3 style="font-size: var(--step-2); margin-top: 4px;">${flagship.name}</h3>
          </div>
          <span class="location-status-badge open">Open · ${flagship.hours}</span>
        </div>
        <p style="font-size: var(--step--1);">${flagship.address}</p>
        <p style="font-size: 0.82rem; font-family: var(--font-mono); color: var(--ink-soft); margin: 0.5rem 0;">
          <strong>Setting:</strong> ${flagship.vibe} · <strong>Capacity:</strong> ${flagship.tables} tables (${flagship.capacity} seats)
        </p>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem;">
          ${flagship.features.map(f => `<span class="menu-tag-pill">${f}</span>`).join('')}
        </div>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <a href="#booking" class="btn btn-mustard btn-sm" data-select-outlet="anjuna">
            Reserve Anjuna Table
          </a>
          <a href="${flagship.mapUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
            Directions
          </a>
        </div>
      </div>
    </div>
  `;

  const othersHtml = others.map(loc => `
    <div class="location-compact-row">
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <h4 style="font-size: var(--step-0);">${loc.name}</h4>
          <span style="font-size: 0.72rem; color: var(--ink-soft); font-family: var(--font-mono);">(${loc.area})</span>
        </div>
        <p style="font-size: 0.78rem; color: var(--ink-soft); margin-top: 2px;">${loc.hours} · ${loc.seating}</p>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
        <a href="#booking" class="btn btn-mustard btn-sm" data-select-outlet="${loc.id}">
          Reserve
        </a>
        <a href="${loc.mapUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
          Map
        </a>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    ${flagshipHtml}
    <div class="locations-compact-list">
      <h3 style="font-size: var(--step-1); margin-bottom: 0.25rem;">All Dining Rooms</h3>
      ${othersHtml}
    </div>
  `;

  container.querySelectorAll('[data-select-outlet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const locId = btn.dataset.selectOutlet;
      const selectEl = document.getElementById('book-location');
      if (selectEl) {
        selectEl.value = locId;
        selectEl.dispatchEvent(new Event('change'));
      }
    });
  });
}

function renderReviews() {
  const container = document.getElementById('reviews-wall');
  if (!container) return;

  container.innerHTML = reviews.map(r => `
    <article class="review-card">
      <div>
        <div class="review-stars" style="font-family: var(--font-mono); font-weight: 700; color: var(--ketchup);">${r.rating}.0 / 5.0</div>
        <p class="review-quote">"${r.text}"</p>
      </div>
      <footer class="review-footer">
        <strong>${r.name}</strong>
        <span>${r.location} · ${r.date}</span>
      </footer>
    </article>
  `).join('');
}

let bookingGuests = 2;

function setBookingGuests(num) {
  bookingGuests = Math.max(1, Math.min(10, num));
  const valEl = document.getElementById('book-guest-val');
  const labelEl = document.getElementById('book-guest-label');
  const summaryEl = document.getElementById('sum-guests');

  if (valEl) valEl.textContent = bookingGuests;
  if (labelEl) labelEl.textContent = `${bookingGuests === 1 ? 'Guest' : 'Guests'} (${bookingGuests <= 2 ? '2-seater' : bookingGuests <= 4 ? '4-seater' : bookingGuests <= 6 ? '6-seater' : 'Large Table'})`;
  if (summaryEl) summaryEl.textContent = `${bookingGuests} ${bookingGuests === 1 ? 'Guest' : 'Guests'}`;

  renderBookingSlotChips();
}

function renderBookingSlotChips() {
  const locSelect = document.getElementById('book-location');
  const dateInput = document.getElementById('book-date');
  const zoneSelect = document.getElementById('book-zone');
  const chipsContainer = document.getElementById('time-slot-chips');
  const timeInput = document.getElementById('book-selected-time');

  if (!locSelect || !dateInput || !chipsContainer) return;

  const locId = locSelect.value;
  const dateStr = dateInput.value;
  const seating = zoneSelect ? zoneSelect.value : 'any';

  const slotData = getSlotAvailabilityGrid(locId, dateStr, bookingGuests, seating);
  const selectedTime = timeInput ? timeInput.value : '13:00';

  chipsContainer.innerHTML = slotData.map(s => {
    const isSelected = s.time === selectedTime;
    return `
      <div class="chip-slot ${s.status} ${isSelected ? 'active' : ''}" data-time="${s.time}">
        <span class="slot-time">${formatTime(s.time).replace(':00', '')}</span>
        <span class="slot-hint">${s.status === 'full' ? 'Full' : s.status === 'last_tables' ? 'Last 2' : 'Open'}</span>
      </div>
    `;
  }).join('');

  chipsContainer.querySelectorAll('.chip-slot:not(.full)').forEach(chip => {
    chip.addEventListener('click', () => {
      chipsContainer.querySelectorAll('.chip-slot').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const chosen = chip.dataset.time;
      if (timeInput) timeInput.value = chosen;

      const sumTime = document.getElementById('sum-time');
      if (sumTime) sumTime.textContent = formatTime(chosen);
    });
  });
}

function initBookingFlow() {
  const form = document.getElementById('main-booking-form');
  const dateInput = document.getElementById('book-date');
  const locSelect = document.getElementById('book-location');
  const zoneSelect = document.getElementById('book-zone');
  const minusBtn = document.getElementById('book-guest-minus');
  const plusBtn = document.getElementById('book-guest-plus');

  const todayStr = getTodayIST();

  if (dateInput) {
    dateInput.min = todayStr;
    dateInput.value = todayStr;
  }

  minusBtn?.addEventListener('click', () => setBookingGuests(bookingGuests - 1));
  plusBtn?.addEventListener('click', () => setBookingGuests(bookingGuests + 1));

  locSelect?.addEventListener('change', () => {
    const sumLoc = document.getElementById('sum-outlet');
    if (sumLoc) sumLoc.textContent = getLocationName(locSelect.value).split(',')[0];
    renderBookingSlotChips();
  });

  dateInput?.addEventListener('change', () => {
    const sumDate = document.getElementById('sum-date');
    if (sumDate) sumDate.textContent = formatDate(dateInput.value);
    renderBookingSlotChips();
  });

  zoneSelect?.addEventListener('change', () => {
    const sumZone = document.getElementById('sum-zone');
    if (sumZone) sumZone.textContent = zoneSelect.options[zoneSelect.selectedIndex].text;
    renderBookingSlotChips();
  });

  renderBookingSlotChips();

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = form.querySelector('#book-name').value.trim();
    const phone = form.querySelector('#book-phone').value.trim();
    const email = form.querySelector('#book-email').value.trim();
    const locationId = locSelect.value;
    const date = dateInput.value;
    const time = document.getElementById('book-selected-time').value;
    const seating = zoneSelect.value;
    const occasion = form.querySelector('#book-occasion').value;
    const notes = form.querySelector('#book-notes').value.trim();

    if (!name || name.length < 2) {
      showToast('Please enter your full name', 'warning');
      return;
    }

    if (!phone || !/^(\+91[\-\s]?)?[0]?[6789]\d{9}$/.test(phone.replace(/\s+/g, ''))) {
      showToast('Please enter a valid 10-digit mobile number', 'warning');
      return;
    }

    const result = await createReservation({
      name,
      phone,
      email,
      locationId,
      date,
      time,
      guests: bookingGuests,
      seating,
      occasion,
      notes
    });

    if (!result.success) {
      showToast(result.message, 'error');
      return;
    }

    const reservation = result.reservation;
    reservation.dateFormatted = formatDate(reservation.date);
    reservation.timeFormatted = formatTime(reservation.time);

    const mount = document.getElementById('ticket-modal-mount');
    const overlay = document.getElementById('booking-modal-overlay');

    if (mount && overlay) {
      mount.innerHTML = renderThermalTicket(reservation);
      attachTicketListeners(reservation);

      document.getElementById('btn-ticket-done')?.addEventListener('click', () => {
        overlay.classList.remove('open');
      });

      overlay.classList.add('open');
    }

    showToast(`Table ${reservation.tableLabel} confirmed (${reservation.code})`, 'success');
    form.reset();
    dateInput.value = todayStr;
    setBookingGuests(2);
    refreshStripSlotsFn();
  });
}

function initLookupSection() {
  const form = document.getElementById('lookup-form');
  const resultContainer = document.getElementById('lookup-result-container');

  if (!form || !resultContainer) return;

  async function runLookup() {
    const ref = document.getElementById('lookup-ref').value.trim();
    const phone4 = document.getElementById('lookup-phone4').value.trim();

    if (!ref || !phone4 || phone4.length !== 4) {
      showToast('Please enter your booking reference and last 4 digits of phone', 'warning');
      return;
    }

    const result = await lookupReservation(ref, phone4);
    resultContainer.style.display = 'block';

    if (!result.success) {
      resultContainer.innerHTML = `
        <div style="background: rgba(214,59,39,0.1); border: 1.5px solid var(--ketchup); border-radius: var(--radius); padding: 1rem; color: var(--ketchup-dark); font-weight: 600;">
          ${result.message}
        </div>
      `;
      showToast(result.message, 'error');
      return;
    }

    const r = result.reservation;
    const isActive = r.status === 'confirmed' || r.status === 'seated';

    resultContainer.innerHTML = `
      <div style="background: var(--paper-deep); border: var(--line); border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow-hard-xs);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(28,23,19,0.25); padding-bottom: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <strong style="font-family: var(--font-mono); font-size: 1.1rem; color: var(--ketchup);">${escapeHtml(r.code)}</strong>
          <span class="status-pill ${r.status}">${escapeHtml(r.status.toUpperCase())}</span>
        </div>
        <p style="font-size: var(--step--1); margin-bottom: 0.35rem;">
          <strong>Guest:</strong> ${escapeHtml(r.name)} · <strong>Party:</strong> ${r.guests} Guests
        </p>
        <p style="font-size: var(--step--1); margin-bottom: 0.35rem;">
          <strong>Outlet:</strong> ${escapeHtml(r.locationName)} (Table ${escapeHtml(r.tableLabel || r.tableId)})
        </p>
        <p style="font-size: var(--step--1); margin-bottom: 1rem;">
          <strong>Date &amp; Time:</strong> ${formatDate(r.date)} at ${formatTime(r.time)}
        </p>

        ${isActive ? `
          <button type="button" class="btn btn-ketchup btn-sm" id="btn-cancel-reservation" data-code="${r.code}">
            Cancel Reservation
          </button>
        ` : `
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--ketchup);">
            Status: ${r.status.toUpperCase()} — Table has been released.
          </div>
        `}
      </div>
    `;

    document.getElementById('btn-cancel-reservation')?.addEventListener('click', async () => {
      if (confirm(`Cancel reservation ${r.code} for ${r.name}?`)) {
        const cancelRes = await cancelReservation(r.code, phone4, 'Cancelled by customer online');
        if (cancelRes.success) {
          showToast(`Reservation ${r.code} cancelled. Staff Portal updated.`, 'info');
          await runLookup();
          refreshStripSlotsFn();
          renderBookingSlotChips();
        } else {
          showToast(cancelRes.message, 'error');
        }
      }
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runLookup();
  });
}
