// ============================================
// THE BURGER FACTORY — SHARED CONSTANTS
// ============================================

export const TIME_SLOTS = [
  '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
] as const;

export type TimeSlot = typeof TIME_SLOTS[number];

export const RESERVATION_STATUS = {
  PENDING_DEPOSIT: 'pending_deposit',
  CONFIRMED: 'confirmed',
  SEATED: 'seated',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show'
} as const;

export type ReservationStatusType = typeof RESERVATION_STATUS[keyof typeof RESERVATION_STATUS];

export const ZONES = {
  INDOOR: 'indoor',
  OUTDOOR: 'outdoor',
  BEACHSIDE: 'beachside',
  ROOFTOP: 'rooftop'
} as const;

export type ZoneType = typeof ZONES[keyof typeof ZONES];

export const ZONE_ALIASES: Record<string, ZoneType[]> = {
  any: ['indoor', 'outdoor', 'beachside', 'rooftop'],
  indoor: ['indoor'],
  outdoor: ['outdoor', 'beachside', 'rooftop'],
  beachside: ['beachside', 'outdoor'],
  rooftop: ['rooftop', 'outdoor']
};

export const USER_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  HOST: 'host'
} as const;

export type UserRoleType = typeof USER_ROLES[keyof typeof USER_ROLES];

export const TABLE_TURN_MINUTES = 90;
export const LARGE_GROUP_THRESHOLD = 6;
export const DEPOSIT_PER_GUEST_PAISE = 50000; // ₹500 in paise

// Unambiguous character set for 6-character booking codes (approx 1.07 billion combinations)
export const BOOKING_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const BOOKING_CODE_LENGTH = 6;

export const LOCATIONS = [
  {
    id: 'anjuna',
    slug: 'anjuna',
    name: 'Anjuna',
    tag: 'Flagship & Original Shack',
    area: 'North Goa',
    address: 'Near Anjuna Beach Road, Anjuna, Bardez, Goa 403509',
    phone: '+91 98765 43210',
    hours: '12:30 PM – 10:30 PM',
    opensAt: '12:30',
    lastSeatingAt: '22:00',
    seating: 'Indoor & Garden Shack',
    tablesCount: 18,
    capacity: 72,
    vibe: 'Rustic · Hippie · Wood-Fired',
    image: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80',
    features: ['Pet Friendly', 'Live Music (Fri-Sat)', 'Craft Beer & Full Bar'],
    mapUrl: 'https://maps.google.com/?q=Anjuna+Goa+Burger+Factory'
  },
  {
    id: 'morjim',
    slug: 'morjim',
    name: 'Morjim',
    tag: 'Beachside & Sunset',
    area: 'North Goa',
    address: 'Morjim Beach Road, Near Turtle Nesting Site, Morjim, Goa 403512',
    phone: '+91 98765 43211',
    hours: '12:30 PM – 10:30 PM',
    opensAt: '12:30',
    lastSeatingAt: '22:00',
    seating: 'Beach Deck & Indoor',
    tablesCount: 20,
    capacity: 96,
    vibe: 'Sea Breeze · Golden Hour · Chill',
    image: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80',
    features: ['Sunset Views', 'Open Seafront Deck', 'Beachside Cocktails'],
    mapUrl: 'https://maps.google.com/?q=Morjim+Goa+Burger+Factory'
  },
  {
    id: 'vagator',
    slug: 'vagator',
    name: 'Vagator',
    tag: 'Cliffside Casual',
    area: 'North Goa',
    address: 'Ozran Beach Road, Vagator, Bardez, Goa 403509',
    phone: '+91 98765 43212',
    hours: '12:30 PM – 10:30 PM',
    opensAt: '12:30',
    lastSeatingAt: '22:00',
    seating: 'Indoor & Open-Air Terrace',
    tablesCount: 14,
    capacity: 56,
    vibe: 'Casual · Lively · Sunlit',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
    features: ['Open Air Terrace', 'Quick Table Turn', 'Craft Shakes'],
    mapUrl: 'https://maps.google.com/?q=Vagator+Goa+Burger+Factory'
  },
  {
    id: 'nerul',
    slug: 'nerul',
    name: 'Nerul',
    tag: 'Riverfront Hideout',
    area: 'North Goa',
    address: 'Near Nerul Bridge, Nerul, Bardez, Goa 403114',
    phone: '+91 98765 43213',
    hours: '12:30 PM – 10:00 PM',
    opensAt: '12:30',
    lastSeatingAt: '21:30',
    seating: 'Indoor Cozy Dining',
    tablesCount: 10,
    capacity: 40,
    vibe: 'Intimate · Calm · Neighborhood',
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80',
    features: ['Family Friendly', 'Dedicated Parking', 'Air-Conditioned'],
    mapUrl: 'https://maps.google.com/?q=Nerul+Goa+Burger+Factory'
  },
  {
    id: 'dona-paula',
    slug: 'dona-paula',
    name: 'Dona Paula',
    tag: 'Jetty Viewpoint',
    area: 'South Goa',
    address: 'Near Dona Paula Jetty, Dona Paula, Tiswadi, Goa 403004',
    phone: '+91 98765 43214',
    hours: '12:30 PM – 10:00 PM',
    opensAt: '12:30',
    lastSeatingAt: '21:30',
    seating: 'Terrace & Indoor',
    tablesCount: 12,
    capacity: 48,
    vibe: 'Bay View · Gentle Breeze · Romantic',
    image: 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80',
    features: ['Sea Bay Views', 'Terrace Tables', 'Candlelit Dinners'],
    mapUrl: 'https://maps.google.com/?q=Dona+Paula+Goa+Burger+Factory'
  },
  {
    id: 'panaji',
    slug: 'panaji',
    name: 'Panaji',
    tag: 'Fontainhas City Corner',
    area: 'Central Goa',
    address: 'MG Road, Panaji, Tiswadi, Goa 403001',
    phone: '+91 98765 43215',
    hours: '12:00 PM – 10:30 PM',
    opensAt: '12:00',
    lastSeatingAt: '22:00',
    seating: 'Bustling AC Dining',
    tablesCount: 16,
    capacity: 64,
    vibe: 'Urban · Quick · Heritage Street',
    image: 'https://images.unsplash.com/photo-1559329007-40df8a9345d8?w=800&q=80',
    features: ['Central AC', 'City Center', 'Takeaway Counter'],
    mapUrl: 'https://maps.google.com/?q=Panaji+Goa+Burger+Factory'
  },
  {
    id: 'delhi',
    slug: 'delhi',
    name: 'New Delhi',
    tag: 'Capital Outpost',
    area: 'NCR',
    address: 'Alaknanda Market, Greater Kailash, New Delhi 110019',
    phone: '+91 98765 43216',
    hours: '12:00 PM – 11:00 PM',
    opensAt: '12:00',
    lastSeatingAt: '22:30',
    seating: 'Rooftop & Indoor Hall',
    tablesCount: 20,
    capacity: 80,
    vibe: 'Metro · Rooftop Nights · Vibrant',
    image: 'https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=800&q=80',
    features: ['Open Rooftop', 'Late Night Dining', 'Fast Delivery'],
    mapUrl: 'https://maps.google.com/?q=Alaknanda+New+Delhi+Burger+Factory'
  }
] as const;
