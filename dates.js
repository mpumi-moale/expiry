// Date helpers + label-text date extraction
const MON = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return y >= 2000 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const today = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Every 30-day reminder date between the day the item was added and its expiry
function reminderDates(added, exp) {
  const out = [];
  for (let k = 1; k <= 400; k++) { const d = addDays(added, 30 * k); if (d > exp) break; out.push(d); }
  return out;
}

function extractDate(text, order = 'DMY') {
  const t = text.toUpperCase().replace(/[,]/g, ' ');
  const found = [];
  const push = (y, m, d) => { if (y < 100) y += 2000; if (valid(y, m, d)) found.push(iso(y, m, d)); };
  let m;
  for (m of t.matchAll(/(?<![\d])(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/g)) push(+m[1], +m[2], +m[3]);
  for (m of t.matchAll(/(?<![\d\/.-])(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{4}|\d{2})(?![\d\/.-])/g)) {
    let [a, b] = [+m[1], +m[2]];
    let [d, mo] = order === 'MDY' ? [b, a] : [a, b];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    push(+m[3], mo, d);
  }
  const names = Object.keys(MON).join('|');
  for (m of t.matchAll(new RegExp(`(\\d{1,2})\\s*(${names})[A-Z]*\\.?\\s*(\\d{4}|\\d{2})`, 'g'))) push(+m[3], MON[m[2]], +m[1]);
  for (m of t.matchAll(new RegExp(`(${names})[A-Z]*\\.?\\s*(\\d{1,2})\\s+(\\d{4})`, 'g'))) push(+m[3], MON[m[1]], +m[2]);
  const rest = t.replace(new RegExp(`(\\d{1,2})\\s*(${names})[A-Z]*\\.?\\s*(\\d{4}|\\d{2})|(${names})[A-Z]*\\.?\\s*(\\d{1,2})\\s+(\\d{4})`, 'g'), ' ');
  for (m of rest.matchAll(new RegExp(`(${names})[A-Z]*\\.?\\s*(\\d{4}|\\d{2})(?!\\d)`, 'g'))) { let y = +m[2]; if (y < 100) y += 2000; push(y, MON[m[1]], lastDay(y, MON[m[1]])); }
  if (!found.length) for (m of t.matchAll(/(?<![\d\/.-])(0?[1-9]|1[0-2])[\/-](\d{4}|\d{2})(?![\d\/.-])/g)) { let y = +m[2]; if (y < 100) y += 2000; push(y, +m[1], lastDay(y, +m[1])); }
  // Labels often show a packed date and an expiry date; the later one is the expiry
  return found.sort().pop() || null;
}
module.exports = { today, addDays, diffDays, reminderDates, extractDate, valid };
