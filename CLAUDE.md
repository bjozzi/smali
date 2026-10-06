# Smali

Vefapp fyrir smalamennsku. Allir í hópnum sjá hver annan á korti Landmælinga, líka í þoku og stopulu sambandi. Björn (eigandi) er forritari, skrifar á íslensku og vill að á móti sé ýtt þegar hugmynd eða forsenda er hæpin.

Upphaflega smíðað í Claude spjalli 2.–6. okt. 2026. Þessi skrá er yfirfærslan yfir í Claude Code.

## Staðan núna

Upprunakóðinn (`src/`, `public/`, `test/`, `package.json`, `wrangler.jsonc` með `assets: ./public`) er aðalkóðinn. Gamla einnar-skráar `worker.js` (vefappið innbyggt sem `ASSETS`) var fjarlægð; hún var staðfest jafngild upprunakóðanum þegar skipt var. `smali-src.zip` er ekki í geymslunni (`.gitignore`). Workers Builds keyrir `npm install` sjálft þar sem `package.json` er til.

Hýsing: Cloudflare Workers, ókeypis plan, aðgangur Björns. Workerinn heitir `smali` og er tengdur við github.com/bjozzi/smali í gegnum Workers Builds, svo hvert push á `main` setur upp sjálfkrafa. Fyrsta keyrslan var á tómri geymslu og hefur líklega mistekist.
Builds: https://dash.cloudflare.com/ebaa720b6b44f3d5d0542b78df435b4b/workers/services/view/smali/production/builds

Sýnishorn án netþjóns (gervikort, hermdir smalar): https://claude.ai/artifact/BAhKRqrAnaiP7HF6WBpXXi

## Hvernig það virkar

- **Bakendi:** Cloudflare Worker + einn SQLite Durable Object (`Group`) per hópkóða. Töflur `members` (nafn, aðstoð, rafhlaða, síðasta staða) og `pts` (slóðir; `rx` er rowid = raðnúmer móttöku). Gögn geymd í 3 daga, alarm hreinsar á 6 klst fresti og eyðir tómum hópum. Free plan krefst `new_sqlite_classes`.
- **API:** `POST /api/g/:kóði/sync` með `{id, pts:[[t,lat,lon,acc]...], since, name?, help?, batt?}` sendir eigin punkta og fær allt nýtt frá hinum í einni köllun (`{now, cursor, more, members, pts}`). Nafn/aðstoð/rafhlaða bara send þegar breytist eða á 2 mín fresti. `GET /api/g/:kóði?since=` les bara. Leave: `{id, leave:true}`.
- **Kort:** `/tile/z/x/y.png` er proxy á WMS Landmælinga (`https://gis.lmi.is/mapcache/web-mercator/`, `LAYERS=LMI_Kort`, EPSG:3857), cachað hjá Cloudflare í 30 daga. Fer í gegnum okkur svo service worker megi vista flísar offline. Kort LMÍ eru opin gögn, tilvísun „© Landmælingar Íslands“.
- **Vefapp** (`public/`): Leaflet 1.9.4 (vistað í `public/vendor`, ekki CDN, vegna offline). Hópkóði eða hlekkur `/?g=KÓÐI`, engin innskráning. GPS punktar í biðröð í localStorage, sendir á 15 sek fresti, `INSERT` hunsar ekki tvítekningar en `last_t` uppfærist bara fram á við. Síðasta staða hópsins vistuð svo appið opnist án sambands. Wake Lock heldur skjánum kveiktum. Service worker vistar appið (`smali-shell-vN`, hækka N við breytingar) og kortaflísar (`smali-tiles-v1`). „Vista kort af svæðinu“ sækir allt að 3000 flísar.
- **Smalalína** (`public/sweep.js`): smalar raðaðir þvert á gönguátt (meðalstefna síðustu 5 mín, síðasta átt notuð ef hópurinn stoppar). Græn lína á milli, rauð ef annar er meira en 150/300/500 m aftar. Brotin lína ef staðsetning er gömul. Þeir sem eru > 5 km frá næsta manni eru utan línunnar.
- **Gengið svæði** (`public/cover.js`): hver slóð teiknuð sem gulur borði 50/100/200 m til hvorrar handar í eigin Leaflet pane með sameiginlegu gegnsæi, svo skörun dekkist ekki. Flatarmál reiknað á 20 m neti.
- **Sýnishornshamur** `/?demo`: 5 hermdir smalar ganga frá GPS staðsetningu notanda að Úthlíð (64,2798 N, 20,4464 V) á alvöru korti. Ef notandi er > 20 km frá Úthlíð byrja þeir 8 km frá Úthlíð í átt til hans. Ekkert sent á netþjón.

