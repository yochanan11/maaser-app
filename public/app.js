'use strict';
const $app = document.getElementById('app');
const state = { tab: 'home', filter: 'all', txFilter: 'all', txLimit: 60, month: null, data: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const money = (n) => '₪' + nf.format(Math.round((n + Number.EPSILON) * 100) / 100);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const ic = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  home: ic('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  list: ic('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/>'),
  repeat: ic('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  down: ic('<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>'),
  heart: ic('<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/>'),
  mark: ic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/>'),
};
const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && url !== '/api/login') { renderLogin(); throw new Error('unauth'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'שגיאה');
  return r.json();
}

// ---------- חישובים ----------
const catKind = () => Object.fromEntries(state.data.category.map((c) => [c.id, c.kind]));
const catName = () => Object.fromEntries(state.data.category.map((c) => [c.id, c.name]));

// כל מה שמשפיע על המעשר: הכנסות ידניות ומהבנק, ומעשרות ידניים ומהבנק
function flows() {
  const { income, gift, tx } = state.data, kind = catKind(), out = [];
  income.forEach((i) => out.push({ date: i.date, earned: i.amount, owed: (i.amount * i.pct) / 100, given: 0 }));
  gift.forEach((g) => out.push({ date: g.date, earned: 0, owed: 0, given: g.amount }));
  tx.forEach((t) => {
    const k = kind[t.category_id];
    if (k === 'income' && t.amount > 0) out.push({ date: t.date, earned: t.amount, owed: (t.amount * t.pct) / 100, given: 0 });
    else if (k === 'tithe') out.push({ date: t.date, earned: 0, owed: 0, given: -t.amount });
  });
  return out;
}

function totals() {
  const f = flows(), sum = (k) => f.reduce((s, x) => s + x[k], 0);
  const earned = sum('earned'), owed = sum('owed'), given = sum('given');
  return { earned, owed, given, left: owed - given };
}

function lastMonths(n) {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[x.getMonth()], owed: 0, given: 0 });
  }
  return out;
}

