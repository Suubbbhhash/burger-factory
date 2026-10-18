// ============================================
// THE BURGER FACTORY — AUTHENTIC GOA MENU, OUTLET DATA & BURGER JOKES
// ============================================

export const burgerJokes = [
  {
    headline: "How does a sesame seed stick to a bun? That's magical.",
    punchline: "There must be some sesame seed glue out there. Either that or they're adhesive on one side—peel off the backing, place it on the bun.",
    author: "Mitch Hedberg"
  },
  {
    headline: "No great story ever started with someone ordering a salad.",
    punchline: "Unless that salad was sitting quietly next to a Double Cheddar Bacon burger and a basket of hand-cut wedges.",
    author: "Classic Pub Chalkboard"
  },
  {
    headline: "It's late. I'm weak. Hello, burger and fries.",
    punchline: "Why do we pretend we're better than a cheeseburger? Give in gracefully and grab a table before the grill cools down.",
    author: "Jim Gaffigan"
  },
  {
    headline: "Remember sesame seeds? What happened? All the buns are blank!",
    punchline: "They could take sesame seeds off the market and I wouldn't even care. Good thing we bake soft potato buns instead.",
    author: "Mitch Hedberg"
  },
  {
    headline: "We don't cut burgers in half. Friendship has limits.",
    punchline: "Order your own burger, guard your zucchini fries, and book your table online so you don't wait on the road.",
    author: "Anjuna House Rule"
  },
  {
    headline: "A balanced diet is a burger in both hands.",
    punchline: "Scientifically unproven, emotionally undefeated. Seven kitchens across Goa and New Delhi.",
    author: "Chalkboard Wisdom"
  }
];

