// ============================================
// THE BURGER FACTORY — ICS CALENDAR GENERATOR
// ============================================

/**
 * Generates an .ics iCalendar file and triggers instant browser download.
 */
export function downloadCalendarEvent(reservation) {
  const { code, locationName, date, time, guests } = reservation;
  
  // Format date and time for ICS (UTC or local formatted as YYYYMMDDTHHMMSS)
  const [year, month, day] = date.split('-');
  const [hour, min] = time.split(':');
  
  const startDate = `${year}${month}${day}T${hour}${min}00`;
  
  // Add 90 minutes for end time
  const startObj = new Date(`${date}T${time}:00`);
  const endObj = new Date(startObj.getTime() + 90 * 60 * 1000);
  const endYear = endObj.getFullYear();
  const endMonth = String(endObj.getMonth() + 1).padStart(2, '0');
  const endDay = String(endObj.getDate()).padStart(2, '0');
  const endHour = String(endObj.getHours()).padStart(2, '0');
  const endMin = String(endObj.getMinutes()).padStart(2, '0');
  const endDate = `${endYear}${endMonth}${endDay}T${endHour}${endMin}00`;

  const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Burger Factory//Table Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:BF-${code}-${nowStr}@burgerfactory.in`,
    `DTSTAMP:${nowStr}`,
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:Burger Factory Booking (${code}) - ${locationName}`,
    `DESCRIPTION:Reservation for ${guests} guests at The Burger Factory (${locationName}).\\nBooking Reference: ${code}\\nPlease arrive 10-15 mins early.`,
    `LOCATION:The Burger Factory, ${locationName}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Burger-Factory-Reservation-${code}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