// ---------- גרפים (SVG בלי ספריות) ----------
function ringSvg(frac) {
  const f = Math.max(0, Math.min(1, frac)), r = 54, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="11"/>
  <circle cx="66" cy="66" r="${r}" fill="none" stroke="#5cf5c0" stroke-width="11" stroke-linecap="round"
   stroke-dasharray="${c * f} ${c}" ${f ? '' : 'opacity="0"'} transform="rotate(-90 66 66)"/>
  <text x="66" y="68" text-anchor="middle" style="font-size:26px;font-weight:800;fill:#fff">${Math.round(f * 100)}%</text>
  <text x="66" y="86" text-anchor="middle">ניתן</text></svg>`;
}

function barsSvg(months) {
  const W = 320, H = 150, pb = 20, ph = H - pb - 8;
  const max = Math.max(1, ...months.flatMap((m) => [m.owed, m.given]));
  const bw = W / months.length;
  const bars = months.map((m, i) => {
    // עברית: הזמן זורם מימין לשמאל
    const x = (months.length - 1 - i) * bw, h1 = (m.owed / max) * ph, h2 = (m.given / max) * ph, w = bw * 0.3;
    return `<rect x="${x + bw * 0.17}" y="${H - pb - h1}" width="${w}" height="${Math.max(h1, 0)}" rx="3" fill="var(--soft)"/>
    <rect x="${x + bw * 0.17 + w + 2}" y="${H - pb - h2}" width="${w}" height="${Math.max(h2, 0)}" rx="3" fill="var(--green2)"/>
    <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${m.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="מעשר שנדרש מול מה שניתן לפי חודש">${bars}</svg>`;
}

const PALETTE = ['#12b886', '#6c8cff', '#ffb454', '#ff7a9a', '#b28cff', '#5fd3f3'];
function donutSvg(slices) {
  const total = slices.reduce((s, x) => s + x.v, 0);
  if (!total) return '';
  const r = 46, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = slices.map((s, i) => {
    const len = (s.v / total) * c;
    const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="16"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len; return el;
  }).join('');
  const legend = slices.map((s, i) => `<div><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s.k)} · ${money(s.v)}</div>`).join('');
  return `<div style="display:flex;align-items:center;gap:16px"><svg viewBox="0 0 120 120" width="120" height="120" style="flex:none">${arcs}</svg><div class="legend" style="flex-direction:column;gap:6px;margin:0">${legend}</div></div>`;
}

// ---------- מסכים ----------
function rowHtml(kind, x) {
  if (kind === 'income') {
    const tithe = (x.amount * x.pct) / 100;
    return `<div class="row" data-edit="income" data-id="${x.id}"><div class="dot in">${I.down}</div>
      <div class="m"><b>${esc(x.description || 'הכנסה')}</b><small>${fmtDate(x.date)} · מעשר ${x.pct}% = ${money(tithe)}</small></div>
      <div class="amt">${money(x.amount)}</div></div>`;
  }
  return `<div class="row" data-edit="gift" data-id="${x.id}"><div class="dot">${I.heart}</div>
    <div class="m"><b>${esc(x.recipient || 'מעשר')}${x.recurring_id ? '<span class="tag">קבע</span>' : ''}</b><small>${fmtDate(x.date)}${x.category ? ' · ' + esc(x.category) : ''}${x.note ? ' · ' + esc(x.note) : ''}</small></div>
    <div class="amt g">${money(x.amount)}</div></div>`;
}

function homeView() {
  const t = totals(), { income, gift, recurring } = state.data, kinds = catKind();
  const months = lastMonths(12);
  const idx = Object.fromEntries(months.map((m) => [m.key, m]));
  flows().forEach((x) => { const m = idx[x.date.slice(0, 7)]; if (m) { m.owed += x.owed; m.given += x.given; } });

  const by = {};
  gift.forEach((g) => { const k = g.recipient || g.category || 'אחר'; by[k] = (by[k] || 0) + g.amount; });
  state.data.tx.filter((x) => kinds[x.category_id] === 'tithe').forEach((x) => { by[x.description] = (by[x.description] || 0) - x.amount; });
  let slices = Object.entries(by).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  if (slices.length > 5) { const rest = slices.slice(5).reduce((s, x) => s + x.v, 0); slices = [...slices.slice(0, 5), { k: 'אחר', v: rest }]; }

  const over = t.left < 0;
  const monthly = recurring.filter((r) => r.active).reduce((s, r) => s + r.amount, 0);
  const recent = [
    ...income.map((x) => ({ k: 'income', x })), ...gift.map((x) => ({ k: 'gift', x })),
  ].sort((a, b) => (a.x.date < b.x.date ? 1 : -1)).slice(0, 5);

  const unc = state.data.tx.filter((x) => !x.category_id && !x.matched).length;
  return `
  <h1>מעשר</h1>
  ${unc ? `<div class="banner" data-review style="cursor:pointer">${unc} תנועות בנק ממתינות לסיווג. לחץ לסיווג</div>` : ''}
  ${t.left > 0.5 ? `<div class="banner">יש חוב מעשר פתוח: ${money(t.left)}</div>` : ''}
  <div class="card hero">
    <div>
      <div class="lbl">${over ? 'נתת יותר מהנדרש ב־' : 'נשאר לתת'}</div>
      <div class="big ${over ? 'over' : ''}">${money(Math.abs(t.left))}</div>
      <div class="sub">מתוך ${money(t.owed)} מעשר נדרש</div>
    </div>
    ${ringSvg(t.owed ? t.given / t.owed : 0)}
  </div>
  <div class="chips">
    <div class="chip"><b>${money(t.earned)}</b><span>הכנסות</span></div>
    <div class="chip"><b>${money(t.owed)}</b><span>מעשר נדרש</span></div>
    <div class="chip"><b>${money(t.given)}</b><span>ניתן בפועל</span></div>
  </div>
  <div class="card"><h2>12 חודשים אחרונים</h2>${barsSvg(months)}
    <div class="legend"><span><i style="background:var(--soft)"></i>נדרש</span><span><i style="background:var(--green2)"></i>ניתן</span></div></div>
  ${slices.length ? `<div class="card"><h2>למי נתתי</h2>${donutSvg(slices)}</div>` : ''}
  <div class="card"><h2>הוראות קבע</h2>
    <div class="muted">${recurring.filter((r) => r.active).length} פעילות · ${money(monthly)} בחודש</div></div>
  <div class="card"><h2>תנועות אחרונות</h2>${recent.length ? recent.map((r) => rowHtml(r.k, r.x)).join('') : '<div class="empty">אין עדיין תנועות</div>'}</div>`;
}

function historyView() {
  const { income, gift } = state.data;
  let rows = [...income.map((x) => ({ k: 'income', x })), ...gift.map((x) => ({ k: 'gift', x }))];
  if (state.filter === 'income') rows = rows.filter((r) => r.k === 'income');
  if (state.filter === 'gift') rows = rows.filter((r) => r.k === 'gift');
  rows.sort((a, b) => (a.x.date < b.x.date ? 1 : a.x.date > b.x.date ? -1 : b.x.id - a.x.id));
  const seg = [['all', 'הכל'], ['income', 'הכנסות'], ['gift', 'מעשרות']]
    .map(([k, l]) => `<button data-filter="${k}" class="${state.filter === k ? 'on' : ''}">${l}</button>`).join('');
  return `<h2 style="margin-top:6px">היסטוריית מעשר</h2><div class="seg">${seg}</div>
  <div class="card">${rows.length ? rows.map((r) => rowHtml(r.k, r.x)).join('') : '<div class="empty">אין תנועות</div>'}</div>`;
}

function recurringView() {
  const list = state.data.recurring;
  const rows = list.map((r) => `<div class="row" data-edit="recurring" data-id="${r.id}">
    <div class="dot">${I.repeat}</div>
    <div class="m"><b>${esc(r.recipient || 'הוראת קבע')}</b><small>ב־${r.day} בחודש${r.category ? ' · ' + esc(r.category) : ''}${r.note ? ' · ' + esc(r.note) : ''}</small></div>
    <div class="amt g">${money(r.amount)}</div>
    <label class="sw" data-stop><input type="checkbox" data-toggle="${r.id}" ${r.active ? 'checked' : ''}><span></span></label></div>`).join('');
  return `<h2 style="margin-top:18px">הוראות קבע של מעשר</h2><p class="muted" style="margin-top:-6px">נוספות אוטומטית לרשימת המעשרות בכל חודש, ביום שהגדרת.</p>
  <div class="card">${rows || '<div class="empty">אין הוראות קבע</div>'}</div>`;
}

function render() {
  const body = { home: overviewView, tx: txView, cards: cardsView, analysis: analysisView, history: () => homeView() + historyView() + recurringView() }[state.tab]();
  const tabs = [['home', I.chart, 'סקירה'], ['tx', I.list, 'תנועות'], ['cards', I.card, 'כרטיסים'], ['analysis', I.spark, 'ניתוח'], ['history', I.heart, 'מעשר']];
  $app.innerHTML = body + `<button class="fab" id="fab" aria-label="הוספה">${I.plus}</button>
  <nav><div class="in">${tabs.map(([k, icon, l]) => `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${icon}${l}</button>`).join('')}</div></nav>`;
}

// ---------- טפסים ----------
function uniq(field) {
  const s = new Set();
  [...state.data.gift, ...state.data.recurring].forEach((g) => g[field] && s.add(g[field]));
  return [...s].map((v) => `<option value="${esc(v)}">`).join('');
}

function openSheet(html, onSave, onDelete) {
  const el = document.createElement('div');
  el.className = 'scrim';
  el.innerHTML = `<form class="sheet">${html}<div class="btns">
    <button class="btn" type="submit">שמירה</button>
    ${onDelete ? '<button class="btn del" type="button" id="del">מחיקה</button>' : ''}
    <button class="btn sec" type="button" id="cancel">ביטול</button></div><div class="err" id="err"></div></form>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.querySelector('#cancel').onclick = close;
  if (onDelete) el.querySelector('#del').onclick = async () => { if (confirm('למחוק?')) { await onDelete(); close(); await reload(); } };
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await onSave(f); close(); await reload(); } catch (err) { el.querySelector('#err').textContent = err.message; }
  };
  el.querySelector('input[name=amount]')?.focus();
}

