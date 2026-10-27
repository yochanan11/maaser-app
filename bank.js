// ייבוא קובץ תנועות מהבנק (xlsx) וסיווג אוטומטי
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import { db } from './db.js';

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');

function toIsoDate(v) {
  const s = squash(v);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

// מסיר מספרי זהות ומספרי חשבון ארוכים כדי שלא יישמרו באפליקציה
const redact = (s) => squash(String(s ?? '').replace(/(מזהה|מח-ן:?|ח-ן:?)\s*\d+/g, '').replace(/\b\d{7,}\b/g, ''));

// קורא את הגיליון הראשון לשורות של {עמודה: ערך}
export function readSheet(buffer) {
  const zip = new AdmZip(buffer);
  // חלק מהקבצים משתמשים בקידומת x: לתגיות (x:row), מסירים אותה
  const read = (n) => (zip.getEntry(n)?.getData().toString('utf8') ?? '').replace(/<(\/?)[a-z]+:(?=[a-zA-Z])/g, '<$1');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const sheet = zip.getEntries().map((e) => e.entryName).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .map((n) => read(n)).find((x) => /<row /.test(x));
  if (!sheet) throw new Error('לא נמצאו נתונים בקובץ');

  const rows = [];
  for (const r of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const body = c[3] || '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      row[c[1]] = /t="s"/.test(c[2]) ? shared[Number(v?.[1])] ?? '' : /t="inlineStr"/.test(c[2]) ? texts(body) : unxml(v?.[1] ?? '');
    }
    rows.push(row);
  }
  return rows;
}

export function parseBankXlsx(buffer) {
  const rows = readSheet(buffer);
  const hi = rows.findIndex((r) => Object.values(r).map(squash).includes('תאריך') && Object.values(r).map(squash).includes('הפעולה'));
  if (hi < 0) throw new Error('פורמט הקובץ לא מוכר. צריך עמודות תאריך והפעולה');
  const col = {};
  for (const [k, v] of Object.entries(rows[hi])) {
    const t = squash(v);
    if (t === 'תאריך') col.date = k; else if (t === 'הפעולה') col.desc = k; else if (t === 'פרטים') col.details = k;
    else if (t === 'אסמכתא') col.ref = k; else if (t === 'חובה') col.debit = k; else if (t === 'זכות') col.credit = k;
    else if (t.startsWith('יתרה')) col.balance = k;
  }
  const num = (v) => (v === undefined || v === '' ? 0 : Number(v));
  return rows.slice(hi + 1).map((r) => ({
    date: toIsoDate(r[col.date]), description: squash(r[col.desc]), details: r[col.details], ref: r[col.ref],
    debit: num(r[col.debit]), credit: num(r[col.credit]), balance: r[col.balance] === undefined ? null : num(r[col.balance]),
  })).filter((r) => r.date && r.description);
}

export const DEFAULT_CATEGORIES = [
  ['הכנסה (משכורת וכד׳)', 'income'], ['קצבת ילדים', 'income'], ['מעשר ותרומות', 'tithe'],
  ['משכנתא', 'loan'], ['הלוואות', 'loan'], ['ביטוחים', 'expense'], ['פנסיה וקרנות', 'saving'],
  ['כרטיסי אשראי', 'card'], ['מזומן', 'expense'], ['העברות בין חשבונות', 'transfer'],
  ['עמלות וריבית בנק', 'expense'], ['מזון וקניות', 'expense'], ['תקשורת', 'expense'],
  ['בריאות', 'expense'], ['חינוך', 'expense'], ['תחבורה', 'expense'], ['אחר', 'expense'],
];
// רק התאמות חד-משמעיות; כל השאר עובר לסיווג ידני
const DEFAULT_RULES = [
  ['קצבת ילדים', 'קצבת ילדים'], ['הו"ק הלו', 'הלוואות'], ['טפחות-משכנתא', 'משכנתא'], ['הפניקס ביטוח', 'ביטוחים'],
  ['הראל פנסיה', 'פנסיה וקרנות'], ['כרטיסי אשראי', 'כרטיסי אשראי'], ['משיכה מבנקט', 'מזומן'],
  ['דמי ניהול', 'עמלות וריבית בנק'], ['תיקון מס', 'עמלות וריבית בנק'],
];

export async function seedCategories() {
  if ((await db.all('SELECT id FROM category LIMIT 1')).length) return;
  for (const [name, kind] of DEFAULT_CATEGORIES) await db.run('INSERT INTO category (name, kind) VALUES (?, ?)', [name, kind]);
  const cats = Object.fromEntries((await db.all('SELECT id, name FROM category')).map((c) => [c.name, c.id]));
  for (const [pattern, cat] of DEFAULT_RULES) await db.run('INSERT INTO rule (pattern, category_id) VALUES (?, ?)', [pattern, cats[cat]]);
}

// מייבא תנועות. כפילויות (אותה תנועה בקובץ חופף) מדולגות לפי חתימה
export async function importRows(rows) {
  const rules = (await db.all('SELECT pattern, category_id FROM rule')).sort((a, b) => b.pattern.length - a.pattern.length);
  let added = 0, skipped = 0, auto = 0;
  for (const r of rows) {
    const amount = Math.round((r.credit - r.debit) * 100) / 100;
    const details = redact(r.details);
    const hash = crypto.createHash('sha1').update([r.date, r.description, details, r.ref, amount, r.balance].join('|')).digest('hex');
    if ((await db.all('SELECT id FROM tx WHERE hash = ?', [hash])).length) { skipped++; continue; }
    const rule = rules.find((x) => r.description.includes(x.pattern));
    if (rule) auto++;
    await db.run(
      'INSERT INTO tx (date, description, details, amount, balance, ref, category_id, auto, hash) VALUES (?,?,?,?,?,?,?,?,?)',
      [r.date, r.description, details, amount, r.balance, squash(r.ref), rule ? rule.category_id : null, rule ? 1 : 0, hash]);
    added++;
  }
  return { added, skipped, auto, uncategorized: (await db.all('SELECT id FROM tx WHERE category_id IS NULL AND matched = 0')).length };
}

// קובע קטגוריה לכל התנועות בשם הזה, ושומר כלל לייבוא הבא
export async function categorizeDescription(description, categoryId) {
  await db.run('INSERT INTO rule (pattern, category_id) VALUES (?, ?) ON CONFLICT (pattern) DO UPDATE SET category_id = excluded.category_id', [description, categoryId]);
  await db.run('UPDATE tx SET category_id = ?, auto = 0 WHERE description = ? AND (category_id IS NULL OR auto = 1)', [categoryId, description]);
}
