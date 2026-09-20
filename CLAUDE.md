# CLAUDE.md

Ohjeet tälle repolle. Lue tämä kokonaan ennen ensimmäistä muutosta.

## Mitä tämä projekti on

Kartta Suomen vanhojen osakeasuntojen hintakehityksestä. Kartta on käyttöliittymä, ei kuvitus: käyttäjä valitsee alueen ja ajanhetken kartalta, ei valikosta.

Data on Tilastokeskuksen StatFin-tietokannan tilastosta "Osakeasuntojen hinnat" (ashi). Avoin, ei API-avainta.

Sovellus vastaa kahteen kysymykseen:
1. Mikä on hintataso alueella (EUR/m2)
2. Onko hinta noussut vai laskenut (laatuvakioitu hintaindeksi)

## Tärkein sääntö

**Neliöhinnoista ei lasketa hintamuutosta.** Tilastokeskus kieltää tämän taulukoiden metadatassa. Neliöhinta on keskiarvo toteutuneista kaupoista, ja se heiluu sen mukaan minkä kokoisia ja ikäisiä asuntoja sattui myydyksi.

Muutos-% tulee aina hintaindeksistä, joka on laatuvakioitu. Indeksin pistelukujen suhdelukuja saa laskea vapaasti.

Jos jokin näkymä ei voi näyttää muutosta indeksistä, se ei näytä muutosta lainkaan.

## Aluejako: 87 aluetta

Indeksidata on saatavilla vain tälle aluejaolle, ei kaikille 301 kunnalle. Jako on hierarkia:

| Taso | Määrä | Geometria |
|---|---|---|
| Koosteet (koko maa, PKS, suuret kaupungit ym.) | 5 | ei piirretä |
| Maakunnat | 18 | kyllä |
| Kunnat | 27 | kyllä |
| Kaupunkien osa-alueet | 36 | ei ole olemassa |
| Kehyskunnat | 1 | johdettava |

Kartalle piirtyy 45 aluetta. Osa-alueet ovat drill-down-paneelissa, eivät kartalla.

Mukana olevat 27 kuntaa: Helsinki, Espoo-Kauniainen, Vantaa, Porvoo, Hyvinkää, Järvenpää, Kerava, Turku, Pori, Rauma, Hämeenlinna, Riihimäki, Tampere, Lahti, Kotka, Kouvola, Lappeenranta, Mikkeli, Kuopio, Joensuu, Jyväskylä, Seinäjoki, Vaasa, Kokkola, Oulu, Kajaani, Rovaniemi.

Osa-alueet (Helsinki 1–4, Tampere 1–3 jne.) on muodostettu postinumeroalueista hintatason mukaan. Numero 1 on kallein. Tilastokeskus ei julkaise postinumeroiden ja osa-alueiden vastaavuutta, joten geometriaa ei voi koota. Älä yritä arvata sitä.

## Taulukot

| ID | Sisältö | Jakso |
|---|---|---|
| 15it | ketjutetut hintaindeksit | 1988Q1–2026Q2 |
| 15is | hintaindeksi 2025=100, neljännes | 2025Q1–2026Q2 |
| 15iq | kk-indeksi, EUR/m2, kauppamäärät, myyntiaika, vain 16 aluetta | 2025M01– |
| 13mv | EUR/m2 + kauppamäärät, 87 aluetta | 2006Q1–2026Q1 |
| 13mq | vuosi-indeksi 2020=100 + reaali-indeksi, 87 aluetta | 2020–2025 |
| 13mx | EUR/m2 kunnittain, 301 kuntaa | 2006–2025 |

Pitkä aikasarja tulee 15it:stä. Neliöhintataso tulee 13mv:stä. 13mx on varalla, jos kuntakattavuus myöhemmin tarvitaan.

Huomaa: 15iq kattaa vain 16 aluetta, eli kuukausitaso on karkeampi kuin neljännesvuositaso. Sovelluksen aikayksikkö on neljännes.

## Datan hakeminen

Hae koko taulukko raakana px-tiedostona yhdellä GET-kutsulla:

```
https://pxdata.stat.fi/PXWeb/Resources/PX/Databases/StatFin/ashi/{ID}.px
```