const inp = (label, name, v = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(v)}" ${extra}></label>`;

function formIncome(x) {
  const e = x || { date: today(), amount: '', description: '', pct: 10 };
  openSheet(`<h2>${x ? 'עריכת הכנסה' : 'הכנסה חדשה'}</h2>
    <div class="two">${inp('סכום (נטו)', 'amount', e.amount, 'type="number" step="any" inputmode="decimal" required')}${inp('תאריך', 'date', e.date, 'type="date" required')}</div>
    ${inp('תיאור', 'description', e.description, 'placeholder="משכורת, קצבה..."')}
    <label>אחוז מעשר<input name="pct" id="pct" value="${e.pct}" type="number" step="any" inputmode="decimal" required></label>
    <div class="pctrow"><button type="button" data-pct="10">10%</button><button type="button" data-pct="20">20%</button><button type="button" data-pct="0">פטור</button></div>`,
    (f) => x ? api('PUT', `/api/income/${x.id}`, norm(f)) : api('POST', '/api/income', norm(f)),
    x && (() => api('DELETE', `/api/income/${x.id}`)));
  document.querySelectorAll('[data-pct]').forEach((b) => (b.onclick = () => (document.getElementById('pct').value = b.dataset.pct)));
}

function formGift(x) {
  const e = x || { date: today(), amount: '', recipient: '', category: '', note: '' };
  openSheet(`<h2>${x ? 'עריכת מעשר שניתן' : 'מעשר שנתתי'}</h2>
    <div class="two">${inp('סכום', 'amount', e.amount, 'type="number" step="any" inputmode="decimal" required')}${inp('תאריך', 'date', e.date, 'type="date" required')}</div>
    ${inp('למי (גבאי / עמותה)', 'recipient', e.recipient, 'list="dl-r"')}<datalist id="dl-r">${uniq('recipient')}</datalist>
    ${inp('קטגוריה / יעד', 'category', e.category, 'list="dl-c"')}<datalist id="dl-c">${uniq('category')}</datalist>
    ${inp('הערה', 'note', e.note)}`,
    (f) => x ? api('PUT', `/api/gift/${x.id}`, norm(f)) : api('POST', '/api/gift', norm(f)),
    x && (() => api('DELETE', `/api/gift/${x.id}`)));
}

