# Notes · Agenda

A warm paper-style daily agenda for your iPhone: one page per day with half-hour slots from 06:00 to 20:00, a separate area for free notes, and automatic sync to GitHub. A fullscreen Windows app with the same open-book Moleskine look is included.

## Features

- Half-hour grid (6:00, 6:30, 7:00, …) on cream paper with a red margin and ruled lines. Tap a time to type there.
- A red **now line** shows the current time; a small **○/✓** button marks an appointment done (double-click a Windows slot).
- Free notes at the bottom of the page, with ruled lines.
- Handwriting font (Patrick Hand) or plain system font, plus blue-black / black / pencil-grey ink — switch in ⚙ Settings.
- Four paper themes: **Cream**, **Regen / Rain**, **Zonsondergang / Sunset** and **Graphite**. The same four are in the Windows app.
- `#tags` in any slot or note become small coloured dots in the left margin, plus a tag row under the grid. `#werk` is blue, `#gezondheid` green and `#rekeningen` red; other tags get a stable colour. The same tags are clickable filter chips in Search.
- **Undo** with `Ctrl+Z` (or `⌘Z`) or the ↶ button, and redo with `Ctrl+Y` / `Ctrl+Shift+Z`. Clearing a day, a wrong tick, a settings change and recurring-rule edits are all undoable.
- Search by text, time or date; tap a result to jump to that day. `#tags` in any note become clickable filter chips in Search.
- A muted **Last week** line shows what was written seven days earlier.
- **Copy day** puts the current day on the clipboard; ⬇ downloads a `.md` file without a token.
- **Autosave to GitHub**: about 5 seconds after you stop typing, `notities/agenda.json` is updated (plus `agenda.md` as a readable copy). The sync status shows when a push is waiting and when it completed. The app also pulls changes from the Windows app every minute.
- Everything is also stored locally on your device. The app is a PWA and works offline (only sync needs internet).

### Recurring items

In ⚙ Settings → **Recurring items** you can define rules that appear as pale hints in the matching slots:

- **Weekly**: weekday `0` = Monday … `6` = Sunday, at a chosen time. `Every N` makes it fortnightly or every 3 weeks, counted from the day you created the rule.
- **Monthly**: day `1`–`31`, or `-1` for the **last day of the month** — ideal for rent, direct debits and other fixed payments. If a month is shorter than the chosen day, the item falls on that month's last day. Choose **Nth weekday** for rules like *first Monday of the month* (or *last Friday*). `Every N` also works for months.
- **Skip dates**: one or more `YYYY-MM-DD` dates to except, e.g. holidays: `2026-12-25, 2027-01-01`.

The rule list shows a readable summary such as `Team lead · first Monday of the month 09:00 · except 2027-01-01`. Rules live in `agenda.json` under `templates` and sync both ways; older rules keep working unchanged. Clearing a day hides a hint for **that date only**; it does not delete the rule. Tapping ✓ on a hint copies its text into the slot so you can tick it off.

One read-only `backups/YYYY-MM.json` snapshot is written per month, so older months stay recoverable.

### Siri / Shortcuts

The app accepts `?date=YYYY-MM-DD`, `?date=today`, `?date=tomorrow`, `?date=yesterday` (or `#YYYY-MM-DD`) in its URL. In iOS Shortcuts, use **Open URLs** with `https://toshalbir.github.io/notities/?date=2026-11-30` — or build the URL with a **Format Date** action (`yyyy-MM-dd`) to ask Siri for any date. For a fullscreen icon that always opens today, visit `https://toshalbir.github.io/notities/?date=today` in Safari once and choose **Share ▸ Add to Home Screen**; the icon keeps that URL. A haptic tick is given on supported devices when you type or tick an item.

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

Autosave is on by default and can be turned off in the same settings. The token field uses password autofill, so iOS can keep the token in **iCloud Keychain** (Passwords). A web page cannot call the Keychain API directly, so the PWA keeps the token only for the current session (session storage) and removes any older plaintext copy from local storage on first load. It is never stored in the app code or in `agenda.json`. On Windows the token is encrypted with **DPAPI** before `settings.json` is written, so only your Windows account can read it.

### What goes to GitHub

One file is authoritative for sync: `notities/agenda.json`. It contains `days` (with per-field timestamps, done marks and per-day hidden recurring hints) and `templates` (the recurring rules). The app also writes `notities/agenda.md` as a readable copy, with each day's appointments and free notes:

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

`windows/` contains a fullscreen Tkinter app in the same style, laid out like an open Moleskine week: Monday–Wednesday on the left page, Thursday–Friday on the right page, and Saturday and Sunday stacked in the rightmost column (with its own clear scrollbar). The pages fill the full window height, with a centre fold, soft shadow and cream paper. Each day has a half-hour grid from 06:00 to 20:00 and a notes field. It uses the same GitHub settings and the same `agenda.json`, so changes from iPhone and Windows are merged per field (most recent timestamp wins). Old 15-minute entries are folded into the nearest half-hour slot automatically, so no notes are lost.

Toolbar buttons: **Today**, **Big** (large read-only card for today), ↶/↷ (undo/redo), **Find** (`Ctrl+K`), **Rules** (weekly/monthly templates with intervals, nth weekday and skip dates), **Mini** (a translucent, draggable sticky note with **today only**, always on top), **Theme** (cycles Cream → Rain → Sunset → Graphite), **Copy**, **Print**, ↻ (sync), ⚙ (settings), ⛶ (fullscreen) and ✕ (quit). Month tabs on the left jump to a month. `Ctrl+Alt+N` brings the app to the front and returns to today; `Ctrl+Z` / `Ctrl+Y` undo and redo. In a day grid, ↑/↓ and Enter move between half-hour slots, Tab jumps to the ○/✓ tick, and Enter on a tick returns to typing. Double-click a slot also toggles its done tick. The small ✕ next to a date clears that whole day — including its notes and any recurring hints for that date. Print puts the entire week on one landscape page with a torn-paper edge; if no printer is available, it opens a PDF instead.

1. In the Windows app, enter the same username, repository, branch, folder and token as on the iPhone (⚙).
2. `windows/maak-exe.bat` builds `Notities.exe` (PyInstaller is installed automatically if needed) and copies it to the Start menu and startup locations.
3. Escape temporarily leaves fullscreen; the ↻ button syncs immediately. The status bar shows **Waiting to sync…** before a push.

The iPhone app must use the latest `app.js` (v12): older versions only write `agenda.md` and never read from GitHub. After an upload, reopen the app on the iPhone to refresh the service worker cache (`notities-shell-v12`).

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

Notes stay on your device until they are synced to GitHub. No account, backend or analytics; the only network calls go straight to `api.github.com`. The GitHub token is session-only on iPhone (with iCloud Keychain autofill) and DPAPI-encrypted on Windows. Undo history is kept in memory only and is never uploaded.
