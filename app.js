(() => {
  'use strict';

  const KEYS = {
    notes: 'notities.v1.notes',
    settings: 'notities.v1.settings',
    last: 'notities.v1.lastDate'
  };

  const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  const $ = (id) => document.getElementById(id);
  const el = {
    datePicker: $('date-picker'),
    weekdayLabel: $('weekday-label'),
    paperDate: $('paper-date'),
    paperPage: $('paper-page'),
    noteInput: $('note-input'),
    saveState: $('save-state'),
    charCount: $('char-count'),
    searchInput: $('search-input'),
    searchMeta: $('search-meta'),
    searchResults: $('search-results'),
    connectionStatus: $('connection-status'),
    toast: $('toast'),
    exportBtn: $('export-github'),
    downloadBtn: $('download-md')
  };

  /* ---------- Datum-hulpmiddelen ---------- */

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

  function dayOfYear(date) {
    const year = date.getFullYear();
    const current = Date.UTC(year, date.getMonth(), date.getDate());
    const start = Date.UTC(year, 0, 0);
    return Math.round((current - start) / 86400000);
  }

  function daysInYear(year) {
    return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  }

  /* ---------- Opslag ---------- */

  function loadNotes() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEYS.notes) || '{}');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function persistNotes() {
    try {
      localStorage.setItem(KEYS.notes, JSON.stringify(notes));
      return true;
    } catch (_) {
      showToast('Opslaan mislukt: de browseropslag is vol', true);
      return false;
    }
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
      token: ''
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

  function persistSettings(settings) {
    try {
      localStorage.setItem(KEYS.settings, JSON.stringify(settings));
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

  function updateCount() {
    const count = el.noteInput.value.length;
    el.charCount.textContent = `${count} ${count === 1 ? 'teken' : 'tekens'}`;
  }

  function autoGrow() {
    el.noteInput.style.height = 'auto';
    el.noteInput.style.height = `${Math.max(el.noteInput.scrollHeight, 340)}px`;
  }

  function setSaveState(text) {
    el.saveState.textContent = text;
  }

  function renderDay() {
    const date = parseKey(currentKey);
    el.datePicker.value = currentKey;
    el.weekdayLabel.textContent = `${WEEKDAYS[date.getDay()]} ${longDate(date)}`;
    el.paperDate.textContent = longDate(date);
    el.paperPage.textContent = `Pagina ${dayOfYear(date)} / ${daysInYear(date.getFullYear())}`;
    el.noteInput.value = notes[currentKey] || '';
    updateCount();
    autoGrow();
    setSaveState(notes[currentKey] ? 'Opgeslagen op dit apparaat' : 'Nieuwe pagina');
  }

  let saveTimer = null;
  let pendingSave = null;

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pendingSave) return;
    const { key, value } = pendingSave;
    pendingSave = null;
    if (value.trim()) notes[key] = value;
    else delete notes[key];
    if (persistNotes()) setSaveState('Opgeslagen op dit apparaat');
  }

  function scheduleSave() {
    pendingSave = { key: currentKey, value: el.noteInput.value };
    setSaveState('Opslaan…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }

  function goToDate(key) {
    if (!isValidKey(key)) return;
    flushSave();
    currentKey = key;
    try { localStorage.setItem(KEYS.last, key); } catch (_) { /* geen kritieke fout */ }
    renderDay();
  }

  function shiftDay(amount) {
    const date = parseKey(currentKey);
    date.setDate(date.getDate() + amount);
    goToDate(dateKey(date));
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
    const flat = text.replace(/\s+/g, ' ').trim();
    if (!query) return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
    const index = flat.toLocaleLowerCase('nl').indexOf(query);
    if (index < 0) return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
    const start = Math.max(0, index - 40);
    const end = Math.min(flat.length, index + query.length + 80);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
  }

  function renderSearch() {
    const rawQuery = el.searchInput.value.trim();
    const query = rawQuery.toLocaleLowerCase('nl');
    const entries = Object.keys(notes)
      .filter((key) => isValidKey(key) && String(notes[key] || '').trim())
      .sort()
      .reverse()
      .map((key) => ({ key, text: String(notes[key]) }));

    const matches = query
      ? entries.filter((entry) => {
          const date = parseKey(entry.key);
          const haystack = [
            entry.text,
            longDate(date),
            WEEKDAYS[date.getDay()],
            entry.key
          ].join(' ').toLocaleLowerCase('nl');
          return haystack.includes(query);
        })
      : entries;

    el.searchMeta.textContent = query
      ? `${matches.length} ${matches.length === 1 ? 'resultaat' : 'resultaten'} voor “${rawQuery}”`
      : `${matches.length} ${matches.length === 1 ? 'dag' : 'dagen'} met notities`;

    el.searchResults.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `<strong>Geen notities gevonden</strong>${query ? 'Probeer een ander woord of een datum.' : 'Schrijf eerst iets op in je dagboek.'}`;
      el.searchResults.appendChild(empty);
      return;
    }

    for (const entry of matches.slice(0, 150)) {
      const date = parseKey(entry.key);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';
      button.innerHTML =
        `<span class="result-date">${escapeHtml(WEEKDAYS[date.getDay()])} ${escapeHtml(longDate(date))}</span>` +
        `<span class="result-text">${highlight(makeSnippet(entry.text, query), query)}</span>`;
      button.addEventListener('click', () => {
        closeOverlay('search-overlay');
        goToDate(entry.key);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      el.searchResults.appendChild(button);
    }
  }

  /* ---------- GitHub ---------- */

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove('show'), 3800);
  }

  function formSettings() {
    return {
      owner: $('cfg-owner').value.trim(),
      repo: $('cfg-repo').value.trim().replace(/\.git$/i, ''),
      branch: $('cfg-branch').value.trim() || 'main',
      path: $('cfg-path').value.trim().replace(/^\/+|\/+$/g, '') || 'notities',
      token: $('cfg-token').value.trim()
    };
  }

  function fillSettingsForm() {
    $('cfg-owner').value = settings.owner || '';
    $('cfg-repo').value = settings.repo || '';
    $('cfg-branch').value = settings.branch || 'main';
    $('cfg-path').value = settings.path || 'notities';
    $('cfg-token').value = settings.token || '';
    el.connectionStatus.textContent = '';
    el.connectionStatus.className = 'connection-status';
  }

  function setBusy(button, busy, label) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent.trim();
    button.disabled = busy;
    button.querySelector('.btn-label').textContent = busy ? label : button.dataset.originalLabel;
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function buildMarkdown() {
    const keys = Object.keys(notes)
      .filter((key) => isValidKey(key) && String(notes[key] || '').trim())
      .sort()
      .reverse();
    const lines = [
      '# Notities',
      '',
      `Dagboek geëxporteerd op ${longDate(new Date())}`,
      ''
    ];
    if (!keys.length) lines.push('_Nog geen notities._', '');
    for (const key of keys) {
      const date = parseKey(key);
      lines.push(`## ${WEEKDAYS[date.getDay()]} ${longDate(date)}`, '', String(notes[key]).trim(), '');
    }
    return `${lines.join('\n')}\n`;
  }

  function apiHeaders(token) {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function contentsUrl(cfg, filename) {
    const base = 'https://api.github.com/repos/'
      + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/';
    return base + [cfg.path, filename].filter(Boolean).map(encodeURIComponent).join('/');
  }

  async function exportToGithub() {
    flushSave();
    settings = loadSettings();
    const cfg = settings;
    if (!cfg.token) {
      fillSettingsForm();
      openOverlay('settings-overlay');
      showToast('Vul eerst je GitHub-token in', true);
      return;
    }
    if (!cfg.owner || !cfg.repo) {
      fillSettingsForm();
      openOverlay('settings-overlay');
      showToast('Vul eerst eigenaar en repository in', true);
      return;
    }

    const url = contentsUrl(cfg, 'agenda.md');
    setBusy(el.exportBtn, true, 'Exporteren…');
    try {
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
        content: toBase64(buildMarkdown()),
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
      showToast(`Geëxporteerd naar ${cfg.path}/agenda.md`);
    } catch (error) {
      showToast(error && error.message ? error.message : 'Export mislukt', true);
    } finally {
      setBusy(el.exportBtn, false);
    }
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

  function downloadMarkdown() {
    flushSave();
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

  /* ---------- Gebeurtenissen ---------- */

  el.noteInput.addEventListener('input', () => {
    updateCount();
    autoGrow();
    scheduleSave();
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
    settings = formSettings();
    if (persistSettings(settings)) {
      closeOverlay('settings-overlay');
      showToast('Instellingen opgeslagen op dit apparaat');
    }
  });

  $('test-connection').addEventListener('click', testConnection);
  el.exportBtn.addEventListener('click', exportToGithub);
  el.downloadBtn.addEventListener('click', downloadMarkdown);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);

  /* ---------- Start ---------- */

  renderDay();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline werkt ook zonder SW */ });
    });
  }
})();