export const menuItems = [
  // ---------- BEEF BURGERS ----------
  {
    id: 'beef-double-cheddar-bacon-bbq',
    name: 'Beef Double Cheddar Bacon BBQ',
    description: 'Flame-grilled imported beef patty topped with double melted cheddar, crispy pork bacon, house smoky BBQ sauce, lettuce, tomato, and house mayo on a toasted potato bun. Served with hand-cut potato wedges and house salad.',
    price: 580,
    category: 'beef',
    diet: 'non-veg',
    badge: 'popular',
    tags: ['Signature', 'Double Cheese']
  },
  {
    id: 'beef-blue-cheese-bacon-avocado',
    name: 'Beef Blue Cheese, Bacon & Avocado',
    description: 'Savory hand-pressed beef patty layered with crumbled Danish blue cheese, crispy smoked bacon, fresh sliced avocado, caramelized onions, and rocket leaves on a potato bun. Served with hand-cut wedges and salad.',
    price: 600,
    category: 'beef',
    diet: 'non-veg',
    badge: 'popular',
    tags: ['All-Star', 'Rich']
  },
  {
    id: 'beef-mango-avocado-bacon',
    name: 'Beef Mango, Avocado & Bacon',
    description: 'Our signature coastal pairing: flame-grilled beef patty with sweet ripe Goan mango slices, creamy avocado, crispy pork bacon, and aged cheddar. Served with hand-cut wedges and house salad.',
    price: 580,
    category: 'beef',
    diet: 'non-veg',
    badge: null,
    tags: ['Goa Special']
  },
  {
    id: 'beef-pineapple-mozzarella-jalapeno',
    name: 'Beef Pineapple, Smoked Mozzarella & Jalapeno',
    description: 'Char-grilled beef patty topped with caramelized grilled pineapple, melted smoked mozzarella, sharp cheddar, and pickled jalapenos. Served with hand-cut wedges and house salad.',
    price: 560,
    category: 'beef',
    diet: 'non-veg',
    badge: null,
    tags: ['Sweet & Spicy']
  },
  {
    id: 'signature-hot-dog-burger',
    name: 'Signature Hot Dog Burger (Beef & Pork)',
    description: 'Flame-grilled beef patty stacked with a split smoked pork frankfurter, melted cheddar, tangy yellow mustard, ketchup, and crispy fried onions. Served with hand-cut wedges and salad.',
    price: 580,
    category: 'beef',
    diet: 'non-veg',
    badge: 'new',
    tags: ['Loaded']
  },

  // ---------- CHICKEN BURGERS ----------
  {
    id: 'chicken-brie-bacon-cranberry',
    name: 'Chicken Brie, Bacon & Cranberry',
    description: 'Flame-grilled chicken breast filet topped with warm creamy French brie, crispy pork bacon, and house-made tart cranberry sauce on a toasted potato bun. Served with hand-cut wedges and salad.',
    price: 600,
    category: 'chicken',
    diet: 'non-veg',
    badge: 'popular',
    tags: ['Must Try', 'Bestseller']
  },
  {
    id: 'chicken-parmesan-avocado-pesto',
    name: 'Chicken Parmesan, Avocado & Basil Pesto',
    description: 'Grilled herb-marinated chicken breast layered with shaved parmesan, fresh sliced avocado, house basil-cashew pesto, and sun-dried tomatoes. Served with hand-cut wedges and salad.',
    price: 560,
    category: 'chicken',
    diet: 'non-veg',
    badge: 'popular',
    tags: ['Fresh Herb']
  },
  {
    id: 'chicken-double-cheddar-bacon-bbq',
    name: 'Chicken Double Cheddar Bacon BBQ',
    description: 'Juicy flame-grilled chicken breast with double melted cheddar, crispy bacon strips, caramelized onions, and smoky BBQ glaze. Served with hand-cut wedges and salad.',
    price: 560,
    category: 'chicken',
    diet: 'non-veg',
    badge: null,
    tags: ['Smoky']
  },
  {
    id: 'chicken-cheddar-pineapple-jalapeno',
    name: 'Chicken Cheddar, Pineapple & Jalapeno',
    description: 'Grilled chicken filet topped with aged cheddar, char-grilled pineapple ring, pickled jalapenos, and chipotle mayo. Served with hand-cut wedges and salad.',
    price: 520,
    category: 'chicken',
    diet: 'non-veg',
    badge: null,
    tags: ['Tropical Heat']
  },

  // ---------- PORK BURGERS ----------
  {
    id: 'pork-double-cheddar-bacon-bbq',
    name: 'Pork Double Cheddar Bacon BBQ',
    description: 'House-ground spiced pork patty stacked with double cheddar cheese, extra crispy bacon, smoky BBQ sauce, and dill pickles on a toasted potato bun. Served with hand-cut wedges and salad.',
    price: 560,
    category: 'pork',
    diet: 'non-veg',
    badge: 'popular',
    tags: ['Pork Lovers']
  },

  // ---------- VEGETARIAN BURGERS ----------
  {
    id: 'veg-black-bean-avocado-mango',
    name: 'Black Bean, Avocado & Mango Burger',
    description: 'Scratch-made spiced black bean and corn patty topped with fresh sliced avocado, ripe mango, melted cheddar, and cilantro-lime dressing. Served with hand-cut wedges and salad.',
    price: 480,
    category: 'veg',
    diet: 'veg',
    badge: 'popular',
    tags: ['House Favorite']
  },
  {
    id: 'veg-spinach-mushroom-blue-cheese',
    name: 'Spinach, Mushroom & Blue Cheese Burger',
    description: 'Seared spinach and button mushroom patty topped with melted cheddar, creamy blue cheese crumbles, and toasted walnuts on a potato bun. Served with hand-cut wedges and salad.',
    price: 480,
    category: 'veg',
    diet: 'veg',
    badge: 'veg',
    tags: ['Gourmet Veg']
  },
  {
    id: 'veg-chickpea-carrot-cheddar',
    name: 'Chickpea, Carrot & Cheddar Burger',
    description: 'Crisp chickpea, grated carrot, and herb patty topped with melted cheddar, pickled red onions, crisp lettuce, and roasted tahini drizzle. Served with hand-cut wedges and salad.',
    price: 440,
    category: 'veg',
    diet: 'veg',
    badge: 'veg',
    tags: ['Protein Rich']
  },

  // ---------- SIDES & APPETIZERS ----------
  {
    id: 'crispy-zucchini-fries',
    name: 'Crispy Panko Zucchini Fries',
    description: 'Fresh zucchini batons coated in seasoned panko breadcrumbs and fried crisp, served with cool garlic-herb sour cream dip.',
    price: 280,
    category: 'sides',
    diet: 'veg',
    badge: 'popular',
    tags: ['House Classic']
  },
  {
    id: 'fried-pickle-chips',
    name: 'Beer-Battered Fried Pickle Chips',
    description: 'Tangy dill pickle slices dipped in spiced batter and fried golden, served with house chipotle ranch.',
    price: 260,
    category: 'sides',
    diet: 'veg',
    badge: 'popular',
    tags: ['Crispy & Tangy']
  },
  {
    id: 'hand-cut-potato-wedges',
    name: 'Signature Hand-Cut Potato Wedges',
    description: 'Large sharing basket of skin-on potato wedges seasoned with sea salt and cracked pepper, served with roasted garlic aioli.',
    price: 240,
    category: 'sides',
    diet: 'veg',
    badge: null,
    tags: ['Gluten Free']
  },

  // ---------- SHAKES & COOLERS ----------
  {
    id: 'banana-peanut-butter-shake',
    name: 'Banana Peanut Butter Thick Shake',
    description: 'Roasted creamy peanut butter, ripe Goan banana, and vanilla bean ice cream blended thick.',
    price: 300,
    category: 'shakes',
    diet: 'veg',
    badge: 'popular',
    tags: ['Signature Shake']
  },
  {
    id: 'belgian-chocolate-oreo-shake',
    name: 'Belgian Chocolate & Oreo Shake',
    description: 'Rich dark chocolate ganache and crushed Oreo cookies blended with creamy vanilla ice cream.',
    price: 300,
    category: 'shakes',
    diet: 'veg',
    badge: null,
    tags: ['Indulgent']
  },
  {
    id: 'passionfruit-mint-cooler',
    name: 'Fresh Passionfruit & Mint Cooler',
    description: 'Tart passionfruit pulp muddled with fresh mint leaves, lime, and chilled sparkling soda.',
    price: 240,
    category: 'shakes',
    diet: 'veg',
    badge: 'new',
    tags: ['Refreshing']
  }
];

