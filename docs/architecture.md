# Architecture: custom client (Option B)

This is the design for a lightweight client of our own. It is used only if
jellyfin-web is too heavy or broken on the Saphi browser (see the plan in the
[README](../README.md)). The playback and device-profile parts are needed in
both options.

## 1. Constraints

| Constraint | Consequence |
|---|---|
| No SDK, no app store | A web app opened in the browser, or through a custom home tile |
| Browser engine unknown | Target ES5 and add polyfills based on the probe. Keep everything Saphi-specific in one platform layer |
| 2019 SoC, little memory | No heavy framework, a small bundle, few DOM nodes, images requested at their display size |
| Remote control only | Focus moved with the arrow keys; Back goes to the previous screen |
| Unclear codec support | Start with a conservative DeviceProfile and widen it using the probe and test clips |
| No remote debugger on the TV | An on-screen log overlay plus logs posted to the dev machine, from day one |

## 2. Deployment

```
 ┌──────────── Philips 55OLED754 (Saphi) ────────────┐
 │ Saphi browser  /  custom home tile (optional)     │
 │   └─ Jellyfin Saphi client (same origin)          │
 └───────────────┬───────────────────────────────────┘
                 │ HTTP(S) on the LAN
 ┌───────────────▼───────────────────────────────────┐
 │ Reverse proxy (Caddy/nginx, Docker)               │
 │   /tv/*      → static client (versioned bundles)  │
 │   /tv/log    → log sink (dev builds only)         │
 │   /*         → Jellyfin server :8096              │
 └───────────────┬───────────────────────────────────┘
                 ▼
          Jellyfin server (API, transcoding, HLS)
```

Serving the client from the same origin as Jellyfin avoids CORS preflight
requests on an old engine, and avoids mixed HTTP/HTTPS content. The client also
works with a separately entered server URL.

## 3. Layers

```
┌──────────────────────────────────────────────────────────┐
│ Screens: Login · Home · Library · Details · Season ·     │
│          Search · Player · Settings                      │
├──────────────────────────────────────────────────────────┤
│ UI kit:  Row · Grid · PosterCard · Button · Dialog ·     │
│          OSD · Toast                                     │
├───────────────┬───────────────┬──────────────────────────┤
│ Navigation    │ Store         │ Playback engine          │
│ - screen stack│ - session     │ - DeviceProfile builder  │
│ - focus tree  │ - settings    │ - PlaybackInfo decision  │
│ - key routing │ - item cache  │ - player adapters        │
│               │               │ - progress reporter      │
│               │               │ - subtitle renderer      │
├───────────────┴───────────────┴──────────────────────────┤
│ Jellyfin API client (typed, XHR/fetch, auth header,      │
│ retries, image URL builder)                              │
├──────────────────────────────────────────────────────────┤
│ Platform layer: saphi │ desktop (dev) │ later: titan     │
│ keys, storage, device info, exit, visibility, logging    │
└──────────────────────────────────────────────────────────┘
```

Rule: only the platform layer may touch anything Saphi-specific: key codes,
OIPF/HbbTV objects and exiting. The same code then runs in a desktop browser
during development.

## 4. Components

### 4.1 Platform layer

```ts
interface Platform {
  keys: Record<number, Key>;        // arrows, OK, Back, Play/Pause… (from the probe)
  storage: KV;                      // localStorage → cookie fallback
  deviceInfo(): { name: string; id: string; ua: string };
  exit(): void;                     // window.close() / history.back()
  onVisibility(cb: (hidden: boolean) => void): void;
}
```

- **Device ID:** a random base ID is generated once and stored. The ID sent to
  the server is `sha1(baseId + userId)`, as in jellyfin-androidtv. Without
  this, the server ends one user's session when another user logs in on the
  same TV.

### 4.2 Jellyfin API client

- **Auth header:**
  `Authorization: MediaBrowser Client="Jellyfin Saphi", Device="Philips Saphi TV", DeviceId="…", Version="…", Token="…"`
- **Types:** use the types from `@jellyfin/sdk` (jellyfin-sdk-typescript). Keep
  our own small fetch/XHR transport, because the SDK requires axios.
- **Endpoints (Jellyfin 10.9+):**