## Verkefni sem eru eftir

1. **Push og fyrsta uppsetning.** `git add . && git commit && git push` (worker.js, wrangler.jsonc, README.md, CLAUDE.md; ekki commita zip skrána nema Björn vilji). Pushað 6. okt. 2026. Fylgjast með keyrslunni hjá Cloudflare. Ef hún mistekst: athuga build stillingar workersins (deploy skipun á að vera `npx wrangler deploy`, rót `/`, engin build skipun).
2. **Staðfesta kort Landmælinga. ÓPRÓFAÐ.** gis.lmi.is var lokað úr sandkassanum sem þetta var smíðað í, svo allar prófanir notuðu gervikort. Opna `/tile/12/1798/1088.png` (Reykjavík) á uppsettu slóðinni. Ef það skilar 502: sækja `https://gis.lmi.is/mapcache/web-mercator/wmts?SERVICE=WMTS&REQUEST=GetCapabilities` (eða `.../wms?request=GetCapabilities`), finna rétt laganafn og laga `lmiTileUrl()` í `src/handler.js`. Annar kostur er að skipta yfir í WMTS/TMS slóð ef hún er til.
3. **Prófa á síma:** `/?demo` á alvöru korti; svo alvöru hópur með tveimur símum, ganga um, setja annan í flugstillingu og sjá slóðina skila sér.
4. **Prófa iPhone sérstaklega:** bæta á heimaskjá, vista kort, opna í flugstillingu.
5. ~~Færa yfir í upprunakóðann~~ Gert 6. okt. 2026. `worker.js` er ekki lengur til; breyta `src/` og `public/` beint.

## Hugmyndir sem Björn hefur nefnt eða ekki svarað

- Viðvörun ef bil á milli tveggja smala til hliðar verður of breitt (smalalínan mælir bara hver er aftarlega). Spurt, ekki svarað.
- Flugleið dróna á þekjukortið: breiðari borði, breidd ≈ 2 × flughæð × tan(hálft sjónsvið). Dróni gagnast lítið í þoku (sem var upphaflega vandamálið), svo þetta er ekki forgangur. RID2Caltopo (Remote ID) eða DJI FlightHub 2 eru leiðir til að fá staðsetningu dróna.

## Þekktar takmarkanir

- **Bakgrunnsstaðsetning:** vefapp sendir ekki staðsetningu þegar skjárinn slokknar eða annað app er opið, sérstaklega á iPhone. Lausnin er native skel (Expo/React Native) á sama bakenda; iPhone krefst Apple Developer aðgangs. Björn valdi vefapp eingöngu í bili.
- Röð smalalínunnar ruglast ef línan sveigir mikið (t.d. kringum fjall).
- Sjónlína gengins svæðis er föst tala, tekur ekki tillit til landslags.
- Hópkóðinn er eini lykillinn; allir sem hafa hann sjá staðsetningar.
- Free plan: 100.000 beiðnir á dag. 15 smalar í 8 tíma eru um 29.000; kortaniðurhal telst líka með.

## Prófanir

`npm test` (í upprunakóðanum) keyrir einingapróf fyrir `GroupCore` (með node:sqlite í stað DO) og `sweep.js`. Áður voru vafraprófanir keyrðar með Playwright gegn staðbundnum Node netþjóni sem líkir eftir Worker og Durable Object; þær eru ekki í geymslunni.
