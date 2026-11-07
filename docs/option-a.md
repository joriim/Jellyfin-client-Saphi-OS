# Option A: jellyfin-web with a Saphi shell

Option A runs the server's own jellyfin-web in the Saphi browser and adds a
small `NativeShell` adapter, [`shell/saphi.js`](../shell/saphi.js). This is the
pattern of the official Tizen and webOS apps (see
[references.md](references.md)).

The Saphi browser cannot load local app files the way Tizen and webOS apps do.
Instead, a reverse proxy sits between the TV and Jellyfin and injects the shell
into jellyfin-web's `index.html`:

```
 TV browser ──► proxy :8097 ──────────────► Jellyfin :8096
                 /tv/saphi.js, /tv/config.js   (served by the proxy)
                 /web/index.html               + <script> tags before </head>
                 everything else, /socket      passed through
```

The scripts are added before `</head>`, so they run before jellyfin-web's
deferred bundle. jellyfin-web then finds `window.NativeShell` at start-up.

## What the shell does

| jellyfin-web asks | Saphi shell answers |
|---|---|
| `getDefaultLayout()` | `'tv'`: TV layout and remote-control navigation |
| `deviceId()` | A random ID, stored once in `localStorage._deviceId2` (the key jellyfin-web uses) |
| `deviceName()` / `appName()` | "Philips Saphi TV" / "Jellyfin for Saphi" |
| `getDeviceProfile(builder)` | `builder(config.profile)`; conservative by default (`enableMkvProgressive: false`) |
| `supports(feature)` | `exit`, `exitmenu`, autoplay, `physicalvolumecontrol`, display language, subtitle settings |
| `screen()` | `config.screenWidth/Height`, else `window.screen` × `devicePixelRatio` |
| `exit()` | `window.close()`, then `exitUrl` or back through the history |

It also:

- **Translates remote keys.** jellyfin-web already understands the arrows,
  Enter and the OIPF/HbbTV codes 461 (Back) and 412–417 (media keys). For any
  other code, add `keyMap: { '<keyCode>': '<action>' }`. The shell swallows the
  original event and sends one jellyfin-web understands. Actions: `Back`,
  `Pause`, `MediaPlay`, `MediaPlayPause`, `MediaStop`, `MediaRewind`,
  `MediaFastForward`, `MediaTrackPrevious`, `MediaTrackNext`, `Find`,
  `BrowserHome`. `backspaceIsBack: true` treats Backspace as Back when no text
  field has focus.
- **Logs.** Console output, `window.onerror` and unhandled rejections go to a
  ring buffer. With `debug: true` they are also posted to `/tv/log`, every key
  press is logged with its codes, and the blue key (406) shows the log on
  screen.

## Configuration

Lowest to highest precedence:

1. `DEFAULTS` in `saphi.js`;
2. `window.SaphiConfig` from [`shell/config.js`](../shell/config.js), edited on
   the proxy host;
3. `localStorage['saphi.config']` (JSON) on the TV;
4. URL parameters: `/web/index.html?saphi-debug=1` turns debug on (and
   remembers it), `?saphi-reset=1` clears the TV's stored settings.

## Running it

### For development: `tools/devserver.py`

Python 3 standard library only. It proxies Jellyfin, injects the shell, serves
the probe, and saves what the TV sends.

```sh
python3 tools/devserver.py --jellyfin http://192.168.1.10:8096
```

On the TV, open:

- `http://<pc-ip>:8000/probe/`: the capability probe. Results and each key you
  press are saved to `logs/probe-<id>.json`.
- `http://<pc-ip>:8000/web/index.html?saphi-debug=1`: jellyfin-web with the
  shell. TV logs go to `logs/tv.log` and the terminal.

### Permanent: nginx in Docker

```sh
cd deploy
JELLYFIN_URL=http://192.168.1.10:8096 docker compose up -d
```

Open `http://<docker-host>:8097/` on the TV and bookmark it. The probe is at
`/tv/probe/` (it cannot save results here; use the dev server for that). If
Jellyfin runs in the same Compose project, use `JELLYFIN_URL=http://jellyfin:8096`.

The proxy only changes jellyfin-web's start page, so other clients can keep
using port 8096 directly.

## Test checklist on the TV

1. Probe: record the user agent, the codec table and the key codes for Back,
   OK, Play/Pause, Stop, FF/REW and the colour keys.
2. Open `/web/` through the proxy. Does jellyfin-web load, and in the TV layout?
3. Navigate with the arrows and OK; check Back on every screen and that Back
   on Home offers to exit.
4. Log in (Quick Connect and password). Restart the browser and check you are
   still logged in.
5. Play an H.264/AAC MP4 (direct play), then something that needs transcoding.
   Check the playback info (Dashboard → Activity) for the method used.
6. Seek, pause, resume, Stop; check that progress is saved.
7. Subtitles: an SRT and an ASS file.
8. Note memory problems: slow scrolling, reloads, crashes after a while.

Write the results into [saphi-platform.md](saphi-platform.md). Then:

- add key codes jellyfin-web does not know to `keyMap`, and consider sending
  them upstream to jellyfin-web's `keyboardNavigation.js`;
- turn on profile options (`supportsHevc`, `enableHls`, `maxVideoWidth`...)
  that the test clips justify;
- if jellyfin-web is too slow or broken, move on to Option B
  ([architecture.md](architecture.md)). The device profile options and key
  map carry over.

## Tests

```sh
npm test   # Node (shell) and Python (dev server) tests, no dependencies
```
