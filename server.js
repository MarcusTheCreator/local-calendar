// Local events calendar: a small web server with no dependencies beyond Node 22.5+.
//   node server.js                      start the site (PORT defaults to 3000)
//   node server.js create-admin EMAIL   create or reset an admin login
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, checkPassword, uniqueSlug, getSettings } = require('./db');
const { daysForYear } = require('./occurrences');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';

// ---------- helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected JSON');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, maxAge) {
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE_COOKIES ? '; Secure' : ''}`;
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.business_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in');
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  return user;
}

const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isUrl = (v) => v === '' || /^https?:\/\/\S+$/i.test(v);
const isColour = (v) => /^#[0-9a-f]{6}$/i.test(v);

function cleanEvent(body) {
  const ev = {
    title: str(body.title, 200),
    description: str(body.description),
    location: str(body.location, 300),
    start_date: str(body.start_date, 10),
    end_date: str(body.end_date, 10) || null,
    start_time: str(body.start_time, 5),
    end_time: str(body.end_time, 5),
    price: str(body.price, 100),
    ticket_url: str(body.ticket_url, 1000),
    info_url: str(body.info_url, 1000),
    repeat: str(body.repeat, 20) || 'none',
    repeat_until: str(body.repeat_until, 10) || null,
  };
  if (!ev.title) throw new HttpError(400, 'Please give the event a title');
  if (!isDate(ev.start_date)) throw new HttpError(400, 'Please choose a start date');
  if (ev.end_date && !isDate(ev.end_date)) throw new HttpError(400, 'End date is not valid');
  if (ev.end_date && ev.end_date < ev.start_date) throw new HttpError(400, 'End date is before the start date');
  if (ev.end_date === ev.start_date) ev.end_date = null;
  if (!isTime(ev.start_time) || !isTime(ev.end_time)) throw new HttpError(400, 'Times should look like 14:30');
  if (!isUrl(ev.ticket_url) || !isUrl(ev.info_url)) throw new HttpError(400, 'Links must start with http:// or https://');
  if (!['none', 'weekly', 'fortnightly', 'monthly'].includes(ev.repeat)) throw new HttpError(400, 'Unknown repeat option');
  if (ev.repeat === 'none') ev.repeat_until = null;
  if (ev.repeat_until && !isDate(ev.repeat_until)) throw new HttpError(400, 'Repeat-until date is not valid');
  return ev;
}

function cleanBusiness(body) {
  const b = {
    name: str(body.name, 120),
    colour: str(body.colour, 7) || '#2f6f4f',
    description: str(body.description),
    address: str(body.address, 300),
    website: str(body.website, 1000),
    phone: str(body.phone, 50),
    opening_times: str(body.opening_times),
    faq: str(body.faq, 20000),
  };
  if (!b.name) throw new HttpError(400, 'Please give the business a name');
  if (!isColour(b.colour)) throw new HttpError(400, 'Colour should look like #2f6f4f');
  if (!isUrl(b.website)) throw new HttpError(400, 'Website must start with http:// or https://');
  return b;
}

const EVENT_COLUMNS = Object.keys(cleanEvent({ title: 'x', start_date: '2000-01-01' }));
const BUSINESS_COLUMNS = Object.keys(cleanBusiness({ name: 'x' }));

function publicBusinesses() {
  return db
    .prepare(
      `SELECT id, name, slug, colour, description, address, website, phone, opening_times, faq
       FROM businesses ORDER BY name COLLATE NOCASE`
    )
    .all();
}

// The whole year in one response: small enough for a local calendar and lets
// the page switch days instantly.
function yearData(year) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const events = db
    .prepare(
      `SELECT * FROM events
       WHERE start_date <= ?
         AND (repeat != 'none' AND (repeat_until IS NULL OR repeat_until >= ?)
              OR COALESCE(end_date, start_date) >= ?)`
    )
    .all(to, from, from);
  const days = daysForYear(events, year);
  const used = new Set(Object.values(days).flat());
  const s = getSettings();
  return {
    year,
    site: { name: s.site_name, tagline: s.tagline, faq: s.faq, footer: s.footer },
    businesses: publicBusinesses(),
    events: events.filter((e) => used.has(e.id)),
    days,
  };
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/year\/(\d{4})$/, (req, res, [year]) => {
  const y = Number(year);
  if (y < 2000 || y > 2100) throw new HttpError(400, 'Year out of range');
  json(res, 200, yearData(y));
});

route('POST', /^\/api\/login$/, async (req, res) => {
  const body = await readJson(req);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(str(body.email, 200));
  if (!user || !checkPassword(String(body.password || ''), user.password_hash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    Date.now() + SESSION_DAYS * 86400000
  );
  json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
});

route('POST', /^\/api\/logout$/, (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
});

route('GET', /^\/api\/me$/, (req, res) => {
  const user = requireUser(req);
  const businesses =
    user.role === 'admin'
      ? publicBusinesses()
      : publicBusinesses().filter((b) => b.id === user.business_id);
  json(res, 200, {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, business_id: user.business_id },
    businesses,
    settings: user.role === 'admin' ? getSettings() : undefined,
  });
});

route('POST', /^\/api\/password$/, async (req, res) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const full = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!checkPassword(String(body.current || ''), full.password_hash)) throw new HttpError(400, 'Current password is wrong');
  if (String(body.password || '').length < 8) throw new HttpError(400, 'New password needs at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), user.id);
  json(res, 200, { ok: true });
});

// Events a signed-in user may manage: their own business's, or all for admins.
function canEditBusiness(user, businessId) {
  return user.role === 'admin' || user.business_id === businessId;
}

route('GET', /^\/api\/manage\/events$/, (req, res) => {
  const user = requireUser(req);
  const rows =
    user.role === 'admin'
      ? db.prepare('SELECT * FROM events ORDER BY start_date DESC').all()
      : db.prepare('SELECT * FROM events WHERE business_id = ? ORDER BY start_date DESC').all(user.business_id);
  json(res, 200, rows);
});

route('POST', /^\/api\/manage\/events$/, async (req, res) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const businessId = user.role === 'admin' ? Number(body.business_id) : user.business_id;
  if (!db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(businessId)) throw new HttpError(400, 'Choose a business');
  const ev = cleanEvent(body);
  const cols = ['business_id', ...EVENT_COLUMNS];
  const info = db
    .prepare(`INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(businessId, ...EVENT_COLUMNS.map((c) => ev[c]));
  json(res, 201, { id: Number(info.lastInsertRowid) });
});

