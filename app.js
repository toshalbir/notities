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

  /* ---------- Gegevens (met tijdstempels voor sync) ---------- */

  function normalizeField(value) {
    if (typeof value === 'string') return { text: value, ts: 0 };
    const obj = (value && typeof value === 'object') ? value : {};
    return {
      text: typeof obj.text === 'string' ? obj.text : '',
      ts: Number(obj.ts) || 0
    };
  }

  function normalizeEntry(value) {
    if (typeof value === 'string') return { notes: { text: value, ts: 0 }, slots: {} };
    const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    const slots = {};
    if (obj.slots && typeof obj.slots === 'object') {
      for (const [time, field] of Object.entries(obj.slots)) {
        slots[time] = normalizeField(field);
      }
    }
    return { notes: normalizeField(obj.notes), slots };
  }

  function hasContent(entry) {
    const clean = normalizeEntry(entry);
    return Boolean(clean.notes.text.trim()) ||
      Object.values(clean.slots).some((field) => Boolean(field.text.trim()));
  }

  function notesSignature() {
    const sorted = {};
    for (const key of Object.keys(notes).sort()) {
      const entry = normalizeEntry(notes[key]);
      const slots = {};
      for (const time of Object.keys(entry.slots).sort()) slots[time] = entry.slots[time];
      sorted[key] = { notes: entry.notes, slots };
    }
    return JSON.stringify(sorted);
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
          if (Object.keys(entry.slots).length || entry.notes.text) result[key] = entry;
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
    if (!notes[key] && !create) return { notes: { text: '', ts: 0 }, slots: {} };
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
    if (!settings.autosave) updateSync('Lokaal opgeslagen');
    else if (!settings.token || !settings.owner || !settings.repo) updateSync('Lokaal — vul GitHub-instellingen in');
    else updateSync('Autosave aan', 'ok');
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
        entry.slots[time] = { text: input.value, ts: Date.now() };
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
    for (const time of TIMES) slotInputs[time].value = (entry.slots[time] || {}).text || '';
    el.notesInput.value = entry.notes.text || '';
    autoGrowNotes();
  }

  /* ---------- Lokaal opslaan ---------- */

  let localTimer = null;

  function tidyNotes() {
    for (const key of Object.keys(notes)) {
      const entry = normalizeEntry(notes[key]);
      if (Object.keys(entry.slots).length || entry.notes.text) notes[key] = entry;
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

  function buildMarkdown() {
    const keys = Object.keys(notes).filter((key) => isValidKey(key) && hasContent(notes[key])).sort().reverse();
    const lines = ['# Notities', ''];
    if (!keys.length) lines.push('_Nog geen notities._', '');
    for (const key of keys) {
      const entry = normalizeEntry(notes[key]);
      const date = parseKey(key);
      lines.push(`## ${WEEKDAYS[date.getDay()]} ${longDate(date)}`, '');
      const times = Object.keys(entry.slots).filter((time) => entry.slots[time].text.trim()).sort();
      if (times.length) {
        lines.push('### Afspraken', '');
        for (const time of times) lines.push(`- ${time} — ${entry.slots[time].text.replace(/\s+/g, ' ').trim()}`);
        lines.push('');
      }
      if (entry.notes.text.trim()) lines.push('### Notities', '', entry.notes.text.trim(), '');
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

  async function fetchFile(cfg, filename) {
    const response = await fetch(`${contentsUrl(cfg, filename)}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: apiHeaders(cfg.token)
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) { /* negeer */ }
      throw new Error(`GitHub gaf status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return { sha: data.sha || null, text: fromBase64(data.content || '') };
  }

  async function pushFile(cfg, filename, content, sha) {
    const payload = {
      message: `Notities bijgewerkt — ${longDate(new Date())}`,
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
    try { detail = (await response.json()).message || ''; } catch (_) { /* negeer */ }
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
      updateSync('Lokaal — vul GitHub-instellingen in');
      if (!silent) {
        fillSettingsForm();
        openOverlay('settings-overlay');
        showToast('Vul eerst GitHub-instellingen in', true);
      }
      return;
    }
    if (!navigator.onLine) {
      offlinePending = true;
      updateSync('Offline — sync wacht op verbinding', 'error');
      return;
    }
    flushLocalSave();
    pushInFlight = true;
    el.exportBtn.disabled = true;
    updateSync(silent ? 'Synchroniseren…' : 'Exporteren…');
    try {
      const cfg = settings;
      const remote = await fetchFile(cfg, 'agenda.json');
      if (remote) {
        try {
          const parsed = JSON.parse(remote.text);
          if (parsed && parsed.days && typeof parsed.days === 'object') mergeRemoteDays(parsed.days);
        } catch (_) { /* onleesbaar bestand: lokale data bewaren */ }
      }
      persistNotes();
      renderDay();

      const signature = notesSignature();
      if (signature === lastSyncedSignature && remote) {
        updateSync('Alles gesynchroniseerd', 'ok');
        return;
      }

      let jsonSha = remote ? remote.sha : null;
      let result = await pushFile(cfg, 'agenda.json', JSON.stringify({
        schema: 1,
        updated: new Date().toISOString(),
        days: notes
      }), jsonSha);

      if (!result.ok && result.status === 409) {
        const again = await fetchFile(cfg, 'agenda.json');
        if (again) {
          try {
            const parsed = JSON.parse(again.text);
            if (parsed && parsed.days) mergeRemoteDays(parsed.days);
          } catch (_) { /* negeer */ }
          jsonSha = again.sha;
          result = await pushFile(cfg, 'agenda.json', JSON.stringify({
            schema: 1,
            updated: new Date().toISOString(),
            days: notes
          }), jsonSha);
        }
      }
      if (!result.ok) throw new Error(`Sync mislukt (${result.status})${result.message ? `: ${result.message}` : ''}`);

      let markdownRemote = await fetchFile(cfg, 'agenda.md');
      let mdResult = await pushFile(cfg, 'agenda.md', buildMarkdown(), markdownRemote ? markdownRemote.sha : null);
      if (!mdResult.ok && mdResult.status === 409) {
        markdownRemote = await fetchFile(cfg, 'agenda.md');
        mdResult = await pushFile(cfg, 'agenda.md', buildMarkdown(), markdownRemote ? markdownRemote.sha : null);
      }
      if (!mdResult.ok) throw new Error(`Sync van agenda.md mislukt (${mdResult.status})`);

      lastSyncedSignature = signature;
      offlinePending = false;
      const now = new Date();
      updateSync(`Gesynchroniseerd ${pad(now.getHours())}:${pad(now.getMinutes())}`, 'ok');
      if (!silent) showToast('Gesynchroniseerd met GitHub');
    } catch (error) {
      updateSync('Sync mislukt — tik op ⬆', 'error');
      showToast(error && error.message ? error.message : 'Synchroniseren mislukt', true);
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
          if (entry.slots[time].text.trim()) parts.push({ label: time, text: entry.slots[time].text });
        }
        if (entry.notes.text.trim()) parts.push({ label: 'Notities', text: entry.notes.text });
        return { key, date, parts };
      });

    const matches = days.filter((day) => {
      if (!query) return true;
      const haystack = [
        longDate(day.date), WEEKDAYS[day.date.getDay()], day.key,
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
    if (!document.querySelector('.sheet-overlay:not([hidden])')) document.body.classList.remove('overlay-open');
  }

  /* ---------- Gebeurtenissen ---------- */

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
  el.exportBtn.addEventListener('click', () => syncToGithub(false));
  $('download-md').addEventListener('click', downloadMarkdown);

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
  renderDay();

  if (settings.autosave && settings.token && settings.owner && settings.repo) {
    setTimeout(() => syncToGithub(true), 800);
    setInterval(() => syncToGithub(true), 60000);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline werkt zonder SW */ });
    });
  }
})();
