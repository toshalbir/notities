# Huishoudboekje

Een PWA voor één persoon om uitgaven bij te houden op **iPhone én Windows**. Je typt het bedrag in op je telefoon, en op de laptop zie je automatisch de maandkalender met weektotalen, maandtotaal en totalen per categorie.

Deze map staat los van de bestaande `Notes · Agenda`-app in de hoofdmap — niets daaraan is gewijzigd.

## Wat het doet

- **Invoer in 5 seconden**: bedrag (komma of punt), categorie, datum (standaard vandaag), optionele notitie.
- **Maandkalender**: weken van maandag t/m zondag, bedrag per dag, weektotaal rechts, maandtotaal onderaan, vergelijking met de vorige maand. Op brede schermen (Windows) wordt de kalender schermvullend en zie je in elke dag een lijstje met de afzonderlijke uitgaven.
- **Categorieën**: balken met bedrag en percentage voor de gekozen maand.
- **Lijst**: alle uitgaven van de maand, gegroepeerd per dag, bewerkbaar en verwijderbaar.
- **Jaar**: twaalf maandkaarten met maandtotaal, jaartotaal, grootste maand en gemiddelde; klik op een maand om naar de kalender te gaan.
- **Terugkerend**: vaste uitgaven zoals huishuur of een abonnement. Eén regel (bedrag, dag, categorie, vanaf/tot en notitie) maakt automatisch elke maand een uitgave. Wijzigen of verwijderen kan via de regel; al aangemaakte maanden blijven apart bewerkbaar.
- **Print**: de knop rechtsboven printt het tabblad waarin je zit (kalender, lijst, categorieën, jaar of terugkerend).
- **Offline-first**: alles staat eerst in de browser. Sync gebeurt op de achtergrond zodra er verbinding is.
- **Automatische sync**: via Supabase, inclusief realtime updates tussen apparaten.

Standaardcategorieën: Boodschappen · Eten buiten · Vervoer · Wonen · Kleding · Gezondheid · Ontspanning · Overig.

## Lokal starten

```powershell
cd huishoudboekje
python -m http.server 8001
```

Open `http://localhost:8001`. (Een webserver is nodig omdat de app ES modules gebruikt; `file://` werkt niet.)

## Supabase instellen

1. Maak een gratis project op [supabase.com](https://supabase.com).
2. Open **SQL Editor**, plak de SQL uit **Instellingen → Eenmalige Supabase-instelling** en klik op **Run**. De app toont de SQL ook als je hem wilt kopiëren.
3. Klik in Supabase op **Connect** (rechtsboven in je project): daar staan de **Project URL** en de **publishable key** (`sb_publishable_…`). Alternatief: het tandwiel **Project Settings → API Keys** (er is geen losse *API*-pagina meer; oude `eyJ…`-anon-keys staan onder *Legacy API Keys*).
4. Plak beide in de app bij **Instellingen** en klik op **Instellingen bewaren**.
5. Klik op **Account maken** met een e-mail en wachtwoord. Als e-mailbevestiging aan staat, bevestig die eerst en log daarna in met **Inloggen**.
6. Herhaal stap 3–5 op het tweede apparaat, met hetzelfde account.

Daarna: uitgave toevoegen → lokale opslag direct → push naar Supabase na ~1 seconde → realtime pull op het andere apparaat. Destatusbolletje bovenin toont `Alleen lokaal`, `Syncen…`, `Gesynced 14:32` of `Offline – lokaal bewaard`.

### Conflicten

Nieuwe regels krijgen een eigen id en worden nooit overschreven. Bij bewerken geldt: **de laatste wijziging wint** (op basis van `updated_at`). Records die lokaal nog niet gesynct zijn, worden door een pull nooit overschreven — ze gaan eerst mee omhoog.

## Live versie

De app staat online op **https://toshalbir.github.io/notities/huishoudboekje/** (GitHub Pages, map `huishoudboekje/` in de repo `notities`). Project-URL en publishable key zijn al ingevuld; op een nieuw apparaat hoef je alleen in te loggen met `toshke@gmail.com` en hetzelfde wachtwoord.

## Installeren

- **iPhone**: open de live URL in Safari ▸ Deel ▸ **Zet toe aan startscherm**. Start de app vanaf het icoon (dan volledig scherm).
- **Windows**: dubbelklik `Huishoudboekje.exe` in deze map. Hij opent de online app in een Edge- of Chrome-venster zonder adresbalk. De exe is te herbouwen met `windows\maak-exe.bat` (die installeert PyInstaller en Pillow zelf als ze ontbreken). Het eerste gebruik vraagt één keer om inloggen; daarna blijft de app ingelogd in een eigen browserprofiel onder `%LOCALAPPDATA%\Huishoudboekje`.
- **Windows via browser**: open de live URL in Edge of Chrome ▸ **… ▸ Apps ▸ Install this site as an app** (of het installatie-icoon in de adresbalk).

Voor GitHub Pages: upload de hele map, zet **Settings → Pages → Deploy from a branch → main / huishoudboekje** en open `https://<naam>.github.io/huishoudboekje/`.

## Bestanden

| Bestand | Doel |
| --- | --- |
| `index.html` | Structuur van kalender, lijst, categorieën, jaar, terugkerend en instellingen |
| `styles.css` | Moderne sans-stijl voor kalender en lijsten |
| `app.js` | Data, totalen, formulieren, offline opslag en Supabase-sync |
| `sw.js` / `manifest.json` | PWA, offline cache en installatie |
| `icons/` | App-iconen |
| `tools/make_icons.py` | Iconen opnieuw genereren (Pillow) |
| `windows/maak-exe.bat` + `windows/huishoudboekje.py` | Windows-exe bouwen (PyInstaller) |
| `Huishoudboekje.exe` | Kant-en-klare Windows-starter voor de online app |

## Gegevens

Uitgaven staan in `localStorage` (`hb.v1.expenses`), terugkerende regels in `hb.v1.recurring`; zodra sync aan staat gaan de uitgaven naar jouw eigen Supabase-project. Er zijn geen analytics of derde partijen buiten Supabase en de CDN waar de Supabase-bibliotheek vandaan komt. Via **Instellingen → Backup** download of importeer je alles (uitgaven én regels) als JSON.

## Later misschien

- Eigen categorieën toevoegen/hernoemen
- Bonnetjes fotograferen en bank-CSV importeren
- Budget per categorie met voortgangsbalk
- Vaste lasten / terugkerende uitgaven
