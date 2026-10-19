// Database setup and helpers. Uses Node's built-in SQLite (Node 22.5+), so there
// are no packages to install.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'calendar.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  colour TEXT NOT NULL DEFAULT '#2f6f4f',
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  opening_times TEXT NOT NULL DEFAULT '',
  faq TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'business')),
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  info_url TEXT NOT NULL DEFAULT '',
  repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'weekly', 'fortnightly', 'monthly')),
  repeat_until TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const DEFAULT_SETTINGS = {
  site_name: 'Worth Valley Calendar',
  tagline: "What's on in the Worth Valley, all year round",
  faq: 'How do I get my events listed?\nAsk the site admin for a business login, then add events from your dashboard.\n\nAre the events free?\nEach event shows its own price and ticket link where there is one.',
  footer: '',
};
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'business';
}

function uniqueSlug(name, exceptId = 0) {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; db.prepare('SELECT 1 FROM businesses WHERE slug = ? AND id != ?').get(slug, exceptId); n++) {
    slug = `${base}-${n}`;
  }
  return slug;
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

module.exports = { db, hashPassword, checkPassword, uniqueSlug, getSettings };