| Feature | Endpoint |
|---|---|
| Server check | `/System/Info/Public`; try http/https and port variants of the entered address |
| Login | Quick Connect: `/QuickConnect/Initiate`, poll `/QuickConnect/Connect` every 5 s, then `/Users/AuthenticateWithQuickConnect`. Fallback: `/Users/AuthenticateByName` |
| Home | `/UserViews`, `/UserItems/Resume`, `/Shows/NextUp`, `/Items/Latest` (per library, `groupItems=true`) |
| Home order | `/DisplayPreferences/usersettings?client=emby`, keys `homesection0..7`; same as jellyfin-web |
| Library | `/Items?ParentId&StartIndex&Limit&SortBy&Fields` (paged) |
| Details | `/Items/{id}`, `/Shows/{id}/Seasons`, `/Shows/{id}/Episodes` |
| Search | `/Items?searchTerm=…` |
| Images | `/Items/{id}/Images/{type}?fillWidth&fillHeight&quality=80&tag=` |
| Playback | `POST /Items/{id}/PlaybackInfo` |
| Reporting | `/Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` |
| Stop transcode | `DELETE /Videos/ActiveEncodings?deviceId&playSessionId` |
| Segments | `/MediaSegments/{itemId}` |
| Trickplay | `/Videos/{id}/Trickplay/{width}/{index}.jpg` |

- Request a small `Fields` set (`PrimaryImageAspectRatio, Overview, ChildCount, DateCreated`)
  and `imageTypeLimit=1` for rows.

### 4.3 Navigation and focus

- **Screen stack:** opening a screen pushes it onto the stack and Back pops it.
  On Home, Back asks before exiting.
- **Focus tree, not position-based navigation.** Screens are built from
  containers (Row, Grid, List, ButtonBar) that remember their last focused
  index:
  - left/right moves within a row;
  - up/down moves between rows;
  - at the edge of a container, the key passes up to the parent container.

  This is predictable and cheap on a weak SoC.
- **Restoring focus:** each focusable element has a string key. The last
  focused key is saved per screen and restored on Back.
- **Virtualisation:** rows and grids render only the visible items plus a
  small margin (about 60 posters at most). Scrolling uses `transform: translate`.
- **Paging:** load the next chunk when the focus is within about 60% of a
  chunk from the end. Chunk size is 25–150, scaled to the cards visible on screen.

### 4.4 Playback engine

```
 item → DeviceProfileBuilder(probe results, settings)
      → POST PlaybackInfo { DeviceProfile, MaxStreamingBitrate, StartTimeTicks,
                             AudioStreamIndex, SubtitleStreamIndex,
                             EnableDirectPlay/DirectStream/Transcoding = true }
      → MediaSource decision (the server decides; the client picks in order):
          SupportsDirectPlay   → /Videos/{id}/stream?static=true&MediaSourceId&Tag
          SupportsDirectStream → TranscodingUrl
          SupportsTranscoding  → TranscodingUrl (HLS)
      → PlayerAdapter:
          NativeVideoPlayer   (progressive file; native HLS if supported)
          HlsJsPlayer         (hls.js, only if MSE exists and native HLS does not)
          OipfPlayer          (only if <video> turns out to be limited)
      → services: ProgressReporter · SegmentSkipper · NextUp · RemoteControl
```

- **DeviceProfile:** same structure as jellyfin-androidtv and jellyfin-web's
  `browserDeviceProfile.js`:
  - direct-play profiles;
  - transcoding profiles (HLS/TS with H.264 + AAC/AC-3 first, HLS/fMP4 later);
  - codec profiles (H.264 profile and level, reference frames, maximum
    width/height, audio channels);
  - subtitle profiles.

  HEVC, VP9 and MKV direct play are switched on only after real test clips play.
- **Subtitle profiles:**
  - VTT: external, plus inside HLS (the server puts only WebVTT into HLS);
  - SRT/ASS: external, converted to VTT by the server;
  - PGS/DVD/DVB: burned in by the server.

  The client draws text subtitles itself in an overlay above the video.
- **Changing audio or subtitle tracks while transcoding:**
  1. stop the active encoding;
  2. request PlaybackInfo again with the new index and the current position;
  3. reload the player.

  For direct play, use the element's `audioTracks` only if the probe shows it works.