Tämä on parempi kuin POST-rajapinta: ei kyselyn rakentamista, ei 100 000 solun rajaa, metadata ja data samassa tiedostossa. Kirjoita px-parseri kerran `scripts/parse-px.ts`-tiedostoon.

POST-rajapinta on olemassa osoitteessa `https://pxdata.stat.fi/PXWeb/api/v1/fi/StatFin/ashi/{ID}.px`, mutta sitä ei tässä projektissa tarvita.

### Rajapinta muuttui 8.6.2026

Verkosta löytyvät esimerkit ja useimmat kirjastot ovat vanhentuneita. Muutokset:

- Tiedostonimet lyhenivät: `statfin_ashi_pxt_13mx.px` → `13mx.px`
- Muuttujan nimen tilalla tunnisteena on muuttujakoodi: Tiedot → `contentscode`, Vuosineljännes → `timeperiod_q`, Kuukausi → `timeperiod_m`, Alue → esim. `alue_43_20260625`
- Osalle tietomuuttujien arvokoodeista tuli etuliite

Lue koodit aina px-tiedoston metadatasta. Älä kovakoodaa muuttujien tai arvojen nimiä.

## Datan kompastuskivet

Nämä kaikki pitää käsitellä ETL-vaiheessa, ei selaimessa.

- **Salassapito.** Puuttuva arvo on merkkijono `"."`, ei null eikä tyhjä. Parserin pitää muuntaa se nulliksi.
- **Ennakkotiedot.** Tuoreimmat ajanhetket on merkitty tähdellä (`2026Q1*`). Riisu tähti koodista mutta säilytä lippu, ja merkitse ennakkotieto käyttöliittymässä.
- **Perusvuoden vaihtuminen.** 2026 siirryttiin perusvuoteen 2025=100. Vanhat 2020=100-taulukot jäivät rinnalle. Eri perusvuosien pistelukuja ei saa yhdistää samaan sarjaan. 15it on valmiiksi ketjutettu, käytä sitä.
- **Ahvenanmaa puuttuu.** Se ei ole mukana tilastossa eikä koko maan luvuissa. Kartalla harmaa, ei nolla.
- **Vuosimuutos puuttuu perusvuoden alusta.** 2025=100-taulukoissa vuosimuutos on tyhjä ensimmäiset 12 kuukautta.
- **Kauppamäärä on kahta lajia.** Käytä kiinteistönvälittäjien kautta tehtyjä kauppoja (KVKL). Se on lopullinen ja kuvaa tuoretta aktiivisuutta. Varainsiirtoverotiedoista laskettu määrä tarkentuu kuukausia jälkikäteen eikä kelpaa tuoreimman hetken arviointiin.
- **Vertailukelpoisuuden katko.** Kauppamäärät eivät ole täysin vertailukelpoisia 2019Q4 alkaen.

## Geometria

Lähde on Tilastokeskuksen WFS, maksuton, ei tunnistautumista:

```
https://geo.stat.fi/geoserver/tilastointialueet/wfs
```

Tasot `kunta4500k_2026` ja `maakunta1000k_2026`. Numero on yleistystaso; 4500k riittää web-karttaan. Koordinaatisto on EPSG:3067 (ETRS-TM35FIN), joten data pitää projisoida WGS84:ään MapLibrea varten.

Hae geometria kerran, yksinkertaista mapshaperilla ja commitoi GeoJSON repoon. Ei runtime-kutsua WFS:ään.

### Liitosavain

Taulukoiden kuntakoodit ovat virallisia kuntanumeroita ja liittyvät suoraan geometrian `kunta`-kenttään: 091 Helsinki, 049 Espoo, 092 Vantaa, 853 Turku, 837 Tampere, 564 Oulu. Lue koodit metadatasta.

Poikkeukset:
- Espoo-Kauniainen on tilastossa yksi alue, kartalla kaksi kuntaa. Yhdistä polygonit 049 ja 235.
- Kehyskunnat on nimetty kuntajoukko. Katso kokoonpano alueluokituksesta ja yhdistä polygonit.

## Arkkitehtuuri

Data ei ole reaaliaikaista: neljännesvuositaulukot päivittyvät neljä kertaa vuodessa. Älä rakenna runtime-proxya rajapintaan.

