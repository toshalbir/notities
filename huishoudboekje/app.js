// Huishoudboekje — offline-first PWA with optional Supabase sync.
(() => {
  'use strict';

  const STORE_KEY = 'hb.v1.expenses';
  const CFG_KEY = 'hb.v1.settings';
  const REC_KEY = 'hb.v1.recurring';
  const SUPABASE_MODULE = 'https://esm.sh/@supabase/supabase-js@2.119.2';
  const DEFAULT_CFG = {
    url: 'https://dsrzgovpfknnziuvzdbg.supabase.co',
    key: 'sb_publishable_b65BLKzwkB02scmuN1re2A_sTtsr48C'
  };

  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  const DAYNAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

  const CATEGORIES = [
    { id: 'boodschappen', label: 'Boodschappen', color: '#b8862f', emoji: '🛒' },
    { id: 'eten',         label: 'Eten buiten',   color: '#c8623a', emoji: '🍽️' },
    { id: 'vervoer',      label: 'Vervoer',       color: '#416c86', emoji: '🚲' },
    { id: 'wonen',        label: 'Wonen',         color: '#8b6aa3', emoji: '🏠' },
    { id: 'kleding',      label: 'Kleding',       color: '#b34b42', emoji: '👕' },
    { id: 'gezondheid',   label: 'Gezondheid',    color: '#3d7a50', emoji: '💊' },
    { id: 'ontspanning',  label: 'Ontspanning',   color: '#4d8d8a', emoji: '🎬' },
    { id: 'overig',       label: 'Overig',        color: '#7a7a72', emoji: '📦' }
  ];

  const SQL = `create table if not exists public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  category text not null,
  spent_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists expenses_user_spent_idx
  on public.expenses (user_id, spent_on desc);

alter table public.expenses enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.expenses replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;`;

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const moneyFmt = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const money = (n) => moneyFmt.format(n || 0);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  function parseYmd(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ymd(d) === key ? d : null;
  }

  function parseMonth(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11) return null;
    return { year: Number(m[1]), month };
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Stable UUID for a recurring rule + month, so two devices never create
  // duplicate rows for the same recurring expense.
  function uuidFrom(text) {
    let h = 2166136261;
    let hex = '';
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i) + pass;
        h = Math.imul(h, 16777619);
      }
      hex += (h >>> 0).toString(16).padStart(8, '0');
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  function parseAmount(value) {
    let s = String(value ?? '').trim().replace(/\s|€/g, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - start) / 86400000 + 1) / 7);
  }

  function catOf(id) {
    return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  }

  function uid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  /* ---------- State ---------- */

  const today = new Date();
  const state = {
    expenses: [],
    cfg: { url: '', key: '' },
    view: 'calendar',
    year: today.getFullYear(),
    month: today.getMonth(),
    selectedDate: null,
    filterCategory: 'all',
    entryCategory: 'boodschappen',
    editingId: null,
    recurring: [],
    recCategory: 'wonen',
    editingRecId: null,
    lastSync: null
  };

  let client = null;
  let user = null;
  let channel = null;
  let syncBusy = false;
  let syncTimer = null;
  let toastTimer = null;

  function normalizeExpense(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const amount = Number(raw.amount);
    const date = parseYmd(raw.spentOn);
    if (!Number.isFinite(amount) || amount <= 0 || !date) return null;
    return {
      id: String(raw.id || uid()),
      amount: Math.round(amount * 100) / 100,
      category: catOf(raw.category).id,
      spentOn: raw.spentOn,
      note: String(raw.note || '').slice(0, 80),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
      deleted: Boolean(raw.deleted),
      dirty: Boolean(raw.dirty),
      auto: Boolean(raw.auto),
      recurringId: raw.recurringId ? String(raw.recurringId) : null
    };
  }

  function loadExpenses() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return (Array.isArray(raw) ? raw : []).map(normalizeExpense).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      return {
        url: String(raw.url || DEFAULT_CFG.url).trim().replace(/\/$/, ''),
        key: String(raw.key || DEFAULT_CFG.key).trim()
      };
    } catch (_) {
      return { ...DEFAULT_CFG };
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.expenses));
      return true;
    } catch (_) {
      toast('Opslag vol – kon niet bewaren');
      return false;
    }
  }

  function saveCfg() {
    localStorage.setItem(CFG_KEY, JSON.stringify(state.cfg));
  }

  function normalizeRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const amount = Number(raw.amount);
    const day = Number(raw.day);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(day) || day < 1 || day > 31) return null;
    return {
      id: String(raw.id || uid()),
      amount: Math.round(amount * 100) / 100,
      category: catOf(raw.category).id,
      day,
      note: String(raw.note || '').slice(0, 80),
      start: parseMonth(raw.start) ? String(raw.start) : ymd(new Date()).slice(0, 7),
      end: parseMonth(raw.end) ? String(raw.end) : null
    };
  }

  function loadRecurring() {
    try {
      const raw = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
      return (Array.isArray(raw) ? raw : []).map(normalizeRule).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function persistRecurring() {
    try {
      localStorage.setItem(REC_KEY, JSON.stringify(state.recurring));
      return true;
    } catch (_) {
      toast('Opslag vol – kon de regel niet bewaren');
      return false;
    }
  }

  function visibleExpenses() {
    return state.expenses.filter((e) => !e.deleted);
  }

  function groupByDate(list) {
    const groups = new Map();
    for (const e of list) {
      if (!groups.has(e.spentOn)) groups.set(e.spentOn, []);
      groups.get(e.spentOn).push(e);
    }
    for (const rows of groups.values()) rows.sort((a, b) => b.createdAt - a.createdAt);
    return groups;
  }

  function sum(list) {
    return list.reduce((total, e) => total + e.amount, 0);
  }

  function inMonth(key) {
    return key.startsWith(`${state.year}-${pad(state.month + 1)}-`);
  }

  // Create (and keep in sync) one expense per month for every recurring rule.
  // Past months are left alone once generated; changes apply from this month on.
  function applyRecurring() {
    const now = new Date();
    let changed = false;
    for (const rule of state.recurring) {
      const start = parseMonth(rule.start) || { year: now.getFullYear(), month: now.getMonth() };
      const end = parseMonth(rule.end);
      let y = start.year;
      let m = start.month;
      for (let guard = 0; guard < 240; guard++) {
        if (end && (y > end.year || (y === end.year && m > end.month))) break;
        if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) break;
        const key = `${y}-${pad(m + 1)}`;
        const spentOn = ymd(new Date(y, m, Math.min(rule.day, daysInMonth(y, m))));
        const note = rule.note || `${catOf(rule.category).label} (terugkerend)`;
        const id = uuidFrom(`hb-rec:${rule.id}:${key}`);
        const existing = state.expenses.find((e) => e.id === id);
        if (!existing) {
          state.expenses.push({
            id, amount: rule.amount, spentOn, category: rule.category, note,
            createdAt: Date.now(), updatedAt: Date.now(), deleted: false, dirty: true,
            auto: true, recurringId: rule.id
          });
          changed = true;
        } else if (existing.auto && !existing.deleted &&
                   (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth()))) {
          if (existing.amount !== rule.amount || existing.category !== rule.category ||
              existing.note !== note || existing.spentOn !== spentOn) {
            Object.assign(existing, {
              amount: rule.amount, category: rule.category, note, spentOn,
              updatedAt: Date.now(), dirty: true
            });
            changed = true;
          }
        }
        const next = new Date(y, m + 1, 1);
        y = next.getFullYear();
        m = next.getMonth();
      }
    }
    if (changed) persist();
    return changed;
  }

  /* ---------- Feedback ---------- */

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setSync(kind, text) {
    $('sync-pill').className = 'sync-pill' + (kind ? ' ' + kind : '');
    $('sync-text').textContent = text;
  }

  function setAuthStatus(message, isError = false) {
    const el = $('auth-status');
    el.textContent = message;
    el.style.color = isError ? 'var(--red)' : 'var(--muted)';
  }

  /* ---------- Rendering ---------- */

  function renderMonthBar() {
    $('month-title').textContent = `${MONTHS[state.month]} ${state.year}`;
    const rows = visibleExpenses().filter((e) => inMonth(e.spentOn));
    const total = sum(rows);
    $('month-sub').textContent = `Maandtotaal ${money(total)} · ${rows.length} ${rows.length === 1 ? 'uitgave' : 'uitgaven'}`;
    $('month-bar').style.display = ['settings', 'year', 'recurring'].includes(state.view) ? 'none' : 'flex';
  }

  function renderCalendar() {
    const groups = groupByDate(visibleExpenses());
    const first = new Date(state.year, state.month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const start = new Date(state.year, state.month, 1 - offset);
    const todayKey = ymd(new Date());

    let html = WEEKDAYS.map((d) => `<div class="dow">${d}</div>`).join('') +
      '<div class="dow week-dow">week</div>';

    for (let w = 0; w < 6; w++) {
      let weekSum = 0;
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
        const key = ymd(date);
        const rows = groups.get(key) || [];
        const daySum = sum(rows);
        if (date.getMonth() === state.month) weekSum += daySum;
        const classes = ['day'];
        if (date.getMonth() !== state.month) classes.push('other');
        if (key === todayKey) classes.push('today');
        if (key === state.selectedDate) classes.push('selected');
        const items = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
        const dayItems = items.slice(0, 5).map((e) => {
          const cat = catOf(e.category);
          return `<li class="day-item"><span class="cat-dot" style="background:${cat.color}"></span>` +
            `<span class="di-label">${esc(e.note || cat.label)}</span><b>${money(e.amount)}</b></li>`;
        }).join('') + (items.length > 5 ? `<li class="day-item di-more">+${items.length - 5} meer</li>` : '');
        html += `<div class="${classes.join(' ')}" role="button" tabindex="0" data-date="${key}" aria-label="${DAYNAMES[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}">` +
          `<span class="dnum">${date.getDate()}</span>` +
          (daySum ? `<span class="amt">${money(daySum)}</span>` : '') +
          (dayItems ? `<ul class="day-items">${dayItems}</ul>` : '') +
          (rows.length ? `<span class="cnt">${rows.length}x</span>` : '') +
          '</div>';
      }
      const thursday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + 3);
      html += `<div class="week-total">${money(weekSum)}<small>wk ${isoWeek(thursday)}</small></div>`;
    }
    $('calendar').innerHTML = html;

    const monthRows = visibleExpenses().filter((e) => inMonth(e.spentOn));
    const total = sum(monthRows);
    const prevDate = new Date(state.year, state.month - 1, 1);
    const prevTotal = sum(visibleExpenses().filter((e) =>
      e.spentOn.startsWith(`${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}-`)));

    const byCat = new Map();
    for (const e of monthRows) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    const diff = total - prevTotal;
    let compare = `Vorige maand: ${money(prevTotal)}`;
    if (prevTotal > 0) compare += ` · ${diff >= 0 ? '+' : '−'} ${money(Math.abs(diff))}`;

    $('summary-strip').innerHTML =
      '<div class="big-row"><span>Totaal deze maand</span><strong>' + money(total) + '</strong></div>' +
      `<div class="compare">${esc(compare)}</div>` +
      (top ? `<div class="compare">Grootste post: ${esc(catOf(top[0]).label)} · ${money(top[1])}</div>` : '');
  }

  function renderList() {
    let rows = visibleExpenses().filter((e) => inMonth(e.spentOn));
    if (state.filterCategory !== 'all') rows = rows.filter((e) => e.category === state.filterCategory);
    rows.sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAt - a.createdAt);

    if (!rows.length) {
      $('expense-list').innerHTML = '<p class="empty">Nog geen uitgaven deze maand.</p>';
      return;
    }

    const groups = groupByDate(rows);
    let html = `<div class="date-group"><h3>Totaal <small>${money(sum(rows))}</small></h3></div>`;
    for (const [key, list] of [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const d = parseYmd(key) || new Date();
      html += `<div class="date-group"><h3>${DAYNAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}<small>${money(sum(list))}</small></h3>`;
      for (const e of list) {
        const cat = catOf(e.category);
        html += `<button type="button" class="expense-row" data-id="${esc(e.id)}">` +
          `<span class="cat-dot" style="background:${cat.color}"></span>` +
          `<span class="desc"><b>${esc(cat.label)}</b>` +
          (e.note ? `<small>${esc(e.note)}</small>` : '') + '</span>' +
          `<span class="money">${money(e.amount)}</span></button>`;
      }
      html += '</div>';
    }
    $('expense-list').innerHTML = html;
  }

  function renderCategories() {
    const rows = visibleExpenses().filter((e) => inMonth(e.spentOn));
    const total = sum(rows);
    const byCat = new Map();
    for (const e of rows) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
    const entries = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      $('category-bars').innerHTML = '<p class="empty">Nog geen uitgaven deze maand.</p>';
      return;
    }
    const max = entries[0][1];
    $('category-bars').innerHTML = entries.map(([id, amount]) => {
      const cat = catOf(id);
      const pct = total ? Math.round(amount / total * 100) : 0;
      return `<div class="cat-row">` +
        `<div class="cat-top"><span class="cat-dot" style="background:${cat.color}"></span>` +
        `<b>${esc(cat.label)}</b><span>${money(amount)}</span><em>${pct}%</em></div>` +
        `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, amount / max * 100)}%;background:${cat.color}"></div></div>` +
        '</div>';
    }).join('') + `<p class="hint" style="margin-top:18px">Totaal: <strong>${money(total)}</strong></p>`;
  }

  function renderYear() {
    $('year-title').textContent = String(state.year);
    const rows = visibleExpenses().filter((e) => e.spentOn.startsWith(`${state.year}-`));
    const total = sum(rows);
    $('year-sub').textContent = `Jaartotaal ${money(total)} · ${rows.length} ${rows.length === 1 ? 'uitgave' : 'uitgaven'}`;

    const monthly = MONTHS.map((_, m) => {
      const list = rows.filter((e) => Number(e.spentOn.slice(5, 7)) === m + 1);
      return { month: m, sum: sum(list), count: list.length };
    });
    const max = Math.max(...monthly.map((m) => m.sum), 1);
    $('year-overview').innerHTML = monthly.map((m) => {
      const future = state.year > today.getFullYear() ||
        (state.year === today.getFullYear() && m.month > today.getMonth());
      return `<button type="button" class="month-card${future ? ' future' : ''}" data-month="${m.month}" ` +
        `aria-label="${MONTHS[m.month]} ${state.year}">` +
        `<span class="mc-name">${MONTHS[m.month]}</span>` +
        `<span class="mc-total">${money(m.sum)}</span>` +
        `<span class="mc-meta">${m.count} ${m.count === 1 ? 'uitgave' : 'uitgaven'}</span>` +
        `<span class="mc-track"><span class="mc-fill" style="width:${Math.max(2, m.sum / max * 100)}%"></span></span>` +
        '</button>';
    }).join('');

    const prev = sum(visibleExpenses().filter((e) => e.spentOn.startsWith(`${state.year - 1}-`)));
    const active = monthly.filter((m) => m.count);
    const top = active.slice().sort((a, b) => b.sum - a.sum)[0];
    const diff = total - prev;
    let compare = `${state.year - 1}: ${money(prev)}`;
    if (prev > 0) compare += ` · ${diff >= 0 ? '+' : '−'} ${money(Math.abs(diff))}`;
    $('year-summary').innerHTML =
      '<div class="big-row"><span>Totaal ' + state.year + '</span><strong>' + money(total) + '</strong></div>' +
      `<div class="compare">${esc(compare)}</div>` +
      (top ? `<div class="compare">Grootste maand: ${MONTHS[top.month]} · ${money(top.sum)}</div>` : '') +
      (active.length ? `<div class="compare">Gemiddeld per maand met uitgaven: ${money(total / active.length)}</div>` : '');
  }

  function renderRecChips() {
    $('rec-chips').innerHTML = CATEGORIES.map((c) =>
      `<button type="button" class="chip${c.id === state.recCategory ? ' active' : ''}" data-rec-cat="${c.id}">` +
      `<span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</button>`
    ).join('');
  }

  function renderRecurring() {
    if (!state.recurring.length) {
      $('rec-list').innerHTML = '<p class="hint">Nog geen regels. Vul hierboven bijvoorbeeld je huishuur in.</p>';
      return;
    }
    $('rec-list').innerHTML = state.recurring.slice().sort((a, b) => a.day - b.day).map((r) => {
      const cat = catOf(r.category);
      const count = state.expenses.filter((e) => e.recurringId === r.id && !e.deleted).length;
      return '<div class="rec-row">' +
        `<span class="cat-dot" style="background:${cat.color}"></span>` +
        `<div class="rec-main" data-rec-edit="${esc(r.id)}"><b>${esc(r.note || cat.label)}</b>` +
        `<small>${esc(cat.label)} · dag ${r.day}${r.end ? ` · t/m ${esc(r.end)}` : ''} · ${count} maanden</small></div>` +
        `<span class="rec-amount">${money(r.amount)}</span>` +
        `<button type="button" data-rec-edit="${esc(r.id)}">Bewerk</button>` +
        `<button type="button" class="del" data-rec-del="${esc(r.id)}">Verwijder</button>` +
        '</div>';
    }).join('');
  }

  function renderSettings() {
    // Don't overwrite credentials while someone is typing in them.
    if (document.activeElement !== $('cfg-url')) $('cfg-url').value = state.cfg.url;
    if (document.activeElement !== $('cfg-key')) $('cfg-key').value = state.cfg.key;
    $('sql-snippet').textContent = SQL;
    $('data-count').textContent = `${state.expenses.length} uitgaven lokaal opgeslagen, waarvan ${state.expenses.filter((e) => e.dirty).length} nog te syncen.`;
    if (user) setAuthStatus(`Ingelogd als ${user.email}`, false);
  }

  function renderAll() {
    renderMonthBar();
    renderCalendar();
    renderList();
    renderCategories();
    renderYear();
    renderRecurring();
    renderSettings();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    renderSettings();
    renderMonthBar();
  }

  /* ---------- Entry sheet ---------- */

  function renderChips() {
    $('entry-chips').innerHTML = CATEGORIES.map((c) =>
      `<button type="button" class="chip${c.id === state.entryCategory ? ' active' : ''}" data-cat="${c.id}">` +
      `<span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</button>`
    ).join('');
  }

  function openEntry(id = null, presetDate = null) {
    state.editingId = id;
    const expense = id ? state.expenses.find((e) => e.id === id) : null;
    $('entry-title').textContent = expense ? 'Uitgave bewerken' : 'Nieuwe uitgave';
    $('entry-amount').value = expense ? String(expense.amount).replace('.', ',') : '';
    $('entry-date').value = expense ? expense.spentOn : (presetDate || ymd(new Date()));
    $('entry-note').value = expense ? expense.note : '';
    state.entryCategory = expense ? expense.category : 'boodschappen';
    $('btn-delete').hidden = !expense;
    renderChips();
    $('day-overlay').hidden = true; // avoid stacking two sheets with stale content
    $('entry-overlay').hidden = false;
    setTimeout(() => $('entry-amount').focus(), 60);
  }

  function closeOverlay(id) {
    $(id).hidden = true;
  }

  function saveEntry(event) {
    event.preventDefault();
    const amount = parseAmount($('entry-amount').value);
    const date = $('entry-date').value;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Vul een geldig bedrag in');
      $('entry-amount').focus();
      return;
    }
    if (!parseYmd(date)) {
      toast('Kies een geldige datum');
      return;
    }
    const now = Date.now();
    const existing = state.editingId ? state.expenses.find((e) => e.id === state.editingId) : null;
    if (existing) {
      Object.assign(existing, {
        amount, spentOn: date, category: state.entryCategory,
        note: $('entry-note').value.trim(), updatedAt: now, dirty: true, auto: false
      });
    } else {
      state.expenses.push({
        id: uid(), amount, spentOn: date, category: state.entryCategory,
        note: $('entry-note').value.trim(), createdAt: now, updatedAt: now,
        deleted: false, dirty: true
      });
    }
    state.selectedDate = date;
    persist();
    closeOverlay('entry-overlay');
    renderAll();
    toast(existing ? 'Uitgave bijgewerkt' : 'Uitgave bewaard');
    scheduleSync();
  }

  function deleteEntry() {
    const e = state.expenses.find((x) => x.id === state.editingId);
    if (!e || !confirm('Deze uitgave verwijderen?')) return;
    e.deleted = true;
    e.updatedAt = Date.now();
    e.dirty = true;
    persist();
    closeOverlay('entry-overlay');
    renderAll();
    toast('Uitgave verwijderd');
    scheduleSync();
  }

  /* ---------- Day sheet ---------- */

  function openDay(key) {
    const date = parseYmd(key);
    if (!date) return;
    state.selectedDate = key;
    const rows = visibleExpenses().filter((e) => e.spentOn === key);
    $('day-title').textContent = `${DAYNAMES[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
    let html = `<div class="day-total-line"><span>${rows.length} ${rows.length === 1 ? 'uitgave' : 'uitgaven'}</span><b>${money(sum(rows))}</b></div>`;
    if (!rows.length) html += '<p class="empty">Nog niets op deze dag.</p>';
    for (const e of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const cat = catOf(e.category);
      html += `<button type="button" class="expense-row" data-id="${esc(e.id)}">` +
        `<span class="cat-dot" style="background:${cat.color}"></span>` +
        `<span class="desc"><b>${esc(cat.label)}</b>` + (e.note ? `<small>${esc(e.note)}</small>` : '') + '</span>' +
        `<span class="money">${money(e.amount)}</span></button>`;
    }
    $('day-entries').innerHTML = html;
    $('day-overlay').hidden = false;
    renderCalendar();
  }

  /* ---------- Recurring rules ---------- */

  function resetRecForm() {
    state.editingRecId = null;
    $('rec-amount').value = '';
    $('rec-day').value = '1';
    $('rec-start').value = ymd(new Date()).slice(0, 7);
    $('rec-end').value = '';
    $('rec-note').value = '';
    state.recCategory = 'wonen';
    renderRecChips();
    $('btn-add-rec').textContent = 'Regel toevoegen';
    $('btn-cancel-rec').hidden = true;
  }

  function editRec(id) {
    const rule = state.recurring.find((r) => r.id === id);
    if (!rule) return;
    state.editingRecId = id;
    $('rec-amount').value = String(rule.amount).replace('.', ',');
    $('rec-day').value = String(rule.day);
    $('rec-start').value = rule.start;
    $('rec-end').value = rule.end || '';
    $('rec-note').value = rule.note;
    state.recCategory = rule.category;
    renderRecChips();
    $('btn-add-rec').textContent = 'Regel bijwerken';
    $('btn-cancel-rec').hidden = false;
    $('rec-amount').focus();
  }

  function saveRec() {
    const amount = parseAmount($('rec-amount').value);
    const day = Number($('rec-day').value);
    const start = $('rec-start').value;
    const end = $('rec-end').value;
    if (!Number.isFinite(amount) || amount <= 0) { toast('Vul een geldig bedrag in'); $('rec-amount').focus(); return; }
    if (!Number.isInteger(day) || day < 1 || day > 31) { toast('Kies een dag tussen 1 en 31'); return; }
    if (!parseMonth(start)) { toast('Kies een geldige startdatum'); return; }
    if (end && !parseMonth(end)) { toast('Kies een geldige einddatum'); return; }
    if (end && end < start) { toast('De einddatum ligt vóór de startdatum'); return; }

    const rule = normalizeRule({
      id: state.editingRecId || undefined,
      amount, day, category: state.recCategory,
      note: $('rec-note').value.trim(), start, end
    });
    const idx = state.recurring.findIndex((r) => r.id === rule.id);
    if (idx >= 0) state.recurring[idx] = rule; else state.recurring.push(rule);
    persistRecurring();
    resetRecForm();
    if (applyRecurring()) scheduleSync(400);
    renderAll();
    toast(idx >= 0 ? 'Regel bijgewerkt' : 'Terugkerende uitgave toegevoegd');
  }

  function removeRec(id) {
    const rule = state.recurring.find((r) => r.id === id);
    if (!rule) return;
    if (!confirm(`Regel “${rule.note || catOf(rule.category).label}” verwijderen? Al aangemaakte uitgaven blijven staan.`)) return;
    state.recurring = state.recurring.filter((r) => r.id !== id);
    persistRecurring();
    if (state.editingRecId === id) resetRecForm();
    renderAll();
    toast('Regel verwijderd');
  }

  /* ---------- Supabase sync ---------- */

  function setSyncFromState() {
    if (!state.cfg.url || !state.cfg.key) {
      setSync('', 'Alleen lokaal');
    } else if (!user) {
      setSync('error', 'Niet ingelogd');
    } else {
      setSync('online', 'Klaar om te syncen');
    }
  }

  async function ensureClient() {
    if (!state.cfg.url || !state.cfg.key) return null;
    if (client) return client;
    try {
      const mod = await import(SUPABASE_MODULE);
      client = mod.createClient(state.cfg.url, state.cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
      client.auth.onAuthStateChange((_event, session) => {
        user = session ? session.user : null;
        setSyncFromState();
        if (user) subscribeRealtime(client);
      });
      client.from('expenses').select('id').limit(1).then(({ error }) => {
        if (error && /relation|schema cache/i.test(error.message)) {
          setAuthStatus('Tabel ontbreekt – voer eerst de SQL hieronder uit.', true);
        }
      });
      return client;
    } catch (err) {
      console.warn('Supabase kon niet laden', err);
      setSync('error', 'Geen verbinding met Supabase');
      return null;
    }
  }

  function subscribeRealtime(c) {
    try {
      if (channel) { c.removeChannel(channel); channel = null; }
      channel = c.channel('huishoudboekje')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' },
          () => scheduleSync(350))
        .subscribe();
    } catch (_) { /* realtime is optional */ }
  }

  function toRow(e) {
    return {
      id: e.id,
      user_id: user.id,
      amount: e.amount,
      category: e.category,
      spent_on: e.spentOn,
      note: e.note || null,
      created_at: new Date(e.createdAt).toISOString(),
      updated_at: new Date(e.updatedAt).toISOString(),
      deleted: e.deleted
    };
  }

  function fromRow(row) {
    return {
      id: String(row.id),
      amount: Number(row.amount),
      category: catOf(row.category).id,
      spentOn: String(row.spent_on),
      note: String(row.note || ''),
      createdAt: Date.parse(row.created_at) || Date.now(),
      updatedAt: Date.parse(row.updated_at) || Date.now(),
      deleted: Boolean(row.deleted),
      dirty: false
    };
  }

  async function pushDirty(c) {
    const dirty = state.expenses.filter((e) => e.dirty);
    if (!dirty.length) return;
    const { error } = await c.from('expenses').upsert(dirty.map(toRow), { onConflict: 'id' });
    if (error) throw error;
    for (const e of dirty) e.dirty = false;
    persist();
  }

  async function pullRemote(c) {
    const { data, error } = await c.from('expenses').select('*').eq('user_id', user.id);
    if (error) throw error;
    const byId = new Map(state.expenses.map((e) => [e.id, e]));
    let changed = false;
    for (const row of data || []) {
      const incoming = fromRow(row);
      if (!parseYmd(incoming.spentOn) || !Number.isFinite(incoming.amount)) continue;
      const local = byId.get(incoming.id);
      if (!local) {
        state.expenses.push(incoming);
        changed = true;
      } else if (!local.dirty && incoming.updatedAt > local.updatedAt) {
        Object.assign(local, incoming);
        changed = true;
      }
    }
    if (changed) { persist(); renderAll(); }
  }

  async function syncNow() {
    if (syncBusy) return;
    const c = await ensureClient();
    if (!c) { setSyncFromState(); return; }
    if (!user) {
      toast('Log eerst in via Instellingen');
      setSync('error', 'Niet ingelogd');
      return;
    }
    syncBusy = true;
    setSync('busy', 'Syncen…');
    try {
      await pushDirty(c);
      await pullRemote(c);
      state.lastSync = Date.now();
      const time = new Date(state.lastSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      setSync('online', `Gesynced ${time}`);
      setAuthStatus(`Ingelogd als ${user.email} · laatst gesynced ${time}`);
      $('data-count').textContent = `${state.expenses.length} uitgaven lokaal opgeslagen, waarvan 0 nog te syncen.`;
    } catch (err) {
      console.warn('Sync mislukt', err);
      setSync('error', navigator.onLine ? 'Sync mislukt' : 'Offline – lokaal bewaard');
      if (navigator.onLine) setAuthStatus(`Sync mislukt: ${err.message}`, true);
    } finally {
      syncBusy = false;
    }
  }

  function scheduleSync(delay = 900) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(); }, delay);
  }

  async function handleAuth(kind) {
    saveCfg();
    client = null;
    const c = await ensureClient();
    if (!c) { setAuthStatus('Vul eerst de project URL en anon key in.', true); return; }
    const email = $('cfg-email').value.trim();
    const password = $('cfg-password').value;
    if (!email || !password) { setAuthStatus('Vul e-mail en wachtwoord in.', true); return; }

    setAuthStatus(kind === 'signup' ? 'Account aanmaken…' : 'Inloggen…');
    try {
      if (kind === 'signup') {
        const { data, error } = await c.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          user = data.session.user;
          subscribeRealtime(c);
          setAuthStatus(`Ingelogd als ${user.email}`);
          await syncNow();
          toast('Account aangemaakt en verbonden');
        } else {
          setAuthStatus('Account aangemaakt. Bevestig je e-mail en log daarna in.');
        }
      } else {
        const { data, error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw error;
        user = data.user;
        subscribeRealtime(c);
        setAuthStatus(`Ingelogd als ${user.email}`);
        await syncNow();
        toast('Verbonden met Supabase');
      }
      setSyncFromState();
    } catch (err) {
      setAuthStatus(err.message || 'Inloggen mislukt', true);
      setSync('error', 'Niet ingelogd');
    }
  }

  /* ---------- Backup ---------- */

  function downloadBackup() {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      expenses: state.expenses,
      recurring: state.recurring
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `huishoudboekje-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup gedownload');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed
        : (parsed && Array.isArray(parsed.expenses) ? parsed.expenses : null);
      if (!rows) throw new Error('Ongeldig bestand');
      const byId = new Map(state.expenses.map((e) => [e.id, e]));
      let added = 0;
      for (const raw of rows) {
        const e = normalizeExpense(raw);
        if (!e) continue;
        e.dirty = true;
        const local = byId.get(e.id);
        if (!local || e.updatedAt > local.updatedAt) {
          if (local) Object.assign(local, e); else state.expenses.push(e);
          added++;
        }
      }
      if (parsed && Array.isArray(parsed.recurring)) {
        for (const raw of parsed.recurring) {
          const rule = normalizeRule(raw);
          if (rule && !state.recurring.some((r) => r.id === rule.id)) state.recurring.push(rule);
        }
        persistRecurring();
      }
      applyRecurring();
      persist();
      renderAll();
      toast(`${added} uitgaven geïmporteerd`);
      scheduleSync();
    } catch (err) {
      toast('Kon backup niet lezen');
    } finally {
      $('import-file').value = '';
    }
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(SQL);
      toast('SQL gekopieerd');
    } catch (_) {
      $('sql-snippet').focus();
      toast('Selecteer en kopieer de SQL handmatig');
    }
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    $('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (btn) setView(btn.dataset.view);
    });

    $('month-prev').addEventListener('click', () => {
      const d = new Date(state.year, state.month - 1, 1);
      state.year = d.getFullYear(); state.month = d.getMonth();
      renderAll();
    });
    $('month-next').addEventListener('click', () => {
      const d = new Date(state.year, state.month + 1, 1);
      state.year = d.getFullYear(); state.month = d.getMonth();
      renderAll();
    });

    $('calendar').addEventListener('click', (e) => {
      const cell = e.target.closest('.day[data-date]');
      if (cell) openDay(cell.dataset.date);
    });
    $('calendar').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cell = e.target.closest('.day[data-date]');
      if (cell) { e.preventDefault(); openDay(cell.dataset.date); }
    });

    $('year-prev').addEventListener('click', () => { state.year -= 1; renderAll(); });
    $('year-next').addEventListener('click', () => { state.year += 1; renderAll(); });
    $('year-overview').addEventListener('click', (e) => {
      const card = e.target.closest('button[data-month]');
      if (!card) return;
      state.month = Number(card.dataset.month);
      setView('calendar');
      renderAll();
    });

    $('btn-print').addEventListener('click', () => window.print());

    $('expense-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (btn) openEntry(btn.dataset.id);
    });

    $('day-entries').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (btn) openEntry(btn.dataset.id);
    });

    $('filter-category').addEventListener('change', (e) => {
      state.filterCategory = e.target.value;
      renderList();
    });

    $('fab').addEventListener('click', () => openEntry());

    $('entry-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('button[data-cat]');
      if (chip) { state.entryCategory = chip.dataset.cat; renderChips(); }
    });

    $('entry-form').addEventListener('submit', saveEntry);
    $('btn-delete').addEventListener('click', deleteEntry);
    $('btn-add-for-day').addEventListener('click', () => openEntry(null, state.selectedDate));

    $('rec-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('button[data-rec-cat]');
      if (chip) { state.recCategory = chip.dataset.recCat; renderRecChips(); }
    });
    $('btn-add-rec').addEventListener('click', saveRec);
    $('btn-cancel-rec').addEventListener('click', resetRecForm);
    $('rec-list').addEventListener('click', (e) => {
      const del = e.target.closest('button[data-rec-del]');
      if (del) { removeRec(del.dataset.recDel); return; }
      const edit = e.target.closest('[data-rec-edit]');
      if (edit) editRec(edit.dataset.recEdit);
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
    });
    document.querySelectorAll('.overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
      }
    });

    $('sync-pill').addEventListener('click', () => syncNow());
    $('btn-sync-now').addEventListener('click', () => syncNow());
    $('btn-save-settings').addEventListener('click', () => {
      state.cfg.url = $('cfg-url').value.trim().replace(/\/$/, '');
      state.cfg.key = $('cfg-key').value.trim();
      saveCfg();
      client = null;
      setSyncFromState();
      toast('Instellingen bewaard');
      if (state.cfg.url && state.cfg.key) scheduleSync(200);
    });
    $('btn-signin').addEventListener('click', () => handleAuth('signin'));
    $('btn-signup').addEventListener('click', () => handleAuth('signup'));
    $('btn-show-sql').addEventListener('click', () => {
      const details = $('sql-snippet').closest('details');
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('btn-copy-sql').addEventListener('click', copySql);
    $('btn-export').addEventListener('click', downloadBackup);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => importBackup(e.target.files[0]));

    window.addEventListener('online', () => scheduleSync(500));
    window.addEventListener('focus', () => scheduleSync(500));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleSync(500);
    });
  }

  /* ---------- Init ---------- */

  function init() {
    state.expenses = loadExpenses();
    state.cfg = loadCfg();
    state.recurring = loadRecurring();
    $('filter-category').innerHTML = '<option value="all">Alle categorieën</option>' +
      CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
    bindEvents();
    resetRecForm();
    const generated = applyRecurring();
    renderAll();
    setSyncFromState();
    if (generated) scheduleSync(600);
    if (state.cfg.url && state.cfg.key) scheduleSync(700);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
