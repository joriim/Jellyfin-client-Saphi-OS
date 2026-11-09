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

Research and design are done. **Client code exists on branch
`ccr-510dfa11-xgoqxi`, but it is not merged into `main` (no PR) and has never
run on a TV.** That branch was cut from the seed commit, before this file
existed. It contains:

- **Option A:** `shell/saphi.js` (NativeShell for jellyfin-web),
  `tools/devserver.py` (dev proxy that injects the shell), and
  `deploy/` (nginx + Docker);
- **Option B:** `app/`, a working TV client in plain ES5 with no build step.
  It has sign-in (Quick Connect and password), Home rows, library pages, and
  playback (direct play with transcoding fallback, resume, progress
  reporting, next episode);
- tests: unit tests and Playwright e2e tests against `tools/fakejellyfin.py`;
- `docs/plan-review.md` (proposes Option B as the main line) and
  `docs/tv-setup-guide.md`.

Desktop checks so far (2026-11-08): the client's API routes and JSON fields
match the official Jellyfin 10.11.11 build, which is the owner's server. This
was a static check only; nothing ran live against the owner's server. The TV
test guide in Finnish is [docs/tv-testi.md](docs/tv-testi.md).

Owner's server: Jellyfin **10.11.11** on a NAS (`NAS497CD0`) at
`http://192.168.8.140:8096`.

Waiting on two tests on the real TV. Both run through `tools/devserver.py`
on a PC; see [docs/tv-testi.md](docs/tv-testi.md):

1. **Probe:** open `http://<pc>:8000/probe/` in the Saphi browser. Results
   are saved to `logs/probe-*.json`. Record:
   - user agent (browser engine and version);
   - ES2015 / ES2017 support;
   - MSE and EME;
   - `canPlayType` and `isTypeSupported` results;
   - window size;
   - remote key codes.
2. **jellyfin-web:** open `http://<server>:8096` in the Saphi browser, and
   with the Saphi shell at `http://<pc>:8000/web/index.html?saphi-debug=1`.
   Does it load, use the TV layout, respond to the remote, and play video?

The results decide which path to take:
- **Option A:** wrapper around jellyfin-web.
- **Option B:** custom lightweight client.

**Open decision, for the owner:** the branch's `docs/plan-review.md` proposes
reversing the order below: Option B becomes the main line, in plain ES5 with
no build, served from Jellyfin's web folder. The owner has not approved this.
Until the TV results are in and the owner decides, the key decisions below
stand as written.

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

## Lessons

Lessons from a review of the last 10 Claude Code sessions (2026-11-08).
Session refs S1–S10 are mapped to session IDs in the Claude Lessons Wiki
(`raw/2026-11-08-review-last-10-sessions.md`).

### General

