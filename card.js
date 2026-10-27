// קריאת דף חיוב חודשי דיגיטלי של כאל (PDF) לשורות עסקאות
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const HEB = /[֐-׿]/;
const num = (s) => Number(String(s).replace(/[,₪\s]/g, ''));
const AMOUNT = /^-?[\d,]+\.\d{2}$/;
const revDigits = (s) => s.replace(/[0-9][0-9.,/]*/g, (d) => [...d].reverse().join(''));

// עמודות לפי הקצה הימני של הטקסט (x1). הדף כתוב מימין לשמאל.
const ZONE = { date: 505, merchant: 420, category: 390, details: 280, charge: [150, 215] };

// מחבר אותיות בודדות למילים לפי הרווחים ביניהן
function visual(tokens) {
  if (!tokens.length) return '';
  const heb = HEB.test(tokens.map((t) => t.s).join(''));
  const ts = [...tokens].sort((a, b) => (heb ? b.x1 - a.x1 : a.x1 - b.x1));
  let out = '';
  ts.forEach((t, i) => {
    const s = heb ? t.s : [...t.s].reverse().join('');
    const gap = i === 0 ? 0 : heb ? ts[i - 1].x0 - t.x1 : t.x0 - ts[i - 1].x1;
    out += (gap > 1.3 ? ' ' : '') + s;
  });
  return (heb ? revDigits(out) : out).replace(/\s+/g, ' ').trim();
}

export async function parseCalPdf(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  const rows = [];
  let total = null, chargeDate = null, card = '';

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items
      .filter((i) => i.str.trim())
      .map((i) => ({ s: i.str.trim(), x0: i.transform[4], x1: i.transform[4] + i.width, y: i.transform[5] }));
    const lines = [];
    for (const it of items.sort((a, b) => b.y - a.y)) {
      const l = lines.find((x) => Math.abs(x.y - it.y) <= 4);
      l ? l.t.push(it) : lines.push({ y: it.y, t: [it] });
    }

    let cur = null, lastY = 0;
    for (const l of lines) {
      const text = visual(l.t.filter((t) => t.x1 > 150));
      if (/PRD-|ט\.ל\.ח/.test(l.t.map((t) => t.s).join(' '))) { cur = null; continue; }
      if (!chargeDate && /חודשי/.test(text)) {
        const m = l.t.map((t) => t.s).join('').match(/(\d{2}\/\d{2}\/\d{2})/);
        if (m) chargeDate = m[1];
      }
      const cm = text.match(/המסתיים ב\s*-?\s*(\d{4})/);
      if (cm && !card) card = cm[1];
      if (/לתאריך/.test(text) && /סה/.test(text)) {
        const a = l.t.find((t) => AMOUNT.test(t.s) && t.x1 > ZONE.charge[0] && t.x1 < ZONE.charge[1]);
        if (a) total = num(a.s);
      }
      const dateTokens = l.t.filter((t) => t.x1 > ZONE.date);
      const dateStr = [...dateTokens.sort((a, b) => b.x1 - a.x1).map((t) => t.s).join('')].reverse().join('');
      const dm = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (dm) {
        // הסכום מגיע לפעמים ספרה-ספרה, לכן מחברים משמאל לימין
        const chargeText = l.t.filter((t) => t.x1 > ZONE.charge[0] && t.x1 < ZONE.charge[1])
          .map((t) => t.s.replace(/[₪\s]/g, '')).filter((s) => /^-?[\d,]*\.?\d+$/.test(s)).sort((a, b) => a.length - b.length).pop() || '';
        const charge = /\d/.test(chargeText) ? { s: chargeText } : null;
        cur = {
          purchase: `${dm[3]}-${dm[2]}-${dm[1]}`,
          merchantT: l.t.filter((t) => t.x1 <= ZONE.date && t.x1 > ZONE.merchant),
          categoryT: l.t.filter((t) => t.x1 <= ZONE.merchant && t.x1 > ZONE.category),
          detailsT: l.t.filter((t) => t.x1 <= ZONE.category && t.x1 > ZONE.details && t.s !== 'לא'),
          amount: charge ? num(charge.s) : NaN,
        };
        lastY = l.y;
        rows.push(cur);
      } else if (cur && lastY - l.y < 24) {
        // שורת המשך של ענף או פירוט שנשברו לשורה נוספת
        cur.categoryT.push(...l.t.filter((t) => t.x1 <= ZONE.merchant && t.x1 > ZONE.category));
        cur.detailsT.push(...l.t.filter((t) => t.x1 <= ZONE.category && t.x1 > ZONE.details));
      }
    }
  }

  const out = rows.map((r) => ({
    purchase: r.purchase, merchant: visual(r.merchantT), category: visual(r.categoryT), details: visual(r.detailsT), amount: r.amount,
  })).filter((r) => !Number.isNaN(r.amount) && r.amount !== 0);
  const sum = Math.round(out.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const [d, m, y] = (chargeDate || '').split('/');
  return { card, chargeDate: chargeDate ? `20${y}-${m}-${d}` : null, total, sum, rows: out };
}
