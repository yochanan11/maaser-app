// ייבוא פירוט כרטיסי אשראי (ישראכרד xlsx וכאל PDF) והתאמה לשורות החיוב בבנק
import crypto from 'node:crypto';
import { db } from './db.js';
import { readSheet, squash } from './bank.js';
import { parseCalPdf } from './card.js';

const pad = (n) => String(n).padStart(2, '0');
function isoFromDots(s) {
  const m = squash(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}

export function parseIsracard(buffer) {
  const rows = readSheet(buffer);
  const head = rows.slice(0, 10).map((r) => Object.values(r).join(' ')).join(' ');
  const card = (head.match(/-\s*(\d{4})/) || [])[1] || '';
  const out = [];
  let col = null;
  for (const r of rows) {
    const vals = Object.entries(r).map(([k, v]) => [k, squash(v)]);
    if (vals.some(([, v]) => v === 'תאריך רכישה')) {
      col = {};
      for (const [k, v] of vals) {
        if (v === 'תאריך רכישה') col.date = k; else if (v === 'שם בית עסק') col.name = k; else if (v === 'סכום חיוב') col.charge = k;
        else if (v === 'מס\' שובר') col.voucher = k; else if (v === 'פירוט נוסף') col.extra = k; else if (v === 'חיוב בחשבון הבנק') col.bank = k;
      }
      continue;
    }
    if (!col) continue;
    const purchase = isoFromDots(r[col.date]);
    if (!purchase || !squash(r[col.name])) continue;
    out.push({
      purchase, chargeDate: col.bank ? isoFromDots(r[col.bank]) : null, merchant: squash(r[col.name]),
      amount: Number(r[col.charge]), voucher: squash(r[col.voucher]), details: squash(r[col.extra]),
    });
  }
  if (!card || !out.length) throw new Error('לא זוהה דף פירוט של ישראכרד');
  return { card, rows: out.filter((x) => !Number.isNaN(x.amount)) };
}

// רמזים מהענף של כאל. רק התאמות ברורות, כל השאר עובר לסיווג ידני
const CAL_HINTS = [[/שורת/, 'תקשורת'], [/רפוא/, 'בריאות'], [/ביטוח/, 'ביטוחים'], [/אנרג|רכב/, 'תחבורה']];

async function loadRules() {
  return (await db.all('SELECT pattern, category_id FROM rule')).sort((a, b) => b.pattern.length - a.pattern.length);
}

// מוסיף עסקאות כרטיס בתאריך החיוב שלהן, ומחליף את שורות החיוב המסכמות בבנק
export async function importCardRows({ card, source, rows }) {
  const rules = await loadRules();
  const cats = Object.fromEntries((await db.all('SELECT id, name FROM category')).map((c) => [c.name, c.id]));
  let added = 0, skipped = 0;
  const seen = {};
  const groups = {};

  for (const r of rows) {
    const key = [r.chargeDate, r.purchase, r.merchant, r.amount].join('|');
    seen[key] = (seen[key] || 0) + 1;
    const hash = crypto.createHash('sha1').update(['card', card, r.voucher || key, seen[key]].join('|')).digest('hex');
    (groups[r.chargeDate] ||= []).push(r.amount);
    if ((await db.all('SELECT id FROM tx WHERE hash = ?', [hash])).length) { skipped++; continue; }
    const rule = rules.find((x) => r.merchant.includes(x.pattern));
    const hint = !rule && r.hint ? CAL_HINTS.find(([re]) => re.test(r.hint)) : null;
    const categoryId = rule ? rule.category_id : hint ? cats[hint[1]] : null;
    const [y, m, d] = r.purchase.split('-');
    const note = [r.details && r.details.length < 40 ? r.details : '', `קנייה ${d}/${m}`].filter(Boolean).join(' · ');
    await db.run(
      'INSERT INTO tx (date, description, details, amount, ref, category_id, auto, hash, source, card) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [r.chargeDate, r.merchant, note, Math.round(-r.amount * 100) / 100, r.voucher || '', categoryId, categoryId ? 1 : 0, hash, source, card]);
    added++;
  }

  // התאמה לבנק: אותו תאריך וסכום, וכרטיס זהה (דירקט) או שורת "כרטיסי אשראי"
  const matched = [], unmatched = [];
  for (const [date, amounts] of Object.entries(groups)) {
    const sum = Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
    const cand = (await db.all("SELECT id, description, ref FROM tx WHERE source = 'bank' AND date = ? AND amount BETWEEN ? AND ?",
      [date, -sum - 0.01, -sum + 0.01])).find((b) => /כרטיסי אשראי/.test(b.description) || (/דירקט/.test(b.description) && String(b.ref).startsWith(card)));
    if (cand) { await db.run('UPDATE tx SET matched = 1 WHERE id = ?', [cand.id]); matched.push({ date, sum }); }
    else unmatched.push({ date, sum });
  }
  return { added, skipped, matched, unmatched };
}

export async function importIsracard(buffer) {
  const { card, rows } = parseIsracard(buffer);
  // עסקאות בלי תאריך חיוב (הסעיף "למועד חיוב"): נקבע לפי שורת בנק תואמת אם קיימת
  const open = rows.filter((r) => !r.chargeDate);
  if (open.length) {
    const sum = Math.round(open.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const last = open.reduce((m, r) => (r.purchase > m ? r.purchase : m), '');
    const b = (await db.all("SELECT date FROM tx WHERE source = 'bank' AND description LIKE 'דירקט%' AND date >= ? AND amount BETWEEN ? AND ? ORDER BY date LIMIT 1",
      [last, -sum - 0.01, -sum + 0.01]))[0];
    for (const r of open) r.chargeDate = b ? b.date : r.purchase;
  }
  return { card, bank: 'ישראכרד', ...(await importCardRows({ card, source: 'isracard', rows })) };
}

export async function importCal(buffer) {
  const r = await parseCalPdf(buffer);
  if (!r.chargeDate || !r.rows.length) throw new Error('לא זוהה דף חיוב של כאל');
  const rows = r.rows.map((x) => ({ purchase: x.purchase, chargeDate: r.chargeDate, merchant: x.merchant, amount: x.amount, voucher: '', details: x.details, hint: x.category }));
  return { card: r.card, bank: 'כאל', ...(await importCardRows({ card: r.card, source: 'cal', rows })) };
}

// מזהה את סוג הקובץ ומייבא אותו: PDF של כאל, xlsx של ישראכרד
export async function importCardFile(buffer) {
  if (buffer.slice(0, 4).toString() === '%PDF') return importCal(buffer);
  return importIsracard(buffer);
}

export function isCardFile(buffer) {
  if (buffer.slice(0, 4).toString() === '%PDF') return true;
  return readSheet(buffer).some((r) => Object.values(r).some((v) => squash(v) === 'תאריך רכישה'));
}
