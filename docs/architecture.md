# Architecture: the Saphi client (Option B)

The design of our own lightweight TV client, the main line of the project
since the [plan review](plan-review.md). What is built and how to use it:
[client.md](client.md). Sections marked **(changed)** were revised in the
review.

## 1. Constraints

| Constraint | Consequence |
|---|---|
| No SDK, no app store | A web app opened from a browser bookmark (no home-tile route exists) |
| Browser engine unknown, probably old | Write ES5 directly; no transpiling. Keep everything Saphi-specific in one platform layer |
| 2019 SoC, little memory | No heavy framework, a small bundle, few DOM nodes, images requested at their display size |
| Remote control only | Focus moved with the arrow keys; Back goes to the previous screen |
| Unclear codec support | Start with a conservative DeviceProfile and widen it using the probe and test clips |
| No remote debugger on the TV | An on-screen log overlay plus logs posted to the dev machine, from day one |

## 2. Deployment (changed)

```
 ┌──────────── Philips 55OLED754 (Saphi) ────────────┐
 │ Internet browser, bookmark                        │
 │   └─ http://<server>:8096/web/saphi/              │
 └───────────────┬───────────────────────────────────┘
                 │ HTTP(S) on the LAN, same origin
 ┌───────────────▼───────────────────────────────────┐
 │ Jellyfin server                                   │
 │   /web/saphi/*  the client (app/ copied or        │
 │                 mounted into the web folder)      │
 │   /*            API, images, streams, HLS         │
 └───────────────────────────────────────────────────┘
```

Serving the client from Jellyfin's own web folder makes it the same origin as
the API. That gives no CORS preflights on an old engine, no mixed HTTP/HTTPS
content, and no extra service to run. The same path works through a reverse
proxy. For development, or to leave the server untouched,
`tools/devserver.py` and the nginx config in `deploy/` serve `/web/saphi/` in
front of Jellyfin. The Connect screen still accepts any server address, for
servers that allow cross-origin requests.

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
- **Types (changed):** our own small XHR client, documented with JSDoc. The
  `@jellyfin/sdk` types can be used for `tsc --checkJs` later; no runtime
  dependency.
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

## 5. Technology (changed)

| Area | Choice |
|---|---|
| Language | ES5 JavaScript, written directly; JSDoc for types. A test rejects ES2015+ syntax |
| UI | No framework: small DOM helpers, a row-based focus model, a screen stack |
| Build | None. `index.html` loads the scripts in order. A concatenating build can come later if load time on the TV needs it |
| Video | `<video>` with direct play, native HLS or progressive transcodes. hls.js only if the probe finds MSE but no native HLS |
| Styling | Plain CSS on a 1920×1080 canvas, scaled with one root `transform`; no CSS grid or custom properties |
| Tests | `node:test` unit tests in a VM sandbox; Playwright end-to-end tests driven by remote keys against `tools/fakejellyfin.py` |
| Delivery | Copy `app/` into Jellyfin's web folder, or the nginx image in `deploy/` |

Why not TypeScript, Vite and Preact as first planned: for an engine that may
only run ES5, every transpile and polyfill step can let in code the TV cannot
run, and the TV has no debugger. Plain ES5 means the TV runs exactly what is
in the repository.

## 6. Updates

Updating the files on the server updates the TV. The dev server and nginx send
`Cache-Control: no-cache` for the client. Jellyfin serves its web folder with
its own caching, so a version query on the script URLs may be needed if the TV
holds stale copies (check on the TV).

## 7. Repository layout (changed)

```
app/          the client (Option B): index.html, css/, js/
shell/        NativeShell for jellyfin-web (Option A)
probe/        capability probe page
tools/        devserver.py (proxy, log sink), fakejellyfin.py (test server)
deploy/       nginx + docker compose
tests/        unit tests; e2e/ end-to-end tests
docs/
```

## 8. Milestones

See the revised list in [plan-review.md](plan-review.md#revised-milestones).
Milestones 1–4 of the original list (probe tooling, foundation, browsing,
playback MVP) are built; running the probe on the TV is still open.

## 9. Decisions that wait on the probe

| Probe result | Decision |
|---|---|
| ES2015 support | Build target and polyfill size |
| MSE | Whether hls.js can be used, or only native HLS / progressive files |
| Native HLS | Transcoding container |
| HEVC / VP9 / AC-3 | DeviceProfile, and how often the server has to transcode |
| Window size | Scale factor and image sizes |
| Key codes | Key map, especially Back and the media keys |
