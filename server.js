import 'express-async-errors';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, init } from './db.js';
import { importCardFile, isCardFile } from './cards.js';
import { parseBankXlsx, importRows, seedCategories, categorizeDescription } from './bank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = process.env.APP_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'dev');
const SECRET = crypto.createHash('sha256').update('maaser|' + PASSWORD).digest();
const YEAR = 365 * 24 * 3600;

if (!PASSWORD) { console.error('APP_PASSWORD חסר'); process.exit(1); }

const sign = (exp) => exp + '.' + crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
const valid = (tok = '') => {
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const good = sign(exp).split('.')[1];
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
};
const cookie = (req, name) =>
  (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

const app = express();
app.use(express.json({ limit: '12mb' }));

app.post('/api/login', (req, res) => {
  const a = Buffer.from(String(req.body.password || ''));
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'סיסמה שגויה' });
  const tok = sign(Math.floor(Date.now() / 1000) + YEAR);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth=${tok}; Max-Age=${YEAR}; Path=/; HttpOnly; SameSite=Lax${secure}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth=; Max-Age=0; Path=/');
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => (valid(cookie(req, 'auth')) ? next() : res.status(401).json({ error: 'לא מחובר' })));

const TABLES = {
  income: ['date', 'amount', 'description', 'pct'],
  gift: ['date', 'amount', 'recipient', 'category', 'note'],
  category: ['name', 'kind', 'grp'],
  tx: ['category_id', 'auto', 'pct', 'date', 'description', 'details', 'amount'],
  recurring: ['amount', 'day', 'recipient', 'category', 'note', 'start_date', 'active'],
};

// יצירת תשלומי הוראות הקבע שהגיע זמנם (פעם בחודש, ללא אישור)
const pad = (n) => String(n).padStart(2, '0');
async function runRecurring() {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const rows = await db.all('SELECT * FROM recurring WHERE active = 1');
  for (const r of rows) {
    let [y, m] = (r.last_month ? r.last_month : r.start_date.slice(0, 7)).split('-').map(Number);
    if (r.last_month) { m++; if (m > 12) { m = 1; y++; } }
    for (;;) {
      const last = new Date(y, m, 0).getDate();
      const date = `${y}-${pad(m)}-${pad(Math.min(r.day, last))}`;
      if (date > today) break;
      if (date >= r.start_date) {
        await db.insert(
          'INSERT INTO gift (date, amount, recipient, category, note, recurring_id) VALUES (?,?,?,?,?,?)',
          [date, r.amount, r.recipient, r.category, r.note, r.id]);
      }
      await db.run('UPDATE recurring SET last_month = ? WHERE id = ?', [`${y}-${pad(m)}`, r.id]);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
}

app.get('/api/data', async (req, res) => {
  await runRecurring();
  res.json({
    income: await db.all('SELECT * FROM income ORDER BY date DESC, id DESC'),
    gift: await db.all('SELECT * FROM gift ORDER BY date DESC, id DESC'),
    recurring: await db.all('SELECT * FROM recurring ORDER BY day, id'),
    category: await db.all('SELECT * FROM category ORDER BY id'),
    tx: await db.all('SELECT * FROM tx ORDER BY date DESC, id DESC'),
  });
});

// ייבוא קובץ בנק (xlsx שמגיע כ-base64)
app.post('/api/import', async (req, res) => {
  try {
    const buf = Buffer.from(String(req.body.data || ''), 'base64');
    if (isCardFile(buf)) return res.json({ kind: 'card', ...(await importCardFile(buf)) });
    const rows = parseBankXlsx(buf);
    res.json({ kind: 'bank', rows: rows.length, ...(await importRows(rows)) });
  } catch (e) { console.error('import failed:', e); res.status(400).json({ error: e.message }); }
});
app.post('/api/categorize', async (req, res) => {
  await categorizeDescription(String(req.body.description), Number(req.body.category_id));
  res.json({ ok: true });
});

// מחיקת קטגוריה: התנועות שלה חוזרות ל"לא מסווג" וכללי הסיווג שלה נמחקים
app.delete('/api/category/:id', async (req, res) => {
  await db.run('UPDATE tx SET category_id = NULL, auto = 0 WHERE category_id = ?', [req.params.id]);
  await db.run('DELETE FROM rule WHERE category_id = ?', [req.params.id]);
  await db.run('DELETE FROM category WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// שאלות חופשיות על הנתונים. נשלח סיכום מצומצם (לא תנועות גולמיות) למודל, ורק אם הוגדר מפתח בשרת
app.post('/api/ask', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: 'לא הוגדר מפתח ANTHROPIC_API_KEY בשרת' });
  const question = String(req.body.question || '').slice(0, 500);
  const context = JSON.stringify(req.body.context || {}).slice(0, 120000);
  if (!question) return res.status(400).json({ error: 'חסרה שאלה' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 1200,
      system: 'אתה אנליסט פיננסי אישי. ענה בעברית, בקצרה ובמדויק, רק לפי הנתונים שניתנו. סכומים בשקלים. אם הנתונים לא מספיקים לתשובה, אמור זאת וציין מה חסר. אל תמציא נתונים.',
      messages: [{ role: 'user', content: `נתונים (JSON מסוכם):
${context}

שאלה: ${question}` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('ask failed', r.status, j); return res.status(502).json({ error: j.error?.message || 'שגיאה משירות המודל' }); }
  res.json({ answer: (j.content || []).map((c) => c.text || '').join('').trim() });
});

const clean = (table, body) => TABLES[table].filter((k) => k in body).map((k) => [k, body[k]]);
for (const table of Object.keys(TABLES)) {
  app.post(`/api/${table}`, async (req, res) => {
    const f = clean(table, req.body);
    const id = await db.insert(
      `INSERT INTO ${table} (${f.map(([k]) => k)}) VALUES (${f.map(() => '?')})`, f.map(([, v]) => v));
    res.json({ id });
  });
  app.put(`/api/${table}/:id`, async (req, res) => {
    const f = clean(table, req.body);
    if (f.length) await db.run(`UPDATE ${table} SET ${f.map(([k]) => k + ' = ?')} WHERE id = ?`, [...f.map(([, v]) => v), req.params.id]);
    res.json({ ok: true });
  });
  app.delete(`/api/${table}/:id`, async (req, res) => {
    await db.run(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  });
}

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'שגיאת שרת' }); });

await init();
await seedCategories();
// נתוני ההתחלה מהגיליון (רק בהרצה ראשונה על בסיס נתונים ריק)
if (!(await db.all('SELECT id FROM income LIMIT 1')).length) {
  const d = new Date().toISOString().slice(0, 10);
  for (const [amount, description] of [[590, 'קצבת ילדים'], [2800, 'דתות - שרוליק'], [750, 'שרוליק ביניק קניית קורס']]) {
    await db.insert('INSERT INTO income (date, amount, description, pct) VALUES (?,?,?,10)', [d, amount, description]);
  }
}
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));
