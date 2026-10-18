// Dashboard for business logins (their own events and details) and admins (everything).
(() => {
  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Please sign in');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  // Form field helpers.
  const field = (label, input, hint) => h('label', {}, label, input, hint && h('span', { class: 'hint' }, hint));
  const input = (name, value, attrs = {}) => h('input', { name, value: value ?? '', ...attrs });
  const textarea = (name, value, attrs = {}) => {
    const t = h('textarea', { name, ...attrs });
    t.value = value ?? '';
    return t;
  };
  const select = (name, options, value) =>
    h('select', { name }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) || null }, label)));
  // replaceChildren, skipping the false/null left by `cond && el`.
  const fill = (el, ...children) => el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  const formValues = (form) => Object.fromEntries(new FormData(form).entries());

  function formWith(children, onSubmit, submitLabel = 'Save') {
    const err = h('p', { class: 'error', role: 'alert' });
    const form = h('form', { class: 'stack' }, children, err, h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, submitLabel)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await onSubmit(formValues(form), form);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    return form;
  }

  const dialog = $('dialog');
  $('dialog-close').addEventListener('click', () => dialog.close());
  function openDialog(title, body) {
    $('dialog-title').textContent = title;
    $('dialog-body').replaceChildren(body);
    if (!dialog.open) dialog.showModal();
  }

  function shortDate(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // ---------- state ----------
  let me = null;
  let businesses = [];
  const isAdmin = () => me.role === 'admin';
  const bizName = (id) => businesses.find((b) => b.id === id)?.name || '';

  async function refreshMe() {
    const data = await api('GET', '/api/me');
    me = data.user;
    businesses = data.businesses;
    me.settings = data.settings;
  }

  // ---------- events tab ----------
  let eventFilter = 'upcoming';

  function lastDay(ev) {
    if (ev.repeat !== 'none') return ev.repeat_until || '9999-12-31';
    return ev.end_date || ev.start_date;
  }

  async function eventsTab(panel) {
    const events = await api('GET', '/api/manage/events');
    const shown = events
      .filter((ev) => (eventFilter === 'upcoming' ? lastDay(ev) >= todayIso : eventFilter === 'past' ? lastDay(ev) < todayIso : true))
      .sort((a, b) => (eventFilter === 'past' ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date)));

    const repeatText = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
    const rows = shown.map((ev) =>
      h(
        'tr',
        {},
        h(
          'td',
          {},
          shortDate(ev.start_date),
          ev.end_date && h('div', { class: 'muted' }, `to ${shortDate(ev.end_date)}`),
          ev.repeat !== 'none' && h('div', { class: 'muted' }, `${repeatText[ev.repeat]}${ev.repeat_until ? ` until ${shortDate(ev.repeat_until)}` : ''}`)
        ),
        h('td', {}, h('strong', {}, ev.title), h('div', { class: 'muted' }, ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ''}` : 'All day')),
        isAdmin() && h('td', {}, bizName(ev.business_id)),
        h(
          'td',
          { style: 'white-space:nowrap' },
          h('button', { class: 'btn', onclick: () => editEvent(ev) }, 'Edit'),
          ' ',
          h('button', { class: 'btn', onclick: () => editEvent({ ...ev, id: null }), title: 'Make a copy with a new date' }, 'Copy'),
          ' ',
          h(
            'button',
            {
              class: 'btn danger',
              onclick: async () => {
                if (!confirm(`Delete "${ev.title}"?`)) return;
                await api('DELETE', `/api/manage/events/${ev.id}`);
                render();
              },
            },
            'Delete'
          )
        )
      )
    );

    fill(
      panel,
      h(
        'div',
        { class: 'toolbar' },
        h('button', { class: 'btn primary', onclick: () => editEvent(null) }, '+ Add event'),
        h(
          'div',
          {},
          ['upcoming', 'past', 'all'].map((f) =>
            h('button', { class: `btn${f === eventFilter ? ' primary' : ''}`, style: 'margin-left:4px', onclick: () => ((eventFilter = f), render()) }, f[0].toUpperCase() + f.slice(1))
          )
        )
      ),
      !businesses.length && isAdmin() && h('p', { class: 'notice' }, 'Add a business first (Businesses tab), then you can add events for it.'),
      shown.length
        ? h(
            'div',
            { class: 'card table-wrap' },
            h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Event'), isAdmin() && h('th', {}, 'Business'), h('th', {}, ''))), h('tbody', {}, rows))
          )
        : h('p', { class: 'muted' }, eventFilter === 'upcoming' ? 'No upcoming events yet. Click "Add event" to create one.' : 'Nothing here.')
    );
  }

  function editEvent(ev) {
    const e = ev || { repeat: 'none', business_id: me.business_id || businesses[0]?.id };
    const repeatUntil = field('Repeat until', input('repeat_until', e.repeat_until, { type: 'date' }), 'Leave empty to repeat for ever');
    const repeatSel = select('repeat', [['none', 'Does not repeat'], ['weekly', 'Every week'], ['fortnightly', 'Every two weeks'], ['monthly', 'Every month (same date)']], e.repeat);
    const syncRepeat = () => (repeatUntil.hidden = repeatSel.value === 'none');
    repeatSel.addEventListener('change', syncRepeat);
    syncRepeat();

    const form = formWith(
      [
        isAdmin() && field('Business', select('business_id', businesses.map((b) => [b.id, b.name]), e.business_id)),
        field('Title', input('title', e.title, { required: true, maxlength: 200 })),
        h(
          'div',
          { class: 'row' },
          field('Date', input('start_date', e.start_date, { type: 'date', required: true })),
          field('Last day', input('end_date', e.end_date, { type: 'date' }), 'For events over several days')
        ),
        h(
          'div',
          { class: 'row' },
          field('Starts', input('start_time', e.start_time, { type: 'time' }), 'Empty = all day'),
          field('Ends', input('end_time', e.end_time, { type: 'time' }))
        ),
        h('div', { class: 'row' }, field('Repeats', repeatSel), repeatUntil),
        field('Where', input('location', e.location, { maxlength: 300 })),
        field('Price', input('price', e.price, { maxlength: 100, placeholder: 'e.g. Free, £5, Adults £12 / Kids £6' })),
        field('Description', textarea('description', e.description)),
        field('Ticket link', input('ticket_url', e.ticket_url, { type: 'url', placeholder: 'https://' })),
        field('More info link', input('info_url', e.info_url, { type: 'url', placeholder: 'https://' })),
      ],
      async (values) => {
        if (e.id) await api('PUT', `/api/manage/events/${e.id}`, values);
        else await api('POST', '/api/manage/events', values);
        dialog.close();
        render();
      },
      e.id ? 'Save changes' : 'Add event'
    );
    openDialog(e.id ? 'Edit event' : ev ? 'Copy event' : 'Add event', form);
  }

  // ---------- business tab ----------
  function businessForm(b, onSaved) {
    return formWith(
      [
        h('div', { class: 'row', style: 'grid-template-columns:1fr auto' }, field('Name', input('name', b.name, { required: true })), field('Colour', input('colour', b.colour || '#2f6f4f', { type: 'color' }))),
        field('About', textarea('description', b.description), 'A sentence or two for visitors'),
        field('Address', textarea('address', b.address, { style: 'min-height:60px' })),
        h('div', { class: 'row' }, field('Phone', input('phone', b.phone)), field('Website', input('website', b.website, { type: 'url', placeholder: 'https://' }))),
        field('Opening times', textarea('opening_times', b.opening_times, { placeholder: 'Mon–Fri 9am–5pm\nSat 10am–4pm\nSun closed' })),
        field('Frequently asked questions', textarea('faq', b.faq, { style: 'min-height:160px', placeholder: 'Is there parking?\nYes, free parking behind the station.\n\nAre dogs welcome?\nYes, on a lead.' }), 'Question on one line, answer below it, blank line between questions'),
      ],
      onSaved
    );
  }

  async function businessTab(panel) {
    if (!isAdmin()) {
      const b = businesses[0];
      if (!b) return fill(panel, h('p', { class: 'muted' }, 'Your login is not linked to a business yet.'));
      const saved = h('p', { class: 'muted', role: 'status' });
      fill(panel,
        h(
          'div',
          { class: 'card', style: 'max-width:720px' },
          businessForm(b, async (values) => {
            await api('PUT', `/api/manage/businesses/${b.id}`, values);
            await refreshMe();
            saved.textContent = 'Saved. Visitors will see this straight away.';
          }),
          saved
        )
      );
      return;
    }
    fill(panel,
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => editBusiness(null) }, '+ Add business')),
      businesses.length
        ? h(
            'div',
            { class: 'card table-wrap' },
            h(
              'table',
              {},
              h('tbody', {}, businesses.map((b) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('span', { class: 'chip' }, h('i', { style: `background:${b.colour}` }), h('strong', {}, b.name))),
                  h(
                    'td',
                    { style: 'text-align:right;white-space:nowrap' },
                    h('button', { class: 'btn', onclick: () => editBusiness(b) }, 'Edit'),
                    ' ',
                    h(
                      'button',
                      {
                        class: 'btn danger',
                        onclick: async () => {
                          if (!confirm(`Delete ${b.name}? This also deletes its events and logins.`)) return;
                          await api('DELETE', `/api/admin/businesses/${b.id}`);
                          await refreshMe();
                          render();
                        },
                      },
                      'Delete'
                    )
                  )
                )
              ))
            )
          )
        : h('p', { class: 'muted' }, 'No businesses yet.')
    );
  }

  function editBusiness(b) {
    openDialog(
      b ? `Edit ${b.name}` : 'Add business',
      businessForm(b || {}, async (values) => {
        if (b) await api('PUT', `/api/manage/businesses/${b.id}`, values);
        else await api('POST', '/api/admin/businesses', values);
        dialog.close();
        await refreshMe();
        render();
      })
    );
  }

  // ---------- logins tab (admin) ----------
  function showPassword(email, password) {
    openDialog(
      'Login details',
      h(
        'div',
        {},
        h('p', {}, 'Send these to the person. The password is only shown once; they can change it under "My account".'),
        h('div', { class: 'notice' }, h('div', {}, 'Email: ', h('strong', {}, email)), h('div', {}, 'Password: ', h('strong', { style: 'font-family:monospace' }, password))),
        h('p', {}, h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(`Email: ${email}\nPassword: ${password}\nSign in at: ${location.origin}/login`) }, 'Copy'))
      )
    );
  }

  async function loginsTab(panel) {
    const users = await api('GET', '/api/admin/users');
    const roleSel = select('role', [['business', 'Business'], ['admin', 'Admin']], 'business');
    const bizField = field('Business', select('business_id', businesses.map((b) => [b.id, b.name])));
    roleSel.addEventListener('change', () => (bizField.hidden = roleSel.value === 'admin'));
    fill(panel,
      h(
        'div',
        { class: 'card table-wrap', style: 'margin-bottom:24px' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Name'), h('th', {}, 'Access'), h('th', {}, ''))),
          h('tbody', {}, users.map((u) =>
            h(
              'tr',
              {},
              h('td', {}, u.email),
              h('td', {}, u.name),
              h('td', {}, u.role === 'admin' ? 'Admin' : bizName(u.business_id)),
              h(
                'td',
                { style: 'text-align:right;white-space:nowrap' },
                h(
                  'button',
                  {
                    class: 'btn',
                    onclick: async () => {
                      if (!confirm(`Reset the password for ${u.email}?`)) return;
                      const r = await api('POST', `/api/admin/users/${u.id}/reset`);
                      showPassword(r.email, r.password);
                    },
                  },
                  'Reset password'
                ),
                ' ',
                u.id !== me.id &&
                  h(
                    'button',
                    {
                      class: 'btn danger',
                      onclick: async () => {
                        if (!confirm(`Remove the login for ${u.email}?`)) return;
                        await api('DELETE', `/api/admin/users/${u.id}`);
                        render();
                      },
                    },
                    'Remove'
                  )
              )
            )
          ))
        )
      ),
      h(
        'div',
        { class: 'card', style: 'max-width:560px' },
        h('h2', { style: 'font-size:1.2rem;margin-bottom:12px' }, 'Add a login'),
        businesses.length ? null : h('p', { class: 'notice' }, 'Add a business first.'),
        formWith(
          [
            field('Email', input('email', '', { type: 'email', required: true })),
            field('Name', input('name', '')),
            h('div', { class: 'row' }, field('Access', roleSel), bizField),
          ],
          async (values) => {
            const r = await api('POST', '/api/admin/users', values);
            await render();
            showPassword(r.email, r.password);
          },
          'Create login'
        )
      )
    );
  }

  // ---------- site settings (admin) ----------
  function settingsTab(panel) {
    const s = me.settings;
    const saved = h('p', { class: 'muted', role: 'status' });
    fill(panel,
      h(
        'div',
        { class: 'card', style: 'max-width:720px' },
        formWith(
          [
            field('Site name', input('site_name', s.site_name, { required: true })),
            field('Tagline', input('tagline', s.tagline)),
            field('FAQ page', textarea('faq', s.faq, { style: 'min-height:220px' }), 'Question on one line, answer below it, blank line between questions'),
            field('Footer text', input('footer', s.footer)),
          ],
          async (values) => {
            await api('PUT', '/api/admin/settings', values);
            await refreshMe();
            saved.textContent = 'Saved.';
          }
        ),
        saved
      )
    );
  }

  // ---------- account ----------
  function accountTab(panel) {
    const done = h('p', { class: 'muted', role: 'status' });
    fill(panel,
      h(
        'div',
        { class: 'card', style: 'max-width:420px' },
        h('h2', { style: 'font-size:1.2rem;margin-bottom:12px' }, 'Change password'),
        formWith(
          [
            field('Current password', input('current', '', { type: 'password', required: true, autocomplete: 'current-password' })),
            field('New password', input('password', '', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'At least 8 characters'),
          ],
          async (values, form) => {
            await api('POST', '/api/password', values);
            form.reset();
            done.textContent = 'Password changed.';
          },
          'Change password'
        ),
        done
      )
    );
  }

  // ---------- tabs ----------
  let tab = 'events';
  function tabs() {
    return isAdmin()
      ? [['events', 'Events', eventsTab], ['business', 'Businesses', businessTab], ['logins', 'Logins', loginsTab], ['settings', 'Site settings', settingsTab], ['account', 'My account', accountTab]]
      : [['events', 'My events', eventsTab], ['business', 'My business', businessTab], ['account', 'My account', accountTab]];
  }

  async function render() {
    const list = tabs();
    if (!list.some(([id]) => id === tab)) tab = 'events';
    $('tabs').replaceChildren(
      ...list.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(id === tab), onclick: () => ((tab = id), render()) }, label))
    );
    const panel = $('panel');
    try {
      await list.find(([id]) => id === tab)[2](panel);
    } catch (e) {
      fill(panel, h('p', { class: 'error' }, e.message));
    }
  }

  $('logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('POST', '/api/logout');
    location.href = '/';
  });

  refreshMe().then(() => {
    $('who').textContent = isAdmin() ? `Signed in as ${me.email} (admin)` : `Signed in as ${me.email} for ${bizName(me.business_id)}`;
    render();
  });
})();
