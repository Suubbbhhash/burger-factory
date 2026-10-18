// ============================================
// SIMULATION — PERSONA POOLS
// Names, phones, notes, occasions — the human texture
// of the digital twin. Phone format matches the app's
// own seed style ("+91 98765 12345") and passes the
// client's validation regex.
// ============================================

const FIRST = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Sneha', 'Kabir', 'Isha',
  'Rahul', 'Diya', 'Aditya', 'Kavya', 'Nikhil', 'Riya', 'Sanjay', 'Pooja', 'Amit', 'Neha',
  'Farhan', 'Zara', 'Ravi', 'Anjali', 'Karan', 'Tara', 'Dev', 'Maya', 'Sid', 'Naina',
  'Chris', 'Elena', 'Mike', 'Sophie', 'Tom', 'Laura', 'Jake', 'Emma', 'Daniel', 'Olivia',
  'Marco', 'Ana', 'Lukas', 'Mia', 'Pedro', 'Carla', 'Ivan', 'Sasha', 'Noah', 'Lena',
  'Raghav', 'Ishita', 'Yash', 'Trisha', 'Harsh', 'Simran', 'Omkar', 'Tanvi'
];

const LAST = [
  'Sharma', 'Patel', 'Kapoor', 'Nair', 'Menon', 'Desai', 'Reddy', 'Iyer', 'Khan', 'Verma',
  'Malhotra', 'Bose', 'Chatterjee', 'Pereira', 'D\'Souza', 'Fernandes', 'Ghosh', 'Joshi',
  'Kulkarni', 'Rao', 'Mehta', 'Sinha', 'Bhatt', 'Chauhan', 'Dutta', 'Gupta',
  'Smith', 'Johnson', 'Miller', 'Walker', 'Silva', 'Costa', 'Weber', 'Rossi', 'Novak', 'Kumar'
];

const NOTES_POOL = [
  'Garden table preferred', 'Window table if possible', 'Birthday dessert at the table please',
  'High chair for a toddler', 'Quiet corner, anniversary dinner', 'Peanut allergy — please note kitchen',
  'Wheelchair access needed', 'Bringing our own cake', 'First time in Goa, want the sunset view',
  'Proposal dinner — need a private table', 'Kids party, 2 high chairs', 'Car parking needed',
  'Late by 10 mins maybe, please hold', 'Vegetarian only table', 'Arriving straight from the airport',
  'Want the table near the live music', 'Celebrating promotion', 'Date night, cozy spot please'
];

const OCCASIONS = [['', 60], ['birthday', 12], ['anniversary', 8], ['date', 8], ['business', 7], ['other', 5]];

/** Build a persona-sampled guest identity. */
export function makeIdentity(rng) {
  const first = rng.pick(FIRST);
  const last = rng.pick(LAST);
  const name = `${first} ${last}`;
  // Indian mobile: 9/8/7 leading digit, format like the app's seed data
  const lead = rng.pick(['9', '8', '7']);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += rng.int(0, 9);
  const phone = `+91 ${lead}${rest.slice(0, 4)} ${rest.slice(4)}`;
  const email = rng.chance(0.45) ? '' : `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${rng.pick(['gmail.com', 'outlook.com', 'yahoo.in', 'proton.me'])}`;
  return { name, phone, email };
}

export function makeNotes(rng) { return rng.chance(0.42) ? rng.pick(NOTES_POOL) : ''; }
export function makeOccasion(rng) { return rng.weighted(OCCASIONS); }

/** Booking code in the app's own format, generated CLIENT-side like booking.js does. */
export function makeBookingCode(rng) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = 'BF-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(rng.float() * chars.length)];
  return code;
}
