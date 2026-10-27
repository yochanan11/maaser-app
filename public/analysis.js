'use strict';
// כרטיסי אשראי והתאמה לבנק, וניתוח: מנויים, קבוצות הוצאה, שינויים ושאלות חופשיות. נטען אחרי features.js.
I.card = ic('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>');
I.spark = ic('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>');
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- כרטיסים והתאמה לדירקט ----------
function cardRecon() {
  const cards = {};
  const get = (id, name) => (cards[id] ||= { id, name, detail: {}, bank: {}, n: 0, total: 0, hasDetail: false });
  state.data.tx.filter((t) => t.source !== 'bank').forEach((t) => {
    const c = get(t.card, t.source === 'cal' ? 'כאל' : 'ישראכרד');
    c.detail[t.date] = r2((c.detail[t.date] || 0) - t.amount);
    c.n++; c.total = r2(c.total - t.amount); c.hasDetail = true;
  });
  const calIds = Object.values(cards).filter((c) => c.name === 'כאל').map((c) => c.id);
  state.data.tx.filter((t) => t.source === 'bank').forEach((t) => {
    if (/דירקט/.test(t.description) && /^\d{4}/.test(String(t.ref))) {
      const c = get(String(t.ref).slice(0, 4), 'ישראכרד');
      c.bank[t.date] = r2((c.bank[t.date] || 0) - t.amount);
    } else if (/כרטיסי אשראי/.test(t.description) && calIds.length) {
      const c = cards[calIds[0]];
      c.bank[t.date] = r2((c.bank[t.date] || 0) - t.amount);
    }
  });
  return Object.values(cards).map((c) => {
    const dates = [...new Set([...Object.keys(c.detail), ...Object.keys(c.bank)])].sort().reverse();
    const rows = dates.map((date) => {
      const d = c.detail[date], b = c.bank[date];
      const status = d === undefined ? 'nodetail' : b === undefined ? 'nobank' : Math.abs(d - b) < 0.01 ? 'ok' : 'diff';
      return { date, detail: d, bank: b, diff: d !== undefined && b !== undefined ? r2(d - b) : null, status };
    });
    return { ...c, rows, ok: rows.filter((x) => x.status === 'ok').length };
  }).sort((a, b) => b.hasDetail - a.hasDetail || a.id.localeCompare(b.id));
}

const STATUS = {
  ok: ['תואם', 'var(--pos)'], diff: ['הפרש', 'var(--red)'],
  nodetail: ['אין פירוט', 'var(--gold)'], nobank: ['לא נמצא בבנק', 'var(--muted)'],
};

