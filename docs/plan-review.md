# Plan review (November 2026)

The goal is an app like the Jellyfin apps on Android TV, Samsung (Tizen) and
LG (webOS): open it from the TV, pick a server, sign in, browse your libraries
with the remote, and play with direct play where possible. This review checks
the original plan against that goal and what has been learned since.

## What changed

**1. A Saphi TV cannot install an app.**
The App Gallery is closed to outside developers. The only home-screen route
examined, [UAEpro/philips-tv-saphi-os-jailbreak](https://github.com/UAEpro/philips-tv-saphi-os-jailbreak),
does not add app tiles:
- it replaces the Home dashboard through a DLNA trick, for one model and firmware;
- a firmware update can remove it;
- it has no license.

The original plan listed a "custom home tile" as optional. It is dropped.
**The app is a bookmark in the TV's Internet browser**, and the docs say so
plainly. This is the one way it cannot match the Android TV app.

**2. The Saphi browser is probably old.**
The same repository targets ES5 and reports that sites using newer JavaScript
fail on the TV's browser. jellyfin-web 10.11 is a large React application. Even
if it transpiles to old syntax, it is likely to be slow on a 2019 SoC with an
old engine. The plan treated Option A (jellyfin-web) as the likely outcome and
Option B (our own client) as the fallback. That is reversed: **Option B is the
main line.** Option B is also what the Android TV app is: a purpose-built TV
interface, not the web interface.

**3. Option A needed a proxy server.**
The Saphi browser cannot load local app files, so the shell has to be injected
by something serving jellyfin-web: the dev server or nginx in Docker. Android
TV users do not run an extra service. Option A stays as a quick experiment
(see [option-a.md](option-a.md)), not the product.

**4. The architecture's toolchain did not fit the target.**
The plan named TypeScript, Vite with the legacy plugin, Preact and core-js.
For an engine that may only run ES5:
- every transpile and polyfill step is a place where code the TV cannot run
  slips in unnoticed;
- the TV has no remote debugger.

The client is now **plain ES5 with no framework, no build step and no runtime
dependencies**. The TV runs exactly the code in `app/js/`. A test fails the
build if ES2015+ syntax appears. JSDoc comments document the types. TypeScript
checking (`tsc --checkJs`) can be added later without changing the output.

**5. Hosting without CORS or mixed-content problems.**
A client hosted elsewhere, for example on HTTPS GitHub Pages, cannot call a
plain-HTTP Jellyfin server on the LAN: the browser blocks mixed content.
The client is therefore served **from the Jellyfin server itself**: the `app/`
folder copied into Jellyfin's web folder as `/web/saphi/`. It is then the same
origin as the API, there is no extra service, and it also works through a
reverse proxy. The dev server and nginx config serve it at the same path.

## What did not change

- **The probe comes first on the TV.** It sets the key map, the codec
  capabilities and whether the engine runs ES5 only. The client now runs
  without it, though: capabilities come from `canPlayType` at runtime, and
  playback falls back to transcoding when direct play fails.
- The API design (Quick Connect, per-user device ID, PlaybackInfo decision,
  progress reporting, stopping transcodes) follows jellyfin-androidtv.
- License: MPL-2.0; no code copied from GPL projects.

## Parity with the Android TV app

| Feature | Android TV app | Saphi client now |
|---|---|---|
| Launch from the TV | App icon | Browser bookmark (no install route on Saphi) |
| Server address, discovery | Address + UDP discovery | Address with port/scheme guessing; prefilled when served from the server. No discovery: browsers cannot use UDP |
| Sign in | Quick Connect, password, multiple users | Quick Connect, password; one user at a time |
| Home | Continue Watching, Next Up, Latest per library, My Media | Same rows, Android TV order |
| Libraries | Grid with sorting and filters | Paged grid, sorted by name |
| Details | Movie, series, season, episode | Movie, series → seasons → episodes, mark watched |
| Playback | Direct play / stream / transcode, ExoPlayer | Direct play / stream / transcode via the browser's `<video>`; automatic fallback to transcoding |
| Resume and progress | Yes | Yes (start, every 5 s playing / 15 s paused, stop) |
| Next episode | Yes, with a prompt | Plays automatically (setting) |
| Audio and subtitle tracks | Yes | **Not yet** (server defaults; image subtitles burned in) |
| Skip intro (media segments) | Yes | **Not yet** |
| Trickplay previews | Yes | **Not yet** |
| Search | Yes | **Not yet** |
| Remote control from other clients | Yes | **Not yet** |
| Music, Live TV | Yes | **No** |
| Screensaver | Yes | Not needed (the TV has its own) |

## Revised milestones

1. **Done:** Option A experiment (shell, dev proxy, nginx).
2. **Done:** client foundation and MVP: connect, Quick Connect and password
   login, Home rows, library grid, details, seasons, playback with direct
   play, transcoding fallback, progress, resume and next episode. Tested
   in Chromium against a fake server: 8 end-to-end tests and 23 unit tests.
3. **Next, on the TV:** run the probe; open `/web/saphi/`. Record key codes,
   capabilities, performance and what plays. Fix what breaks.
4. Audio and subtitle track selection, with a subtitle overlay for VTT.
5. Media segments (skip intro), trickplay, search.
6. Remote control over the WebSocket; library sorting and filters; multiple users.
7. Later: music, Live TV, Titan OS platform layer.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The engine is older than ES5 assumes, or lacks `classList`/`textContent` | Client fails to start | The probe finds out first; the code avoids newer DOM APIs where it can |
| `<video>` plays little directly | Most things transcode; server load | Transcoding fallback is automatic; HLS/TS is the cheapest profile |
| No native HLS and no MSE | Only progressive transcodes (no seeking inside the stream) | The player restarts the transcode at the new position |
| Keys differ from OIPF/HbbTV codes | Back or media keys do nothing | Key overrides in settings (`keyMap`), filled in from the probe |
| The TV browser drops localStorage | Sign-in lost on restart | Probe checks it; the client falls back to memory and says so |
