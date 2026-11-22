# Notities · Agenda

Een lichte, strakke dagagenda voor je iPhone: één pagina per dag met tijdvakken van 08:00 tot 20:00, een apart vel voor losse notities, en automatische opslag naar GitHub.

## Wat zit erin

- Tijdgrid met halve uren (8:00, 8:30, 9:00, …), zoals een Moleskine-dagagenda. Tik op een tijd om daar te typen.
- Losse notities onderaan de pagina, met schrijflijnen.
- Handgeschreven lettertype (Patrick Hand) of gewoon systeemlettertype — om te zetten in ⚙ Instellingen.
- Zoeken op tekst, tijd of datum; tik op een resultaat om naar die dag te gaan.
- **Autosave naar GitHub**: ~5 seconden nadat je stopt met typen wordt `notities/agenda.md` bijgewerkt. Onderaan zie je de sync-status.
- Handmatig exporteren kan ook met de ⬆-knop; ⬇ downloadt een `.md`-bestand zonder token.
- Alles staat ook lokaal op je apparaat. De app is een PWA en werkt offline (alleen sync heeft internet nodig).

## Op GitHub zetten

1. Maak/ververs een publieke repository op GitHub, bijvoorbeeld `notities`.
2. Upload alle bestanden uit deze map, inclusief `fonts`, `icons` en `tools`.
3. **Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.**
4. Open `https://<jouw-naam>.github.io/notities/` in Safari en kies **Deel ▸ Toevoegen aan startscherm**.

`<jouw-naam>` vervang je door je echte GitHub-gebruikersnaam. Eigenaar en repository worden verder automatisch uit de URL herkend.

## Token instellen

1. GitHub ▸ avatar ▸ **Settings** ▸ **Developer settings** ▸ **Personal access tokens** ▸ **Fine-grained tokens** ▸ **Generate new token**.
2. Naam, bijv. `notities-iphone`; vervaldatum bijv. 90 dagen.
3. **Repository access**: *Only select repositories* → alleen je `notities`-repo.
4. **Permissions → Repository permissions**: **Contents = Read and write**.
5. Generate token, kopieer de hele `github_pat_…`-tekst en plak die in ⚙ **Instellingen → Toegangstoken**.
6. Controleer eventueel met **Controleer verbinding** en tik op **Opslaan**.

Autosave staat standaard aan; je kunt hem in dezelfde instellingen uitzetten. Het token staat alleen in Safari-opslag op jouw apparaat en wordt nooit in de app-code bewaard.

### Wat er naar GitHub gaat

Eén bestand: `notities/agenda.md`, met per dag de afspraken en losse notities:

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
| `app.js` | Opslag, tijdgrid, zoeken, autosave en export |
| `manifest.json` / `sw.js` | PWA en offline caching |
| `fonts/` | Patrick Hand + licentie (SIL OFL 1.1) |
| `icons/` | App-iconen |
| `tools/make_icons.py` | Optioneel: iconen opnieuw genereren |

## Privacy

Notities blijven op je apparaat tot ze naar GitHub worden gesynchroniseerd. Geen account, backend of analyse; de enige netwerkcalls gaan rechtstreeks naar `api.github.com`.
