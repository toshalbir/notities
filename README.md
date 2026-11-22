# Notities · Dagboek

Een digitale papieren agenda voor je iPhone. Eén bladzijde per dag, handgeschreven lettertype, doorzoekbaar, en met één druk op de knop geëxporteerd naar een map `notities` in je GitHub-repository.

De app is een **PWA**: je zet hem op je iPhone-thoisscherm en hij werkt ook zonder internet (alleen exporteren naar GitHub heeft internet nodig).

## Wat zit erin

- 📓 Eén pagina per dag, met gelinieerd papier, rode marge en lederen omslag
- ✍️ Handgeschreven, goed leesbare lettertypen (Caveat + Patrick Hand), lokaal meegeleverd
- 🔍 Zoeken in alle notities (op tekst, datum of weekdag), met klik op een resultaat naar die dag
- 💾 Automatisch opslaan op je apparaat
- ⬆️ **Exporteer naar GitHub** → schrijft `notities/agenda.md` naar je repository
- ⬇️ Download als `.md`-bestand (zonder token, bijvoorbeeld als back-up)

## Installeren op GitHub (in 5 stappen)

1. Maak een lege repository op GitHub, bijvoorbeeld `notities`.
2. Upload alle bestanden uit deze map naar die repository (de mappen `fonts`, `icons` en `tools` inclusief).
3. Ga in je repository naar **Settings → Pages**.
4. Kies bij **Build and deployment** voor **Deploy from a branch**, selecteer `main` en `/ (root)`, en klik op **Save**.
5. Na een minuut staat je app op `https://<jouw-naam>.github.io/<repository>/`.

### Op je iPhone

1. Open de URL in Safari (niet in de GitHub-app).
2. Tik op **Deel** ▸ **Toevoegen aan startscherm**.
3. Open de app vanaf je startscherm. Hij voelt verder als een echte app.

De eigenaar en repository worden automatisch herkend uit de GitHub Pages-URL. Alleen het token moet je eenmalig invullen.

## Token instellen (nodig voor de exportknop)

1. Ga naar GitHub ▸ je avatar ▸ **Settings** ▸ **Developer settings** ▸ **Personal access tokens** ▸ **Fine-grained tokens** ▸ **Generate new token**.
2. Geef het een naam, bijvoorbeeld `notities-iphone`, en kies een vervaldatum (bijv. 90 dagen).
3. Bij **Repository access** kies je **Only select repositories** en alleen je `notities`-repository.
4. Bij **Permissions → Repository permissions** zet je **Contents** op **Read and write**.
5. Kopieer het token (`github_pat_…`).
6. Open in de app ⚙ **Instellingen**, plak het token en controleer eventueel met **Controleer verbinding**. Tik op **Opslaan**.

Het token staat alleen in `localStorage` van Safari op jouw iPhone. Het staat niet in de code en wordt niet naar andere servers verstuurd — rechtstreeks alleen naar `api.github.com`. Deel je telefoon niet met anderen, en vervang het token als het verloopt.

### Wat exporteert de app precies?

De knop maakt (of actualiseert) één bestand: `notities/agenda.md` in je repository. Alle dagen met notities staan daarin chronologisch, nieuwste dag bovenaan, met een kopje per datum:

```markdown
# Notities

Dagboek geëxporteerd op 22 november 2026

## zaterdag 22 november 2026

Tekst van die dag…
```

Het pad `notities` kun je aanpassen in de instellingen. Bestaat de map nog niet, dan maakt GitHub hem automatisch aan.

## Lokaal proberen (optioneel)

Je hebt geen Node.js nodig. In deze map:

```powershell
python -m http.server 8000
```

Open daarna `http://localhost:8000` in je browser. De export werkt ook lokaal, mits je eigenaar/repository/token invult.

## Bestanden

| Bestand | Doel |
| --- | --- |
| `index.html` | Structuur van de app |
| `styles.css` | Papier-, leder- en schrijfstijl |
| `app.js` | Opslag, datum, zoeken, GitHub-export |
| `manifest.json` | PWA-instellingen voor iOS |
| `sw.js` | Offline caching |
| `fonts/` | Lettertypen (lokaal, geen Google Fonts-verzoek) |
| `icons/` | App-iconen |
| `tools/make_icons.py` | Optioneel: iconen opnieuw genereren (`python tools/make_icons.py`) |

## Lettertypen

Caveat en Patrick Hand komen van Google Fonts en zijn vrij te gebruiken onder de SIL Open Font License 1.1. De licenties staan in `fonts/OFL-Caveat.txt` en `fonts/OFL-Patrick-Hand.txt`. De lettertypen zijn lokaal opgeslagen, dus de app laadt geen fonts van externe servers.

## Privacy

Notities blijven op je apparaat tot je ze exporteert. Er is geen account, backend of analyse. De enige netwerkcalls zijn naar GitHub wanneer je exporteert of de verbinding controleert.
