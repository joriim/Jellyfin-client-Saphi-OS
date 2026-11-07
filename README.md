# Jellyfin client for Saphi OS

A [Jellyfin](https://jellyfin.org) client for Philips TVs running **Saphi OS**,
TP Vision's Linux-based smart TV platform (2018–2022 models). The first target
device is the **Philips 55OLED754/12** (2019, 4K OLED).

Saphi has no public SDK and no open app store, so this client is a web app
that runs in the TV's built-in browser.

## Status

Option A is ready to try on the TV: a Saphi `NativeShell`
([`shell/saphi.js`](shell/saphi.js)), a dev server that proxies Jellyfin and
injects it, and an nginx/Docker deployment. It has been tested in desktop
Chromium only. Nothing has been run on the TV yet.

## Plan

1. **Probe the TV.** Open [`probe/index.html`](probe/index.html) in the Saphi
   browser to find the browser engine, JavaScript level, media APIs, playable
   codecs and remote key codes.
2. **Try jellyfin-web as is.** Open `http://<jellyfin-server>:8096` in the
   Saphi browser. jellyfin-web still targets Chrome 27+ and treats Philips user
   agents as TVs.
3. **Option A: wrapper.** If jellyfin-web is usable, add a small Saphi
   `NativeShell` adapter (device ID, device profile, keys, exit), as the
   official Tizen and webOS apps do. **Built:** see
   [docs/option-a.md](docs/option-a.md).
4. **Option B: custom client.** If jellyfin-web is too heavy for the TV, build
   the lightweight client described in [docs/architecture.md](docs/architecture.md).

## Running on the TV

```sh
python3 tools/devserver.py --jellyfin http://<jellyfin-server>:8096
```

Then, in the TV's browser:

- `http://<your-pc-ip>:8000/probe/`: the capability probe. Press each remote
  key; the results and key codes are saved to `logs/probe-<id>.json`.
- `http://<your-pc-ip>:8000/web/index.html?saphi-debug=1`: jellyfin-web with
  the Saphi shell. TV logs appear in `logs/tv.log`.

For a permanent setup, run the nginx proxy in [`deploy/`](deploy/) with
`docker compose`. See [docs/option-a.md](docs/option-a.md) for both, the
configuration and a test checklist.

## Tests

```sh
npm test   # no dependencies: Node 18+ and Python 3.8+
```

## Documentation

- [docs/option-a.md](docs/option-a.md): jellyfin-web with the Saphi shell:
  setup, configuration, test checklist
- [docs/saphi-platform.md](docs/saphi-platform.md): what is known about Saphi
  OS and the 55OLED754/12
- [docs/architecture.md](docs/architecture.md): architecture of the custom
  client (Option B)
- [docs/references.md](docs/references.md): review of other Jellyfin clients
  and what to reuse

## License

[MPL-2.0](LICENSE), the same license as jellyfin-tizen, jellyfin-webos and
jellyfin-sdk-typescript. jellyfin-web, jellyfin-androidtv and jellyfin-roku
are GPL-2.0. Do not copy code from them into this repository unless the
license is changed to match.
