(() => {
  'use strict';

  const KEYS = {
    notes: 'notities.v1.notes',
    settings: 'notities.v1.settings',
    templates: 'notities.v1.templates',
    last: 'notities.v1.lastDate',
    backup: 'notities.v1.lastBackup'
  };

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const TIMES = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let minutes = 6 * 60; minutes <= 20 * 60; minutes += 30) {
    TIMES.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }

  const $ = (id) => document.getElementById(id);
  const el = {
    datePicker: $('date-picker'),
    dateShort: $('date-short'),
    pageDate: $('page-date'),
    pageNum: $('page-num'),
    timeCol: $('time-col'),
    tagDotsCol: $('tag-dots-col'),
    slotCol: $('slot-col'),
    doneCol: $('done-col'),
    dayTags: $('day-tags'),
    nowLine: $('now-line'),
    lastWeek: $('last-week'),
    notesInput: $('notes-input'),
    searchInput: $('search-input'),
    searchMeta: $('search-meta'),
    searchResults: $('search-results'),
    tagChips: $('tag-chips'),
    connectionStatus: $('connection-status'),
    syncStatus: $('sync-status'),
    toast: $('toast'),
    exportBtn: $('export-github'),
    copyBtn: $('copy-day'),
    ruleList: $('rule-list'),
    ruleText: $('rule-text'),
    ruleTime: $('rule-time'),
    ruleRepeat: $('rule-repeat'),
    ruleDetail: $('rule-detail'),
    rulePattern: $('rule-pattern'),
    ruleWeekday: $('rule-weekday'),
    ruleEvery: $('rule-every'),
    ruleSkip: $('rule-skip'),
    ruleAdd: $('rule-add')
  };
  const slotInputs = {};
  const doneButtons = {};
  const tagDots = {};
  const INK_COLORS = { blue: '#2f3b46', black: '#262626', gray: '#5d5a52' };
  const TOKEN_SESSION = 'notities.v1.sessionToken';
  const THEME_META = { paper: '#fffdf6', rain: '#f3f7f8', sunset: '#fff6ec', graphite: '#2e3337' };

  // A few familiar tags get a fixed colour; the rest get a stable one from their name.
  const TAG_COLORS = {
    '#werk': '#416c86', '#work': '#416c86', '#office': '#416c86',
    '#gezondheid': '#3d7a50', '#health': '#3d7a50', '#sport': '#3d7a50',
    '#rekeningen': '#b34b42', '#bills': '#b34b42', '#money': '#b34b42', '#geld': '#b34b42',
    '#privé': '#8b6aa3', '#prive': '#8b6aa3', '#family': '#8b6aa3',
    '#boodschappen': '#b8862f', '#shopping': '#b8862f',
  };
  const TAG_PALETTE = ['#416c86', '#3d7a50', '#b34b42', '#8b6aa3', '#b8862f', '#4d8d8a'];

  function tagColor(tag) {
    const known = TAG_COLORS[String(tag).toLowerCase()];
    if (known) return known;
    let hash = 0;
    for (const char of String(tag)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

  function tagsIn(text) {
    return [...String(text || '').matchAll(/#[\p{L}\p{N}_-]+/gu)]
      .map((match) => match[0].toLowerCase())
      .filter((tag, index, all) => all.indexOf(tag) === index);
  }

  function editableTarget(target) {
    return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  /* ---------- Datum ---------- */

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseKey(key) {
    const parts = String(key).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return new Date();
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isValidKey(key) {
    return /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(parseKey(key)) === key;
  }

  function longDate(date) {
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  function shortDate(date) {
    return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  }

  function dayOfYear(date) {
    const year = date.getFullYear();
    return Math.round((Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86400000);
  }

  function shiftDate(date, amount) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + amount);
    return copy;
  }

  function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  // `weekday` is 0=Mon … 6=Sun; `nth` is 1–5 or -1 for the last one.
  function nthWeekdayFor(date, weekday, nth) {
    if (!nth) return null;
    const last = lastDayOfMonth(date);
    const jsWeekday = (weekday + 1) % 7;
    if (nth === -1) {
      const lastDate = new Date(date.getFullYear(), date.getMonth(), last);
      return last - ((lastDate.getDay() - jsWeekday + 7) % 7);
    }
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const day = 1 + ((jsWeekday - first.getDay() + 7) % 7) + 7 * (nth - 1);
    return day <= last ? day : null;
  }

  function anchorDate(item, fallback) {
    if (isValidKey(item.anchor)) return parseKey(item.anchor);
    if (item.ts) {
      const fromStamp = new Date(item.ts);
      if (!Number.isNaN(fromStamp.getTime())) return fromStamp;
    }
    return fallback;
  }

  /* ---------- Data (with timestamps for sync) ---------- */

  function normalizeField(value) {
    if (typeof value === 'string') return { text: value, ts: 0, done: false };
    const obj = (value && typeof value === 'object') ? value : {};
    return {
      text: typeof obj.text === 'string' ? obj.text : '',
      ts: Number(obj.ts) || 0,
      done: Boolean(obj.done)
    };
  }

  function slotBucket(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    const bucket = Math.floor(minutes / 30) * 30;
    if (bucket < 6 * 60 || bucket > 20 * 60) return null;
    return `${pad(Math.floor(bucket / 60))}:${pad(bucket % 60)}`;
  }

  function normalizeHidden(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [key, stamp] of Object.entries(value)) {
      const id = String(key).trim();
      if (id && Number.isFinite(Number(stamp))) result[id] = Number(stamp);
    }
    return result;
  }

  function normalizeEntry(value) {
    if (typeof value === 'string') return { notes: normalizeField(value), slots: {}, hidden: {} };

    const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    const slots = {};
    if (obj.slots && typeof obj.slots === 'object') {
      for (const [time, field] of Object.entries(obj.slots)) {
        const bucket = slotBucket(time);
        if (!bucket) continue;
        const incoming = normalizeField(field);
        const current = slots[bucket];
        if (!current || incoming.ts > current.ts) slots[bucket] = incoming;
      }
    }
    return { notes: normalizeField(obj.notes), slots, hidden: normalizeHidden(obj.hidden) };
  }

  function normalizeTemplate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const id = String(value.id || '').trim();
    const text = String(value.text || '').trim();
    if (!id || !text) return null;
    const day = Number(value.day);
    const every = Number(value.every);
    const nth = Number(value.nth);
    const skip = Array.isArray(value.skip)
      ? [...new Set(value.skip.filter((item) => isValidKey(String(item).trim())))].sort()
      : [];
    return {
      id,
      text,
      time: slotBucket(value.time) || '09:00',
      repeat: value.repeat === 'weekly' ? 'weekly' : 'monthly',
      weekday: ((Number(value.weekday) || 0) % 7 + 7) % 7,
      day: Number.isFinite(day) ? (day === -1 ? -1 : Math.min(31, Math.max(1, Math.round(day)))) : 1,
      every: Number.isFinite(every) ? Math.min(52, Math.max(1, Math.round(every))) : 1,
      anchor: isValidKey(value.anchor) ? value.anchor : '',
      nth: Number.isFinite(nth) && nth !== 0 ? (nth < 0 ? -1 : Math.min(5, Math.round(nth))) : 0,
      skip,
      ts: Number(value.ts) || 0,
      deleted: Boolean(value.deleted)
    };
  }

  function normalizeTemplates(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const raw of Object.values(value)) {
      const item = normalizeTemplate(raw);
      if (item) result[item.id] = item;
    }
    return result;
  }

  function mergeRemoteTemplates(remote) {
    let changed = false;
    for (const raw of Object.values(remote || {})) {
      const item = normalizeTemplate(raw);
      if (!item) continue;
      const current = templates[item.id];
      if (!current || item.ts > current.ts) {
        templates[item.id] = item;
        changed = true;
      }
    }
    return changed;
  }

  function occurrencesForDay(date, time) {
    const last = lastDayOfMonth(date);
    const key = dateKey(date);
    return Object.values(templates)
      .filter((item) => {
        if (item.deleted || item.skip.includes(key)) return false;
        if (time && item.time !== time) return false;
        if (item.repeat === 'weekly') {
          if (date.getDay() !== ((item.weekday + 1) % 7)) return false;
          if (item.every > 1) {
            const origin = anchorDate(item, date);
            const originMonday = shiftDate(origin, -((origin.getDay() + 6) % 7));
            const thisMonday = shiftDate(date, -((date.getDay() + 6) % 7));
            const weeks = Math.round((thisMonday - originMonday) / 604800000);
            if (weeks < 0 || weeks % item.every) return false;
          }
          return true;
        }
        if (item.every > 1) {
          const origin = anchorDate(item, date);
          const months = (date.getFullYear() * 12 + date.getMonth()) -
            (origin.getFullYear() * 12 + origin.getMonth());
          if (months < 0 || months % item.every) return false;
        }
        const target = item.nth
          ? nthWeekdayFor(date, item.weekday, item.nth)
          : (item.day === -1 ? last : Math.min(item.day, last));
        return target !== null && date.getDate() === target;
      })
      .sort((a, b) => a.time.localeCompare(b.time) || a.text.localeCompare(b.text));
  }

  function visibleOccurrences(date, time) {
    const hidden = normalizeEntry(notes[dateKey(date)] || {}).hidden;
    return occurrencesForDay(date, time).filter((item) => !hidden[item.id]);
  }

  function hasContent(entry) {
    const clean = normalizeEntry(entry);
    return Boolean(clean.notes.text.trim()) ||
      Object.keys(clean.hidden).length > 0 ||
      Object.values(clean.slots).some((field) => Boolean(field.text.trim()) || field.done);
  }

  function notesSignature() {
    const sorted = {};
    for (const key of Object.keys(notes).sort()) {
      const entry = normalizeEntry(notes[key]);
      const slots = {};
      for (const time of Object.keys(entry.slots).sort()) slots[time] = entry.slots[time];
      sorted[key] = { notes: entry.notes, slots };
    }
    const rules = {};
    for (const id of Object.keys(templates).sort()) rules[id] = templates[id];
    return JSON.stringify({ days: sorted, templates: rules });
  }

  function mergeRemoteDays(remoteDays) {
    let changed = false;
    for (const [key, remoteDay] of Object.entries(remoteDays)) {
      if (!isValidKey(key) || !remoteDay || typeof remoteDay !== 'object') continue;
      const remote = normalizeEntry(remoteDay);
      const local = normalizeEntry(notes[key] || { notes: { text: '', ts: 0 }, slots: {} });

      if (remote.notes.ts > local.notes.ts) local.notes = remote.notes;
      for (const [time, field] of Object.entries(remote.slots)) {
        if (!local.slots[time] || field.ts > local.slots[time].ts) local.slots[time] = field;
      }
      for (const [id, stamp] of Object.entries(remote.hidden)) {
        if ((local.hidden[id] || -1) < stamp) local.hidden[id] = stamp;
      }
      if (!notes[key] || JSON.stringify(local) !== JSON.stringify(normalizeEntry(notes[key]))) changed = true;
      notes[key] = local;
    }
    return changed;
  }

  function loadNotes() {
    let raw = {};
    try {
      raw = JSON.parse(localStorage.getItem(KEYS.notes) || '{}');
    } catch (_) {
      raw = {};
    }
    const result = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (isValidKey(key)) {
          const entry = normalizeEntry(value);
          if (hasContent(entry)) result[key] = entry;
        }
      }
    }
    return result;
  }

  function persistNotes() {
    try {
      localStorage.setItem(KEYS.notes, JSON.stringify(notes));
      return true;
    } catch (_) {
      showToast('Save failed: browser storage is full', true);
      return false;
    }
  }

  function loadTemplates() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEYS.templates) || '{}');
      return normalizeTemplates(raw);
    } catch (_) {
      return {};
    }
  }

  function persistTemplates() {
    try {
      localStorage.setItem(KEYS.templates, JSON.stringify(templates));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getEntry(key, create) {
    if (!notes[key] && !create) return { notes: { text: '', ts: 0, done: false }, slots: {} };
    if (!notes[key]) notes[key] = { notes: { text: '', ts: 0 }, slots: {} };
    notes[key] = normalizeEntry(notes[key]);
    return notes[key];
  }

  function detectRepo() {
    const match = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!match) return { owner: '', repo: '' };
    const parts = location.pathname.split('/').filter(Boolean);
    return { owner: match[1], repo: parts[0] || '' };
  }

  function defaultSettings() {
    const detected = detectRepo();
    return {
      owner: detected.owner,
      repo: detected.repo,
      branch: 'main',
      path: 'notities',
      token: '',
      autosave: true,
      font: 'hand',
      ink: 'blue',
      theme: 'paper'
    };
  }

  // iOS web apps cannot call the Keychain API directly. Safari can keep the
  // token in iCloud Keychain via password autofill; we keep it only in the
  // session and never write it to localStorage.
  function loadSettings() {
    const defaults = defaultSettings();
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(KEYS.settings) || '{}');
      if (parsed && typeof parsed === 'object') stored = parsed;
    } catch (_) { /* use defaults */ }
    const clean = { ...defaults, ...stored };
    const legacy = typeof stored.token === 'string' ? stored.token.trim() : '';
    if (legacy) {
      try { sessionStorage.setItem(TOKEN_SESSION, legacy); } catch (_) { /* ignore */ }
    }
    let token = '';
    try { token = sessionStorage.getItem(TOKEN_SESSION) || ''; } catch (_) { /* ignore */ }
    clean.token = token;
    if (legacy) persistSettings(clean); // migrate: strip plaintext from localStorage
    return clean;
  }

  function persistSettings(value) {
    const stored = { ...value };
    delete stored.token;
    try {
      if (value.token) sessionStorage.setItem(TOKEN_SESSION, value.token);
      else sessionStorage.removeItem(TOKEN_SESSION);
    } catch (_) { /* session storage unavailable: token stays in memory only */ }
    try {
      localStorage.setItem(KEYS.settings, JSON.stringify(stored));
      return true;
    } catch (_) {
      showToast('Could not save settings', true);
      return false;
    }
  }

  let notes = loadNotes();
  persistNotes(); // fold any old 15-minute keys into the half-hour grid
  let templates = loadTemplates();
  persistTemplates();
  let settings = loadSettings();
  let currentKey = localStorage.getItem(KEYS.last) || dateKey(new Date());
  if (!isValidKey(currentKey)) currentKey = dateKey(new Date());

  /* ---------- Undo ---------- */

  const undoStack = [];
  const redoStack = [];

  function snapshotState() {
    return JSON.stringify({ notes, templates, settings, currentKey });
  }

  function pushUndo() {
    undoStack.push(snapshotState());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
  }

  let fieldSnapshot = null;

  function beginFieldEdit() {
    if (fieldSnapshot === null) fieldSnapshot = snapshotState();
  }

  function endFieldEdit() {
    if (fieldSnapshot !== null && fieldSnapshot !== snapshotState()) {
      undoStack.push(fieldSnapshot);
      if (undoStack.length > 40) undoStack.shift();
      redoStack.length = 0;
    }
    fieldSnapshot = null;
  }

  function applySnapshot(raw) {
    const state = JSON.parse(raw);
    notes = state.notes;
    templates = state.templates;
    settings = state.settings;
    currentKey = state.currentKey;
    try { localStorage.setItem(KEYS.last, currentKey); } catch (_) { /* not critical */ }
    persistNotes();
    persistTemplates();
    persistSettings(settings);
    applySettings();
    fillSettingsForm();
    renderDay();
    scheduleAutoPush();
  }

  function undo() {
    if (!undoStack.length) {
      showToast('Nothing to undo');
      return;
    }
    redoStack.push(snapshotState());
    applySnapshot(undoStack.pop());
    haptic();
    showToast('Undone');
  }

  function redo() {
    if (!redoStack.length) {
      showToast('Nothing to redo');
      return;
    }
    undoStack.push(snapshotState());
    applySnapshot(redoStack.pop());
    showToast('Redone');
  }

  /* ---------- Display ---------- */

  function updateSync(text, kind) {
    el.syncStatus.textContent = text;
    el.syncStatus.className = `sync${kind ? ` ${kind}` : ''}`;
  }

  function refreshSyncBase() {
    if (!settings.autosave) updateSync('Saved locally');
    else if (!settings.token || !settings.owner || !settings.repo) updateSync('Local only — enter GitHub settings');
    else updateSync('Autosave on', 'ok');
  }

  function applySettings() {
    document.body.dataset.font = settings.font === 'system' ? 'system' : 'hand';
    const theme = THEME_META[settings.theme] ? settings.theme : 'paper';
    document.body.dataset.theme = theme;
    document.body.dataset.ink = INK_COLORS[settings.ink] ? settings.ink : 'blue';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[theme]);
    refreshSyncBase();
  }

  function haptic() {
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove('show'), 3600);
  }

  function buildTimeGrid() {
    for (const time of TIMES) {
      const isHour = time.endsWith(':00');
      const label = document.createElement('div');
      label.className = `time${isHour ? ' hour' : ''}`;
      label.textContent = time;
      el.timeCol.appendChild(label);

      const dot = document.createElement('div');
      dot.className = 'tag-dot';
      el.tagDotsCol.appendChild(dot);
      tagDots[time] = dot;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = `slot${isHour ? ' hour' : ''}`;
      input.dataset.time = time;
      input.setAttribute('aria-label', `Appointment at ${time}`);
      input.addEventListener('focus', beginFieldEdit);
      input.addEventListener('blur', endFieldEdit);
      input.autocomplete = 'off';
      input.autocapitalize = 'sentences';
      input.spellcheck = true;
      input.addEventListener('input', () => {
        const entry = getEntry(currentKey, true);
        const old = entry.slots[time] || {};
        entry.slots[time] = { text: input.value, ts: Date.now(), done: Boolean(old.done) };
        input.classList.toggle('done', Boolean(old.done) && !input.value.trim());
        scheduleLocalSave();
        scheduleAutoPush();
        haptic();
      });
      label.addEventListener('click', () => input.focus());

      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'done-btn';
      done.textContent = '○';
      done.setAttribute('aria-label', `Toggle done for ${time}`);
      done.addEventListener('click', () => toggleDone(time));
      doneButtons[time] = done;
      el.doneCol.appendChild(done);

      slotInputs[time] = input;
      el.slotCol.appendChild(input);
    }
  }

  function toggleDone(time) {
    pushUndo();
    flushLocalSave();
    const entry = getEntry(currentKey, true);
    const field = entry.slots[time] || { text: '', ts: 0, done: false };
    field.done = !field.done;
    field.ts = Date.now();
    if (!field.text.trim()) {
      const recurring = visibleOccurrences(parseKey(currentKey), time);
      if (recurring.length) field.text = recurring[0].text;
    }
    entry.slots[time] = field;
    slotInputs[time].value = field.text;
    slotInputs[time].placeholder = '';
    doneButtons[time].textContent = field.done ? '✓' : '○';
    doneButtons[time].classList.toggle('on', field.done);
    slotInputs[time].classList.toggle('done', field.done);
    haptic();
    flushLocalSave();
    scheduleAutoPush();
  }

  function autoGrowNotes() {
    el.notesInput.style.height = 'auto';
    el.notesInput.style.height = `${Math.max(el.notesInput.scrollHeight, 200)}px`;
  }

  function renderDay() {
    const date = parseKey(currentKey);
    const entry = getEntry(currentKey, false);
    el.datePicker.value = currentKey;
    el.dateShort.textContent = shortDate(date);
    el.pageDate.textContent = `${WEEKDAYS[date.getDay()]} ${longDate(date)}`;
    el.pageNum.textContent = String(dayOfYear(date));

    const dayTags = new Set();
    for (const time of TIMES) {
      const field = entry.slots[time] || { text: '', done: false };
      const input = slotInputs[time];
      const hint = visibleOccurrences(date, time).map((item) => item.text).join(' · ');
      input.value = field.text || '';
      input.placeholder = field.text.trim() ? '' : hint;
      input.classList.toggle('done', Boolean(field.done));
      doneButtons[time].textContent = field.done ? '✓' : '○';
      doneButtons[time].classList.toggle('on', Boolean(field.done));

      const tags = tagsIn(field.text.trim() ? field.text : hint);
      const dot = tagDots[time];
      dot.replaceChildren();
      dot.title = tags.join(', ');
      for (const tag of tags.slice(0, 3)) {
        const mark = document.createElement('i');
        mark.style.background = tagColor(tag);
        dot.appendChild(mark);
      }
      for (const tag of tags) dayTags.add(tag);
    }
    for (const tag of tagsIn(entry.notes.text)) dayTags.add(tag);
    for (const item of visibleOccurrences(date)) {
      for (const tag of tagsIn(item.text)) dayTags.add(tag);
    }
    el.dayTags.replaceChildren();
    for (const tag of [...dayTags].sort()) {
      const chip = document.createElement('span');
      chip.className = 'day-tag';
      const mark = document.createElement('i');
      mark.style.background = tagColor(tag);
      chip.append(mark, document.createTextNode(tag));
      el.dayTags.appendChild(chip);
    }

    const previous = [];
    const previousDay = shiftDate(date, -7);
    const previousEntry = notes[dateKey(previousDay)];
    if (previousEntry) {
      for (const [time, field] of Object.entries(previousEntry.slots || {})) {
        if (field.text && field.text.trim()) previous.push([time, field.text.trim()]);
      }
    }
    for (const item of visibleOccurrences(previousDay)) previous.push([item.time, item.text]);
    previous.sort((a, b) => a[0].localeCompare(b[0]));
    el.lastWeek.textContent = previous.length
      ? `Last week · ${previous.slice(0, 3).map(([time, text]) => `${time} ${text}`).join(' · ')}`
      : '';

    el.notesInput.value = entry.notes.text || '';
    autoGrowNotes();
    updateNowLine();
  }

  function updateNowLine() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < 6 * 60 || minutes > 20 * 60) {
      el.nowLine.style.display = 'none';
      return;
    }
    const rowHeight = 40;
    const top = (minutes - 6 * 60) * (rowHeight / 30);
    el.nowLine.style.display = 'block';
    el.nowLine.style.top = `${top}px`;
  }

  /* ---------- Local saving ---------- */

  let localTimer = null;

  function tidyNotes() {
    for (const key of Object.keys(notes)) {
      const entry = normalizeEntry(notes[key]);
      if (hasContent(entry)) notes[key] = entry;
      else delete notes[key];
    }
  }

  function scheduleLocalSave() {
    clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      tidyNotes();
      persistNotes();
    }, 350);
  }

  function flushLocalSave() {
    clearTimeout(localTimer);
    localTimer = null;
    tidyNotes();
    persistNotes();
  }

  function goToDate(key) {
    if (!isValidKey(key)) return;
    flushLocalSave();
    currentKey = key;
    try { localStorage.setItem(KEYS.last, key); } catch (_) { /* not critical */ }
    renderDay();
  }

  function shiftDay(amount) {
    const date = parseKey(currentKey);
    date.setDate(date.getDate() + amount);
    goToDate(dateKey(date));
  }

  /* ---------- GitHub sync ---------- */

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(String(text).replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  const ORDINALS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };

  function describeTemplate(item) {
    const weekday = WEEKDAYS[(item.weekday + 1) % 7];
    let when;
    if (item.repeat === 'weekly') {
      when = `${weekday} ${item.time}`;
      if (item.every > 1) when += ` · every ${item.every} weeks`;
    } else if (item.nth) {
      when = `${ORDINALS[item.nth] || item.nth} ${weekday} of the month ${item.time}`;
      if (item.every > 1) when += ` · every ${item.every} months`;
    } else {
      when = `day ${item.day === -1 ? 'last' : item.day} ${item.time}`;
      if (item.every > 1) when += ` · every ${item.every} months`;
    }
    if (item.skip.length) when += ` · except ${item.skip.join(', ')}`;
    return when;
  }

  function buildMarkdown() {
    const keys = Object.keys(notes).filter((key) => isValidKey(key) && hasContent(notes[key])).sort().reverse();
    const lines = ['# Notes', ''];
    const active = Object.values(templates).filter((item) => !item.deleted);
    if (active.length) {
      lines.push('## Recurring', '');
      for (const item of active.sort((a, b) => a.repeat.localeCompare(b.repeat) || a.time.localeCompare(b.time))) {
        lines.push(`- ${describeTemplate(item)} — ${item.text}`);
      }
      lines.push('');
    }
    if (!keys.length) lines.push('_No notes yet._', '');
    for (const key of keys) {
      const entry = normalizeEntry(notes[key]);
      const date = parseKey(key);
      lines.push(`## ${WEEKDAYS[date.getDay()]} ${longDate(date)}`, '');
      const times = Object.keys(entry.slots).filter((time) => entry.slots[time].text.trim()).sort();
      if (times.length) {
        lines.push('### Appointments', '');
        for (const time of times) {
          const field = entry.slots[time];
          lines.push(`- ${time} — ${field.done ? '✓ ' : ''}${field.text.replace(/\s+/g, ' ').trim()}`);
        }
        lines.push('');
      }
      if (entry.notes.text.trim()) lines.push('### Notes', '', entry.notes.text.trim(), '');
    }
    return `${lines.join('\n')}\n`;
  }

  function apiHeaders(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function contentsUrl(cfg, filename) {
    const base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/`;
    const parts = [cfg.path, ...String(filename).split('/')].filter(Boolean);
    return base + parts.map(encodeURIComponent).join('/');
  }

  async function backupIfNeeded(cfg) {
    const month = new Date().toISOString().slice(0, 7);
    if (localStorage.getItem(KEYS.backup) === month) return;
    try {
      const existing = await fetchFile(cfg, `backups/${month}.json`);
      if (!existing) {
        await pushFile(cfg, `backups/${month}.json`, JSON.stringify({
          schema: 1,
          updated: new Date().toISOString(),
          days: notes,
          templates
        }), null);
      }
      localStorage.setItem(KEYS.backup, month);
    } catch (_) { /* backups are best-effort */ }
  }

  async function fetchFile(cfg, filename) {
    const response = await fetch(`${contentsUrl(cfg, filename)}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: apiHeaders(cfg.token)
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) { /* ignore */ }
      throw new Error(`GitHub returned status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return { sha: data.sha || null, text: fromBase64(data.content || '') };
  }

  async function pushFile(cfg, filename, content, sha) {
    const payload = {
      message: `Notes updated — ${longDate(new Date())}`,
      content: toBase64(content),
      branch: cfg.branch
    };
    if (sha) payload.sha = sha;
    const response = await fetch(contentsUrl(cfg, filename), {
      method: 'PUT',
      headers: { ...apiHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) return { ok: true, sha: (await response.json()).content?.sha || sha };
    let detail = '';
    try { detail = (await response.json()).message || ''; } catch (_) { /* ignore */ }
    return { ok: false, status: response.status, message: detail };
  }

  let pushTimer = null;
  let pushInFlight = false;
  let pushQueued = false;
  let offlinePending = false;
  let lastSyncedSignature = null;

  async function syncToGithub(silent) {
    if (pushInFlight) { pushQueued = true; return; }
    settings = loadSettings();
    if (silent && !settings.autosave) return;
    if (!settings.token || !settings.owner || !settings.repo) {
      updateSync('Local only — enter GitHub settings');
      if (!silent) {
        fillSettingsForm();
        openOverlay('settings-overlay');
        showToast('Enter your GitHub settings first', true);
      }
      return;
    }
    if (!navigator.onLine) {
      offlinePending = true;
      updateSync('Offline — sync will resume when connected', 'error');
      return;
    }
    flushLocalSave();
    pushInFlight = true;
    el.exportBtn.disabled = true;
    updateSync(silent ? 'Syncing…' : 'Exporting…');
    try {
      const cfg = settings;
      const remote = await fetchFile(cfg, 'agenda.json');
      if (remote) {
        try {
          const parsed = JSON.parse(remote.text);
          if (parsed && parsed.days && typeof parsed.days === 'object') mergeRemoteDays(parsed.days);
          if (parsed && parsed.templates) mergeRemoteTemplates(parsed.templates);
        } catch (_) { /* onleesbaar bestand: lokale data bewaren */ }
      }
      persistNotes();
      persistTemplates();
      renderDay();

      const signature = notesSignature();
      if (signature === lastSyncedSignature && remote) {
        updateSync('All synced', 'ok');
        return;
      }

      let jsonSha = remote ? remote.sha : null;
      let result = await pushFile(cfg, 'agenda.json', JSON.stringify({
        schema: 1,
        updated: new Date().toISOString(),
        days: notes,
        templates
      }), jsonSha);

      if (!result.ok && result.status === 409) {
        const again = await fetchFile(cfg, 'agenda.json');
        if (again) {
          try {
            const parsed = JSON.parse(again.text);
            if (parsed && parsed.days) mergeRemoteDays(parsed.days);
            if (parsed && parsed.templates) mergeRemoteTemplates(parsed.templates);
          } catch (_) { /* ignore */ }
          jsonSha = again.sha;
          result = await pushFile(cfg, 'agenda.json', JSON.stringify({
            schema: 1,
            updated: new Date().toISOString(),
            days: notes,
            templates
          }), jsonSha);
        }
      }
      if (!result.ok) throw new Error(`Sync failed (${result.status})${result.message ? `: ${result.message}` : ''}`);

      let markdownRemote = await fetchFile(cfg, 'agenda.md');
      let mdResult = await pushFile(cfg, 'agenda.md', buildMarkdown(), markdownRemote ? markdownRemote.sha : null);
      if (!mdResult.ok && mdResult.status === 409) {
        markdownRemote = await fetchFile(cfg, 'agenda.md');
        mdResult = await pushFile(cfg, 'agenda.md', buildMarkdown(), markdownRemote ? markdownRemote.sha : null);
      }
      if (!mdResult.ok) throw new Error(`Sync of agenda.md failed (${mdResult.status})`);

      await backupIfNeeded(cfg);
      lastSyncedSignature = signature;
      offlinePending = false;
      const now = new Date();
      updateSync(`Synced ${pad(now.getHours())}:${pad(now.getMinutes())}`, 'ok');
      if (!silent) showToast('Synced with GitHub');
    } catch (error) {
      updateSync('Sync failed — tap ⬆', 'error');
      showToast(error && error.message ? error.message : 'Sync failed', true);
    } finally {
      pushInFlight = false;
      el.exportBtn.disabled = false;
      if (pushQueued) {
        pushQueued = false;
        scheduleAutoPush();
      }
    }
  }

  function scheduleAutoPush() {
    if (!settings.autosave) return;
    if (pushInFlight) { pushQueued = true; return; }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncToGithub(true), 5000);
  }

  function downloadMarkdown() {
    flushLocalSave();
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `notes-${dateKey(new Date())}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    showToast('File downloaded');
  }

  async function copyCurrentDay() {
    flushLocalSave();
    const date = parseKey(currentKey);
    const entry = getEntry(currentKey, false);
    const lines = [`${WEEKDAYS[date.getDay()]} ${longDate(date)}`, ''];
    for (const time of Object.keys(entry.slots).sort()) {
      const field = entry.slots[time];
      if (field.text && field.text.trim()) {
        lines.push(`- ${time} — ${field.done ? '✓ ' : ''}${field.text.trim()}`);
      }
    }
    for (const item of visibleOccurrences(date)) lines.push(`- ${item.time} — ${item.text} (recurring)`);
    if (entry.notes.text.trim()) lines.push('', entry.notes.text.trim());
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast('Day copied to clipboard');
      haptic();
    } catch (_) {
      showToast('Clipboard not available here', true);
    }
  }

  function clearCurrentDay() {
    const date = parseKey(currentKey);
    if (!window.confirm(`Clear all entries and notes for ${longDate(date)}?`)) return;
    pushUndo();
    flushLocalSave();
    const entry = getEntry(currentKey, true);
    const stamp = Date.now();
    entry.slots = {};
    for (const time of TIMES) entry.slots[time] = { text: '', ts: stamp, done: false };
    entry.notes = { text: '', ts: stamp };
    for (const item of visibleOccurrences(date)) entry.hidden[item.id] = stamp;
    notes[currentKey] = normalizeEntry(entry);
    flushLocalSave();
    renderDay();
    scheduleAutoPush();
    haptic();
    showToast('Day cleared — tap ↶ to undo');
  }

  /* ---------- Search ---------- */

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const needle = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!needle) return safe;
    try {
      return safe.replace(new RegExp(needle, 'gi'), (match) => `<mark>${match}</mark>`);
    } catch (_) {
      return safe;
    }
  }

  function makeSnippet(text, query) {
    const flat = String(text).replace(/\s+/g, ' ').trim();
    if (!query) return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat;
    const index = flat.toLocaleLowerCase('en').indexOf(query);
    if (index < 0) return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat;
    const start = Math.max(0, index - 35);
    const end = Math.min(flat.length, index + query.length + 70);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
  }

  let activeTag = '';

  function collectTags() {
    const found = new Set();
    for (const entry of Object.values(notes)) {
      const texts = [entry.notes.text, ...Object.values(entry.slots || {}).map((field) => field.text)];
      for (const text of texts) {
        for (const match of String(text || '').matchAll(/#[\p{L}\p{N}_-]+/gu)) found.add(match[0].toLowerCase());
      }
    }
    return [...found].sort();
  }

  function renderTagChips() {
    el.tagChips.innerHTML = '';
    for (const tag of collectTags()) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `tag-chip${activeTag === tag ? ' active' : ''}`;
      const mark = document.createElement('i');
      mark.style.background = tagColor(tag);
      chip.append(mark, document.createTextNode(tag));
      chip.addEventListener('click', () => {
        activeTag = activeTag === tag ? '' : tag;
        renderSearch();
      });
      el.tagChips.appendChild(chip);
    }
  }

  function renderSearch() {
    renderTagChips();
    const rawQuery = el.searchInput.value.trim();
    const query = rawQuery.toLocaleLowerCase('en');
    const days = Object.keys(notes)
      .filter((key) => isValidKey(key) && hasContent(notes[key]))
      .sort()
      .reverse()
      .map((key) => {
        const entry = normalizeEntry(notes[key]);
        const date = parseKey(key);
        const parts = [];
        for (const time of Object.keys(entry.slots).sort()) {
          if (entry.slots[time].text.trim()) parts.push({ label: time, text: entry.slots[time].text });
        }
        if (entry.notes.text.trim()) parts.push({ label: 'Notes', text: entry.notes.text });
        return { key, date, parts };
      });

    const matches = days.filter((day) => {
      if (activeTag) {
        const all = day.parts.map((part) => part.text).join(' ').toLocaleLowerCase('en');
        if (!all.includes(activeTag)) return false;
      }
      if (!query) return true;
      const haystack = [
        longDate(day.date), WEEKDAYS[day.date.getDay()], day.key,
        ...day.parts.map((part) => `${part.label} ${part.text}`)
      ].join(' ').toLocaleLowerCase('en');
      return haystack.includes(query);
    });

    el.searchMeta.textContent = query
      ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'} for “${rawQuery}”`
      : `${matches.length} ${matches.length === 1 ? 'day' : 'days'} with notes`;

    el.searchResults.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = query ? 'No notes found. Try another word.' : 'No notes written yet.';
      el.searchResults.appendChild(empty);
      return;
    }

    for (const day of matches.slice(0, 150)) {
      const chosen = day.parts.find((part) => !query || `${part.label} ${part.text}`.toLocaleLowerCase('en').includes(query)) || day.parts[0];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';
      const dateLabel = `${WEEKDAYS[day.date.getDay()]} ${longDate(day.date)}`;
      button.innerHTML =
        `<span class="result-date">${escapeHtml(dateLabel)} · ${escapeHtml(chosen.label)}</span>` +
        `<span class="result-text">${highlight(makeSnippet(chosen.text, query), query)}</span>`;
      button.addEventListener('click', () => {
        closeOverlay('search-overlay');
        goToDate(day.key);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      el.searchResults.appendChild(button);
    }
  }

  /* ---------- Settings ---------- */

  function formSettings() {
    return {
      owner: $('cfg-owner').value.trim(),
      repo: $('cfg-repo').value.trim().replace(/\.git$/i, ''),
      branch: $('cfg-branch').value.trim() || 'main',
      path: $('cfg-path').value.trim().replace(/^\/+|\/+$/g, '') || 'notities',
      token: $('cfg-token').value.trim() || (settings && settings.token) || '',
      autosave: $('cfg-autosave').checked,
      font: $('cfg-font').value === 'system' ? 'system' : 'hand',
      ink: $('cfg-ink').value,
      theme: THEME_META[$('cfg-theme').value] ? $('cfg-theme').value : 'paper'
    };
  }

  function fillSettingsForm() {
    $('cfg-owner').value = settings.owner || '';
    $('cfg-repo').value = settings.repo || '';
    $('cfg-branch').value = settings.branch || 'main';
    $('cfg-path').value = settings.path || 'notities';
    $('cfg-token').value = '';
    $('cfg-token').placeholder = settings.token ? 'Saved in this session' : 'github_pat_…';
    $('cfg-autosave').checked = settings.autosave !== false;
    $('cfg-font').value = settings.font === 'system' ? 'system' : 'hand';
    $('cfg-ink').value = INK_COLORS[settings.ink] ? settings.ink : 'blue';
    $('cfg-theme').value = THEME_META[settings.theme] ? settings.theme : 'paper';
    el.connectionStatus.textContent = '';
    el.connectionStatus.className = 'connection-status';
    renderRules();
  }

  function renderRules() {
    el.ruleList.innerHTML = '';
    const active = Object.values(templates).filter((item) => !item.deleted)
      .sort((a, b) => a.repeat.localeCompare(b.repeat) || a.time.localeCompare(b.time));
    if (!active.length) {
      const empty = document.createElement('div');
      empty.className = 'rule-item';
      empty.textContent = 'No recurring items yet.';
      el.ruleList.appendChild(empty);
      return;
    }
    for (const item of active) {
      const row = document.createElement('div');
      row.className = 'rule-item';
      const label = document.createElement('span');
      label.textContent = `${item.text} · ${describeTemplate(item)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove ${item.text}`);
      remove.addEventListener('click', () => {
        pushUndo();
        templates[item.id] = { ...item, deleted: true, ts: Date.now() };
        persistTemplates();
        renderRules();
        renderDay();
        scheduleAutoPush();
        haptic();
      });
      row.append(label, remove);
      el.ruleList.appendChild(row);
    }
  }

  function addRule() {
    const text = el.ruleText.value.trim();
    if (!text) {
      showToast('Enter a text for the recurring item', true);
      return;
    }
    const time = slotBucket(el.ruleTime.value) || '09:00';
    const repeat = el.ruleRepeat.value === 'weekly' ? 'weekly' : 'monthly';
    const pattern = el.rulePattern.value;
    const rawDetail = Number(el.ruleDetail.value);
    const detail = Number.isFinite(rawDetail) ? rawDetail : 1;
    const weekday = (((Number(el.ruleWeekday.value) || 0) % 7) + 7) % 7;
    const rawEvery = Number(el.ruleEvery.value);
    const every = Number.isFinite(rawEvery) ? Math.min(52, Math.max(1, Math.round(rawEvery))) : 1;
    const skip = el.ruleSkip.value.split(/[,\s]+/).map((value) => value.trim()).filter(isValidKey);

    let day = 1;
    let nth = 0;
    let ruleWeekday = weekday;
    if (repeat !== 'weekly') {
      if (pattern === 'nth') {
        nth = Math.max(-1, Math.min(5, Math.round(detail || 1))) || 1;
      } else if (pattern === 'last') {
        day = -1;
      } else {
        day = detail === -1 ? -1 : Math.min(31, Math.max(1, Math.round(detail || 1)));
      }
    }

    pushUndo();
    const id = `r${Date.now()}`;
    templates[id] = {
      id,
      text,
      time,
      repeat,
      weekday: ruleWeekday,
      day,
      every,
      anchor: dateKey(new Date()),
      nth,
      skip,
      ts: Date.now(),
      deleted: false
    };
    el.ruleText.value = '';
    el.ruleSkip.value = '';
    persistTemplates();
    renderRules();
    renderDay();
    scheduleAutoPush();
    haptic();
    showToast('Recurring item added');
  }

  async function testConnection() {
    const cfg = formSettings();
    el.connectionStatus.className = 'connection-status';
    el.connectionStatus.textContent = 'Connecting…';
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      el.connectionStatus.className = 'connection-status error';
      el.connectionStatus.textContent = 'Enter owner, repository and token.';
      return;
    }
    try {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
        { headers: apiHeaders(cfg.token) }
      );
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).message || ''; } catch (_) { /* ignore */ }
        throw new Error(detail || `status ${response.status}`);
      }
      el.connectionStatus.className = 'connection-status ok';
      el.connectionStatus.textContent = 'Connection OK — repository found.';
    } catch (error) {
      el.connectionStatus.className = 'connection-status error';
      el.connectionStatus.textContent = `No connection: ${error.message || 'unknown error'}`;
    }
  }

  /* ---------- Overlays ---------- */

  function openOverlay(id) {
    $(id).hidden = false;
    document.body.classList.add('overlay-open');
  }

  function closeOverlay(id) {
    $(id).hidden = true;
    if (!document.querySelector('.sheet-overlay:not([hidden])')) document.body.classList.remove('overlay-open');
  }

  /* ---------- Gebeurtenissen ---------- */

  el.notesInput.addEventListener('focus', beginFieldEdit);
  el.notesInput.addEventListener('blur', endFieldEdit);
  el.notesInput.addEventListener('input', () => {
    const entry = getEntry(currentKey, true);
    entry.notes = { text: el.notesInput.value, ts: Date.now() };
    autoGrowNotes();
    scheduleLocalSave();
    scheduleAutoPush();
  });

  $('prev-day').addEventListener('click', () => shiftDay(-1));
  $('next-day').addEventListener('click', () => shiftDay(1));
  $('go-today').addEventListener('click', () => goToDate(dateKey(new Date())));
  el.datePicker.addEventListener('change', () => goToDate(el.datePicker.value));

  $('open-search').addEventListener('click', () => {
    renderSearch();
    openOverlay('search-overlay');
    setTimeout(() => el.searchInput.focus(), 60);
  });
  el.searchInput.addEventListener('input', renderSearch);

  $('open-settings').addEventListener('click', () => {
    fillSettingsForm();
    openOverlay('settings-overlay');
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeOverlay(button.dataset.close));
  });
  document.querySelectorAll('.sheet-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeOverlay(overlay.id);
    });
  });
  document.addEventListener('keydown', (event) => {
    const key = String(event.key).toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'k') {
      event.preventDefault();
      renderSearch();
      openOverlay('search-overlay');
      setTimeout(() => el.searchInput.focus(), 60);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z' && !editableTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y' && !editableTarget(event.target)) {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Escape') {
      document.querySelectorAll('.sheet-overlay:not([hidden])').forEach((overlay) => closeOverlay(overlay.id));
    }
  });

  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const previous = settings.autosave;
    pushUndo();
    settings = formSettings();
    if (persistSettings(settings)) {
      applySettings();
      closeOverlay('settings-overlay');
      showToast('Settings saved');
      if (!previous && settings.autosave) scheduleAutoPush();
    }
  });

  $('test-connection').addEventListener('click', testConnection);
  el.exportBtn.addEventListener('click', () => syncToGithub(false));
  $('download-md').addEventListener('click', downloadMarkdown);
  $('clear-day').addEventListener('click', clearCurrentDay);
  $('undo-day').addEventListener('click', undo);
  el.copyBtn.addEventListener('click', copyCurrentDay);
  el.ruleAdd.addEventListener('click', addRule);

  window.addEventListener('online', () => {
    if (offlinePending && settings.autosave) scheduleAutoPush();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLocalSave();
      if (settings.autosave) syncToGithub(true);
    }
  });
  window.addEventListener('pagehide', flushLocalSave);

  /* ---------- Start ---------- */

  buildTimeGrid();
  applySettings();

  // Siri Shortcut / bookmark support: ?date=YYYY-MM-DD, ?date=today, ?date=tomorrow
  // or #YYYY-MM-DD opens that day. Relative words make a home-screen icon future-proof.
  const requestedDate = new URLSearchParams(location.search).get('date') || location.hash.replace(/^#/, '');
  let startKey = requestedDate;
  if (startKey === 'today') startKey = dateKey(new Date());
  else if (startKey === 'tomorrow') startKey = dateKey(shiftDate(new Date(), 1));
  else if (startKey === 'yesterday') startKey = dateKey(shiftDate(new Date(), -1));
  if (isValidKey(startKey)) goToDate(startKey);
  else renderDay();

  if (settings.autosave && settings.token && settings.owner && settings.repo) {
    setTimeout(() => syncToGithub(true), 800);
    setInterval(() => syncToGithub(true), 60000);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline works without SW */ });
    });
  }
})();
