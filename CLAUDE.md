# Project context: Jellyfin client for Saphi OS

Context for anyone (human or AI assistant) continuing this project. Detailed
write-ups are in [`docs/`](docs/); this file is the short version plus the
source-review findings, with the file paths in the reference repositories.

## Goal

A Jellyfin client for Philips TVs running **Saphi OS** (TP Vision,
Linux-based, 2018–2022). The first target is the **Philips 55OLED754/12**
(2019 4K OLED).

Saphi has no public SDK and no open app store. The client is therefore a
**web app opened in the TV's built-in browser**. An optional custom home tile
is possible via the unofficial
[UAEpro/philips-tv-saphi-os-jailbreak](https://github.com/UAEpro/philips-tv-saphi-os-jailbreak).

## Status

Research and design are done. No client code yet.

Waiting on two tests on the real TV:

1. **Probe:** serve `probe/` (`python3 -m http.server 8000`) and open it in
   the Saphi browser. Record:
   - user agent (browser engine and version);
   - ES2015 / ES2017 support;
   - MSE and EME;
   - `canPlayType` and `isTypeSupported` results;
   - window size;
   - remote key codes.
2. **jellyfin-web:** open `http://<server>:8096` in the Saphi browser. Does it
   load, use the TV layout, respond to the remote, and play video?

The results decide which path to take:
- **Option A:** wrapper around jellyfin-web.
- **Option B:** custom lightweight client.

## Key decisions

- **License: MPL-2.0.** Code may be reused from jellyfin-tizen, jellyfin-webos
  and jellyfin-sdk-typescript (MPL-2.0). jellyfin-web, jellyfin-androidtv and
  jellyfin-roku are **GPL-2.0**: take ideas only, never copy their code, unless
  the project license is changed.
- **Option A comes first if jellyfin-web runs acceptably.** Follow the webOS
  pattern:
  1. a tiny loader page asks for the server address;
  2. it loads the server's jellyfin-web in a full-screen iframe;
  3. it injects `window.NativeShell` from `saphi.js`.
- **Option B is the fallback** ([docs/architecture.md](docs/architecture.md)):
  - TypeScript built down to ES5, Preact + signals or no framework;
  - a platform layer that isolates everything Saphi-specific;
  - a focus tree for remote navigation (not position-based);
  - a playback engine built around PlaybackInfo;
  - own fetch/XHR transport with types from `@jellyfin/sdk`;
  - served from the same origin as Jellyfin through a reverse proxy.
- **The DeviceProfile comes from the probe results** in both options. Start
  conservative: H.264 + AAC/AC-3, transcodes as HLS/TS. Switch on HEVC, VP9
  and MKV direct play only after real test clips play.

## Known facts about the TV

- Codecs listed for the TV's **own** media player:
  - containers MKV and AVI;
  - video H.264, HEVC, VP9, VC-1, MPEG-1/2/4;
  - no AV1; MP4 is not listed.
- HDR: Dolby Vision, HDR10, HDR10+, HLG.
- The browser `<video>` element may support less than the TV's own player.
- Older Philips user agents contain `PhilipsTV`, `NETTV`, `SmartTvA`, `HbbTV`
  and `CE-HTML`. The engine is either Opera Presto 12 or a Chromium-based Opera
  ("OPR"); which one Saphi uses is **unverified**.
- JointSPACE control API v6 on `http://<tv>:1925` (power, keys, Ambilight).
  Some Saphi sets need HTTPS on port 1926 with digest authentication.
- DLNA: browsing a server from the TV works; Jellyfin "Play To" this TV often
  fails.

## Source review (reference commits reviewed on 2026-11-07)

| Repo | Commit | License |
|---|---|---|
| jellyfin/jellyfin-androidtv | `e0e2704` (2026-11-07) | GPL-2.0 |
| jellyfin/jellyfin-web | `1af443a` (2026-11-07) | GPL-2.0 |
| jellyfin/jellyfin-roku | `684a0f2` (2026-11-03) | GPL-2.0 |
| jellyfin/jellyfin-sdk-typescript | `3916ced` (2026-10-29) | MPL-2.0 |
| jellyfin/jellyfin-webos | `ab47940` (2025-11-03) | MPL-2.0 |
| jellyfin/jellyfin-tizen | `31408c1` (2025-10-24) | MPL-2.0 |

To look at them again:
`git clone --depth 1 https://github.com/jellyfin/<repo>.git` into a scratch
directory outside this repository.

### jellyfin-tizen: the NativeShell contract (Option A template)

`tizen.js` (202 lines) is the whole platform adapter. jellyfin-web looks for
`window.NativeShell`:

- **`AppHost`:**
  - `init()` returns a Promise of AppInfo;
  - `appName()`, `appVersion()`, `deviceId()`, `deviceName()`;
  - `exit()`;
  - `getDefaultLayout()` returns `'tv'`;
  - `getDeviceProfile(profileBuilder)` returns
    `profileBuilder({ enableMkvProgressive: false, enableSsaRender: true })`;
  - `getSyncProfile(profileBuilder)`;
  - `screen()` returns `{ width, height }`;
  - `supports(feature)`.
- **`supports` list:** `exit`, `exitmenu`, `externallinkdisplay`,
  `htmlaudioautoplay`, `htmlvideoautoplay`, `physicalvolumecontrol`,
  `displaylanguage`, `otherapppromotions`, `targetblank`, `screensaver`,
  `multiserver`, `subtitleappearancesettings`, `subtitleburnsettings`.
- **Other members**, no-ops on Tizen: `downloadFile`, `enableFullscreen`,
  `disableFullscreen`, `getPlugins` (returns `[]`), `openUrl`,
  `updateMediaSession`, `hideMediaSession`.
- **Device ID:** stored in `localStorage['_deviceId2']`, the key jellyfin-web
  uses. Generated as `btoa(userAgent + '|' + Date.now())` with `=` replaced.
- **Media keys** are registered on load. `MediaPlayPause` is registered only on
  the `/video` and `/queue` pages.

### jellyfin-webos: loading jellyfin-web from the server

- `frontend/js/index.js`, `handoff(url, bundle)`:
  1. hides the start page;
  2. sets `#contentFrame.src` to the server URL;
  3. on the iframe's `DOMContentLoaded`/`load`, injects
     `window.AppInfo = …`, `window.DeviceInfo = …`, the NativeShell script and
     CSS into the iframe document.

  The iframe sends `postMessage({ type: 'selectServer' })` to go back to the
  server picker.
- `frontend/js/webOS.js`: NativeShell like Tizen's. Its `getDeviceProfile` also
  passes `supportsDolbyAtmos`, `supportsDolbyVision` and `supportsHdr10` from
  the device info, and its `supports` list adds `imageanalysis` and
  `chromecast`.

### jellyfin-web

- **Supported browsers** (`package.json` browserslist): include Chrome 27, 38,
  47, 53, 56, 63, Edge 18 and Firefox ESR.
- **`src/scripts/browser.js`:**
  - `isTv()` returns true for any user agent containing `tv` (also `viera`,
    `titanos`, webOS). Philips user agents therefore get the TV layout.
  - `operaTv = tv && ua.includes('opr/')`.
- **`src/scripts/browserDeviceProfile.js`** (1,654 lines). Builder options:
  - `audioChannels`, `enableHls`, `maxVideoWidth`, `globalMaxVideoBitrate`;
  - `enablePgsRender`, `enableSsaRender`;
  - `supportsDolbyVision`, `supportsHdr10`, `supportsHlg`, `supportsHevc`,
    `supportsDts`, `supportsTrueHd`, `supportsMp2VideoAudio`;
  - `disableVideoAudioCodecs`, `disableHlsVideoAudioCodecs`, `isRetry`.

  A comment says titanos, operaTv, vidaa and other platforms still need
  testing.
- **`src/scripts/keyboardNavigation.js`:** maps `event.keyCode` to a key name
  with a `KeyNames` table. Saphi codes may need adding.

### jellyfin-androidtv (the Google TV app)

Kotlin, Koin dependency injection, jellyfin-sdk-kotlin 1.8.x, Media3/ExoPlayer.
UI is a mix of Leanback and Compose. Modules: `:app`, `:design`,
`:preference`, `:playback:core`, `:playback:jellyfin`,
`:playback:media3:exoplayer`, `:playback:media3:session`.
`APP` = `app/src/main/java/org/jellyfin/androidtv`.

| Topic | Where | Take-away for us |
|---|---|---|
| DeviceProfile | `APP/util/profile/deviceProfile.kt` | Transcoding: HLS/TS (H.264, plus HEVC if supported; AAC/AC-3/E-AC-3/MP3) and HLS/fMP4. Codec profiles: H.264 profiles and levels; reference frames ≤12 when width ≥1200, ≤4 when width ≥1900; HEVC main/main10; maximum width/height; channels ≤2 when downmixing, else ≤8 |
| Subtitle profiles | same file | VTT: embed, external and HLS. SRT/TTML: embed and external only, because the server puts only WebVTT into HLS. PGS/DVD/DVB: encode (burn in). ASS: direct only with a renderer |
| Choosing how to play | `playback/jellyfin/.../mediastream/JellyfinMediaStreamResolver.kt`, legacy `APP/ui/playback/PlaybackManager.kt` | PlaybackInfo with everything enabled; take direct play (`/Videos/{id}/stream?static=true&mediaSourceId&tag`), else direct stream, else transcode (`TranscodingUrl`). Skip non-FILE and remote sources |
| Changing tracks | `APP/ui/playback/PlaybackController.java`, `PlaybackControllerHelper.kt` | While transcoding: `stopEncodingProcess(deviceId, playSessionId)`, then PlaybackInfo again with the new index and `startTimeTicks`. While direct playing: switch the track in the player |
| Progress reporting | `PlaybackController.java` (lines ~59–61), `APP/util/apiclient/ReportingHelper.kt` | Every 3 s while playing and every 15 s while paused, with playSessionId, playMethod, mediaSourceId and stream indexes. The new `PlaySessionService` only reports on state changes, which is a gap |
| Resume | `APP/util/sdk/SdkPlaybackHelper.kt` | Start at `playbackPositionTicks` minus a preroll setting |
| Queue and next up | `SdkPlaybackHelper.kt`, `APP/ui/playback/nextup/` | Episodes queue from `getEpisodes(seriesId, startItemId, limit=150)`. "Still watching?" prompt. The last audio and subtitle languages carry over |
| Media segments | `APP/ui/playback/segment/MediaSegmentRepository.kt` | Per type: NOTHING, SKIP or ASK_TO_SKIP. SKIP for segments ≥1 s; ASK for ≥3 s; the prompt auto-hides after 8 s |
| Trickplay | `APP/ui/playback/overlay/CustomSeekProvider.kt` | tile = pos / interval, then the sheet index and x/y offset from tileWidth/tileHeight. On the web: CSS `background-position` |
| Auth | `APP/auth/repository/*`, `APP/ui/startup/UserLoginViewModel.kt` | Multiple servers and users with stored tokens. Quick Connect polls every 5 s |
| Device ID per user | `APP/util/sdk/DeviceInfoExtensions.kt` | `sha1("$deviceId+$userId")`, so one user logging in doesn't end another user's session |
| Adding a server | `APP/auth/repository/ServerRepository.kt` | Try several address variants (`getAddressCandidates`) and score them with `/System/Info/Public`. UDP discovery is not possible in a browser |
| Home rows | `APP/ui/home/HomeRowsFragment.kt`, `HomeFragmentHelper.kt`, `APP/preference/UserSettingPreferences.kt` | The order is server-side: DisplayPreferences `usersettings`, client `emby`, keys `homesection0..7`. Resume, NextUp and Latest per library each use limit 50, `imageTypeLimit=1` and a small `Fields` set |
| Images | `APP/util/apiclient/JellyfinImage.kt`, `APP/ui/composable/AsyncImage.kt` | Size-limited image URLs; fall back to parent or series images; BlurHash placeholders |
| Paging | `APP/ui/itemhandling/ItemRowAdapter.java`, `BrowseGridFragment.java` | Load more when `pos >= loaded - chunk/1.7`; chunk size 25–150 |
| Navigation and focus | `APP/ui/navigation/NavigationRepository.kt`, `.../focus/FocusPersistManager.kt` | A stack of destinations; focus restored by string key on Back |
| WebSocket | `APP/data/eventhandling/SocketHandler.kt` | Capabilities: Video and Audio, SupportsMediaControl, commands DisplayContent, SetAudio/SubtitleStreamIndex, DisplayMessage. Handles Play, the Playstate commands (Stop, Pause, Unpause, PlayPause, Next, Previous, Seek, Rewind, FastForward), LibraryChanged and UserDataChanged |
| Player design | `playback/core` | `PlayerBackend` abstraction, plug-in services, lazy `QueueSupplier`s, `TimedEventService`. A good shape for TypeScript |

Avoid: the legacy Java player (`PlaybackController.java`, `VideoManager.java`,
`CustomPlaybackOverlayFragment.java`, about 3,400 lines that mix UI with
logic). Not applicable: `MediaCodecList`, `KnownDefects`, ffmpeg and libass,
UDP discovery, Media3 sessions, Leanback channels. There is no SyncPlay.

### jellyfin-roku

A TV interface built from scratch for weak hardware.

- `source/utils/deviceCapabilities.bs` (1,164 lines): builds the profile from
  `CanDecodeVideo({ Codec, Container })` checks; `MaxStreamingBitrate` is 120 Mbps.
- `components/captionParser.bs`, `captionTask.bs`: its own subtitle renderer.
- `components/ItemGrid/`, `ButtonGroupHoriz/Vert`, `JFScreen`: focusable
  grids and screens.
- `GetPlaybackInfoTask`, `PlaystateTask`, `GetNextEpisodeTask`: playback
  concerns split cleanly.

### jellyfin-sdk-typescript

- Generated API types and clients. **axios is a peer dependency**; avoid it in
  an ES5 bundle and use the types only.
- `src/utils/address-candidates.ts`: address variants for a typed-in server.
- `src/discovery/`: scores those candidates.
- `src/websocket/`: the WebSocket message models.
- `openapi.json`: the definitive API specification.

## Jellyfin API endpoints in the design (10.9+)

| Feature | Endpoints |
|---|---|
| Server | `/System/Info/Public` |
| Quick Connect | `/QuickConnect/Initiate`, `/QuickConnect/Connect?secret=`, `/Users/AuthenticateWithQuickConnect` |
| Password login | `/Users/AuthenticateByName` |
| Home | `/UserViews`, `/UserItems/Resume`, `/Shows/NextUp`, `/Items/Latest`, `/DisplayPreferences/usersettings?client=emby` |
| Browsing | `/Items`, `/Items/{id}`, `/Shows/{id}/Seasons`, `/Shows/{id}/Episodes` |
| Images | `/Items/{id}/Images/{type}` |
| Playback | `POST /Items/{id}/PlaybackInfo`, `/Videos/{id}/stream`, `DELETE /Videos/ActiveEncodings` |
| Reporting | `/Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` |
| Extras | `/MediaSegments/{itemId}`, `/Videos/{id}/Trickplay/{width}/{index}.jpg` |
| Remote control | `/Sessions/Capabilities/Full`, WebSocket `/socket?api_key&deviceId` |

Auth header:
`Authorization: MediaBrowser Client="Jellyfin Saphi", Device="…", DeviceId="…", Version="…", Token="…"`

## Conventions

- This project is self-contained. Work only in this repository.
- Work on feature branches and open PRs into `main`.
- Code must run on an old TV browser:
  - ES5 output;
  - no dependency without checking its size and the ES level it needs;
  - test in a desktop browser through the platform layer, then on the TV.
- Update `docs/` and this file when a decision changes or TV test results
  arrive. Record probe results in `docs/saphi-platform.md`.
