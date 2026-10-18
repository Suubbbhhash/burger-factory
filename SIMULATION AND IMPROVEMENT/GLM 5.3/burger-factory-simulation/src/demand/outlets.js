// ============================================
// SIMULATION — OUTLET WORLD MODEL
// Verbatim replica of src/js/data.js `locationTables`
// (110 tables, 7 outlets) + TIME_SLOTS + the
// locationName strings produced by booking.js
// getLocationName(). The simulator's ground truth
// for tables comes from HERE (single source).
// ============================================

const RAW_TABLES = {
  anjuna: {
    indoor: [['ANJ-I1', 2], ['ANJ-I2', 2], ['ANJ-I3', 2], ['ANJ-I4', 4], ['ANJ-I5', 4], ['ANJ-I6', 4], ['ANJ-I7', 4], ['ANJ-I8', 6], ['ANJ-I9', 6]],
    outdoor: [['ANJ-O1', 2], ['ANJ-O2', 2], ['ANJ-O3', 4], ['ANJ-O4', 4], ['ANJ-O5', 4], ['ANJ-O6', 4], ['ANJ-O7', 6], ['ANJ-O8', 8], ['ANJ-O9', 8]]
  },
  morjim: {
    indoor: [['MOR-I1', 2], ['MOR-I2', 2], ['MOR-I3', 4], ['MOR-I4', 4], ['MOR-I5', 4], ['MOR-I6', 6]],
    beachside: [['MOR-B1', 2], ['MOR-B2', 2], ['MOR-B3', 2], ['MOR-B4', 4], ['MOR-B5', 4], ['MOR-B6', 4], ['MOR-B7', 4], ['MOR-B8', 4], ['MOR-B9', 6], ['MOR-B10', 6], ['MOR-B11', 6], ['MOR-B12', 8], ['MOR-B13', 8], ['MOR-B14', 8]]
  },
  vagator: {
    indoor: [['VAG-I1', 2], ['VAG-I2', 2], ['VAG-I3', 4], ['VAG-I4', 4], ['VAG-I5', 4], ['VAG-I6', 6]],
    outdoor: [['VAG-O1', 2], ['VAG-O2', 4], ['VAG-O3', 4], ['VAG-O4', 4], ['VAG-O5', 4], ['VAG-O6', 6], ['VAG-O7', 6], ['VAG-O8', 8]]
  },
  nerul: {
    indoor: [['NER-I1', 2], ['NER-I2', 2], ['NER-I3', 4], ['NER-I4', 4], ['NER-I5', 4], ['NER-I6', 4], ['NER-I7', 6], ['NER-I8', 6], ['NER-I9', 8], ['NER-I10', 8]]
  },
  'dona-paula': {
    indoor: [['DP-I1', 2], ['DP-I2', 2], ['DP-I3', 4], ['DP-I4', 4], ['DP-I5', 6]],
    outdoor: [['DP-O1', 2], ['DP-O2', 4], ['DP-O3', 4], ['DP-O4', 4], ['DP-O5', 6], ['DP-O6', 6], ['DP-O7', 8]]
  },
  panaji: {
    indoor: [['PNJ-I1', 2], ['PNJ-I2', 2], ['PNJ-I3', 2], ['PNJ-I4', 4], ['PNJ-I5', 4], ['PNJ-I6', 4], ['PNJ-I7', 4], ['PNJ-I8', 4], ['PNJ-I9', 6], ['PNJ-I10', 6], ['PNJ-I11', 6], ['PNJ-I12', 8], ['PNJ-I13', 8], ['PNJ-I14', 8], ['PNJ-I15', 8], ['PNJ-I16', 10]]
  },
  delhi: {
    indoor: [['DEL-I1', 2], ['DEL-I2', 2], ['DEL-I3', 2], ['DEL-I4', 4], ['DEL-I5', 4], ['DEL-I6', 4], ['DEL-I7', 4], ['DEL-I8', 6], ['DEL-I9', 6], ['DEL-I10', 6]],
    outdoor: [['DEL-R1', 2], ['DEL-R2', 2], ['DEL-R3', 4], ['DEL-R4', 4], ['DEL-R5', 4], ['DEL-R6', 4], ['DEL-R7', 6], ['DEL-R8', 6], ['DEL-R9', 8], ['DEL-R10', 8]]
  }
};

const seatType = (cap) => `${cap}-seater`;

/** Normalized: { locationId: { zone: [ {id, type, capacity, zone} ... ] } } */
export const locationTables = {};
for (const [loc, zones] of Object.entries(RAW_TABLES)) {
  locationTables[loc] = {};
  for (const [zone, rows] of Object.entries(zones)) {
    locationTables[loc][zone] = rows.map(([id, capacity]) => ({ id, type: seatType(capacity), capacity, zone }));
  }
}

/** Flat per-outlet lists + global id lookup. */
export const outletIds = Object.keys(locationTables);
export const tablesByOutlet = {};   // { loc: [table...] }
export const tableIndex = {};       // 'anjuna:ANJ-O3' -> table
for (const loc of outletIds) {
  tablesByOutlet[loc] = [];
  for (const list of Object.values(locationTables[loc])) tablesByOutlet[loc].push(...list);
  for (const t of tablesByOutlet[loc]) tableIndex[`${loc}:${t.id}`] = t;
}

export function getTable(loc, tableId) { return tableIndex[`${loc}:${tableId}`] || null; }

/** Same strings booking.js getLocationName() produces (data.js names+areas). */
export const outletNames = {
  anjuna: 'Anjuna, North Goa',
  morjim: 'Morjim, North Goa',
  vagator: 'Vagator, Bardez, Goa',
  nerul: 'Nerul, North Goa',
  'dona-paula': 'Dona Paula, Tiswadi, Goa',
  panaji: 'Panaji (La Citadel), Central Goa',
  delhi: 'New Delhi, Greater Kailash'
};

/** Same 20 slots as booking.js TIME_SLOTS. */
export const TIME_SLOTS = [
  '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
];

export const TABLE_STATS = (() => {
  const per = {};
  let totalTables = 0, totalSeats = 0;
  for (const loc of outletIds) {
    let seats = 0;
    for (const t of tablesByOutlet[loc]) seats += t.capacity;
    per[loc] = { tables: tablesByOutlet[loc].length, seats };
    totalTables += per[loc].tables; totalSeats += seats;
  }
  return { per, totalTables, totalSeats };
})();
