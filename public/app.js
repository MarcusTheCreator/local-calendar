// Public calendar page: a year of months on one screen; click a day to see what's on.
(() => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const $ = (id) => document.getElementById(id);

  // Tiny DOM builder: h('a', { href }, 'text', child). Text is always escaped.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const now = new Date();
  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

  function longDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function timeRange(ev) {
    if (!ev.start_time) return 'All day';
    return ev.end_time ? `${ev.start_time} – ${ev.end_time}` : ev.start_time;
  }

  // "Question line, then answer lines; blank line between questions."
  function parseFaq(text) {
    return String(text || '')
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const [q, ...rest] = block.split('\n');
        return { q: q.trim(), a: rest.join('\n').trim() };
      });
  }
  function faqList(text) {
    const items = parseFaq(text);
    if (!items.length) return h('p', { class: 'muted' }, 'No questions yet.');
    return h('div', { class: 'faq' }, items.map((it) => h('details', {}, h('summary', {}, it.q), it.a && h('p', {}, it.a))));
  }

  // ---------- data ----------
  const cache = new Map();
  let year = Number(new URLSearchParams(location.search).get('year')) || now.getFullYear();
  let data = null;
  let bizById = new Map();
  let eventById = new Map();

  async function load(y) {
    if (cache.has(y)) return cache.get(y);
    let d;
    if (window.CALENDAR_DATA) {
      // Static preview build: data is embedded in the page.
      d = window.CALENDAR_DATA[y] || { ...window.CALENDAR_DATA[Object.keys(window.CALENDAR_DATA)[0]], year: y, events: [], days: {} };
    } else {
      const res = await fetch(`/api/year/${y}`);
      if (!res.ok) throw new Error('Could not load the calendar');
      d = await res.json();
    }
    cache.set(y, d);
    return d;
  }

  async function show(y) {
    year = y;
    $('year-title').textContent = y;
    try {
      data = await load(y);
    } catch (e) {
      $('year').replaceChildren(h('p', { class: 'error' }, e.message));
      return;
    }
    bizById = new Map(data.businesses.map((b) => [b.id, b]));
    eventById = new Map(data.events.map((e) => [e.id, e]));
    applySite();
    renderYear();
    renderUpcoming();
    renderBusinesses();
    // Fetch neighbours quietly so flipping years is instant.
    load(y + 1).catch(() => {});
  }

  function applySite() {
    const s = data.site;
    $('site-name').textContent = s.name;
    $('tagline').textContent = s.tagline;
    document.title = s.name;
    $('footer').textContent = s.footer || `${s.name} · Click any day to see what's on.`;
    $('site-faq').replaceChildren(faqList(s.faq));
  }

  // ---------- year grid ----------
  function renderYear() {
    const frag = document.createDocumentFragment();
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const offset = (first.getDay() + 6) % 7; // Monday first
      const daysIn = new Date(year, m + 1, 0).getDate();
      const cells = DOW.map((d) => h('div', { class: 'dow', 'aria-hidden': 'true' }, d[0]));
      for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'empty' }));
      for (let d = 1; d <= daysIn; d++) {
        const key = iso(year, m, d);
        const ids = data.days[key] || [];
        const dow = (offset + d - 1) % 7;
        const colours = [...new Set(ids.map((id) => bizById.get(eventById.get(id)?.business_id)?.colour || 'var(--accent)'))].slice(0, 3);
        const cls = ['day', dow >= 5 && 'weekend', key === todayIso && 'today', key < todayIso && 'past', ids.length && 'has-events']
          .filter(Boolean)
          .join(' ');
        const label = `${longDate(key)}${ids.length ? `, ${ids.length} event${ids.length > 1 ? 's' : ''}` : ''}`;
        cells.push(
          h(
            'button',
            { class: cls, 'aria-label': label, 'data-date': key, onclick: () => openDay(key) },
            h('span', { class: 'num' }, d),
            h('span', { class: 'dots' }, colours.map((c) => h('i', { style: `background:${c}` })))
          )
        );
      }
      const isCurrent = year === now.getFullYear() && m === now.getMonth();
      frag.append(h('div', { class: `month${isCurrent ? ' current' : ''}`, id: `m${m}` }, h('h3', {}, MONTHS[m]), h('div', { class: 'grid' }, cells)));
    }
    $('year').replaceChildren(frag);
  }

  // ---------- event rendering ----------
  function eventCard(ev, dateIso) {
    const biz = bizById.get(ev.business_id);
    const ticket = safeUrl(ev.ticket_url);
    const info = safeUrl(ev.info_url);
    let span = '';
    if (ev.end_date && ev.repeat === 'none') span = `${shortDate(ev.start_date)} to ${shortDate(ev.end_date)}`;
    const repeatText = { weekly: 'Every week', fortnightly: 'Every two weeks', monthly: 'Every month' }[ev.repeat];
    return h(
      'article',
      { class: 'event', style: biz ? `--c:${biz.colour}` : null },
      dateIso && h('div', { class: 'when' }, dateIso === todayIso ? 'Today' : shortDate(dateIso)),
      h('h3', {}, ev.title),
      h(
        'div',
        { class: 'meta' },
        h('span', {}, timeRange(ev)),
        ev.location && h('span', {}, ev.location),
        ev.price && h('span', {}, ev.price),
        span && h('span', {}, span),
        repeatText && h('span', {}, repeatText)
      ),
      ev.description && h('p', {}, ev.description),
      h(
        'div',
        { class: 'actions' },
        ticket && h('a', { class: 'btn primary', href: ticket, target: '_blank', rel: 'noopener' }, 'Tickets'),
        info && h('a', { class: 'btn', href: info, target: '_blank', rel: 'noopener' }, 'More info'),
        biz && h('button', { class: 'btn', onclick: () => openBusiness(biz.id) }, h('span', { class: 'chip' }, h('i', { style: `background:${biz.colour}` }), biz.name))
      )
    );
  }

  // ---------- dialog ----------
  const dialog = $('dialog');
  $('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  function openDialog(title, sub, body) {
    $('dialog-title').textContent = title;
    $('dialog-sub').replaceChildren(sub || '');
    $('dialog-body').replaceChildren(body);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }

  function openDay(dateIso) {
    const ids = data.days[dateIso] || [];
    const body = ids.length
      ? h('div', {}, ids.map((id) => eventCard(eventById.get(id))))
      : h('p', { class: 'muted' }, 'Nothing listed for this day yet.');
    openDialog(longDate(dateIso), ids.length ? `${ids.length} event${ids.length > 1 ? 's' : ''}` : '', body);
    history.replaceState(null, '', `#day=${dateIso}`);
  }

  function businessDetails(biz) {
    const site = safeUrl(biz.website);
    return h(
      'div',
      {},
      biz.description && h('p', { class: 'pre' }, biz.description),
      biz.address && [h('div', { class: 'label' }, 'Address'), h('div', { class: 'pre' }, biz.address)],
      biz.phone && [h('div', { class: 'label' }, 'Phone'), h('a', { href: `tel:${biz.phone.replace(/\s/g, '')}` }, biz.phone)],
      site && [h('div', { class: 'label' }, 'Website'), h('a', { href: site, target: '_blank', rel: 'noopener' }, site.replace(/^https?:\/\//, ''))],
      biz.opening_times && [h('div', { class: 'label' }, 'Opening times'), h('div', { class: 'pre' }, biz.opening_times)],
      biz.faq && [h('div', { class: 'label' }, 'Questions'), faqList(biz.faq)]
    );
  }

  function openBusiness(id) {
    const biz = bizById.get(id);
    if (!biz) return;
    openDialog(biz.name, '', businessDetails(biz));
  }

  // ---------- coming up ----------
  function renderUpcoming() {
    const out = [];
    const start = year === now.getFullYear() ? todayIso : `${year}-01-01`;
    for (const key of Object.keys(data.days).sort()) {
      if (key < start) continue;
      for (const id of data.days[key]) {
        // Show multi-day and repeating events once, on their next day.
        if (out.some((o) => o.id === id)) continue;
        out.push({ id, key });
      }
      if (out.length >= 6) break;
    }
    $('upcoming').replaceChildren(
      ...(out.length
        ? out.slice(0, 6).map((o) => h('div', { class: 'card' }, eventCard(eventById.get(o.id), o.key)))
        : [h('p', { class: 'muted' }, 'No upcoming events listed yet.')])
    );
  }

  function renderBusinesses() {
    $('biz-list').replaceChildren(
      ...(data.businesses.length
        ? data.businesses.map((b) =>
            h('div', { class: 'card biz', id: `biz-${b.slug}` }, h('h3', {}, h('i', { style: `background:${b.colour}` }), b.name), businessDetails(b))
          )
        : [h('p', { class: 'muted' }, 'No businesses listed yet.')])
    );
  }

  // ---------- views ----------
  function route() {
    const hash = location.hash.slice(1);
    const view = ['businesses', 'faq'].includes(hash) ? hash : 'calendar';
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== view));
    document.querySelectorAll('nav.main [data-view]').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const m = hash.match(/^day=(\d{4})-\d{2}-\d{2}$/);
    if (m) {
      const target = hash.slice(4);
      const y = Number(m[1]);
      (y === year && data ? Promise.resolve() : show(y)).then(() => openDay(target));
    }
  }
  window.addEventListener('hashchange', route);
  dialog.addEventListener('close', () => {
    if (location.hash.startsWith('#day=')) history.replaceState(null, '', location.pathname + location.search);
  });

  $('prev-year').addEventListener('click', () => show(year - 1));
  $('next-year').addEventListener('click', () => show(year + 1));
  $('today-btn').addEventListener('click', async () => {
    if (year !== now.getFullYear()) await show(now.getFullYear());
    document.getElementById(`m${now.getMonth()}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  if (window.CALENDAR_DATA) $('login-link').remove();

  show(year).then(() => {
    route();
    // On phones the year is a long scroll, so start at this month.
    if (!location.hash && year === now.getFullYear() && matchMedia('(max-width: 520px)').matches) {
      document.getElementById(`m${now.getMonth()}`)?.scrollIntoView({ block: 'start' });
    }
  });
})();
