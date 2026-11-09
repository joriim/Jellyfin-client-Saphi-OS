# TV-testi: Saphi-client Philips 55OLED754/12:lla

Lyhyt testiohje, joka on tehty juuri tähän kotiverkkoon:

| Laite | Tieto |
|---|---|
| Jellyfin-palvelin | NAS `NAS497CD0`, `http://192.168.8.140:8096`, Jellyfin 10.11.11 |
| TV | Philips 55OLED754/12 (Saphi OS), selain "Internet browser" |
| PC | Windows, macOS tai Linux, samassa verkossa (ei vierasverkossa) |

Testejä on neljä. Kesto on noin 45 minuuttia. TV:hen ei asenneta mitään, eikä
NAS:n asetuksia muuteta. Testien 1 ja 2 tulokset ratkaisevat, kumpi
toteutustapa valitaan (A = jellyfin-web, B = oma client), joten tee ne ensin.

Tarkempi englanninkielinen ohje ja vianetsintä:
[`docs/tv-setup-guide.md`](tv-setup-guide.md)
samassa kansiossa.

```
TV:n selain ──► PC (devserver.py, portti 8000) ──► NAS Jellyfin (192.168.8.140:8096)
```

---

## 0. Valmistelu PC:llä (10 min)

1. **Python 3.8 tai uudempi.** Windowsissa avaa komentokehote ja aja
   `py --version`. Jos komentoa ei löydy, asenna Python osoitteesta
   python.org. Rastita asennuksessa **"Add python.exe to PATH"**.
2. **Lataa koodi:** GitHubissa `joriim/Jellyfin-client-Saphi-OS`, valitse
   haaravalikosta **`ccr-4db1944c-ms25ix`**, sitten **Code → Download ZIP**.
   Pura ZIP esimerkiksi kansioon `C:\saphi`. Kansiossa pitää näkyä `app`,
   `probe` ja `tools`.
3. **Selvitä PC:n IP-osoite.** Windowsissa aja `ipconfig` ja katso kohta
   *IPv4 Address*. Osoitteen pitäisi alkaa `192.168.8.`, kuten NAS:llakin.
   > PC:n osoite: `192.168.8.____`
4. **Käynnistä välityspalvelin** projektikansiossa. Windowsissa avaa kansio
   Resurssienhallinnassa, kirjoita osoiteriville `cmd` ja paina Enter. Aja
   sitten:
   ```bat
   py tools\devserver.py --jellyfin http://192.168.8.140:8096
   ```
   macOS/Linux:
   `python3 tools/devserver.py --jellyfin http://192.168.8.140:8096`
5. Jos Windowsin palomuuri kysyy lupaa, salli **Yksityiset verkot**. Jätä
   ikkuna auki koko testin ajaksi.
6. **Tarkista ensin PC:n omalla selaimella** (korvaa `X` PC:n osoitteella):
   - `http://192.168.8.X:8000/probe/` avaa mustan sivun "Saphi capability
     probe";
   - `http://192.168.8.X:8000/` avaa clientin yhdistämisnäkymän. Paina
     Enter, jolloin pitää tulla kirjautumisnäkymä.

   Jos nämä eivät toimi PC:llä, ne eivät toimi TV:lläkään. Katso silloin
   kohta *Ongelmat*.
7. Tarkista NAS:n Jellyfinistä, että **Dashboard → General → Enable Quick
   Connect** on päällä. Silloin TV:llä ei tarvitse kirjoittaa salasanaa.

---

## 1. Probe: mihin TV:n selain pystyy (10 min, tärkein)

1. TV: **Home → Internet browser** (joskus kohdassa *Apps → All apps*).
2. Kirjoita osoiteriville `192.168.8.X:8000/probe/`.
3. Yläreunassa pitää näkyä vihreänä **"Results sent (0 keys)"**. PC:n
   ikkunaan tulostuu `probe results saved to logs/probe-….json`.
4. **Paina jokaista kaukosäätimen näppäintä kerran, hitaasti:**
   - nuolet ja **OK**;
   - **Back**. Jos selain palaa edelliselle sivulle, avaa probe uudelleen ja
     jatka;
   - **Play, Pause, Play/Pause, Stop, ◄◄, ►►, |◄◄, ►►|**;
   - väripainikkeet **punainen, vihreä, keltainen, sininen**;
   - **Info, Options, List, CH+/−** ja numerot **0–9**.

   **Älä paina Home- tai Source-näppäintä**, koska ne sulkevat selaimen.
5. **Ota kuva** TV:n taulukosta, varmuuden vuoksi.

Tallenna erityisesti probe-taulukon rivit **userAgent** ja **screen**. Ne
kertovat selainmoottorin ja version sekä ruudun koon.

---

## 2. jellyfin-web suoraan NAS:lta (5 min)

Tämä testaa vaihtoehtoa A ilman mitään omaa koodia.

1. TV:n selaimessa avaa `192.168.8.140:8096`.
2. Kirjaa:
   - [ ] latautuuko sivu? Kauanko siihen kuluu?
   - [ ] tuleeko **TV-ulkoasu** (isot rivit, ei hiiriosoitinta) vai
         tavallinen työpöytäsivu?
   - [ ] toimivatko nuolet, OK ja Back?
   - [ ] voiko kirjautua ja toistaa yhden videon?
   - [ ] tuntuuko käyttö sujuvalta vai hitaalta?
3. Sama Saphi-sovittimen kanssa: `192.168.8.X:8000/web/index.html?saphi-debug=1`.
   Kirjaa samat asiat.

---

## 3. Oma client (vaihtoehto B, 15 min)