```
scripts/fetch.ts    hakee px-tiedostot ja geometrian verkosta
scripts/build.ts    parsii, yhdistää, kirjoittaa public/data/*.json
src/                selainsovellus, lukee vain paikallisia JSON-tiedostoja
data/raw/           haetut px- ja GeoJSON-tiedostot, gitignoressa
public/data/        valmiit JSONit, commitoidaan
```

Rakennusvaiheessa esilasketaan kaikki ajanhetket yhteen tiedostoon. 45 aluetta × noin 150 neljännestä × muutama mittari on muutama sata kilotavua pakattuna. Aikaliu'ussa ei saa olla yhtään verkkokutsua.

Stack: Vite + TypeScript + MapLibre GL JS. Ei React-kehystä, ei karttatiilipalvelua, ei backendiä. Node-skriptit ETL:ään.

## Käyttöliittymä

### Kartta

MapLibre GL JS, ei Leaflet. Käytä data-driven stylingia ja feature statea: arvon vaihtuessa päivitetään tila, ei luoda tasoja uudelleen.

Ei taustakarttaa. 45 polygonia piirretään suoraan GeoJSONista tummalle taustalle. Ei tiilipalvelua, ei API-avainta, ei attribuutiorivistöä.

### Väriskaala

Muutos-% on etumerkillinen, joten skaala on divergoiva ja ankkuroitu nollaan. Sekventiaalinen skaala on virhe: se tekee nollasta mielivaltaisen kohdan.

Skaalan ääripäät lasketaan koko aikasarjan yli ja kiinnitetään. Jos skaala elää näkyvän hetken mukaan, kaikki hetket näyttävät yhtä dramaattisilta ja lama katoaa.

### Tasot

Maakunnat teemakarttana pohjalla. 27 kaupunkia ympyröinä päällä: väri = muutos-%, koko = kauppamäärä. Sama väriasteikko molemmille tasoille.

Nimet pisteinä, ei polygonin keskipisteinä. Suomen kuntien muodot ovat sellaisia että automaattinen keskipiste osuu usein veteen.

### Aikaliuku

Liuku neljänneksittäin 1988Q1 alkaen ja play-painike, joka ajaa koko sarjan läpi noin 30 sekunnissa. Tämä on sovelluksen tärkein ominaisuus: siinä näkyy 90-luvun lama, 2010-luvun eriytyminen ja 2022 jälkeinen korkojen nousu.

### Drill-down

Klikkaus maakuntaan: `fitBounds` alueen rajoihin, muu maa himmenee, kaupungit ilmestyvät. Klikkaus kaupunkiin: paneeli, jossa osa-alueet pylväinä hintatason mukaan järjestettynä. Animaation kesto 600–800 ms.

Hover-tila jokaiselle alueelle.

## Älä tee näitä

- Älä laske muutos-% neliöhinnoista
- Älä yhdistä eri perusvuosien indeksipistelukuja
- Älä piirrä 3D-pylväitä; etuala peittää taka-alan
- Älä koodaa kolmatta muuttujaa karttaan väri- ja kokokoodauksen lisäksi
- Älä kutsu StatFin- tai WFS-rajapintaa selaimesta
- Älä lisää karttatiilipalvelua tai taustakarttaa
- Älä kovakoodaa muuttujien nimiä tai aluekoodeja lähdekoodiin

## Tarkistettavaa ennen skeeman lukitsemista

Nämä pitää varmistaa metadatasta, niitä ei ole vahvistettu:

- Kattavatko 15is ja 15it saman 87 alueen jaon kuin 13mv ja 13mq
- Mitkä ketjutetut perusvuodet 15it sisältää ja mikä niistä kattaa koko 1988–2026
- Kehyskunnat-alueen kuntakokoonpano

## Komennot

```
npm run fetch    hakee raakadatan verkosta data/raw-hakemistoon
npm run build    parsii ja kirjoittaa public/data-hakemiston
npm run dev      käynnistää kehityspalvelimen
```

`fetch` ajetaan käsin datajulkistusten jälkeen, ei osana buildia.

## Käyttöehdot

StatFin-data ja Tilastokeskuksen paikkatietoaineistot ovat avointa dataa. Merkitse lähde käyttöliittymään: "Lähde: Tilastokeskus, osakeasuntojen hinnat".
