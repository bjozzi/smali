# Smali

Vefapp fyrir smalamennsku: allir í hópnum sjá hvar hinir eru á korti Landmælinga, líka í þoku og stopulu sambandi.

- Hópkóði eða hlekkur, engin innskráning
- Staðsetningar safnast í biðröð þegar samband dettur út og sendast þegar það kemur aftur, svo slóð hvers og eins verður heil
- Fjarlægð og stefna (t.d. „1,2 km NA“) að hverjum smala, hvenær hann sást síðast og rafhlaða (Android)
- Gengið svæði: slóð hvers smala teiknuð sem gulur borði (50, 100 eða 200 m til hvorrar handar), svo göt á milli manna sjást, og flatarmálið sem búið er að ganga í km²
- Smalalína á milli smalanna, í röð þvert á gönguna: græn þegar menn eru í takt, rauð þar sem einhver er of aftarlega (150, 300 eða 500 m, valið í valmynd). Gönguáttin er reiknuð úr hreyfingu hópsins síðustu 5 mínútur og síðasta átt er notuð þegar hópurinn stoppar.
- „Ég þarf aðstoð“ hnappur sem birtist rauður hjá öllum
- Kort af smalasvæðinu vistuð í símanum fyrir fram, og appið opnast án sambands
- Heldur skjánum kveiktum (Wake Lock)

## Koma því í loftið (ókeypis, um 5 mínútur)

Cloudflare Workers er tengt þessari geymslu og byggir sjálfkrafa við hvert push á `main`. Til að setja upp handvirkt:

Þarft Node.js 20 eða nýrra og ókeypis Cloudflare aðgang (https://dash.cloudflare.com/sign-up).

```bash
npm install
npx wrangler login      # opnar vafra, skráðu þig inn hjá Cloudflare
npx wrangler deploy
```

Í fyrsta skipti biður Cloudflare þig að velja undirlén á workers.dev. Slóðin verður þá `https://smali.<undirlén>.workers.dev`.

Til að prófa á eigin vél: `npx wrangler dev` og opna http://localhost:8787.

## Sýnishorn á alvöru korti

Opnaðu `https://smali.<undirlén>.workers.dev/?demo`. Fimm hermdir smalar ganga í línu frá staðsetningunni þinni niður að Úthlíð, á korti Landmælinga, með smalalínunni, aðstoðarbeiðni og sambandsleysi. Ef þú ert lengra en 20 km frá Úthlíð byrja þeir 8 km frá Úthlíð í áttina til þín. Ekkert er sent á netþjóninn. Ýttu á hraðamerkið til að skipta á milli 1×, 10× og 30×.

## Fyrsta prófun eftir deploy

1. Opnaðu slóðina í símanum og athugaðu að kort Landmælinga birtist. Ef reitirnir eru auðir, sjá „Kort“ hér fyrir neðan.
2. Búðu til hóp, sendu hlekkinn í annan síma og labbaðu aðeins um.
3. Settu annan símann í flugstillingu, labbaðu, slökktu á flugstillingu og sjáðu slóðina koma inn.

## Fyrir smalamennskuna

- **Heima á Wi-Fi:** opna appið, þysja þannig að allt smalasvæðið sjáist, Valmynd → „Vista kort af svæðinu á skjánum“. Bæta appinu á heimaskjáinn (iPhone: Deila → Bæta á heimaskjá) svo kortin haldist vistuð.
- **Á fjallinu:** hafa Smala opinn með skjáinn kveiktan. Vefapp getur ekki sent staðsetningu þegar skjárinn slokknar eða annað app er opið, sérstaklega á iPhone. Hleðslubanki er nauðsynlegur.
- Talstöðvar og ákveðinn fundarstaður eru enn varaáætlunin.

## Takmörk ókeypis plans

Cloudflare Workers Free: 100.000 beiðnir á dag (endurstillist kl. 00:00 UTC). Hver sími samstillir á 15 sekúndna fresti, um 240 beiðnir á klst. 15 smalar í 8 tíma eru því um 29.000. Kortaniðurhal fer líka í gegnum Workerinn, allt að 3.000 flísar á síma, svo best er að fólk vistar kortin dagana á undan en ekki allir sama morgun.

## Hvernig það virkar

- `src/worker.js`: Cloudflare Worker. Einn Durable Object (SQLite) per hópkóða geymir smala og slóðir í 3 daga, hreinsar sjálfur.
- `src/handler.js`: API (`POST /api/g/:kóði/sync` sendir eigin punkta og fær allt nýtt frá hinum í einni köllun) og kortaproxy (`/tile/z/x/y.png` → WMS Landmælinga, `LMI_Kort` í EPSG:3857).
- `public/`: vefappið. Leaflet, service worker sem vistar appið og kortaflísar, biðröð í localStorage.

## Kort

Kortin eru frá Landmælingum Íslands (opin gögn, má nota frjálst með tilvísun). Workerinn sækir þau frá `https://gis.lmi.is/mapcache/web-mercator/` sem WMS með `LAYERS=LMI_Kort`. Ég gat ekki prófað þá þjónustu beint þegar þetta var skrifað, svo ef kortin birtast ekki er fyrsta skrefið að opna eina flísarslóð, t.d. `/tile/12/1798/1088.png` (Reykjavík), og sjá villuna. Laganafn og slóð eru í `lmiTileUrl()` í `src/handler.js`.

## Öryggi

Hópkóðinn er eini lykillinn. Allir sem hafa hann sjá staðsetningar hópsins, svo það á ekki að deila honum opinberlega. Nýir kóðar eru 6 handahófskenndir stafir.
