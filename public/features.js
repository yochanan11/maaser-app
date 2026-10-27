'use strict';
// סקירה כללית, תנועות בנק וכרטיסים, סיווג וניהול קטגוריות. נטען אחרי app.js ומשתמש בעזרים שלו.
I.up = ic('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>');
I.gear = ic('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>');
I.chart = ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
const signed = (n) => '⁦' + (n < 0 ? '−' : '') + money(Math.abs(n)) + '⁩'; // מבודד כיוון כדי שהמינוס יישאר לפני המספר
const KIND_LABEL = {
  income: 'הכנסה', expense: 'הוצאה', tithe: 'מעשר', transfer: 'העברה (לא נספרת)',
  saving: 'חיסכון / פנסיה', loan: 'הלוואה / משכנתא', card: 'סיכום כרטיס (לא נספר אם יש פירוט)',
};
const COUNTED_TX = () => state.data.tx.filter((t) => !t.matched);

// ---------- חישוב חודשי ----------
function monthsList() {
  return [...new Set(state.data.tx.map((t) => t.date.slice(0, 7)))].sort().reverse();
}

function monthStats(month) {
  const kinds = catKind(), names = catName();
  const s = { income: 0, expense: 0, saving: 0, tithe: 0, byCat: {} };
  COUNTED_TX().filter((t) => t.date.startsWith(month)).forEach((t) => {
    const k = kinds[t.category_id];
    if (k === 'income' && t.amount > 0) s.income += t.amount;
    else if (k === 'saving') s.saving -= t.amount;
    else if (k === 'tithe') s.tithe -= t.amount;
    else if (k === 'expense' || k === 'loan' || k === 'card' || (!k && t.amount < 0)) {
      const n = k ? names[t.category_id] : 'לא מסווג';
      s.byCat[n] = (s.byCat[n] || 0) - t.amount;
      s.expense -= t.amount;
    }
  });
  state.data.income.filter((i) => i.date.startsWith(month)).forEach((i) => (s.income += i.amount));
  state.data.gift.filter((g) => g.date.startsWith(month)).forEach((g) => (s.tithe += g.amount));
  s.left = s.income - s.expense - s.saving - s.tithe;
  return s;
}

function latestBalance() {
  const rows = state.data.tx.filter((t) => t.source === 'bank' && t.balance !== null && t.balance !== undefined);
  if (!rows.length) return null;
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id));
  return { value: rows[0].balance, date: rows[0].date };
}

