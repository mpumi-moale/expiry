require('dotenv').config();
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { today, reminderDates, extractDate, valid } = require('./dates');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('Set JWT_SECRET (16+ chars) in .env'); process.exit(1); }

const db = new Database(process.env.DB_PATH || 'data.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, phone TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, exp TEXT NOT NULL, added TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS items_user ON items(user_id);
`);

// ---- SMS (Twilio, or console log when not configured) ----
let twilio = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
async function sendSms(to, body) {
  if (!twilio) { console.log(`[SMS dry-run] to ${to}: ${body}`); return true; }
  try { await twilio.messages.create({ to, from: process.env.TWILIO_FROM, body }); return true; }
  catch (e) { console.error('SMS failed', to, e.message); return false; }
}

// ---- Reminders: every 30 days after adding, until the expiry date ----
async function runReminders() {
  const t = today();
  const rows = db.prepare('SELECT i.*, u.phone FROM items i JOIN users u ON u.id=i.user_id WHERE i.exp >= ?').all(t);
  for (const it of rows) {
    const due = reminderDates(it.added, it.exp).filter(d => d <= t).length;
    if (it.sent >= due) continue;
    const left = Math.round((Date.parse(it.exp) - Date.parse(t)) / 864e5);
    const msg = `Expiry Tracker: ${it.name} expires on ${it.exp} (${left === 0 ? 'today' : left + ' day' + (left === 1 ? '' : 's') + ' left'}).`;
    if (await sendSms(it.phone, msg)) db.prepare('UPDATE items SET sent=? WHERE id=?').run(due, it.id);
  }
}
cron.schedule(process.env.REMINDER_CRON || '0 9 * * *', () => runReminders().catch(console.error));

// ---- App ----
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const PHONE = /^\+[1-9]\d{7,14}$/;
const token = u => jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' });
const pub = u => ({ name: u.name, phone: u.phone });

function auth(req, res, next) {
  try { req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET).uid; next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
}

app.post('/api/register', authLimit, (req, res) => {
  const { name, phone, password } = req.body || {};
  const p = String(phone || '').replace(/[\s()-]/g, '');
  if (!PHONE.test(p)) return res.status(400).json({ error: 'Use international format, e.g. +15551234567.' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(p)) return res.status(409).json({ error: 'That number is already registered.' });
  const id = db.prepare('INSERT INTO users(name,phone,hash) VALUES(?,?,?)').run(String(name || '').trim().slice(0, 60) || 'there', p, bcrypt.hashSync(password, 11)).lastInsertRowid;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.json({ token: token(u), user: pub(u) });
});

app.post('/api/login', authLimit, (req, res) => {
  const p = String((req.body || {}).phone || '').replace(/[\s()-]/g, '');
  const u = db.prepare('SELECT * FROM users WHERE phone=?').get(p);
  if (!u || !bcrypt.compareSync(String((req.body || {}).password || ''), u.hash)) return res.status(401).json({ error: 'Wrong number or password.' });
  res.json({ token: token(u), user: pub(u) });
});

app.get('/api/me', auth, (req, res) => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.uid); u ? res.json(pub(u)) : res.status(401).json({ error: 'Please log in again.' }); });

app.get('/api/items', auth, (req, res) => {
  const t = today();
  const rows = db.prepare('SELECT id,name,exp,added FROM items WHERE user_id=? ORDER BY exp').all(req.uid);
  res.json(rows.map(r => ({ ...r, next: reminderDates(r.added, r.exp).find(d => d > t) || null })));
});

app.post('/api/items', auth, (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 100), exp = String((req.body || {}).exp || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exp);
  if (!name || !m || !valid(+m[1], +m[2], +m[3])) return res.status(400).json({ error: 'Enter a product name and a valid date.' });
  if (exp < today()) return res.status(400).json({ error: 'That date is already in the past.' });
  const id = db.prepare('INSERT INTO items(user_id,name,exp,added) VALUES(?,?,?,?)').run(req.uid, name, exp, today()).lastInsertRowid;
  res.json({ id });
});

app.delete('/api/items/:id', auth, (req, res) => {
  db.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  res.json({ ok: true });
});

// Photo -> expiry date (OCR runs on the server, no API key needed)
let worker;
async function getWorker() {
  if (!worker) { const { createWorker } = require('tesseract.js'); worker = await createWorker('eng'); }
  return worker;
}
app.post('/api/scan', auth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo received.' });
  try {
    const { data } = await (await getWorker()).recognize(req.file.buffer);
    res.json({ date: extractDate(data.text, process.env.DATE_ORDER || 'DMY') });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not read that photo.' }); }
});

// Dev helper to trigger the reminder job by hand
if (process.env.NODE_ENV !== 'production') app.post('/api/dev/run-reminders', auth, async (_q, r) => { await runReminders(); r.json({ ok: true }); });

app.listen(process.env.PORT || 3000, () => console.log('Expiry Tracker on http://localhost:' + (process.env.PORT || 3000)));