export const locations = [
  {
    id: 'anjuna',
    name: 'Anjuna',
    tag: 'Original Kitchen',
    area: 'North Goa',
    address: 'Anjuna Mapusa Road, Gumal Vaddo, Opposite Paradise Guesthouse, Anjuna, Goa 403509',
    hours: '12:30 PM – 10:30 PM',
    seating: 'Indoor & Garden',
    tables: 18,
    capacity: 72,
    vibe: 'Garden Courtyard & Open Grill',
    image: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80',
    features: ['Pet Friendly', 'Garden Seating', 'Full Bar'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Anjuna+Goa'
  },
  {
    id: 'morjim',
    name: 'Morjim',
    tag: 'Beachfront',
    area: 'North Goa',
    address: 'Morjim Beach Road, Kannaik Wada, Morjim, Goa 403512',
    hours: '12:30 PM – 10:30 PM',
    seating: 'Beachfront Deck & Indoor',
    tables: 20,
    capacity: 88,
    vibe: 'Sea Breeze & Sunset Deck',
    image: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&q=80',
    features: ['Sunset Views', 'Beachside Deck', 'Craft Cocktails'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Morjim+Goa'
  },
  {
    id: 'dona-paula',
    name: 'Dona Paula',
    tag: 'South & Panjim Coast',
    area: 'Tiswadi, Goa',
    address: 'Near Dona Paula Circle, Jetty Road, Dona Paula, Goa 403004',
    hours: '12:30 PM – 10:30 PM',
    seating: 'Indoor & Terrace',
    tables: 12,
    capacity: 48,
    vibe: 'Bay Breeze & Terrace Dining',
    image: 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80',
    features: ['Terrace Seating', 'Cocktail Bar'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Dona+Paula+Goa'
  },
  {
    id: 'panaji',
    name: 'Panaji (La Citadel)',
    tag: 'City Kitchen',
    area: 'Central Goa',
    address: 'Villa Dona, Plot D1, La Citadel Colony, Panaji, Goa 403001',
    hours: '12:30 PM – 10:00 PM',
    seating: 'Air-Conditioned Dining',
    tables: 16,
    capacity: 64,
    vibe: 'Neighborhood Dining Room',
    image: 'https://images.unsplash.com/photo-1559329007-40df8a9345d8?w=800&q=80',
    features: ['AC Dining', 'Central Location', 'Takeaway'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+La+Citadel+Panaji+Goa'
  },
  {
    id: 'vagator',
    name: 'Vagator',
    tag: 'North Goa',
    area: 'Bardez, Goa',
    address: 'Ozran Beach Road, Vagator, Bardez, Goa 403509',
    hours: '12:30 PM – 10:30 PM',
    seating: 'Indoor & Veranda',
    tables: 14,
    capacity: 56,
    vibe: 'Relaxed Veranda Dining',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
    features: ['Open Veranda', 'Thick Shakes'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Vagator+Goa'
  },
  {
    id: 'nerul',
    name: 'Nerul',
    tag: 'Riverfront',
    area: 'North Goa',
    address: 'Near Nerul Bridge, Nerul, Bardez, Goa 403114',
    hours: '12:30 PM – 10:00 PM',
    seating: 'Indoor Dining',
    tables: 10,
    capacity: 40,
    vibe: 'Quiet Local Dining Room',
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80',
    features: ['Family Friendly', 'Easy Parking'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Nerul+Goa'
  },
  {
    id: 'delhi',
    name: 'New Delhi',
    tag: 'NCR Outpost',
    area: 'Greater Kailash',
    address: 'Alaknanda Market, Greater Kailash II, New Delhi 110019',
    hours: '12:00 PM – 11:00 PM',
    seating: 'Indoor & Rooftop',
    tables: 20,
    capacity: 80,
    vibe: 'Evening Rooftop & Grill',
    image: 'https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=800&q=80',
    features: ['Rooftop Seating', 'Late Dinner'],
    mapUrl: 'https://maps.google.com/?q=Burger+Factory+Greater+Kailash+New+Delhi'
  }
];

export const reviews = [
  {
    name: 'Priya Sharma',
    location: 'Anjuna',
    rating: 5,
    text: 'The Chicken Brie, Bacon & Cranberry burger is genuinely one of the best plates in Goa. The potato bun stays soft to the last bite and the hand-cut wedges are seasoned properly.',
    date: 'Oct 2026'
  },
  {
    name: 'Rahul Menon',
    location: 'Morjim',
    rating: 5,
    text: 'Ordered the Beef Mango Avocado Bacon burger with crispy zucchini fries on the beach deck at sunset. Everything came out piping hot and cooked medium-well just as asked.',
    date: 'Sep 2026'
  },
  {
    name: 'Ananya Iyer',
    location: 'Dona Paula',
    rating: 5,
    text: 'Rare to find a burger kitchen where the vegetarian options aren\'t an afterthought. The Black Bean Avocado & Mango burger and the fried pickle chips are outstanding.',
    date: 'Sep 2026'
  }
];

export const locationTables = {
  'anjuna': {
    indoor: [
      { id: 'ANJ-I1', type: '2-seater', capacity: 2 },
      { id: 'ANJ-I2', type: '2-seater', capacity: 2 },
      { id: 'ANJ-I3', type: '2-seater', capacity: 2 },
      { id: 'ANJ-I4', type: '4-seater', capacity: 4 },
      { id: 'ANJ-I5', type: '4-seater', capacity: 4 },
      { id: 'ANJ-I6', type: '4-seater', capacity: 4 },
      { id: 'ANJ-I7', type: '4-seater', capacity: 4 },
      { id: 'ANJ-I8', type: '6-seater', capacity: 6 },
      { id: 'ANJ-I9', type: '6-seater', capacity: 6 }
    ],
    outdoor: [
      { id: 'ANJ-O1', type: '2-seater', capacity: 2 },
      { id: 'ANJ-O2', type: '2-seater', capacity: 2 },
      { id: 'ANJ-O3', type: '4-seater', capacity: 4 },
      { id: 'ANJ-O4', type: '4-seater', capacity: 4 },
      { id: 'ANJ-O5', type: '4-seater', capacity: 4 },
      { id: 'ANJ-O6', type: '4-seater', capacity: 4 },
      { id: 'ANJ-O7', type: '6-seater', capacity: 6 },
      { id: 'ANJ-O8', type: '8-seater', capacity: 8 },
      { id: 'ANJ-O9', type: '8-seater', capacity: 8 }
    ]
  },
  'morjim': {
    indoor: [
      { id: 'MOR-I1', type: '2-seater', capacity: 2 },
      { id: 'MOR-I2', type: '2-seater', capacity: 2 },
      { id: 'MOR-I3', type: '4-seater', capacity: 4 },
      { id: 'MOR-I4', type: '4-seater', capacity: 4 },
      { id: 'MOR-I5', type: '4-seater', capacity: 4 },
      { id: 'MOR-I6', type: '6-seater', capacity: 6 }
    ],
    beachside: [
      { id: 'MOR-B1', type: '2-seater', capacity: 2 },
      { id: 'MOR-B2', type: '2-seater', capacity: 2 },
      { id: 'MOR-B3', type: '2-seater', capacity: 2 },
      { id: 'MOR-B4', type: '4-seater', capacity: 4 },
      { id: 'MOR-B5', type: '4-seater', capacity: 4 },
      { id: 'MOR-B6', type: '4-seater', capacity: 4 },
      { id: 'MOR-B7', type: '4-seater', capacity: 4 },
      { id: 'MOR-B8', type: '4-seater', capacity: 4 },
      { id: 'MOR-B9', type: '6-seater', capacity: 6 },
      { id: 'MOR-B10', type: '6-seater', capacity: 6 },
      { id: 'MOR-B11', type: '6-seater', capacity: 6 },
      { id: 'MOR-B12', type: '8-seater', capacity: 8 },
      { id: 'MOR-B13', type: '8-seater', capacity: 8 },
      { id: 'MOR-B14', type: '8-seater', capacity: 8 }
    ]
  },
  'vagator': {
    indoor: [
      { id: 'VAG-I1', type: '2-seater', capacity: 2 },
      { id: 'VAG-I2', type: '2-seater', capacity: 2 },
      { id: 'VAG-I3', type: '4-seater', capacity: 4 },
      { id: 'VAG-I4', type: '4-seater', capacity: 4 },
      { id: 'VAG-I5', type: '4-seater', capacity: 4 },
      { id: 'VAG-I6', type: '6-seater', capacity: 6 }
    ],
    outdoor: [
      { id: 'VAG-O1', type: '2-seater', capacity: 2 },
      { id: 'VAG-O2', type: '4-seater', capacity: 4 },
      { id: 'VAG-O3', type: '4-seater', capacity: 4 },
      { id: 'VAG-O4', type: '4-seater', capacity: 4 },
      { id: 'VAG-O5', type: '4-seater', capacity: 4 },
      { id: 'VAG-O6', type: '6-seater', capacity: 6 },
      { id: 'VAG-O7', type: '6-seater', capacity: 6 },
      { id: 'VAG-O8', type: '8-seater', capacity: 8 }
    ]
  },
  'nerul': {
    indoor: [
      { id: 'NER-I1', type: '2-seater', capacity: 2 },
      { id: 'NER-I2', type: '2-seater', capacity: 2 },
      { id: 'NER-I3', type: '4-seater', capacity: 4 },
      { id: 'NER-I4', type: '4-seater', capacity: 4 },
      { id: 'NER-I5', type: '4-seater', capacity: 4 },
      { id: 'NER-I6', type: '4-seater', capacity: 4 },
      { id: 'NER-I7', type: '6-seater', capacity: 6 },
      { id: 'NER-I8', type: '6-seater', capacity: 6 },
      { id: 'NER-I9', type: '8-seater', capacity: 8 },
      { id: 'NER-I10', type: '8-seater', capacity: 8 }
    ]
  },
  'dona-paula': {
    indoor: [
      { id: 'DP-I1', type: '2-seater', capacity: 2 },
      { id: 'DP-I2', type: '2-seater', capacity: 2 },
      { id: 'DP-I3', type: '4-seater', capacity: 4 },
      { id: 'DP-I4', type: '4-seater', capacity: 4 },
      { id: 'DP-I5', type: '6-seater', capacity: 6 }
    ],
    outdoor: [
      { id: 'DP-O1', type: '2-seater', capacity: 2 },
      { id: 'DP-O2', type: '4-seater', capacity: 4 },
      { id: 'DP-O3', type: '4-seater', capacity: 4 },
      { id: 'DP-O4', type: '4-seater', capacity: 4 },
      { id: 'DP-O5', type: '6-seater', capacity: 6 },
      { id: 'DP-O6', type: '6-seater', capacity: 6 },
      { id: 'DP-O7', type: '8-seater', capacity: 8 }
    ]
  },
  'panaji': {
    indoor: [
      { id: 'PNJ-I1', type: '2-seater', capacity: 2 },
      { id: 'PNJ-I2', type: '2-seater', capacity: 2 },
      { id: 'PNJ-I3', type: '2-seater', capacity: 2 },
      { id: 'PNJ-I4', type: '4-seater', capacity: 4 },
      { id: 'PNJ-I5', type: '4-seater', capacity: 4 },
      { id: 'PNJ-I6', type: '4-seater', capacity: 4 },
      { id: 'PNJ-I7', type: '4-seater', capacity: 4 },
      { id: 'PNJ-I8', type: '4-seater', capacity: 4 },
      { id: 'PNJ-I9', type: '6-seater', capacity: 6 },
      { id: 'PNJ-I10', type: '6-seater', capacity: 6 },
      { id: 'PNJ-I11', type: '6-seater', capacity: 6 },
      { id: 'PNJ-I12', type: '8-seater', capacity: 8 },
      { id: 'PNJ-I13', type: '8-seater', capacity: 8 },
      { id: 'PNJ-I14', type: '8-seater', capacity: 8 },
      { id: 'PNJ-I15', type: '8-seater', capacity: 8 },
      { id: 'PNJ-I16', type: '10-seater', capacity: 10 }
    ]
  },
  'delhi': {
    indoor: [
      { id: 'DEL-I1', type: '2-seater', capacity: 2 },
      { id: 'DEL-I2', type: '2-seater', capacity: 2 },
      { id: 'DEL-I3', type: '2-seater', capacity: 2 },
      { id: 'DEL-I4', type: '4-seater', capacity: 4 },
      { id: 'DEL-I5', type: '4-seater', capacity: 4 },
      { id: 'DEL-I6', type: '4-seater', capacity: 4 },
      { id: 'DEL-I7', type: '4-seater', capacity: 4 },
      { id: 'DEL-I8', type: '6-seater', capacity: 6 },
      { id: 'DEL-I9', type: '6-seater', capacity: 6 },
      { id: 'DEL-I10', type: '6-seater', capacity: 6 }
    ],
    outdoor: [
      { id: 'DEL-R1', type: '2-seater', capacity: 2 },
      { id: 'DEL-R2', type: '2-seater', capacity: 2 },
      { id: 'DEL-R3', type: '4-seater', capacity: 4 },
      { id: 'DEL-R4', type: '4-seater', capacity: 4 },
      { id: 'DEL-R5', type: '4-seater', capacity: 4 },
      { id: 'DEL-R6', type: '4-seater', capacity: 4 },
      { id: 'DEL-R7', type: '6-seater', capacity: 6 },
      { id: 'DEL-R8', type: '6-seater', capacity: 6 },
      { id: 'DEL-R9', type: '8-seater', capacity: 8 },
      { id: 'DEL-R10', type: '8-seater', capacity: 8 }
    ]
  }
};

export const timeSlots = [
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00', '22:30'
];

// ---- Derived facts: ONE source of truth (fixes card/seat-count mismatches and slot/opening-hours mismatches) ----
const LAST_SEATING_BEFORE_CLOSE_MIN = 30;

export function parseOutletHours(hoursText) {
  const m = String(hoursText || '').match(/(\d+):(\d+)\s*(AM|PM)\s*[\u2013-]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  const f = (h, mi, ap) => ((Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(mi);
  return { open: f(m[1], m[2], m[3]), close: f(m[4], m[5], m[6]) };
}

/** Bookable slots for one outlet: from opening time to (closing - 30 min). */
export function slotsForLocation(locationId) {
  const loc = locations.find(l => l.id === locationId);
  const h = loc ? parseOutletHours(loc.hours) : null;
  if (!h) return timeSlots.slice();
  return timeSlots.filter(t => {
    const [hh, mm] = t.split(':').map(Number);
    const x = hh * 60 + mm;
    return x >= h.open && x <= h.close - LAST_SEATING_BEFORE_CLOSE_MIN;
  });
}

for (const loc of locations) {
  const tables = Object.values(locationTables[loc.id] || {}).flat();
  loc.tables = tables.length;
  loc.capacity = tables.reduce((sum, t) => sum + t.capacity, 0);
}