function formRecurring(x) {
  const e = x || { amount: '', day: new Date().getDate(), recipient: '', category: '', note: '', start_date: today() };
  openSheet(`<h2>${x ? 'עריכת הוראת קבע' : 'הוראת קבע חדשה'}</h2>
    <div class="two">${inp('סכום חודשי', 'amount', e.amount, 'type="number" step="any" inputmode="decimal" required')}${inp('יום בחודש', 'day', e.day, 'type="number" min="1" max="31" required')}</div>
    ${inp('למי', 'recipient', e.recipient, 'list="dl-r"')}<datalist id="dl-r">${uniq('recipient')}</datalist>
    ${inp('קטגוריה / יעד', 'category', e.category, 'list="dl-c"')}<datalist id="dl-c">${uniq('category')}</datalist>
    ${inp('הערה', 'note', e.note)}
    ${inp('מתחילה מתאריך', 'start_date', e.start_date, 'type="date" required')}`,
    (f) => x ? api('PUT', `/api/recurring/${x.id}`, norm(f)) : api('POST', '/api/recurring', norm(f)),
    x && (() => api('DELETE', `/api/recurring/${x.id}`)));
}

function norm(f) {
  for (const k of ['amount', 'pct', 'day']) if (k in f) f[k] = Number(f[k]);
  return f;
}

