// Fills an empty database with made-up example businesses and events so you can
// see how the calendar looks. Run: node seed-demo.js
// Delete data/calendar.db afterwards to start clean with real events.
const { db, uniqueSlug } = require('./db');

if (db.prepare('SELECT COUNT(*) AS n FROM businesses').get().n > 0) {
  console.log('Database already has businesses; not adding demo data.');
  process.exit(0);
}

const year = new Date().getFullYear();
const businesses = [
  {
    name: 'Heritage Railway',
    colour: '#8a3b2e',
    description: 'Volunteer-run steam railway with trains through the valley on most weekends.',
    address: 'Station Yard, High Street',
    website: 'https://example.com/railway',
    phone: '01234 567890',
    opening_times: 'Trains run weekends March to October, 10:30–16:30\nBooking office opens 10:00 on running days',
    faq: 'Can I bring my dog?\nYes, well-behaved dogs on a lead travel free.\n\nIs there parking?\nFree parking in the station car park.\n\nIs the train accessible?\nOne carriage on every train has wheelchair space. Please tell us when booking.',
    events: [
      { title: 'Spring Steam Gala', start_date: `${year}-04-18`, end_date: `${year}-04-19`, start_time: '10:00', end_time: '17:00', price: 'Adults £18, children £9', location: 'Station Yard', description: 'Four engines in steam, brake-van rides and the model railway in the goods shed.', ticket_url: 'https://example.com/tickets' },
      { title: 'Santa Specials', start_date: `${year}-12-05`, start_time: '10:00', end_time: '15:00', repeat: 'weekly', repeat_until: `${year}-12-20`, price: '£15 per person, includes a present for children', description: 'A festive trip up the line to meet Father Christmas. Booking essential.', ticket_url: 'https://example.com/santa' },
      { title: 'Fish & Chip Express', start_date: `${year}-06-12`, start_time: '18:30', end_time: '21:00', price: '£28', description: 'Evening train with fish and chips served on board.', ticket_url: 'https://example.com/tickets' },
    ],
  },
  {
    name: 'The Pizza Box',
    colour: '#d17a22',
    description: 'Wood-fired pizza van serving round the villages.',
    website: 'https://example.com/pizzabox',
    opening_times: 'Fridays 17:00–21:00 on the Market Square\nOther dates as listed on the calendar',
    faq: 'Can I pre-order?\nYes, text your order to the number on the van from 4pm.\n\nDo you do gluten-free?\nYes, gluten-free bases are £1 extra.',
    events: [
      { title: 'Pizza night on the Market Square', start_date: `${year}-01-02`, start_time: '17:00', end_time: '21:00', repeat: 'weekly', location: 'Market Square', description: 'Wood-fired pizzas to take away.' },
      { title: 'Pizza Box at the 1940s Weekend', start_date: `${year}-08-22`, end_date: `${year}-08-23`, start_time: '11:00', end_time: '19:00', location: 'Recreation Ground' },
    ],
  },
  {
    name: '1940s Weekend',
    colour: '#3d5a80',
    description: 'The town goes back in time for a weekend of music, dancing, vehicles and re-enactors.',
    website: 'https://example.com/1940s',
    opening_times: 'Saturday and Sunday, 10:00–18:00\nEvening dance on Saturday from 19:30',
    faq: 'Do I have to dress up?\nNot at all, but lots of people do.\n\nWhere do I park?\nPark and ride from the leisure centre, £3 per car.',
    events: [
      { title: '1940s Weekend', start_date: `${year}-08-22`, end_date: `${year}-08-23`, start_time: '10:00', end_time: '18:00', location: 'Town centre and Recreation Ground', price: 'Free entry', description: 'Military vehicles, swing bands, vintage market and a flypast on Sunday at 14:00.', info_url: 'https://example.com/1940s' },
      { title: 'Victory Dance', start_date: `${year}-08-22`, start_time: '19:30', end_time: '23:00', location: 'Town Hall', price: '£12', ticket_url: 'https://example.com/dance' },
    ],
  },
  {
    name: 'Town Council',
    colour: '#2f6f4f',
    description: 'Monthly meetings are open to the public. Agendas are published a week before.',
    address: 'Town Hall, Market Square',
    opening_times: 'Town Hall office: Mon–Thu 9:30–13:00',
    events: [
      { title: 'Town Council meeting', start_date: `${year}-01-14`, start_time: '19:00', end_time: '21:00', repeat: 'monthly', location: 'Town Hall', description: 'Public question time at the start of each meeting.' },
      { title: 'Christmas lights switch-on', start_date: `${year}-11-28`, start_time: '16:00', end_time: '18:30', location: 'Market Square', price: 'Free' },
    ],
  },
];

const insertBiz = db.prepare(
  'INSERT INTO businesses (name, slug, colour, description, address, website, phone, opening_times, faq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertEvent = db.prepare(
  `INSERT INTO events (business_id, title, description, location, start_date, end_date, start_time, end_time, price, ticket_url, info_url, repeat, repeat_until)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

for (const b of businesses) {
  const { lastInsertRowid } = insertBiz.run(b.name, uniqueSlug(b.name), b.colour, b.description || '', b.address || '', b.website || '', b.phone || '', b.opening_times || '', b.faq || '');
  for (const e of b.events) {
    insertEvent.run(
      lastInsertRowid, e.title, e.description || '', e.location || '', e.start_date, e.end_date || null,
      e.start_time || '', e.end_time || '', e.price || '', e.ticket_url || '', e.info_url || '', e.repeat || 'none', e.repeat_until || null
    );
  }
}
console.log(`Added ${businesses.length} example businesses with events for ${year}.`);