1. TV:n selaimessa avaa `192.168.8.X:8000/web/saphi/?debug=1`.
   `?debug=1` laittaa debug-lokin päälle heti alusta, joten jokainen
   näppäinpainallus ja klikkaus tallentuu PC:lle tiedostoon `logs/tv.log`.
   **Tallenna kirjanmerkiksi.**
2. **Connect → OK.** Jos selaimessa näkyy osoitin (nuoli), siirrä se
   kaukosäätimen nuolilla Connect-painikkeen päälle ja paina OK. Kirjaa
   tarkistuslistaan, kumpi tapa toimi: korostus vai osoitin. Kirjaudu
   jommallakummalla tavalla:
   - **Quick Connect:** TV näyttää 6-numeroisen koodin. Avaa puhelimessa
     Jellyfin → profiilikuva → Quick Connect, syötä koodi ja hyväksy.
   - **Salasana:** OK avaa kentän ja TV:n näppäimistön, ▼ siirtää
     seuraavaan kenttään, ja lopuksi **Sign in**.
3. Jos jokin menee pieleen, laita **debug-loki** päälle: Home → ▲ →
   **Settings** → **Debug log: On**. Loki tallentuu PC:lle tiedostoon
   `logs/tv.log`, ja sininen näppäin näyttää sen TV:llä.

Tarkistuslista (rastita tai kirjoita huomio):

- [ ] client latautuu (ei tyhjää tai mustaa sivua)
- [ ] nuolet, OK ja **Back** toimivat kaikkialla
- [ ] rivien selaus on riittävän sujuvaa
- [ ] kansikuvat näkyvät
- [ ] Quick Connect toimii
- [ ] salasanakirjautuminen toimii (TV:n näppäimistö aukeaa)
- [ ] selaimen sulkemisen jälkeen olet yhä kirjautuneena
- [ ] H.264 MP4 -elokuva toistuu. Mitä alapalkissa lukee: *Direct play*,
      *Direct stream* vai *Transcoding*?
- [ ] MKV-tiedosto toistuu (direct vai transcoding?)
- [ ] HEVC / 4K -tiedosto toistuu (direct vai transcoding?)
- [ ] ääni toimii, ja 5.1 jos sinulla on sellainen
- [ ] tauko, kelaus eteen ja taakse sekä Stop toimivat
- [ ] pysäytyksen jälkeen elokuva näkyy rivillä *Continue Watching*, ja
      jatkaminen alkaa oikeasta kohdasta
- [ ] jakson loputtua seuraava jakso alkaa
- [ ] kaukosäätimen mediapainikkeet (Play, Pause, Stop, ◄◄, ►►) toimivat
      soittimessa
- [ ] muuta outoa: mitä painoit ja mitä tapahtui

---

## 4. Lähetä tulokset

Projektikansiosta PC:ltä:

1. **`logs/probe-*.json`**, kaikki tiedostot (tärkein)
2. **`logs/tv.log`**, jos debug-loki oli päällä
3. testien 2 ja 3 tarkistuslistat täytettyinä
4. kuvat probe-taulukosta ja mahdollisista virheilmoituksista
5. esimerkit tiedostoista, jotka eivät toistuneet: Jellyfin → kohde → ⋮ →
   **Media info** (säiliö sekä video- ja äänikoodekki)

---

## Ongelmat

| Oire | Korjaus |
|---|---|
| TV ei avaa sivua | Tarkista ensin, että osoite toimii PC:n selaimella. Salli Python palomuurissa (Yksityiset verkot) ja tarkista, että PC:n verkkoprofiili on *Yksityinen*. TV ja PC eivät saa olla vierasverkossa |
| PC:n ikkuna sanoo `jellyfin unreachable` | Tarkista, että `http://192.168.8.140:8096` aukeaa PC:llä. Älä lisää osoitteen loppuun `/web` |
| `Address already in use` | Lisää komentoon `--port 8090` ja käytä TV:llä porttia `:8090` |
| Connect (tai muu painike) ei reagoi | Lataa haara uudelleen, sillä 2026-11-09 lisättiin tuki osoittimelle ja klikkaukselle. Avaa `…/web/saphi/?debug=1`, paina OK muutaman kerran ja lähetä `logs/tv.log` sekä kuva ruudusta. Lokista näkyy, tuliko painallus näppäimenä (`key …`) vai klikkauksena (`click …`) vai ei ollenkaan |
| Client on TV:llä tyhjä tai musta | TV:n selain ei pysty ajamaan koodia. Tämäkin on tärkeä tulos: lähetä probe-tiedosto ja kuva |
| Jokin näppäin ei tee mitään (varsinkin Back) | Odotettavaa ennen proben tuloksia. Laita debug-loki päälle, paina näppäintä ja lähetä `logs/tv.log`, josta näkyy näppäinkoodi |
| Video ei käynnisty | Kirjaa alapalkin teksti ja virheilmoitus. Client vaihtaa itse transkoodaukseen, jos suora toisto epäonnistuu |
| Toisto pätkii | Settings → *Maximum streaming bitrate* → 10 Mbps |

## Mitä tiedetään jo ennen testiä

- Clientin käyttämät API-reitit ja kentät löytyvät NAS:n Jellyfin-versiosta
  10.11.11. Tämä tarkistettiin palvelimen tiedostoista 2026-11-08, mutta
  live-yhteyttä NAS:iin ei ole vielä kokeiltu.
- Vahvistamaton vihje: Saphi-TV:iden user agent voi sisältää `SmartTvA/` tai
  `WhaleTV/`. Kummassakin on kirjaimet "tv", joten jellyfin-webin pitäisi
  valita TV-ulkoasu. Testi 2 ja proben userAgent-rivi varmistavat asian.
- Kaukosäätimen näppäinkoodit clientissä ovat arvauksia, kunnes proben
  tulokset ovat tiedossa.