// ---------- סקירה כללית ----------
function overviewView() {
  const months = monthsList();
  if (!months.length) {
    return `<h1>סקירה כללית</h1><div class="card"><div class="empty">עוד אין נתונים.<br>ייבא קובץ בנק בלשונית "תנועות".</div></div>`;
  }
  if (!months.includes(state.month)) state.month = months[0];
  const s = monthStats(state.month);
  const bal = latestBalance();
  const t = totals();
  const unc = COUNTED_TX().filter((x) => !x.category_id).length;

  const trend = months.slice(0, 6).reverse().map((m) => ({ label: MONTHS[Number(m.slice(5)) - 1], ...monthStats(m) }));
  trend.forEach((m) => { m.owed = m.income; m.given = m.expense; });

  const list = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 1;
  const chips = months.map((m) => `<button data-month="${m}" class="${m === state.month ? 'on' : ''}">${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}</button>`).join('');

  return `<h1>סקירה כללית</h1>
  ${unc ? `<div class="banner" data-review style="cursor:pointer">${unc} תנועות ממתינות לסיווג. לחץ לסיווג</div>` : ''}
  <div class="grid">
    ${bal ? `<div class="card hero span"><div><div class="lbl">יתרה בחשבון הבנק</div><div class="big ${bal.value < 0 ? 'over' : ''}">${signed(bal.value)}</div>
      <div class="sub">נכון ל־${fmtDate(bal.date)}</div></div></div>` : ''}
    <div class="span"><div class="seg months">${chips}</div></div>
    <div class="chips span">
      <div class="chip"><span>הכנסות</span><b>${money(s.income)}</b></div>
      <div class="chip"><span>הוצאות</span><b>${money(s.expense)}</b></div>
      <div class="chip"><span>נשאר</span><b style="color:${s.left < 0 ? 'var(--red)' : 'var(--green)'}">${signed(s.left)}</b></div>
    </div>
    <div class="card"><h2>הוצאות לפי קטגוריה</h2>
      ${list.map(([n, v]) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.88rem"><span>${esc(n)}</span><b class="amt">${money(v)}</b></div>
        <div class="bar"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></div></div>`).join('') || '<div class="empty">אין הוצאות בחודש הזה</div>'}
      ${s.saving ? `<div class="muted" style="font-size:.85rem;margin-top:6px">חיסכון ופנסיה: ${money(s.saving)}</div>` : ''}</div>
    <div class="grid-col">
      <div class="card"><h2>הכנסות מול הוצאות</h2>${barsSvg(trend)}
        <div class="legend"><span><i style="background:var(--soft)"></i>הכנסות</span><span><i style="background:var(--green2)"></i>הוצאות</span></div></div>
      <div class="card" data-tab="history" style="cursor:pointer"><h2>מעשר</h2>
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="muted">${t.left < 0 ? 'נתת יותר ב־' : 'נשאר לתת'}</span><b style="font-size:1.4rem">${money(Math.abs(t.left))}</b></div>
        <div class="muted" style="font-size:.82rem;margin-top:4px">נדרש ${money(t.owed)} · ניתן ${money(t.given)}</div></div>
    </div>
  </div>`;
}

// ---------- תנועות ----------
function cardLabel(t) {
  return t.source === 'bank' ? '' : ` · כרטיס ${t.card}`;
}

function txRowHtml(t) {
  const names = catName();
  const cat = t.matched ? 'מפורט בכרטיס' : t.category_id ? esc(names[t.category_id]) : 'לא מסווג';
  return `<div class="row ${t.matched ? 'dim' : ''}" data-edit="tx" data-id="${t.id}"><div class="dot ${t.amount > 0 ? 'in' : 'out'}">${t.amount > 0 ? I.down : I.up}</div>
    <div class="m"><b>${esc(t.description)}</b><small>${fmtDate(t.date)} · ${cat}${cardLabel(t)}${t.auto && !t.matched ? ' · אוטומטי' : ''}</small></div>
    <div class="amt ${t.amount > 0 ? 'g' : ''}">${signed(t.amount)}</div></div>`;
}

function txView() {
  const all = state.data.tx;
  const unc = COUNTED_TX().filter((x) => !x.category_id).length;
  const rows = state.txFilter === 'unc' ? COUNTED_TX().filter((x) => !x.category_id) : all;
  const seg = [['all', 'הכל'], ['unc', `לא מסווג (${unc})`]]
    .map(([k, l]) => `<button data-txfilter="${k}" class="${state.txFilter === k ? 'on' : ''}">${l}</button>`).join('');
  return `<h1>תנועות</h1>
  <div class="btns" style="margin:0 0 12px">
    <label class="btn" style="cursor:pointer"><input id="file" type="file" accept=".xlsx,.pdf" hidden>ייבוא קובץ (בנק או כרטיס)</label>
    <button class="btn sec" data-cats style="flex:.5">קטגוריות</button>
  </div>
  ${unc ? `<div class="banner" data-review style="cursor:pointer">${unc} תנועות ממתינות לסיווג. לחץ לסיווג אחת אחת</div>` : ''}
  <div class="seg">${seg}</div>
  <div class="card">${rows.length ? rows.slice(0, state.txLimit).map(txRowHtml).join('') : '<div class="empty">אין תנועות. ייבא קובץ מהבנק או מכרטיס אשראי</div>'}</div>
  ${rows.length > state.txLimit ? '<div class="btns"><button class="btn sec" data-more>הצג עוד</button></div>' : ''}`;
}

function catOptions(selected) {
  return state.data.category.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function formTx(t) {
  openSheet(`<h2>${esc(t.description)}</h2>
    <div class="muted">${fmtDate(t.date)} · ${signed(t.amount)}${t.details ? ' · ' + esc(t.details) : ''}${t.matched ? '<br>שורה זו מכוסה בפירוט הכרטיס ולא נספרת פעמיים' : ''}</div>
    <label>קטגוריה<select name="category_id"><option value="">לא מסווג</option>${catOptions(t.category_id)}</select></label>
    ${t.amount > 0 ? `<label>אחוז מעשר (אם זו הכנסה)<input name="pct" value="${t.pct}" type="number" step="any" inputmode="decimal"></label>
      <div class="pctrow"><button type="button" data-pct="10">10%</button><button type="button" data-pct="${10 / 1.18}">10% בלי מע״מ</button><button type="button" data-pct="0">פטור</button></div>` : ''}
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="all" style="width:auto"> החל על כל התנועות עם השם הזה, וגם בייבוא הבא</label>`,
    async (f) => {
      const cid = f.category_id ? Number(f.category_id) : null;
      if (f.all && cid) await api('POST', '/api/categorize', { description: t.description, category_id: cid });
      await api('PUT', `/api/tx/${t.id}`, { category_id: cid, auto: 0, ...(f.pct !== undefined && { pct: Number(f.pct) }) });
    },
    () => api('DELETE', `/api/tx/${t.id}`));
  document.querySelectorAll('[data-pct]').forEach((b) => (b.onclick = () => { const i = document.querySelector('input[name=pct]'); if (i) i.value = b.dataset.pct; }));
}

// ---------- ניהול קטגוריות ----------
function openCategories() {
  const el = document.createElement('div');
  el.className = 'scrim';
  document.body.appendChild(el);
  const draw = () => {
    const used = {};
    state.data.tx.forEach((t) => { if (t.category_id) used[t.category_id] = (used[t.category_id] || 0) + 1; });
    el.innerHTML = `<div class="sheet"><h2>ניהול קטגוריות</h2>
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">שינוי השם או הסוג חל מיד על כל התנועות. הסוג קובע איך הקטגוריה נספרת בדוחות ובמעשר.</p>
      ${state.data.category.map((c) => `<div class="catrow" data-id="${c.id}">
        <input value="${esc(c.name)}" data-f="name" aria-label="שם">
        <select data-f="kind" aria-label="סוג">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="iconbtn" data-del title="מחיקה (${used[c.id] || 0} תנועות)">✕</button></div>`).join('')}
      <div class="catrow" data-new><input placeholder="קטגוריה חדשה" data-f="name"><select data-f="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${k === 'expense' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="iconbtn add" data-add>＋</button></div>
      <div class="err" id="err"></div>
      <div class="btns"><button class="btn sec" data-close>סיום</button></div></div>`;
  };
  const refresh = async () => { state.data = await api('GET', '/api/data'); draw(); };
  el.onclick = async (e) => {
    if (e.target === el || e.target.closest('[data-close]')) { el.remove(); render(); return; }
    const row = e.target.closest('.catrow');
    try {
      if (e.target.closest('[data-del]')) {
        const c = state.data.category.find((x) => x.id == row.dataset.id);
        if (confirm(`למחוק את "${c.name}"? התנועות שלה יחזרו ל"לא מסווג".`)) { await api('DELETE', `/api/category/${row.dataset.id}`); await refresh(); }
      } else if (e.target.closest('[data-add]')) {
        const name = row.querySelector('[data-f=name]').value.trim();
        if (!name) return;
        await api('POST', '/api/category', { name, kind: row.querySelector('[data-f=kind]').value });
        await refresh();
      }
    } catch (err) { el.querySelector('#err').textContent = err.message.includes('שרת') ? 'השם כבר קיים' : err.message; }
  };
  el.onchange = async (e) => {
    const row = e.target.closest('.catrow');
    if (!row || row.hasAttribute('data-new')) return;
    try { await api('PUT', `/api/category/${row.dataset.id}`, { [e.target.dataset.f]: e.target.value.trim() }); await refresh(); }
    catch (err) { el.querySelector('#err').textContent = 'השם כבר קיים'; await refresh(); }
  };
  draw();
}

// ---------- סיווג אחת אחת ----------
function openReview() {
  const skipped = new Set();
  const el = document.createElement('div');
  el.className = 'scrim';
  document.body.appendChild(el);
  const done = () => { el.remove(); render(); };
  const draw = () => {
    const groups = {};
    COUNTED_TX().filter((t) => !t.category_id && !skipped.has(t.description)).forEach((t) => (groups[t.description] ||= []).push(t));
    const list = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    if (!list.length) return done();
    const [desc, items] = list[0];
    const sum = items.reduce((s, t) => s + t.amount, 0);
    const detail = items.find((t) => t.details)?.details || '';
    el.innerHTML = `<div class="sheet"><h2>סיווג · נשארו ${list.length}</h2>
      <div class="card" style="margin:10px 0"><b>${esc(desc)}</b>
        <div class="muted" style="font-size:.85rem">${items.length} תנועות · סה״כ ${signed(sum)} · ${fmtDate(items[0].date)}${items[0].source !== 'bank' ? ` · כרטיס ${items[0].card}` : ''}${detail ? '<br>' + esc(detail) : ''}</div></div>
      <div class="catgrid">${state.data.category.map((c) => `<button class="catbtn" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <div class="btns"><button class="btn sec" data-skip>דלג</button><button class="btn sec" data-close>סיום</button></div></div>`;
    el.onclick = async (e) => {
      if (e.target === el || e.target.closest('[data-close]')) return done();
      if (e.target.closest('[data-skip]')) { skipped.add(desc); return draw(); }
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      await api('POST', '/api/categorize', { description: desc, category_id: Number(b.dataset.cat) });
      state.data = await api('GET', '/api/data');
      draw();
    };
  };
  draw();
}

// ---------- ייבוא ----------
async function importFile(file) {
  const u = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  try {
    const r = await api('POST', '/api/import', { data: btoa(bin) });
    await reload();
    if (r.kind === 'card') {
      const miss = r.unmatched.length ? ` ${r.unmatched.length} ימי חיוב לא נמצאו בבנק (ייתכן שקובץ הבנק לא מכסה אותם).` : '';
      alert(`${r.bank}, כרטיס ${r.card}: נקלטו ${r.added} עסקאות (${r.skipped} כבר היו). ${r.matched.length} חיובים הותאמו לשורות הבנק.${miss}`);
    } else {
      alert(`נקלטו ${r.added} תנועות בנק חדשות (${r.skipped} כבר היו). ${r.uncategorized} ממתינות לסיווג.`);
    }
    if (COUNTED_TX().some((t) => !t.category_id)) openReview();
  } catch (err) { alert(err.message); }
}
