# The Saphi client (Option B)

A TV client for Jellyfin, written for the Philips Saphi browser. Like the
Android TV app, it has its own interface for the remote: Home rows, library
grids, details pages and a full-screen player. It is plain ES5 JavaScript with
no framework, no build step and no dependencies. Why: see
[plan-review.md](plan-review.md).

## Install on your Jellyfin server

Copy the `app/` folder into Jellyfin's web folder as `saphi`. The client then
lives at `http://<server>:8096/web/saphi/`, on the same origin as the API,
with no extra service to run.

| Jellyfin install | Web folder |
|---|---|
| Docker (`jellyfin/jellyfin`) | `/jellyfin/jellyfin-web` |
| Docker (linuxserver) | `/usr/share/jellyfin/web` |
| Debian / Ubuntu package | `/usr/share/jellyfin/web` |
| Windows | `C:\Program Files\Jellyfin\Server\jellyfin-web` |

With Docker, mount it so that server upgrades keep it:

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin
    volumes:
      - ./Jellyfin-client-Saphi-OS/app:/jellyfin/jellyfin-web/saphi:ro
```

With a package install, copy it again after each Jellyfin upgrade:

```sh
sudo cp -r app /usr/share/jellyfin/web/saphi
```

Behind a reverse proxy, the path stays `/web/saphi/`. If you would rather not
touch the server, run the nginx proxy in [`deploy/`](../deploy/): it serves the
client at the same path in front of Jellyfin.

## On the TV

1. Open the Internet browser and go to `http://<server>:8096/web/saphi/`.
2. Bookmark it. Saphi has no way to install apps, so the bookmark is the app.
3. The server address is filled in. Press OK on **Connect**.
4. Sign in with the Quick Connect code (on your phone: Jellyfin → profile →
   Quick Connect), or with your user name and password.

| Remote key | Action |
|---|---|
| Arrows, OK | Move, select |
| Back | Previous screen. On Home: go to the top row, then press twice to exit |
| Play/Pause, OK (in the player) | Pause and resume |
| Left/Right, ◄◄/►► (in the player) | Back 10 s / forward 30 s (repeated presses add up) |
| Stop | Stop playback |
| Blue | Show the log (when Debug log is on in Settings) |

Key codes are OIPF/HbbTV guesses until the probe confirms them. Unknown keys
can be mapped in settings (`keyMap`, see below).

## Settings

On the TV: Home → Settings. Maximum bitrate, skip lengths, play next episode
automatically, debug log, sign out, change server. The **Playback
capabilities** line shows what the browser says it can play.

Saved in localStorage as `jf.settings`. Two options have no on-screen control
yet:

- `caps`: overrides what the browser reports, e.g. `{"hevc": true, "mkv": false}`
  after testing real clips;
- `keyMap`: remote keyCode → action, e.g. `{"10182": "back"}`.

## How it plays

1. The device profile is built from `canPlayType` (H.264, HEVC, VP9, AV1, AAC,
   AC-3, E-AC-3, MKV, TS, native HLS) plus the `caps` overrides.
2. `POST /Items/{id}/PlaybackInfo` with that profile; the server decides.
3. Direct play uses the original file (`/Videos/{id}/stream?static=true`).
   Otherwise the server's transcoding URL is used: HLS when the browser plays
   HLS natively, else a progressive TS/MP4 stream.
4. If direct play fails in the browser after all, the player asks again with
   direct play off, so the server transcodes from the same position.
5. Progress goes to `/Sessions/Playing*`, so other clients see the position
   and Resume works everywhere. Stopping a transcode tells the server to end
   the encoding.

## Code

```
app/
  index.html        loads the scripts in order
  css/app.css       1920x1080 canvas, scaled to the window
  js/core.js        namespace, Promise fallback, helpers
  js/platform.js    keys, storage, device ID, exit (the only Saphi-specific code)
  js/api.js         Jellyfin API client (XHR)
  js/profile.js     DeviceProfile from canPlayType
  js/ui.js          logger, focus navigation, screen stack, cards
  js/screens.js     Connect, Login, Home, Library, Details, Season, Settings
  js/player.js      playback, controls, reporting
  js/app.js         session, settings, key routing
```

Rule: ES5 only (`var`, `function`, no arrow functions, no `let`/`const`,
no template strings, no `Array.prototype.includes`). `npm test` enforces it.

## Development

```sh
npm run fake        # fake Jellyfin on :8096 with a test library (needs ffmpeg)
                    # open http://localhost:8096/web/saphi/  (demo / demo)
npm test            # unit tests (Node) and dev server tests (Python)
npm run e2e         # the client in Chromium against the fake server, by remote keys
python3 tools/devserver.py --jellyfin http://<server>:8096   # real server, from the TV
```

Use a 1280×720 or 1920×1080 browser window. Arrows, Enter and Escape act as
the remote.
