# Notes · Agenda

A warm paper-style daily agenda for your iPhone: one page per day with half-hour slots from 06:00 to 20:00, a separate area for free notes, and automatic sync to GitHub. A fullscreen Windows app with the same open-book Moleskine look is included.

## Features

- Half-hour grid (6:00, 6:30, 7:00, …) on cream paper with a red margin and ruled lines. Tap a time to type there.
- Free notes at the bottom of the page, with ruled lines.
- Handwriting font (Patrick Hand) or plain system font — switch in ⚙ Settings.
- Search by text, time or date; tap a result to jump to that day.
- **Autosave to GitHub**: about 5 seconds after you stop typing, `notities/agenda.json` is updated (plus `agenda.md` as a readable copy). The sync status is shown at the bottom. The app also pulls changes from the Windows app every minute.
- Manual export with the ⬆ button; ⬇ downloads a `.md` file without a token.
- Everything is also stored locally on your device. The app is a PWA and works offline (only sync needs internet).

## Put it on GitHub

1. Create or refresh a public repository on GitHub, for example `notes`.
2. Upload all files from this folder, including `fonts`, `icons` and `tools`.
3. **Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.**
4. Open `https://<your-name>.github.io/notities/` in Safari and choose **Share ▸ Add to Home Screen**.

Replace `<your-name>` with your real GitHub username. The owner and repository are then detected automatically from the URL.

Open the app **from the home screen icon**: it then runs fullscreen without the address bar. Safari itself always keeps its browser bar — a web page cannot hide it.

## Set up the token

1. GitHub ▸ avatar ▸ **Settings** ▸ **Developer settings** ▸ **Personal access tokens** ▸ **Fine-grained tokens** ▸ **Generate new token**.
2. Name it e.g. `notes-iphone`; set an expiry, e.g. 90 days.
3. **Repository access**: *Only select repositories* → only your `notes` repo.
4. **Permissions → Repository permissions**: **Contents = Read and write**.
5. Generate the token, copy the whole `github_pat_…` text and paste it into ⚙ **Settings → Access token**.
6. Optionally check it with **Check** and then tap **Save**.

Autosave is on by default and can be turned off in the same settings. The token lives only in browser storage on your device and is never stored in the app code.

### What goes to GitHub

One file is authoritative for sync: `notities/agenda.json`. The app also writes `notities/agenda.md` as a readable copy, with each day's appointments and free notes:

```markdown
# Notes

## Sunday 22 November 2026

### Appointments
- 08:30 — Team meeting
- 14:00 — Dentist

### Notes
Finished the prototype today.
```

The folder name `notities` and the branch are configurable. Autosave waits until you stop typing so GitHub does not get a commit for every keystroke.

## Windows app (7 days side by side)

`windows/` contains a fullscreen Tkinter app in the same style, laid out like an open Moleskine week: Monday–Wednesday on the left page, Thursday–Friday on the right page, and Saturday and Sunday stacked in the rightmost column. The pages fill the full window height, with a centre fold, soft shadow and cream paper. Each day has a half-hour grid from 06:00 to 20:00 and a notes field. It uses the same GitHub settings and the same `agenda.json`, so changes from iPhone and Windows are merged per field (most recent timestamp wins). The small ✕ next to a date clears that whole day (including its notes). Print puts the entire week on one landscape page; if no printer is available, it opens a PDF instead. Old 15-minute entries are folded into the nearest half-hour slot automatically, so no notes are lost.

1. In the Windows app, enter the same username, repository, branch, folder and token as on the iPhone (⚙).
2. `windows/maak-exe.bat` builds `Notes.exe` (PyInstaller is installed automatically if needed).
3. Escape temporarily leaves fullscreen; the ↻ button syncs immediately.

The iPhone app must use the latest `app.js`: older versions only write `agenda.md` and never read from GitHub. After an upload, reopen the app on the iPhone to refresh the service worker cache.

## Try it locally

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Agenda structure |
| `styles.css` | Light Moleskine-style design |
| `app.js` | Storage, time grid, search, two-way sync and export |
| `manifest.json` / `sw.js` | PWA and offline caching |
| `fonts/` | Patrick Hand + license (SIL OFL 1.1) |
| `icons/` | App icons |
| `tools/make_icons.py` | Optional: regenerate icons |
| `windows/notities.py` | Fullscreen Windows app with 7 days |
| `windows/notities_core.py` | Shared sync logic (JSON with timestamps) |
| `windows/maak-exe.bat` | Builds `Notes.exe` |

## Privacy

Notes stay on your device until they are synced to GitHub. No account, backend or analytics; the only network calls go straight to `api.github.com`.
