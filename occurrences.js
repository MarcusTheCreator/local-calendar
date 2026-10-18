// Works out which days of a given year each event falls on, including
// multi-day events (a weekend festival) and repeating ones (every Friday).

const DAY = 86400000;

function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function format(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addMonths(ms, months, dayOfMonth) {
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  // Skip months that don't have the day (e.g. the 31st), like most calendars do.
  if (dayOfMonth > lastDay) return null;
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), dayOfMonth);
}

// Returns { 'YYYY-MM-DD': [eventId, ...] } for the given year.
function daysForYear(events, year) {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const days = {};

  for (const ev of events) {
    const start = parse(ev.start_date);
    const end = ev.end_date ? Math.max(parse(ev.end_date), start) : start;
    const length = Math.round((end - start) / DAY);
    const until = ev.repeat !== 'none' && ev.repeat_until ? parse(ev.repeat_until) : Infinity;

    const firstDays = [];
    if (ev.repeat === 'none') {
      firstDays.push(start);
    } else if (ev.repeat === 'weekly' || ev.repeat === 'fortnightly') {
      const step = (ev.repeat === 'weekly' ? 7 : 14) * DAY;
      // Jump straight to the first occurrence that could touch this year.
      let t = start;
      if (t + length * DAY < yearStart) {
        t += Math.floor((yearStart - length * DAY - t) / step) * step;
      }
      for (; t <= yearEnd && t <= until; t += step) firstDays.push(t);
    } else if (ev.repeat === 'monthly') {
      const dayOfMonth = new Date(start).getUTCDate();
      for (let i = 0; ; i++) {
        const t = addMonths(start, i, dayOfMonth);
        if (t === null) continue;
        if (t > yearEnd || t > until) break;
        firstDays.push(t);
      }
    }

    for (const first of firstDays) {
      for (let i = 0; i <= length; i++) {
        const t = first + i * DAY;
        if (t < yearStart || t > yearEnd) continue;
        const key = format(t);
        (days[key] ||= []).push(ev.id);
      }
    }
  }

  // Sort each day's events by start time; all-day events first.
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const ids of Object.values(days)) {
    ids.sort((a, b) => (byId.get(a).start_time || '').localeCompare(byId.get(b).start_time || ''));
  }
  return days;
}

module.exports = { daysForYear };
