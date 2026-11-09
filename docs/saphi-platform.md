# Saphi OS and the Philips 55OLED754/12

Research notes as of November 2026. Items marked **(unverified)** need checking
on the TV, mostly with [`probe/index.html`](../probe/index.html).

## The TV

| Item | Value |
|---|---|
| Model | Philips 55OLED754/12, 2019, 55" 4K OLED, Ambilight on three sides |
| OS | Saphi (TP Vision, Linux-based, not Android TV) |
| Network | Wi-Fi 802.11ac, Wi-Fi Direct, DLNA, Bluetooth 4.2 |
| HDR | Dolby Vision, HDR10, HDR10+, HLG |
| USB/DLNA containers | AVI, MKV (MP4 is not listed in the datasheet) |
| USB/DLNA video codecs | H.264, HEVC, VP9, VC-1/WMV9, MPEG-1/2/4 (no AV1) |
| Chromecast | Listed by some retailers. This is unusual for a Saphi TV **(unverified)** |

The codec list applies to the TV's own media player. What the **browser's**
`<video>` element can play may be different; the probe page measures it.

## Saphi OS

- Developed by TP Vision for Philips and some AOC TVs from 2018 to 2022.
  Replaced by Titan OS in 2024.
- Comes with a fixed set of preinstalled apps plus TP Vision's **App Gallery**.
  There is no public SDK, documentation or submission process. Developers who
  asked on forums got no answer.
- Has a **full web browser** (Smart TV Archive). On the 55OLED754/12 it is
  **Opera TV on Chromium 49** (probe, 2026-11-09; see below). Older Philips
  Linux TVs used Opera Presto 12.
- Older Philips user agents contain `HbbTV`, `CE-HTML`, `NETTV`, `PhilipsTV`
  and `SmartTvA` tokens. jellyfin-web's `isTv()` matches any user agent
  containing `tv`, so it would treat the Saphi browser as a TV.

## Ways to get an app onto the TV