route('PUT', /^\/api\/manage\/events\/(\d+)$/, async (req, res, [id]) => {
  const user = requireUser(req);
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
  if (!existing || !canEditBusiness(user, existing.business_id)) throw new HttpError(404, 'Event not found');
  const body = await readJson(req);
  const ev = cleanEvent(body);
  let businessId = existing.business_id;
  if (user.role === 'admin' && body.business_id) {
    businessId = Number(body.business_id);
    if (!db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(businessId)) throw new HttpError(400, 'Choose a business');
  }
  db.prepare(`UPDATE events SET business_id = ?, ${EVENT_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    businessId,
    ...EVENT_COLUMNS.map((c) => ev[c]),
    existing.id
  );
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/manage\/events\/(\d+)$/, (req, res, [id]) => {
  const user = requireUser(req);
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
  if (!existing || !canEditBusiness(user, existing.business_id)) throw new HttpError(404, 'Event not found');
  db.prepare('DELETE FROM events WHERE id = ?').run(existing.id);
  json(res, 200, { ok: true });
});

route('PUT', /^\/api\/manage\/businesses\/(\d+)$/, async (req, res, [id]) => {
  const user = requireUser(req);
  const businessId = Number(id);
  if (!canEditBusiness(user, businessId) || !db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(businessId)) {
    throw new HttpError(404, 'Business not found');
  }
  const b = cleanBusiness(await readJson(req));
  db.prepare(`UPDATE businesses SET slug = ?, ${BUSINESS_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    uniqueSlug(b.name, businessId),
    ...BUSINESS_COLUMNS.map((c) => b[c]),
    businessId
  );
  json(res, 200, { ok: true });
});

// ----- admin only -----

route('POST', /^\/api\/admin\/businesses$/, async (req, res) => {
  requireAdmin(req);
  const b = cleanBusiness(await readJson(req));
  const cols = ['slug', ...BUSINESS_COLUMNS];
  const info = db
    .prepare(`INSERT INTO businesses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(uniqueSlug(b.name), ...BUSINESS_COLUMNS.map((c) => b[c]));
  json(res, 201, { id: Number(info.lastInsertRowid) });
});

route('DELETE', /^\/api\/admin\/businesses\/(\d+)$/, (req, res, [id]) => {
  requireAdmin(req);
  db.prepare('DELETE FROM businesses WHERE id = ?').run(Number(id));
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/admin\/users$/, (req, res) => {
  requireAdmin(req);
  json(res, 200, db.prepare('SELECT id, email, name, role, business_id FROM users ORDER BY role, email').all());
});

route('POST', /^\/api\/admin\/users$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  const email = str(body.email, 200).toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'business';
  const businessId = role === 'business' ? Number(body.business_id) : null;
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Please enter a valid email');
  if (role === 'business' && !db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(businessId)) {
    throw new HttpError(400, 'Choose which business this login is for');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(400, 'That email already has a login');
  const password = String(body.password || '') || crypto.randomBytes(6).toString('base64url');
  if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters');
  db.prepare('INSERT INTO users (email, name, password_hash, role, business_id) VALUES (?, ?, ?, ?, ?)').run(
    email,
    str(body.name, 120),
    hashPassword(password),
    role,
    businessId
  );
  json(res, 201, { email, password });
});

route('POST', /^\/api\/admin\/users\/(\d+)\/reset$/, (req, res, [id]) => {
  requireAdmin(req);
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(id));
  if (!user) throw new HttpError(404, 'User not found');
  const password = crypto.randomBytes(6).toString('base64url');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  json(res, 200, { email: user.email, password });
});

route('DELETE', /^\/api\/admin\/users\/(\d+)$/, (req, res, [id]) => {
  const me = requireAdmin(req);
  if (Number(id) === me.id) throw new HttpError(400, "You can't delete your own login");
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(id));
  json(res, 200, { ok: true });
});

route('PUT', /^\/api\/admin\/settings$/, async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const key of ['site_name', 'tagline', 'faq', 'footer']) {
    if (key in body) update.run(str(body[key], 20000), key);
  }
  json(res, 200, { ok: true });
});

// ---------- static files ----------

const PAGES = { '/': 'index.html', '/login': 'login.html', '/dashboard': 'dashboard.html' };

function serveStatic(req, res, pathname) {
  const file = PAGES[pathname] || pathname.slice(1);
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    send(res, 200, req.method === 'HEAD' ? '' : data, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'same-origin',
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && pathname.match(r.pattern);
        if (m) return await r.handler(req, res, m.slice(1));
      }
      throw new HttpError(404, 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Something went wrong' });
  }
});

// ---------- command line ----------

function createAdmin(email) {
  const password = crypto.randomBytes(9).toString('base64url');
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin', business_id = NULL WHERE id = ?").run(
      hashPassword(password),
      existing.id
    );
  } else {
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Admin', ?, 'admin')").run(
      email,
      hashPassword(password)
    );
  }
  console.log(`Admin login: ${email}\nPassword:    ${password}\n(Change it after signing in.)`);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'create-admin') {
    if (!arg) {
      console.error('Usage: node server.js create-admin you@example.com');
      process.exit(1);
    }
    createAdmin(arg.toLowerCase());
  } else {
    if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
      console.log('No admin yet. Run: node server.js create-admin you@example.com');
    }
    server.listen(PORT, () => console.log(`Calendar running at http://localhost:${PORT}`));
  }
}

module.exports = { server, yearData };
