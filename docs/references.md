# Reference clients

A review of existing Jellyfin clients (shallow clones from November 2026), and
what this project can reuse from each.

| Repository | Language | License | Relevance |
|---|---|---|---|
| [jellyfin-tizen](https://github.com/jellyfin/jellyfin-tizen) | JS | MPL-2.0 | Wrapper pattern (Option A) |
| [jellyfin-webos](https://github.com/jellyfin/jellyfin-webos) | JS | MPL-2.0 | Wrapper that loads jellyfin-web from the server |
| [jellyfin-web](https://github.com/jellyfin/jellyfin-web) | JS/TS | GPL-2.0 | The UI that Option A reuses; standard browser DeviceProfile |
| [jellyfin-androidtv](https://github.com/jellyfin/jellyfin-androidtv) | Kotlin | GPL-2.0 | Playback and profile rules, TV UX |
| [jellyfin-roku](https://github.com/jellyfin/jellyfin-roku) | BrightScript | GPL-2.0 | Custom TV UI on weak hardware |
| [jellyfin-sdk-typescript](https://github.com/jellyfin/jellyfin-sdk-typescript) | TS | MPL-2.0 | API types, address candidates, WebSocket |

**License rule:** code may be copied from the MPL-2.0 projects. The GPL-2.0
projects are for ideas only, unless this repository changes its license to GPL.

## jellyfin-tizen: the wrapper pattern

The whole Samsung app is jellyfin-web plus `tizen.js` (202 lines). That file
defines `window.NativeShell`, which jellyfin-web looks for at startup:

- `AppHost.init / appName / appVersion / deviceId / deviceName / exit`
- `AppHost.getDefaultLayout()` returns `'tv'`
- `AppHost.getDeviceProfile(profileBuilder)` returns
  `profileBuilder({ enableMkvProgressive: false, enableSsaRender: true })`
- `AppHost.supports(feature)`: a list such as `exit`, `htmlvideoautoplay`,
  `physicalvolumecontrol`, `multiserver`, `subtitleburnsettings`
- `AppHost.screen()`: the real panel resolution
- no-op `enableFullscreen`, `openUrl`, `updateMediaSession` and so on
- registering the media keys with the platform

The device ID is stored as `_deviceId2`, the key jellyfin-web uses.

## jellyfin-webos: loading jellyfin-web from the server

The LG app ships only a small start page:

1. Ask for the server address (or discover it).
2. Load the server's own jellyfin-web into a full-screen `<iframe>`.
3. On the iframe's `DOMContentLoaded`, inject `window.AppInfo`,
   `window.DeviceInfo` and the NativeShell script (`handoff()` in
   `frontend/js/index.js`).

`getDeviceProfile` also passes the TV's HDR and Atmos capabilities
(`supportsDolbyVision`, `supportsHdr10`, `supportsDolbyAtmos`).

This is the closest fit for Saphi: the client stays tiny and always matches
the server's version of jellyfin-web.

## jellyfin-web

- **Supported browsers** (`package.json` browserslist) include Chrome 27, 38,
  47, 53, 56 and 63, kept for old TVs. A Chromium-based Saphi browser has a
  good chance of running it.
- **`src/scripts/browser.js`:**
  - `isTv()` returns true for any user agent containing `tv`, so Philips user
    agents (`PhilipsTV`, `NETTV`, `SmartTvA`) give the TV layout and keyboard
    navigation.
  - `operaTv` is set when the user agent also contains `opr/`.
- **`src/scripts/browserDeviceProfile.js`** (1,654 lines): the standard browser
  profile builder. Options a NativeShell can pass:
  - `enableHls`, `supportsHevc`, `maxVideoWidth`, `audioChannels`;
  - `enableSsaRender`, `enablePgsRender`;
  - `supportsDolbyVision`, `supportsHdr10`, `supportsHlg`, `supportsDts`,
    `supportsTrueHd`;
  - `disableVideoAudioCodecs`, `globalMaxVideoBitrate`.

  A comment notes that titanos, operaTv, vidaa and other platforms still need
  testing.
- **`src/scripts/keyboardNavigation.js`:** the key-code to action map. Saphi
  key codes may need adding.

## jellyfin-androidtv (Google TV / Android TV)

Kotlin, Koin dependency injection, jellyfin-sdk-kotlin, Media3/ExoPlayer, a
mix of Leanback and Compose. The newer Kotlin modules are clean. The legacy
Java player (`PlaybackController.java`, `VideoManager.java`,
`CustomPlaybackOverlayFragment.java`, about 3,400 lines) mixes UI with logic
and is not a model to follow.

### Worth porting

- **DeviceProfile** (`util/profile/deviceProfile.kt`):
  - transcoding: HLS/TS (H.264, plus HEVC if supported) and HLS/fMP4;
  - direct-play containers and codecs;
  - codec profiles: H.264 profiles and levels, reference frames (≤12 when
    width ≥1200, ≤4 when width ≥1900), HEVC main/main10, maximum resolution,
    audio channels;
  - subtitles: only WebVTT goes into HLS; SRT and TTML are delivered as
    external files; PGS/DVD/DVB are burned in.
- **Choosing how to play:** PlaybackInfo with everything enabled; the server
  decides; the client takes direct play, else direct stream, else transcode.
  Strm and remote sources are skipped.
- **Changing tracks while transcoding:** stop the encoding process first, then
  request PlaybackInfo again with the new index and the current position.
- **Progress reporting:** every 3 s while playing and every 15 s while paused,
  with `playSessionId`, play method and stream indexes.
- **A device ID per user:** `sha1(deviceId + userId)`.
- **Quick Connect:** poll every 5 s.
- **Adding a server by address:** try several address variants and score the
  `/System/Info/Public` answers.
- **Home rows:** the order comes from the server (`usersettings` /
  `homesection0..7`). Continue Watching, Next Up and Latest per library, each
  with limit 50, small field sets and `imageTypeLimit=1`.
- **Media segments:** skip or ask-to-skip per segment type; ask only for
  segments of 3 s or more; hide the prompt after 8 s.
- **Smaller features:** trickplay tile maths, BlurHash placeholders, paging
  that loads ahead, stack-based Back, focus restoration by key.
- **The new player** (`playback/core`): a backend abstraction, plug-in
  services and lazy queue suppliers. Maps well to TypeScript.
- **Remote control over the WebSocket:** `Play`, the `Playstate` commands,
  switching audio and subtitle tracks, `DisplayContent`.

### Not applicable

`MediaCodecList` probing, per-device defect lists, ffmpeg and libass, UDP
server discovery, Media3 sessions and notifications, Leanback channels and the
screensaver. There is no SyncPlay.

## jellyfin-roku

A complete TV interface built from scratch for weak hardware. Very active.

- `source/utils/deviceCapabilities.bs`: builds the DeviceProfile from the
  platform's "can this decode X in container Y" checks. The same idea as
  building a profile from `canPlayType` in the probe.
- `components/captionParser.bs`, `captionTask.bs`: its own subtitle parser and
  renderer, as planned for the overlay.
- `components/ItemGrid/`, `ButtonGroupHoriz/Vert`, `JFScreen`: focusable
  grids and a screen stack.
- `GetPlaybackInfoTask`, `PlaystateTask`, `GetNextEpisodeTask`: a clean split
  of playback concerns.

## jellyfin-sdk-typescript

- Generated API types and clients (axios peer dependency).
- `src/utils/address-candidates.ts` and `src/discovery/`: scoring the possible
  server addresses.
- `src/websocket/`: the WebSocket message models.
- Plan: use the types (compile-time only) with our own fetch/XHR transport, so
  the ES5 bundle does not need axios.

## Conclusion

1. Test jellyfin-web in the Saphi browser first.
2. If it works, build **Option A** on the Tizen and webOS pattern: a tiny
   loader and a `saphi.js` NativeShell (MPL-2.0 code can be reused).
3. If it does not, build **Option B** ([architecture.md](architecture.md)).
   Take the playback rules from jellyfin-androidtv and `browserDeviceProfile.js`,
   and the UI building blocks from jellyfin-roku. Write the code ourselves.