- Status consistently said what had not run on the TV/device/live API → keep stating in every status which target hardware or environment the code has and has not run on. (S1, S3, S6, S7)
- Code review reported 10 findings, read code to confirm them, changed nothing unasked → keep reviews report-only and confirm key findings in code before claiming them. (S1)
- Blocked hosts cost verification; hosts were probed one by one and no environment change was proposed → after the first proxy block, check proxy status once, call get_environment and propose the exact allowlist hosts instead of probing. (S1, S2, S3, S7, S10)
- First e2e run failed because the npm script pointed at a directory → run a newly added test script once locally before reporting or committing it. (S1)
- Page fetches failed (ENOTFOUND) and it said only search snippets were read → keep stating which sources were actually read versus inferred from snippets. (S2)
- Empty repo: asked via AskUserQuestion which branch to seed as default → keep asking before irreversible repo choices like the default branch. (S2)
- "Connect only with Jellyfin repo": checked git status/grep and explained attached repos can't be detached in-session → keep verifying isolation and stating session limits honestly. (S2)
- Chose the MPL-2.0 license alone while seeding the repo → ask the owner about license choice, bundled with other setup questions. (S2)
- Jellyfin work lived in a Yield-Data-Suite session/branch until the user objected → say early when a task belongs in a separate session/repo and suggest starting one. (S2)
- First Slack request produced a draft, not a post → keep drafting rather than posting until the user explicitly asks to post. (S3)
- Traced a 0.9% calibration error instead of loosening the test, and said which tests vs code were wrong → keep finding root causes before changing test tolerances. (S3)
- Ambiguous requests ("MC", "Poistaa") were interpreted and the reading stated → keep stating your interpretation of ambiguous requests and inviting correction. (S3)
- PR description listed what was verified live vs mocked; re-ran live tests when access opened → keep an explicit live-verified vs offline-only list. (S3)
- User API key passed only via env var, with a test that it never leaks into logs/errors → keep secrets in env vars and test that they don't leak. (S3)
- Desktop-folder request: called list_computer_folders and read_documentation, gave real options → keep checking access tools/docs before answering access questions. (S3)
- String-replace scripts silently missed after ruff reformatted code (8+ times) → use the Edit tool or assert each replacement applied, and re-read after formatters run. (S3)
- Pushed commits with lint errors or a dropped line at least three times → run lint/tests before every commit and push, not after. (S3)
- pip install hung 10+ min unnoticed, pkill killed own shell, NumPy downgraded → set timeouts on installs, kill by PID, and pin versions to avoid downgrades. (S3)
- PR description repeatedly fell out of date and was patched later → update the PR description with each push that changes scope. (S3)
- Scheduled PR check-ins posted "nothing changed" every ~4 h despite "stay silent" prompts → post only on real changes; no-change polls produce no message. (S3, S6)
- Replied in English to a Finnish-speaking user in places → always reply in the user's language, including status and CI notes. (S3)
- Domain-allowlist instructions weren't followable on the user's Android client → give step-by-step instructions for the user's actual client, or use read_documentation for current steps. (S3)
- Diagnosed with read-only commands first, found no Wi-Fi device on PCI, didn't reinstall drivers blindly → keep diagnosing read-only before changing a system. (S4)
- Picked up a second request mid-turn and gave ordered next steps for both → keep handling queued requests without dropping the first, easiest fix first. (S4)
- Asked before switching the monitor to 60 Hz → keep asking before changing a user's system settings. (S4)
- Claimed a driver version was "the latest" from memory → look it up in a source before claiming something is current, or say it is unverified. (S4)
- Ended with the scratch-folder offer though no files were created → only add boilerplate offers when their condition (files created) actually holds. (S4)
- Offered a speculative event-log entry as a possible cause → leave out weak speculation unless it leads to an actionable check. (S4)
- Checked both premises (CleanYourTV is Android-only; TV runs Saphi) with sources before answering → keep verifying the user's premises against sources first. (S5)
- Gave ranked alternatives with honest limits and said the unrelated repo was untouched → keep offering ordered workarounds with their limits stated. (S5)
- Gave TV menu-level steps as fact with no source → cite a source for UI/menu steps or mark them as unverified. (S5)
- Disabled rules to prove the parity test catches errors; tested sync on real SQLite → keep checking that tests can fail and use real dependencies over mocks. (S6)
- Said "nothing has run on a phone yet" and listed needed secrets/OAuth setup → keep naming exactly what the user must provide for device testing. (S6)
- "Review github" found its own PR contradicting accepted ADRs, wrong LICENSE, duplicated work → keep cross-checking own work against repo decisions during reviews. (S6)
- Asked the basemap product decision via AskUserQuestion with a recommendation → keep putting product decisions to the user with a recommended option. (S6)
- Answered the model question after loading the claude-api skill → keep loading the relevant skill instead of answering from memory. (S6)
- Working branch became the repo default; main lagged for weeks → keep main as default and merge via PRs; flag it at once if setup makes a work branch default. (S6)
- Built PR #4 on decisions superseded by ADRs accepted in another session → read the latest ADRs/decisions on GitHub before starting a work phase. (S6)
- Reported progress with a commit still unpushed → push before reporting status and check `git status` against remote. (S6)
- `sleep 45 && gh api` was blocked by the harness → use Monitor or a scheduled check instead of foreground sleep. (S6)
- Long autonomous turns hit the session/usage limit repeatedly → split work into shorter turns, with commits and pushed state in between. (S6, S7)
- Read host code first and found spec errors (existing `height_from_gsd()`) → keep checking the spec against the host code before writing and reuse what exists. (S7)
- Ran the module end to end against a real host clone, finding two bugs unit tests missed → keep running integration against the real host, not only unit tests. (S7)
- Proved 27 host test failures pre-existed by re-running upstream without the module → keep establishing a baseline before blaming or claiming changes. (S7)
- Checked outputs with independent references (ephemeris values, icalendar parser) → keep validating against independent implementations. (S7)
- Kept to "Phase 1 only", didn't touch a host file, stated Open-Meteo wasn't hit live → keep within spec scope and say what was not verified live. (S7)
- Wrote several wrong test expectations and a vacuous assertion → derive expected values independently before writing tests and remove vacuous asserts. (S7)
- Used getattr defaults for host config and the wrong config class, then undid it → read the host's config structure before adding fields. (S7)
- Committed with author overridden to the user's name/email unasked → use the configured git identity; never set the user's identity without being asked. (S7)
- Fact-checked plan claims against current sources and found version/source drift → keep verifying a plan's factual claims, not just the prose. (S8)
- Researched again when the user pushed back and openly corrected itself → keep re-checking and correcting yourself explicitly when challenged. (S8)
- Wrote v3 alongside v2, kept the user's voice, deferred scope calls → keep new versions non-destructive and leave scope decisions to the user. (S8)
- Stated "you cannot inject DLSS 5" as certain; one search would have refuted it → search before stating a blocker as certain, and keep figures consistent across turns. (S8)
- Heredoc failed and SendUserFile got malformed JSON with an unquoted Windows path → write long files with Write and escape Windows paths in JSON. (S8)
- Search-snippet community claims went into the plan as facts → fetch a primary source or label snippet-derived claims as unverified. (S8)
- Checked which referenced sibling specs exist on disk and wrote nothing until asked → keep checking referenced files exist and waiting for a request before writing. (S9)
- Saved spec verbatim, read project CLAUDE.md, found a rule conflict and asked before changing it → keep reading project rules before edits and asking on conflicts. (S9)
- Heredoc write failed again → use the Write tool for long Markdown instead of shell heredocs. (S9)
- Rewrote a CLAUDE.md section beyond the requested rule removal → edit only what was asked; propose extra rewrites separately. (S9)
- Checked GitHub before declaring the repo empty and found code on a branch/PR → keep checking remote branches and PRs before concluding a repo is empty. (S10)
- Reviewed in a temporary worktree, removed it and confirmed a clean tree → keep isolating reviews in worktrees and cleaning up. (S10)
- Tied review findings to the repo's own PLAN.md promises (farm_id/RLS) → keep reviewing against the project's stated rules. (S10)
- Confirmed a 403 was egress policy, didn't route around it, offered options → keep diagnosing blocks via proxy status and offering allowlist/paste options. (S10)
- Coordinator called WebFetch it lacked; worker ran ~6 near-duplicate searches → check available tools first and stop searching after one or two empty results. (S10)
- Interim status said the repo was "essentially empty" before the remote check → don't send interim conclusions until the check behind them is done. (S10)
- Heredocs failed on long Markdown and string-replaces silently missed after formatters → use Write/Edit, or assert each replacement applied, before committing. (S3, S8, S9)
- Commits pushed before lint/tests passed and a known mistake repeated → run lint and tests as a pre-commit gate and keep a project list of known pitfalls. (S3, S6)
- Verifying against the real thing (host clone, real SQLite, real Chromium, baseline test runs) found bugs mocks missed → keep testing against real dependencies and establishing baselines. (S1, S6, S7)

