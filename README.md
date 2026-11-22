# Notities · Agenda

Een lichte, strakke dagagenda voor je iPhone: één pagina per dag met tijdvakken van 06:00 tot 20:00 per kwartier, een apart vel voor losse notities, en automatische opslag naar GitHub.

## Wat zit erin

- Tijdgrid per kwartier (6:00, 6:15, 6:30, …), zoals een Moleskine-dagagenda. Tik op een tijd om daar te typen.
- Losse notities onderaan de pagina, met schrijflijnen.
- Handgeschreven lettertype (Patrick Hand) of gewoon systeemlettertype — om te zetten in ⚙ Instellingen.
- Zoeken op tekst, tijd of datum; tik op een resultaat om naar die dag te gaan.
- **Autosave naar GitHub**: ~5 seconden nadat je stopt met typen wordt `notities/agenda.json` bijgewerkt (en `agenda.md` als leesbare kopie). Onderaan zie je de sync-status. De app haalt ook elke minuut wijzigingen van de Windows-app op.
- Handmatig exporteren kan ook met de ⬆-knop; ⬇ downloadt een `.md`-bestand zonder token.
- Alles staat ook lokaal op je apparaat. De app is een PWA en werkt offline (alleen sync heeft internet nodig).

## Op GitHub zetten

1. Maak/ververs een publieke repository op GitHub, bijvoorbeeld `notities`.
2. Upload alle bestanden uit deze map, inclusief `fonts`, `icons` en `tools`.
3. **Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.**
4. Open `https://<jouw-naam>.github.io/notities/` in Safari en kies **Deel ▸ Toevoegen aan startscherm**.

`<jouw-naam>` vervang je door je echte GitHub-gebruikersnaam. Eigenaar en repository worden verder automatisch uit de URL herkend.

Open de app daarna **via het icoon op je startscherm**: dan draait hij in volledig scherm zonder adresbalk. In Safari zelf blijft de browserbalk zichtbaar — dat kan een webpagina niet uitzetten.

## Token instellen

1. GitHub ▸ avatar ▸ **Settings** ▸ **Developer settings** ▸ **Personal access tokens** ▸ **Fine-grained tokens** ▸ **Generate new token**.
2. Naam, bijv. `notities-iphone`; vervaldatum bijv. 90 dagen.
3. **Repository access**: *Only select repositories* → alleen je `notities`-repo.
4. **Permissions → Repository permissions**: **Contents = Read and write**.
5. Generate token, kopieer de hele `github_pat_…`-tekst en plak die in ⚙ **Instellingen → Toegangstoken**.
6. Controleer eventueel met **Controleer verbinding** en tik op **Opslaan**.

Autosave staat standaard aan; je kunt hem in dezelfde instellingen uitzetten. Het token staat alleen in Safari-opslag op jouw apparaat en wordt nooit in de app-code bewaard.

### Wat er naar GitHub gaat

Eén bestand is leidend voor de synchronisatie: `notities/agenda.json`. Daarnaast schrijft de app `notities/agenda.md` als leesbare kopie, met per dag de afspraken en losse notities:

```markdown
# Notities

## zondag 22 november 2026

### Afspraken
- 08:30 — Teamoverleg
- 14:00 — Tandarts

### Notities
Vandaag het prototype afgemaakt.
```

De mapnaam `notities` en de branch zijn instelbaar. Autosave wacht tot je stopt met typen zodat GitHub niet bij elke toetsaanslag een commit krijgt.

## Windows-app (7 dagen naast elkaar)

In `windows/` staat een schermvullende Tkinter-app met dezelfde stijl: zeven dagen naast elkaar, kwartierraster van 06:00–20:00 en een notitieveld per dag. Hij gebruikt dezelfde GitHub-instellingen en hetzelfde `agenda.json`, dus wijzigingen van iPhone en Windows worden per veld samengevoegd (nieuwste tijdstempel wint).

1. Vul in de Windows-app op ⚙ dezelfde gebruikersnaam, repository, branch, map en token in als op de iPhone.
2. `windows/maak-exe.bat` bouwt `Notities.exe` (PyInstaller wordt zo nodig automatisch geïnstalleerd).
3. Escape haalt de app even uit fullscreen; de ↻-knop synchroniseert direct.

De iPhone-app moet wel de nieuwste `app.js` gebruiken: oude versies schrijven alleen `agenda.md` en lezen nooit van GitHub. Controleer na een upload dat de app op de iPhone opnieuw is geopend (service worker-cache vernieuwen).

## Lokaal proberen

```powershell
python -m http.server 8000
```

Open daarna `http://localhost:8000`.

## Bestanden

| Bestand | Doel |
| --- | --- |
| `index.html` | Structuur van de agenda |
| `styles.css` | Lichte Moleskine-achtige vormgeving |
| `app.js` | Opslag, tijdgrid, zoeken, tweeweg-sync en export |
| `manifest.json` / `sw.js` | PWA en offline caching |
| `fonts/` | Patrick Hand + licentie (SIL OFL 1.1) |
| `icons/` | App-iconen |
| `tools/make_icons.py` | Optioneel: iconen opnieuw genereren |
| `windows/notities.py` | Schermvullende Windows-app met 7 dagen |
| `windows/notities_core.py` | Gedeelde sync-logica (JSON met tijdstempels) |
| `windows/maak-exe.bat` | Bouwt `Notities.exe` |

## Privacy

Notities blijven op je apparaat tot ze naar GitHub worden gesynchroniseerd. Geen account, backend of analyse; de enige netwerkcalls gaan rechtstreeks naar `api.github.com`.
