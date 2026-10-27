'use strict';
// תנועות בנק: תצוגה, סיווג וייבוא. נטען אחרי app.js ומשתמש בעזרים שלו.
I.up = ic('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>');
const signed = (n) => (n < 0 ? '−' : '') + money(Math.abs(n));

function expensesCard() {
  const { tx } = state.data;
  if (!tx.length) return '';
  const kinds = catKind(), names = catName();
  const month = tx.reduce((m, t) => (t.date > m ? t.date : m), '').slice(0, 7);
  const by = {};
  let inc = 0, out = 0;
  tx.filter((t) => t.date.startsWith(month)).forEach((t) => {
    const k = kinds[t.category_id];
    if (t.amount > 0 && k === 'income') inc += t.amount;
    if (t.amount < 0 && (!k || k === 'expense' || k === 'loan' || k === 'card')) {
      const n = k ? names[t.category_id] : 'לא מסווג';
      by[n] = (by[n] || 0) - t.amount;
      out -= t.amount;
    }
  });
  const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 1;
  return `<div class="card"><h2>הוצאות ${MONTHS[Number(month.slice(5)) - 1]}</h2>
    <div class="muted" style="margin:-6px 0 12px;font-size:.85rem">נכנס ${money(inc)} · יצא ${money(out)}</div>
    ${list.map(([n, v]) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.88rem"><span>${esc(n)}</span><b class="amt">${money(v)}</b></div>
      <div class="bar"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></div></div>`).join('') || '<div class="empty">אין הוצאות</div>'}</div>`;
}

function txRowHtml(t) {
  const names = catName();
  return `<div class="row" data-edit="tx" data-id="${t.id}"><div class="dot ${t.amount > 0 ? 'in' : ''}">${t.amount > 0 ? I.down : I.up}</div>
    <div class="m"><b>${esc(t.description)}</b><small>${fmtDate(t.date)} · ${t.category_id ? esc(names[t.category_id]) : 'לא מסווג'}${t.auto ? ' · אוטומטי' : ''}</small></div>
    <div class="amt ${t.amount > 0 ? 'g' : ''}">${signed(t.amount)}</div></div>`;
}

function txView() {
  const all = state.data.tx;
  const unc = all.filter((x) => !x.category_id).length;
  const rows = state.txFilter === 'unc' ? all.filter((x) => !x.category_id) : all;
  const seg = [['all', 'הכל'], ['unc', `לא מסווג (${unc})`]]
    .map(([k, l]) => `<button data-txfilter="${k}" class="${state.txFilter === k ? 'on' : ''}">${l}</button>`).join('');
  return `<h1>תנועות בנק</h1>
  <label class="btn" style="margin-bottom:12px;cursor:pointer"><input id="file" type="file" accept=".xlsx" hidden>ייבוא קובץ מהבנק</label>
  ${unc ? `<div class="banner" data-review style="cursor:pointer">${unc} תנועות ממתינות לסיווג. לחץ לסיווג אחת אחת</div>` : ''}
  <div class="seg">${seg}</div>
  <div class="card">${rows.length ? rows.slice(0, state.txLimit).map(txRowHtml).join('') : '<div class="empty">אין תנועות. ייבא קובץ מהבנק</div>'}</div>
  ${rows.length > state.txLimit ? '<div class="btns"><button class="btn sec" data-more>הצג עוד</button></div>' : ''}`;
}

function formTx(t) {
  const opts = state.data.category.map((c) => `<option value="${c.id}" ${c.id === t.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  openSheet(`<h2>${esc(t.description)}</h2>
    <div class="muted">${fmtDate(t.date)} · ${signed(t.amount)}${t.details ? ' · ' + esc(t.details) : ''}</div>
    <label>קטגוריה<select name="category_id"><option value="">לא מסווג</option>${opts}</select></label>
    ${t.amount > 0 ? `<label>אחוז מעשר (אם זו הכנסה)<input name="pct" value="${t.pct}" type="number" step="any" inputmode="decimal"></label>` : ''}
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="all" style="width:auto"> החל על כל התנועות עם השם הזה, וגם בייבוא הבא</label>`,
    async (f) => {
      const cid = f.category_id ? Number(f.category_id) : null;
      if (f.all && cid) await api('POST', '/api/categorize', { description: t.description, category_id: cid });
      await api('PUT', `/api/tx/${t.id}`, { category_id: cid, auto: 0, ...(f.pct !== undefined && { pct: Number(f.pct) }) });
    },
    () => api('DELETE', `/api/tx/${t.id}`));
}

// סיווג אחת אחת: קבוצה לפי שם פעולה, בחירה שומרת כלל וממשיכה לבאה
function openReview() {
  const skipped = new Set();
  const el = document.createElement('div');
  el.className = 'scrim';
  document.body.appendChild(el);
  const done = () => { el.remove(); render(); };
  const draw = () => {
    const groups = {};
    state.data.tx.filter((t) => !t.category_id && !skipped.has(t.description)).forEach((t) => (groups[t.description] ||= []).push(t));
    const list = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    if (!list.length) return done();
    const [desc, items] = list[0];
    const sum = items.reduce((s, t) => s + t.amount, 0);
    const detail = items.find((t) => t.details)?.details || '';
    el.innerHTML = `<div class="sheet"><h2>סיווג · נשארו ${list.length}</h2>
      <div class="card" style="margin:10px 0"><b>${esc(desc)}</b>
        <div class="muted" style="font-size:.85rem">${items.length} תנועות · סה״כ ${signed(sum)} · ${fmtDate(items[0].date)}${detail ? '<br>' + esc(detail) : ''}</div></div>
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

async function importFile(file) {
  const u = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  try {
    const r = await api('POST', '/api/import', { data: btoa(bin) });
    await reload();
    alert(`נקלטו ${r.added} תנועות חדשות (${r.skipped} כבר היו). ${r.uncategorized} ממתינות לסיווג.`);
    if (r.uncategorized) openReview();
  } catch (err) { alert(err.message); }
}