### This project

- Option A wrapper was checked on desktop (nginx vs fake Jellyfin, key translation in real Chromium) → keep running new platform code against a fake server and real browser before claiming it works. (S1)
- A subagent read the UAEpro jailbreak repo and found it can't add tiles → keep reading a third-party repo before relying on it, and record corrections in docs/. (S1)
- Fake Jellyfin + 8 remote-key-only Playwright e2e tests found real focus/input bugs → keep testing the client by remote keys only and separate test bugs from app bugs. (S1)
- Added a unit test failing on non-ES5 syntax in app/js → keep enforcing CLAUDE.md platform rules (ES5) with automated checks, not memory. (S1)
- Wrote a thorough TV setup guide after checking the tree was clean and pushed → keep user guides OS-specific with firewall/network pitfalls and a "what to send back" list. (S1)
- Built Option A then switched main line to Option B within hours, with no TV data → don't pick or switch between Option A/B until probe/jellyfin-web TV results exist; ask the user first. (S1)
- Replaced TS/Preact and reverse-proxy design with plain ES5 and copy-into-web-folder without TV results → get user sign-off before departing from docs/architecture.md. (S1)
- Remote key codes shipped as "educated guesses" with no remap path → mark key codes unverified, make them configurable/remappable, and take them from probe results. (S1)
- Cloned six reference repos, recorded commits, found the NativeShell pattern, parallel subagent for Android TV → keep grounding design in pinned reference source reviews. (S2)
- CLAUDE.md recorded exact commits/paths and explained pushing to main (default branch read) → keep context files specific and explain any convention exception. (S2)
- Plan claimed the UAEpro project adds home tiles without reading it; carried into CLAUDE.md → verify third-party capability claims before writing them into plans or CLAUDE.md. (S2)
- Claimed Saphi has "no way to replace the launcher" without searching Saphi modding → search platform-specific mods before making absolute claims about Saphi. (S5)
