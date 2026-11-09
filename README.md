# Jellyfin client for Saphi OS

A [Jellyfin](https://jellyfin.org) client for Philips TVs running **Saphi OS**,
TP Vision's Linux-based smart TV platform (2018–2022 models). The first target
device is the **Philips 55OLED754/12** (2019, 4K OLED).

Saphi has no public SDK and no open app store, so this client is a web app
that runs in the TV's built-in browser.

## Status

**A working TV client (Option B), not yet tried on a TV.** Like the Android TV
app, it has its own remote-control interface. Supported now:

- server connect, with Quick Connect and password sign-in;
- Home rows: Continue Watching, Next Up, My Media, Latest per library;
- library grids, movie, series, season and episode pages;
- playback with direct play, automatic fallback to transcoding, resume and
  progress reporting, and the next episode.

It is plain ES5 JavaScript with no build step, so an old TV browser engine can
run it. It is tested in Chromium against a fake Jellyfin server (end-to-end
with remote keys) and with unit tests.

Missing compared with the Android TV app: audio/subtitle track selection,
skip intro, trickplay, search, remote control from other clients. Saphi cannot
install apps, so the client opens from a browser bookmark. See
[docs/plan-review.md](docs/plan-review.md) for the full comparison and why the
plan changed.

## Try it

**First time? Follow the step-by-step guide:
[docs/tv-setup-guide.md](docs/tv-setup-guide.md)** (PC, Jellyfin server and
TV on the same network; about 30–45 minutes).

**On the TV**, with the client installed on your Jellyfin server
([docs/client.md](docs/client.md)): open
`http://<server>:8096/web/saphi/` in the Internet browser and bookmark it.

**Without touching the server**, from a PC on the same network:

```sh
python3 tools/devserver.py --jellyfin http://<server>:8096
```

Then, in the TV's browser:

- `http://<pc-ip>:8000/probe/`: the capability probe. Press every remote key;
  results and key codes are saved to `logs/probe-<id>.json`. **Please do this
  first** and share the file.
- `http://<pc-ip>:8000/`: the client (redirects to `/web/saphi/`).
- `http://<pc-ip>:8000/web/index.html?saphi-debug=1`: jellyfin-web with the
  Saphi shell (the Option A experiment, [docs/option-a.md](docs/option-a.md)).

**On a PC, with no Jellyfin at all:**

```sh
npm run fake    # needs ffmpeg; then open http://localhost:8096/web/saphi/ (demo / demo)
```

## Tests

```sh
npm test       # unit tests: Node 18+ and Python 3.8+, no dependencies
npm run e2e    # end-to-end in Chromium (Playwright) against the fake server
```

## Documentation

- [docs/tv-setup-guide.md](docs/tv-setup-guide.md): step-by-step guide for
  trying it on your TV, with troubleshooting
- [docs/client.md](docs/client.md): the Saphi client: install, use, settings,
  how playback works, development
- [docs/plan-review.md](docs/plan-review.md): critical review of the plan,
  parity with the Android TV app, revised milestones and risks
- [docs/option-a.md](docs/option-a.md): jellyfin-web with the Saphi shell:
  setup, configuration, test checklist
- [docs/saphi-platform.md](docs/saphi-platform.md): what is known about Saphi
  OS and the 55OLED754/12
- [docs/architecture.md](docs/architecture.md): architecture of the client
- [docs/references.md](docs/references.md): review of other Jellyfin clients
  and what to reuse

## License

[MPL-2.0](LICENSE), the same license as jellyfin-tizen, jellyfin-webos and
jellyfin-sdk-typescript. jellyfin-web, jellyfin-androidtv and jellyfin-roku
are GPL-2.0. Do not copy code from them into this repository unless the
license is changed to match.