function openAdd() {
  const el = document.createElement('div');
  el.className = 'scrim';
  el.innerHTML = `<div class="sheet"><h2>הוספה</h2>
    <div class="btns" style="flex-direction:column">
      <button class="btn add" data-add="gift"><span class="dot">${I.heart}</span>מעשר שנתתי</button>
      <button class="btn add" data-add="income"><span class="dot in">${I.down}</span>הכנסה / משכורת</button>
      <button class="btn add" data-add="recurring"><span class="dot">${I.repeat}</span>הוראת קבע</button></div></div>`;
  document.body.appendChild(el);
  el.onclick = (e) => {
    if (e.target === el) return el.remove();
    const a = e.target.dataset.add; if (!a) return;
    el.remove(); ({ gift: formGift, income: formIncome, recurring: formRecurring })[a]();
  };
}

// ---------- אירועים ----------
$app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-filter],[data-txfilter],[data-edit],[data-review],[data-more],[data-month],[data-cats],[data-q],#fab,[data-stop]');
  if (!t) return;
  if (t.matches('[data-stop]')) return;
  if (t.tagName === 'A') e.preventDefault();
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); scrollTo(0, 0); }
  else if (t.dataset.filter) { state.filter = t.dataset.filter; render(); }
  else if (t.dataset.txfilter) { state.txFilter = t.dataset.txfilter; state.txLimit = 60; render(); }
  else if (t.dataset.q) { document.getElementById('askq').value = t.dataset.q; askAI(t.dataset.q); }
  else if (t.dataset.month) { state.month = t.dataset.month; render(); }
  else if ('cats' in t.dataset) openCategories();
  else if ('review' in t.dataset) openReview();
  else if ('more' in t.dataset) { state.txLimit += 60; render(); }
  else if (t.id === 'fab') openAdd();
  else if (t.dataset.edit) {
    const kind = t.dataset.edit, x = state.data[kind].find((r) => r.id == t.dataset.id);
    ({ income: formIncome, gift: formGift, recurring: formRecurring, tx: formTx })[kind](x);
  }
});
$app.addEventListener('submit', (e) => {
  if (e.target.id !== 'askform') return;
  e.preventDefault();
  const q = document.getElementById('askq').value.trim();
  if (q) askAI(q);
});
$app.addEventListener('change', async (e) => {
  if (e.target.id === 'file' && e.target.files[0]) { await importFile(e.target.files[0]); e.target.value = ''; return; }
  if (e.target.dataset.toggle) {
    await api('PUT', `/api/recurring/${e.target.dataset.toggle}`, { active: e.target.checked ? 1 : 0 });
    await reload();
  }
});

async function reload() { state.data = await api('GET', '/api/data'); render(); }

function renderLogin() {
  $app.innerHTML = `<form class="login"><div class="mark">${I.mark}</div><h1>מעשר</h1>
    <label style="text-align:start">סיסמה<input type="password" name="password" autocomplete="current-password" autofocus></label>
    <div class="btns"><button class="btn" type="submit">כניסה</button></div><div class="err" id="err"></div></form>`;
  $app.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/login', { password: new FormData(e.target).get('password') }); await reload(); }
    catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

// בשרת החינמי הטעינה הראשונה אחרי חוסר פעילות יכולה להיכשל בזמן שהוא מתעורר, לכן מנסים שוב
async function boot(attempt = 0) {
  try { await reload(); } catch (e) {
    if (e.message === 'unauth') return;
    if (attempt < 3) {
      $app.innerHTML = '<div class="empty">טוען... השרת מתעורר</div>';
      return setTimeout(() => boot(attempt + 1), 5000);
    }
    $app.innerHTML = `<div class="empty">שגיאה בטעינה<br><small>${esc(e.message)}</small></div><div class="btns"><button class="btn" id="retry">נסה שוב</button></div>`;
    document.getElementById('retry').onclick = () => boot(0);
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