| Route | Notes |
|---|---|
| Browser URL / bookmark | Works without changes to the TV. The main route |
| Custom home tile | **Not available.** [UAEpro/philips-tv-saphi-os-jailbreak](https://github.com/UAEpro/philips-tv-saphi-os-jailbreak) replaces the Home dashboard through a DLNA injection, for one model and firmware (65PUT6703/56). It does not add app tiles, a firmware update can remove it, and the repository has no license |
| App Gallery | Needs a commercial agreement with TP Vision. Unlikely for a legacy platform |
| DLNA | The TV can browse a DLNA server from its media menu. Jellyfin's DLNA plugin "Play To" this TV often fails; browsing from the TV usually works. A custom DLNA profile may help |
| External stick | An Android TV / Google TV / Fire TV stick with the official Jellyfin app. The practical fallback |

## Control API (JointSPACE)

- [homebridge-saphi-tv](https://github.com/vniehues/homebridge-saphi-tv) lists
  an OLED754 as tested: JointSPACE API v6, `http://<tv>:1925`.
  - Power, remote keys and Ambilight work.
- Other Saphi owners report:
  - `Forbidden` on port 1925;
  - HTTPS on port 1926 with digest authentication.
- Quick check: `http://<tv-ip>:1925/6/system`.
- Useful for sending keys during testing. It probably cannot launch apps.

## Hints about the browser (from the jailbreak repository, unverified here)

- Its Home runtime "targets an older browser": ES5 and simple CSS, no modern
  `backdrop-filter`.
- Sites using newer JavaScript syntax (Shahid, current Stremio Web) failed in
  the TV's browser.
- The Home key (`MENU`) is code 462; the Home page canvas is 1920×1080
  whatever the panel resolution.
- Installed apps are listed in `/3rd_rw/html5/dash/HomeMenu/current/app/appsInstalled.txt`
  with launch URLs; there is no supported way to add an entry.

## Probe results: 55OLED754/12, 2026-11-09

These come from a photo of the probe table on the owner's TV. Only the rows
visible in the photo are recorded here; the rest of the table and the key
codes are still to come (`logs/probe-*.json`).

**User agent:**
```
Mozilla/5.0 (Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko)
Chrome/49.0.2623.112 Safari/537.36 OPR/36.0.2128.0 OMI/4.8.0.129.Driver6.32 ,
_TV_MT5806/091.004.093.001 (Philips, OLED754, wireless) CE-HTML/1.0
NETTV/4.6.0.2 SignOn/2.0 SmartTvA/5.0.0 WH1.0 en
```
- **Engine: Chromium 49** (2016), as Opera TV ("OPR/36", "OMI/4.8"), on a
  MediaTek MT5806 SoC (aarch64). It is not Presto.
- jellyfin-web: `isTv()` is true (`tv`) and `operaTv` is true (`opr/`).
  Chrome 49 falls between the Chrome 47 and 53 entries in jellyfin-web's
  browserslist.

| Feature | Result |
|---|---|
| Screen | 1920×1080, window 1920×1080, dpr 1 |
| ES2015 (arrow, let, class) | yes |
| ES2017 async/await | **no** |
| Promise, fetch, WebSocket, localStorage | yes |
| CSS grid | **no** |
| MediaSource / EME | yes / yes |
| `oipfObjectFactory` (HbbTV/OIPF) | yes |

| Format | `canPlayType` | MSE |
|---|---|---|
| MP4 H.264 + AAC | probably | yes |
| MP4 HEVC (hvc1 / hev1) | probably | yes |
| WebM VP9 | probably | yes |
| MP4 AV1 | probably | no. **Suspect:** the TV's specification lists no AV1 |
| MP4 AC-3 / E-AC-3 | probably | **no** |
| Matroska | "" (**no**) | no |
| MPEG-TS | maybe | no |
| HLS (native) | maybe | no |
| DASH (native) | maybe | no |

**Remote input** (confirmed by the owner, 2026-11-09):
- the browser shows a **mouse pointer**, and the **arrow keys move the
  pointer**. They do not reach the page as key events;
- **other keys do reach the page** as key events: the probe's key text and
  counter change for keys such as Back, Play and the colour keys. Their codes
  are still to come (`logs/probe-*.json`);
- OK over an element clicks it.

What this means:
- **MKV cannot be direct played in the browser**, although the TV's own
  player supports MKV. MKV must be remuxed by the server (direct stream to
  MP4/TS) or transcoded.
- **AC-3/E-AC-3 work only without MSE**, in progressive MP4 or native HLS.
  An hls.js/MSE player would need AAC.
- `canPlayType` answers cannot be trusted as they stand (AV1 "probably").
  Codecs need real test clips before direct play is enabled, as CLAUDE.md
  already says.
- **Pointer-based navigation:** arrow-key focus navigation cannot work in
  this browser. A client must be driven by hover and click, and must let the
  pointer scroll off-screen content. Back, media and colour keys can still
  be used as keys.

## Open questions for the probe

1. Browser engine and version (user agent).
2. ES2015 / ES2017 support, `fetch`, `Promise`, `localStorage`.
3. Media Source Extensions and EME.
4. `canPlayType` / `MediaSource.isTypeSupported` for H.264, HEVC, VP9, AV1,
   AC-3, E-AC-3, MKV, TS, native HLS and native DASH.
5. Browser window size and device pixel ratio.
6. Key codes for Back, OK, the arrows, the colour keys and the media keys.
7. Whether an HbbTV/OIPF object factory is exposed.

## Sources

- [Philips 55OLED754/12 datasheet](https://www.p4c.philips.com/files/5/55oled754_12/55oled754_12_pss_.pdf)
- [Saphi, Smart TV Archive](https://smarttvarchive.miraheze.org/wiki/Saphi)
- [Philips: installing additional apps on a Saphi TV](https://tv-sound-monitors.philips.com/s/article/How-to-install-additional-apps-on-a-Philips-Saphi-TV?language=en_US)
- [AVForums: how to develop app for Saphi OS](https://www.avforums.com/threads/how-to-develop-app-for-saphi-os.2310011/)
- [Jellyfin feature request: app for Saphi OS](https://features.jellyfin.org/posts/1661/app-for-saphi-os-philips-tv-non-android)
- [Home Assistant: Philips TVs with Saphi OS](https://community.home-assistant.io/t/philips-smart-tvs-also-with-saphi-os/160118)
- [Philips TV user agents (maikudou/SmartTV)](https://github.com/maikudou/SmartTV/blob/master/nettv_user_agents.md)
- [Jellyfin forum: DLNA to Philips TV](https://forum.jellyfin.org/t-dlna-to-philips-tv?pid=32617)