function cardsView() {
  const cards = cardRecon();
  if (!cards.length) return `<h1>כרטיסי אשראי</h1><div class="card"><div class="empty">אין עדיין נתוני כרטיסים.<br>ייבא קבצים בלשונית "תנועות".</div></div>`;
  const kinds = catKind(), names = catName();
  const html = cards.map((c) => {
    const rows = c.rows.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${x.detail === undefined ? '—' : money(x.detail)}</td><td>${x.bank === undefined ? '—' : money(x.bank)}</td>
      <td style="color:${STATUS[x.status][1]}">${x.diff ? signed(x.diff) : ''} ${STATUS[x.status][0]}</td></tr>`).join('');
    const cat = {};
    state.data.tx.filter((t) => t.card === c.id && t.source !== 'bank').forEach((t) => { const n = names[t.category_id] || 'לא מסווג'; cat[n] = (cat[n] || 0) - t.amount; });
    const list = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = list.length ? Math.abs(list[0][1]) : 1;
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h2 style="margin:0">${c.name} · ${c.id}</h2>
        <span class="tag" style="margin:0;color:${c.hasDetail ? 'var(--pos)' : 'var(--gold)'}">${c.hasDetail ? `${c.ok} מתוך ${c.rows.length} ימים תואמים` : 'אין פירוט, רק חיובי בנק'}</span></div>
      ${c.hasDetail ? `<div class="muted" style="font-size:.85rem;margin-bottom:10px">${c.n} עסקאות · סה״כ ${money(c.total)}</div>
        ${list.map(([n, v]) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:.86rem"><span>${esc(n)}</span><b class="amt">${money(v)}</b></div><div class="bar"><i style="width:${Math.max(3, (Math.abs(v) / max) * 100)}%"></i></div></div>`).join('')}` : ''}
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">התאמה מול הבנק (תאריך חיוב)</summary>
        <div class="tablewrap"><table class="recon"><thead><tr><th>תאריך</th><th>פירוט כרטיס</th><th>בנק</th><th>סטטוס</th></tr></thead><tbody>${rows}</tbody></table></div></details></div>`;
  }).join('');
  const bad = cards.flatMap((c) => c.rows.filter((x) => x.status === 'diff' || x.status === 'nodetail'));
  return `<h1>כרטיסי אשראי</h1>
  ${bad.length ? `<div class="banner" style="background:var(--soft);color:var(--ink)">${bad.length} ימי חיוב בלי התאמה מלאה. לחץ על "התאמה מול הבנק" בכל כרטיס לפרטים</div>` : '<div class="banner">כל החיובים תואמים לבנק</div>'}
  <div class="grid">${html}</div>`;
}

// ---------- ניתוח ----------
const INST = /תשלום\s*(\d+)\s*מ\s*-?\s*(\d+)/;

function subscriptions() {
  const kinds = catKind();
  const by = {};
  COUNTED_TX().filter((t) => t.amount < 0 && !['transfer', 'income', 'tithe', 'saving'].includes(kinds[t.category_id]) && !/^דירקט|^משיכה/.test(t.description))
    .forEach((t) => (by[t.description] ||= []).push(t));
  const out = [];
  for (const [name, list] of Object.entries(by)) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    const flagged = list.some((t) => /הוראת קבע|הו"ק|חיוב חודשי/.test(`${t.details} ${name}`));
    const inst = list.map((t) => (t.details || '').match(INST)).find(Boolean);
    if (!flagged && !inst && months.size < 2) continue;
    const amounts = list.map((t) => -t.amount).sort((a, b) => a - b);
    const typical = amounts[Math.floor(amounts.length / 2)];
    const perMonth = {};
    list.forEach((t) => { const m = t.date.slice(0, 7); perMonth[m] = (perMonth[m] || 0) - t.amount; });
    const monthly = Object.values(perMonth).sort((a, b) => a - b)[Math.floor(Object.values(perMonth).length / 2)];
    out.push({
      name, count: list.length, monthly: r2(monthly), typical: r2(typical), last: list.map((t) => t.date).sort().pop(),
      type: inst ? `תשלומים (${inst[1]} מתוך ${inst[2]})` : flagged ? 'הוראת קבע' : 'חוזר',
      remaining: inst ? (Number(inst[2]) - Number(inst[1])) * typical : 0,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

function groupStats() {
  const groups = {};
  const grpOf = Object.fromEntries(state.data.category.filter((c) => c.grp).map((c) => [c.id, c.grp]));
  const names = catName();
  COUNTED_TX().filter((t) => grpOf[t.category_id] && t.amount < 0).forEach((t) => {
    const g = (groups[grpOf[t.category_id]] ||= { name: grpOf[t.category_id], total: 0, months: {}, cats: {}, merchants: {} });
    g.total -= t.amount;
    g.months[t.date.slice(0, 7)] = (g.months[t.date.slice(0, 7)] || 0) - t.amount;
    g.cats[names[t.category_id]] = (g.cats[names[t.category_id]] || 0) - t.amount;
    g.merchants[t.description] = (g.merchants[t.description] || 0) - t.amount;
  });
  return Object.values(groups).sort((a, b) => b.total - a.total);
}

function changes() {
  const ms = monthsList();
  if (ms.length < 2) return [];
  const cur = monthStats(ms[0]).byCat, prev = monthStats(ms[1]).byCat;
  return [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
    .map((n) => ({ name: n, cur: cur[n] || 0, prev: prev[n] || 0, delta: (cur[n] || 0) - (prev[n] || 0) }))
    .filter((x) => Math.abs(x.delta) >= 50).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
}

function analysisView() {
  if (!state.data.tx.length) return `<h1>ניתוח</h1><div class="card"><div class="empty">ייבא נתונים כדי לראות ניתוח.</div></div>`;
  const subs = subscriptions().filter((s) => s.type !== 'חוזר' || s.count >= 2);
  const groups = groupStats();
  const ch = changes();
  const ms = monthsList();
  const subTotal = subs.filter((s) => !s.type.startsWith('תשלומים')).reduce((s, x) => s + x.monthly, 0);

  const subHtml = subs.length ? subs.map((s) => `<div class="row" style="cursor:default"><div class="dot">${I.repeat}</div>
      <div class="m"><b>${esc(s.name)}</b><small>${s.type}${s.remaining ? ` · נותרו ${money(s.remaining)}` : ''} · אחרון ${fmtDate(s.last)}</small></div>
      <div class="amt">${money(s.monthly)}</div></div>`).join('') : '<div class="empty">עוד לא זוהו חיובים חוזרים. ככל שתייבא חודשים נוספים הזיהוי משתפר.</div>';

  const groupHtml = groups.length ? groups.map((g) => {
    const cats = Object.entries(g.cats).sort((a, b) => b[1] - a[1]);
    const top = Object.entries(g.merchants).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const monthsN = Object.keys(g.months).length || 1;
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(g.name)}</h2><b style="font-size:1.4rem">${money(g.total)}</b></div>
      <div class="muted" style="font-size:.82rem;margin:2px 0 10px">ממוצע חודשי ${money(g.total / monthsN)} · ${monthsN} חודשים בנתונים</div>
      ${cats.map(([n, v]) => `<div style="display:flex;justify-content:space-between;font-size:.88rem;padding:3px 0"><span>${esc(n)}</span><b class="amt">${money(v)}</b></div>`).join('')}
      <div class="muted" style="font-size:.8rem;margin-top:8px">הגדולים: ${top.map(([n, v]) => `${esc(n)} ${money(v)}`).join(' · ')}</div></div>`;
  }).join('') : `<div class="card"><h2>קבוצות הוצאה</h2><div class="muted" style="font-size:.9rem">כדי לראות למשל כמה עולה הרכב: פתח <a href="#" data-cats style="color:var(--pos)">ניהול קטגוריות</a>, צור קטגוריות (דלק, ביטוח רכב, כבישי אגרה, חניה) ורשום בשדה "קבוצה" את הערך "רכב".</div></div>`;

  return `<h1>ניתוח</h1>
  <div class="card ask"><h2>שאל על הכסף שלך</h2>
    <form id="askform"><input id="askq" placeholder="למשל: כמה הוצאתי על מסעדות? מה השתנה מהחודש שעבר?" autocomplete="off"><button class="btn" type="submit">${I.spark} שאל</button></form>
    <div class="chips-row">${['כמה עולה לי הרכב בחודש?', 'על מה הוצאתי הכי הרבה?', 'מה השתנה לעומת החודש הקודם?', 'אילו מנויים אפשר לבטל?'].map((q) => `<button type="button" data-q="${q}">${q}</button>`).join('')}</div>
    <div id="askout" class="askout"></div></div>
  <div class="grid">
    <div class="card"><h2>מנויים והוצאות קבועות</h2>
      <div class="muted" style="font-size:.85rem;margin:-6px 0 10px">${subs.filter((s) => !s.type.startsWith('תשלומים')).length} חיובים קבועים · כ־${money(subTotal)} בחודש (${money(subTotal * 12)} בשנה)</div>${subHtml}</div>
    <div class="grid-col">${groupHtml}
      ${ch.length ? `<div class="card"><h2>מה השתנה מהחודש הקודם</h2>${ch.map((x) => `<div style="display:flex;justify-content:space-between;font-size:.9rem;padding:4px 0"><span>${esc(x.name)}</span>
        <b class="amt" style="color:${x.delta > 0 ? 'var(--red)' : 'var(--pos)'}">${x.delta > 0 ? '▲' : '▼'} ${money(Math.abs(x.delta))}</b></div>`).join('')}
        <div class="muted" style="font-size:.78rem;margin-top:6px">${MONTHS[Number(ms[0].slice(5)) - 1]} מול ${MONTHS[Number(ms[1].slice(5)) - 1]}</div></div>` : ''}
    </div>
  </div>`;
}

// סיכום מצומצם בלבד נשלח למודל: סכומים לפי חודש וקטגוריה, בתי עסק מובילים, מנויים וקבוצות
function aiContext() {
  const names = catName(), kinds = catKind();
  const monthly = {};
  COUNTED_TX().forEach((t) => {
    const m = t.date.slice(0, 7), n = names[t.category_id] || 'לא מסווג';
    const e = ((monthly[m] ||= {})[n] ||= { סוג: kinds[t.category_id] || 'לא מסווג', סכום: 0, תנועות: 0 });
    e.סכום = r2(e.סכום + t.amount); e.תנועות++;
  });
  const merch = {};
  COUNTED_TX().filter((t) => t.amount < 0).forEach((t) => {
    const e = (merch[t.description] ||= { קטגוריה: names[t.category_id] || 'לא מסווג', סכום: 0, פעמים: 0 });
    e.סכום = r2(e.סכום - t.amount); e.פעמים++;
  });
  const top = Object.entries(merch).sort((a, b) => b[1].סכום - a[1].סכום).slice(0, 80);
  return {
    הערה: 'סכומים שליליים הם הוצאות, חיוביים הכנסות. תנועות שכוסו בפירוט כרטיס לא נספרות פעמיים.',
    קטגוריות: state.data.category.map((c) => ({ שם: c.name, סוג: c.kind, קבוצה: c.grp || '' })),
    לפי_חודש_וקטגוריה: monthly,
    בתי_עסק_מובילים: Object.fromEntries(top),
    מנויים_וחיובים_קבועים: subscriptions().slice(0, 40).map((s) => ({ שם: s.name, סוג: s.type, חודשי: s.monthly })),
    קבוצות: groupStats().map((g) => ({ קבוצה: g.name, סהכ: r2(g.total), לפי_חודש: g.months, לפי_קטגוריה: g.cats })),
    מעשר: (() => { const t = totals(); return { נדרש: r2(t.owed), ניתן: r2(t.given), נשאר: r2(t.left) }; })(),
  };
}

async function askAI(question) {
  const out = document.getElementById('askout');
  out.textContent = 'חושב...';
  try {
    const r = await api('POST', '/api/ask', { question, context: aiContext() });
    out.textContent = r.answer;
  } catch (e) { out.textContent = e.message; }
}
