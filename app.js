(() => {
  'use strict';

  const KEYS = {
    notes: 'notities.v1.notes',
    settings: 'notities.v1.settings',
    last: 'notities.v1.lastDate'
  };

  const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  const TIMES = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let minutes = 6 * 60; minutes <= 20 * 60; minutes += 15) {
    TIMES.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }

  const $ = (id) => document.getElementById(id);
  const el = {
    datePicker: $('date-picker'),
    dateShort: $('date-short'),
    pageDate: $('page-date'),
    pageNum: $('page-num'),
    timeCol: $('time-col'),
    slotCol: $('slot-col'),
    notesInput: $('notes-input'),
    searchInput: $('search-input'),
    searchMeta: $('search-meta'),
    searchResults: $('search-results'),
    connectionStatus: $('connection-status'),
    syncStatus: $('sync-status'),
    toast: $('toast'),
    exportBtn: $('export-github')
  };
  const slotInputs = {};

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

  /* ---------- Gegevens ---------- */

  function normalizeEntry(value) {
    if (typeof value === 'string') return { notes: value, slots: {} };
    const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    const slots = {};
    if (obj.slots && typeof obj.slots === 'object') {
      for (const [time, text] of Object.entries(obj.slots)) {
        if (typeof text === 'string' && text.trim()) slots[time] = text;
      }
    }
    return { notes: typeof obj.notes === 'string' ? obj.notes : '', slots };
  }

  function hasContent(entry) {
    const clean = normalizeEntry(entry);
    return Boolean(clean.notes.trim()) || Object.keys(clean.slots).length > 0;
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
      showToast('Opslaan mislukt: browseropslag is vol', true);
      return false;
    }
  }

  function getEntry(key, create) {
    if (!notes[key] && !create) return { notes: '', slots: {} };
    if (!notes[key]) notes[key] = { notes: '', slots: {} };
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
      font: 'hand'
    };
  }

  function loadSettings() {
    const defaults = defaultSettings();
    try {
      const stored = JSON.parse(localStorage.getItem(KEYS.settings) || '{}');
      return { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
    } catch (_) {
      return defaults;
    }
  }

  function persistSettings(value) {
    try {
      localStorage.setItem(KEYS.settings, JSON.stringify(value));
      return true;
    } catch (_) {
      showToast('Instellingen konden niet worden opgeslagen', true);
      return false;
    }
  }

  let notes = loadNotes();
  let settings = loadSettings();
  let currentKey = localStorage.getItem(KEYS.last) || dateKey(new Date());
  if (!isValidKey(currentKey)) currentKey = dateKey(new Date());

  /* ---------- Weergave ---------- */

  function updateSync(text, kind) {
    el.syncStatus.textContent = text;
    el.syncStatus.className = `sync${kind ? ` ${kind}` : ''}`;
  }

  function refreshSyncBase() {
    if (!settings.autosave) {
      updateSync('Lokaal opgeslagen');
    } else if (!settings.token || !settings.owner || !settings.repo) {
      updateSync('Lokaal — vul GitHub-instellingen in');
    } else {
      updateSync('Autosave aan', 'ok');
    }
  }

  function applySettings() {
    document.body.dataset.font = settings.font === 'system' ? 'system' : 'hand';
    refreshSyncBase();
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

      const input = document.createElement('input');
      input.type = 'text';
      input.className = `slot${isHour ? ' hour' : ''}`;
      input.dataset.time = time;
      input.setAttribute('aria-label', `Afspraak om ${time}`);
      input.autocomplete = 'off';
      input.autocapitalize = 'sentences';
      input.spellcheck = true;
      input.addEventListener('input', () => {
        const entry = getEntry(currentKey, true);
        if (input.value.trim()) entry.slots[time] = input.value;
        else delete entry.slots[time];
        scheduleLocalSave();
        scheduleAutoPush();
      });
      label.addEventListener('click', () => input.focus());
      slotInputs[time] = input;
      el.slotCol.appendChild(input);
    }
  }

  function autoGrowNotes() {
    el.notesInput.style.height = 'auto';
    el.notesInput.style.height = `${Math.max(el.notesInput.scrollHeight, 170)}px`;
  }

  function renderDay() {
    const date = parseKey(currentKey);
    const entry = getEntry(currentKey, false);
    el.datePicker.value = currentKey;
    el.dateShort.textContent = shortDate(date);
    el.pageDate.textContent = `${WEEKDAYS[date.getDay()]} ${longDate(date)}`;
    el.pageNum.textContent = String(dayOfYear(date));
    for (const time of TIMES) slotInputs[time].value = entry.slots[time] || '';
    el.notesInput.value = entry.notes || '';
    autoGrowNotes();
  }

  /* ---------- Opslaan ---------- */

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
    try { localStorage.setItem(KEYS.last, key); } catch (_) { /* niet kritiek */ }
    renderDay();
  }

  function shiftDay(amount) {
    const date = parseKey(currentKey);
    date.setDate(date.getDate() + amount);
    goToDate(dateKey(date));
  }

  /* ---------- GitHub ---------- */

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function buildMarkdown() {
    const keys = Object.keys(notes).filter((key) => isValidKey(key) && hasContent(notes[key])).sort().reverse();
    const lines = ['# Notities', ''];
    if (!keys.length) lines.push('_Nog geen notities._', '');
    for (const key of keys) {
      const entry = normalizeEntry(notes[key]);
      const date = parseKey(key);
      lines.push(`## ${WEEKDAYS[date.getDay()]} ${longDate(date)}`, '');
      const times = Object.keys(entry.slots).sort();
      if (times.length) {
        lines.push('### Afspraken', '');
        for (const time of times) {
          lines.push(`- ${time} — ${String(entry.slots[time]).replace(/\s+/g, ' ').trim()}`);
        }
        lines.push('');
      }
      if (entry.notes.trim()) {
        lines.push('### Notities', '', entry.notes.trim(), '');
      }
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
    return base + [cfg.path, filename].filter(Boolean).map(encodeURIComponent).join('/');
  }

  let pushTimer = null;
  let pushInFlight = false;
  let pushQueued = false;
  let offlinePending = false;
  let lastPushed = null;

  async function performPush(cfg, content, silent) {
    pushInFlight = true;
    updateSync(silent ? 'Synchroniseren…' : 'Exporteren…');
    el.exportBtn.disabled = true;
    try {
      const url = contentsUrl(cfg, 'agenda.md');
      const current = await fetch(`${url}?ref=${encodeURIComponent(cfg.branch)}`, {
        headers: apiHeaders(cfg.token)
      });
      let sha = null;
      if (current.status === 404) {
        sha = null;
      } else if (!current.ok) {
        let detail = '';
        try { detail = (await current.json()).message || ''; } catch (_) { /* negeer */ }
        throw new Error(`GitHub gaf status ${current.status}${detail ? `: ${detail}` : ''}`);
      } else {
        sha = (await current.json()).sha || null;
      }

      const payload = {
        message: `Notities bijgewerkt — ${longDate(new Date())}`,
        content: toBase64(content),
        branch: cfg.branch
      };
      if (sha) payload.sha = sha;

      const response = await fetch(url, {
        method: 'PUT',
        headers: { ...apiHeaders(cfg.token), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).message || ''; } catch (_) { /* negeer */ }
        throw new Error(`Export mislukt (${response.status})${detail ? `: ${detail}` : ''}`);
      }

      lastPushed = content;
      offlinePending = false;
      const now = new Date();
      updateSync(`Gesynchroniseerd ${pad(now.getHours())}:${pad(now.getMinutes())}`, 'ok');
      if (!silent) showToast('Geëxporteerd naar GitHub');
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : 'Synchroniseren mislukt';
      updateSync('Sync mislukt — tik op ⬆', 'error');
      showToast(message, true);
      return false;
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
    if (pushInFlight) {
      pushQueued = true;
      return;
    }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(runAutoPush, 5000);
  }

  async function runAutoPush() {
    if (!settings.autosave) return;
    if (pushInFlight) {
      pushQueued = true;
      return;
    }
    if (!navigator.onLine) {
      offlinePending = true;
      updateSync('Offline — sync wacht op verbinding', 'error');
      return;
    }
    settings = loadSettings();
    if (!settings.token || !settings.owner || !settings.repo) {
      updateSync('Lokaal — vul GitHub-instellingen in');
      return;
    }
    const content = buildMarkdown();
    if (content === lastPushed) {
      updateSync('Alles gesynchroniseerd', 'ok');
      return;
    }
    await performPush(settings, content, true);
  }

  async function manualExport() {
    flushLocalSave();
    settings = loadSettings();
    if (!settings.token || !settings.owner || !settings.repo) {
      fillSettingsForm();
      openOverlay('settings-overlay');
      showToast('Vul eerst GitHub-instellingen in', true);
      return;
    }
    clearTimeout(pushTimer);
    if (pushInFlight) {
      pushQueued = true;
      return;
    }
    await performPush(settings, buildMarkdown(), false);
  }

  function downloadMarkdown() {
    flushLocalSave();
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `notities-${dateKey(new Date())}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    showToast('Bestand gedownload');
  }

  /* ---------- Zoeken ---------- */

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
    const index = flat.toLocaleLowerCase('nl').indexOf(query);
    if (index < 0) return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat;
    const start = Math.max(0, index - 35);
    const end = Math.min(flat.length, index + query.length + 70);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
  }

  function renderSearch() {
    const rawQuery = el.searchInput.value.trim();
    const query = rawQuery.toLocaleLowerCase('nl');
    const days = Object.keys(notes)
      .filter((key) => isValidKey(key) && hasContent(notes[key]))
      .sort()
      .reverse()
      .map((key) => {
        const entry = normalizeEntry(notes[key]);
        const date = parseKey(key);
        const parts = [];
        for (const time of Object.keys(entry.slots).sort()) {
          parts.push({ label: time, text: String(entry.slots[time]) });
        }
        if (entry.notes.trim()) parts.push({ label: 'Notities', text: entry.notes });
        return { key, date, parts };
      });

    const matches = days.filter((day) => {
      if (!query) return true;
      const haystack = [
        longDate(day.date),
        WEEKDAYS[day.date.getDay()],
        day.key,
        ...day.parts.map((part) => `${part.label} ${part.text}`)
      ].join(' ').toLocaleLowerCase('nl');
      return haystack.includes(query);
    });

    el.searchMeta.textContent = query
      ? `${matches.length} ${matches.length === 1 ? 'resultaat' : 'resultaten'} voor “${rawQuery}”`
      : `${matches.length} ${matches.length === 1 ? 'dag' : 'dagen'} met notities`;

    el.searchResults.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = query ? 'Geen notities gevonden. Probeer een ander woord.' : 'Nog geen notities geschreven.';
      el.searchResults.appendChild(empty);
      return;
    }

    for (const day of matches.slice(0, 150)) {
      const chosen = day.parts.find((part) => !query || `${part.label} ${part.text}`.toLocaleLowerCase('nl').includes(query)) || day.parts[0];
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

  /* ---------- Instellingen ---------- */

  function formSettings() {
    return {
      owner: $('cfg-owner').value.trim(),
      repo: $('cfg-repo').value.trim().replace(/\.git$/i, ''),
      branch: $('cfg-branch').value.trim() || 'main',
      path: $('cfg-path').value.trim().replace(/^\/+|\/+$/g, '') || 'notities',
      token: $('cfg-token').value.trim(),
      autosave: $('cfg-autosave').checked,
      font: $('cfg-font').value === 'system' ? 'system' : 'hand'
    };
  }

  function fillSettingsForm() {
    $('cfg-owner').value = settings.owner || '';
    $('cfg-repo').value = settings.repo || '';
    $('cfg-branch').value = settings.branch || 'main';
    $('cfg-path').value = settings.path || 'notities';
    $('cfg-token').value = settings.token || '';
    $('cfg-autosave').checked = settings.autosave !== false;
    $('cfg-font').value = settings.font === 'system' ? 'system' : 'hand';
    el.connectionStatus.textContent = '';
    el.connectionStatus.className = 'connection-status';
  }

  async function testConnection() {
    const cfg = formSettings();
    el.connectionStatus.className = 'connection-status';
    el.connectionStatus.textContent = 'Verbinden…';
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      el.connectionStatus.className = 'connection-status error';
      el.connectionStatus.textContent = 'Vul eigenaar, repository en token in.';
      return;
    }
    try {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
        { headers: apiHeaders(cfg.token) }
      );
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).message || ''; } catch (_) { /* negeer */ }
        throw new Error(detail || `status ${response.status}`);
      }
      el.connectionStatus.className = 'connection-status ok';
      el.connectionStatus.textContent = 'Verbinding OK — repository gevonden.';
    } catch (error) {
      el.connectionStatus.className = 'connection-status error';
      el.connectionStatus.textContent = `Geen verbinding: ${error.message || 'onbekende fout'}`;
    }
  }

  /* ---------- Overlays ---------- */

  function openOverlay(id) {
    $(id).hidden = false;
    document.body.classList.add('overlay-open');
  }

  function closeOverlay(id) {
    $(id).hidden = true;
    if (!document.querySelector('.sheet-overlay:not([hidden])')) {
      document.body.classList.remove('overlay-open');
    }
  }

  /* ---------- Gebeurtenissen ---------- */

  el.notesInput.addEventListener('input', () => {
    const entry = getEntry(currentKey, true);
    entry.notes = el.notesInput.value;
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
    if (event.key === 'Escape') {
      document.querySelectorAll('.sheet-overlay:not([hidden])').forEach((overlay) => closeOverlay(overlay.id));
    }
  });

  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const previous = settings.autosave;
    settings = formSettings();
    if (persistSettings(settings)) {
      applySettings();
      closeOverlay('settings-overlay');
      showToast('Instellingen opgeslagen');
      if (!previous && settings.autosave) scheduleAutoPush();
    }
  });

  $('test-connection').addEventListener('click', testConnection);
  el.exportBtn.addEventListener('click', manualExport);
  $('download-md').addEventListener('click', downloadMarkdown);

  window.addEventListener('online', () => {
    if (offlinePending && settings.autosave) scheduleAutoPush();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLocalSave();
      if (settings.autosave) runAutoPush();
    }
  });
  window.addEventListener('pagehide', flushLocalSave);

  /* ---------- Start ---------- */

  buildTimeGrid();
  applySettings();
  renderDay();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline werkt zonder SW */ });
    });
  }
})();