- **Progress reporting:**
  - every 3 s while playing and every 15 s while paused, plus on every state change;
  - each report includes `PlaySessionId`, `PlayMethod`, `MediaSourceId`, the
    stream indexes and `PositionTicks`.
- **Resume:** start at `UserData.PlaybackPositionTicks` minus a short preroll.
- **Queue:** an episode builds a queue from `/Shows/{seriesId}/Episodes?startItemId`.
  The last used audio and subtitle languages carry over to the next episode.
- **Media segments:** Intro, Outro, Recap, Preview and Commercial each get an
  action: nothing, skip, or ask to skip. Ask only for segments of 3 s or more,
  and hide the prompt after 8 s.
- **Trickplay:** tile index = position / interval. The tile sheet and its
  offset are shown with CSS `background-position`.
- **Bitrate:** default 20 Mbps over Wi-Fi, adjustable in settings.

### 4.5 Remote control (later)

Connect a WebSocket to `/socket?api_key&deviceId` and post capabilities to
`/Sessions/Capabilities/Full`:
- playable media types Video and Audio;
- `SupportsMediaControl=true`;
- supported commands DisplayContent, SetAudioStreamIndex,
  SetSubtitleStreamIndex, DisplayMessage.

Then handle `Play` and the `Playstate` commands (Stop, Pause, Unpause,
PlayPause, Seek, NextTrack, PreviousTrack), and refresh rows on
`LibraryChanged` and `UserDataChanged`.

### 4.6 Store

A small observable store holds:
- the session (server, user, token);
- settings;
- an item cache with a time limit, so Back is instant.

Only the server URL, base device ID, token, user ID and settings are kept in
storage.

### 4.7 Logging

- `log.*` writes to a ring buffer. A colour key shows it on screen.
- Dev builds also POST logs to `/tv/log`.
- `window.onerror` and unhandled rejections are always captured.

## 5. Technology

| Area | Choice |
|---|---|
| Language | TypeScript |
| UI | Preact + signals, or no framework |
| Build | Vite + `@vitejs/plugin-legacy`, or esbuild → ES5. core-js polyfills chosen from the probe |
| Video | `<video>` first; hls.js loaded only when needed |
| Styling | Plain CSS on a 1920×1080 design canvas, scaled with one root `transform` |
| Tests | Vitest (profile builder, focus tree, API client), Playwright on desktop (screen flows) |
| Delivery | Docker image: nginx serving the client and proxying Jellyfin |

Budget: under 120 kB gzipped for the start screen. The player code and hls.js
load separately.

## 6. Updates

`index.html` is a tiny loader. It fetches `manifest.json`, then loads
`app.<hash>.js`, so updating the server updates the TV without stale caches.

## 7. Repository layout

```
src/
  platform/   saphi.ts  desktop.ts  index.ts
  api/        client.ts  auth.ts  items.ts  playback.ts  images.ts
  nav/        router.ts  focus.ts  keys.ts
  playback/   profile.ts  decide.ts  players/{native,hlsjs,oipf}.ts
              reporter.ts  subtitles.ts  segments.ts  trickplay.ts
  store/      session.ts  settings.ts  cache.ts
  ui/         components/  screens/
  debug/      logger.ts  overlay.ts
probe/        index.html
deploy/       Dockerfile  Caddyfile
tests/
```

## 8. Milestones

1. **Probe:** run the probe and test clips on the TV. This sets the build
   target, the first DeviceProfile and the key map.
2. **Foundation:** platform layer, logger, focus tree, Quick Connect login.
3. **Browsing:** Home rows, library grids, details pages.
4. **Playback MVP:** direct play / HLS, progress reporting, resume.
5. **Tracks:** subtitle overlay, audio switching, next episode, segment skipping.
6. **Polish:** search, settings, performance, Docker image, custom home tile.
7. **Later:** remote control over the WebSocket, music, Live TV, Titan OS
   platform layer.

## 9. Decisions that wait on the probe

| Probe result | Decision |
|---|---|
| ES2015 support | Build target and polyfill size |
| MSE | Whether hls.js can be used, or only native HLS / progressive files |
| Native HLS | Transcoding container |
| HEVC / VP9 / AC-3 | DeviceProfile, and how often the server has to transcode |
| Window size | Scale factor and image sizes |
| Key codes | Key map, especially Back and the media keys |
