import { downloadCalendarEvent } from './calendar.js';
import { escapeHtml } from './booking.js';

export function renderThermalTicket(reservation) {
  const {
    code,
    name,
    locationName,
    dateFormatted,
    timeFormatted,
    guests,
    tableLabel,
    tableZone,
    occasion
  } = reservation;

  const safeCode = escapeHtml(code);
  const safeName = escapeHtml(name);
  const safeLoc = escapeHtml(locationName);
  const safeTable = escapeHtml(tableLabel);
  const safeZone = escapeHtml(tableZone);

  const whatsappMessage = encodeURIComponent(
    `*The Burger Factory — Table Reservation*\n` +
    `Booking Ref: *${code}*\n` +
    `Outlet: ${locationName}\n` +
    `Date & Time: ${dateFormatted} at ${timeFormatted}\n` +
    `Guests: ${guests}\n` +
    `Table: ${tableLabel} (${tableZone})`
  );

  const whatsappUrl = `https://wa.me/?text=${whatsappMessage}`;

  return `
    <div class="thermal-ticket-wrapper">
      <article class="thermal-ticket" role="dialog" aria-labelledby="ticket-title">
        <header class="ticket-header">
          <span class="ticket-kicker">THE BURGER FACTORY · EST. 2015</span>
          <h2 id="ticket-title" class="ticket-outlet">${safeLoc.toUpperCase()}</h2>
          <p class="ticket-meta">CONFIRMED TABLE RESERVATION</p>
        </header>

        <div class="ticket-code-banner">
          <span class="ticket-code-label">BOOKING REFERENCE</span>
          <span class="ticket-code-val" id="ticket-code-text">${safeCode}</span>
        </div>

        <dl class="ticket-grid">
          <div class="ticket-field">
            <dt>DATE</dt>
            <dd>${escapeHtml(dateFormatted)}</dd>
          </div>
          <div class="ticket-field">
            <dt>TIME (90 MIN TURN)</dt>
            <dd>${escapeHtml(timeFormatted)}</dd>
          </div>
          <div class="ticket-field">
            <dt>GUEST NAME</dt>
            <dd>${safeName}</dd>
          </div>
          <div class="ticket-field">
            <dt>PARTY SIZE</dt>
            <dd>${guests} ${guests === 1 ? 'Guest' : 'Guests'}</dd>
          </div>
          <div class="ticket-field">
            <dt>TABLE ALLOCATION</dt>
            <dd>${safeTable} (${safeZone.toUpperCase()})</dd>
          </div>
          <div class="ticket-field">
            <dt>STATUS</dt>
            <dd style="color: var(--leaf);">CONFIRMED</dd>
          </div>
        </dl>

        ${occasion ? `
          <div style="font-size: 0.8rem; background: rgba(28,23,19,0.05); padding: 6px 10px; border-radius: 4px; margin-bottom: 1rem;">
            <strong>Occasion:</strong> ${escapeHtml(occasion.charAt(0).toUpperCase() + occasion.slice(1))}
          </div>
        ` : ''}

        <div class="ticket-perforation"></div>

        <footer class="ticket-footer">
          <p style="font-size: 0.72rem; color: var(--ink-soft); line-height: 1.4; margin-bottom: 1rem; text-align: center;">
            Please arrive within 15 minutes of your reservation slot. Use your Booking Reference and phone number below to check or cancel at any time.
          </p>
          <div class="ticket-actions">
            <button type="button" class="btn btn-mustard btn-sm" id="btn-copy-code" data-code="${code}">
              Copy Booking Ref (${code})
            </button>
            <button type="button" class="btn btn-paper btn-sm" id="btn-download-ics">
              Add to Calendar (.ics)
            </button>
            <a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn btn-sea btn-sm">
              Share via WhatsApp
            </a>
            <button type="button" class="btn btn-outline btn-sm" id="btn-ticket-done" style="margin-top: 0.5rem;">
              Close Voucher
            </button>
          </div>
        </footer>
      </article>
    </div>
  `;
}

export function attachTicketListeners(reservation) {
  document.getElementById('btn-copy-code')?.addEventListener('click', (e) => {
    const code = e.currentTarget.dataset.code;
    navigator.clipboard.writeText(code).then(() => {
      e.currentTarget.textContent = `Copied (${code})`;
      setTimeout(() => {
        e.currentTarget.textContent = `Copy Booking Ref (${code})`;
      }, 2500);
    }).catch(() => {
      prompt('Copy your Booking Reference:', code);
    });
  });

  document.getElementById('btn-download-ics')?.addEventListener('click', () => {
    downloadCalendarEvent(reservation);
  });
}
