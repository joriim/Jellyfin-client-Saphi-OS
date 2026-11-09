# Step-by-step guide: trying the client on your Saphi TV

This guide is for a home network with three things on it:

- your **PC** (Windows, macOS or Linux);
- your **Jellyfin server** (on its own machine, a NAS, or on the same PC);
- your **Philips Saphi TV** (for example the 55OLED754/12).

You will run a small program on the PC that sits between the TV and Jellyfin.
The TV then opens the Saphi client from the PC. Nothing is installed on the TV
or changed on the Jellyfin server. This takes about 30–45 minutes the first time.

```
  TV browser ──► PC (tools/devserver.py, port 8000) ──► Jellyfin server (port 8096)
```

The PC must stay on while you use the TV this way. Part 7 shows how to install
the client on the Jellyfin server itself, so the PC is no longer needed.

---

## Part 1. Check what you need

**On the PC:**

- [ ] **Python 3.8 or newer.**
  - *Windows:* open **Command Prompt** (Start → type `cmd` → Enter) and run
    `py --version`. If it is not found, install Python from
    <https://www.python.org/downloads/>. On the installer's first screen, tick
    **"Add python.exe to PATH"**, then click **Install Now**. Close the
    Command Prompt and open a new one afterwards.
  - *macOS:* open **Terminal** and run `python3 --version`. If it asks to
    install developer tools, accept.
  - *Linux:* `python3 --version` (preinstalled on most distributions).
- [ ] **Nothing else.** No Node.js, Docker or ffmpeg is needed for the TV test.

**Jellyfin:**

- [ ] **Its address.** It is usually `http://<server-ip>:8096`. To find it:
  open Jellyfin in a web browser on the PC and look at the address bar. Or
  look in the Jellyfin **Dashboard → Networking** page.
  If Jellyfin runs on the PC itself, the address is `http://localhost:8096`.
- [ ] **A user name and password** that can sign in to it.
- [ ] **Quick Connect** (optional; it saves typing a password with the remote):
  **Dashboard → General → "Enable Quick Connect"** must be ticked. It is on by
  default in Jellyfin 10.9 and newer.

**Network:**

- [ ] The TV and the PC are on the **same network**. Not a guest Wi-Fi: guest
  networks usually block devices from reaching each other.

> Write down: Jellyfin address `http://_______________:8096`

---

## Part 2. Get the code onto the PC

The work is on the branch `ccr-510dfa11-xgoqxi` of
`joriim/Jellyfin-client-Saphi-OS`. Choose one of these:

**A. Download a ZIP (no Git needed)**

1. Open the repository on GitHub in the PC's browser.
2. Click the branch menu (it says `main`) and choose **`ccr-510dfa11-xgoqxi`**.
3. Click the green **Code** button → **Download ZIP**.
4. Unzip it somewhere easy, for example `C:\saphi` or `~/saphi`.
   The folder inside is named something like `Jellyfin-client-Saphi-OS-ccr-510dfa11-xgoqxi`.
   You should see `app`, `docs`, `probe`, `tools` and `README.md` in it.

**B. With Git**

```sh
git clone -b ccr-510dfa11-xgoqxi https://github.com/joriim/Jellyfin-client-Saphi-OS.git
cd Jellyfin-client-Saphi-OS
```

---

## Part 3. Find the PC's IP address

The TV needs the PC's address on your network, for example `192.168.1.20`.

- *Windows:* in Command Prompt, run `ipconfig`. Under your active adapter
  ("Wireless LAN adapter Wi-Fi" or "Ethernet adapter"), read **IPv4 Address**.
- *macOS:* **System Settings → Network → (your connection) → Details →
  TCP/IP → IP address**. Or in Terminal: `ipconfig getifaddr en0`.
- *Linux:* `hostname -I` (the first address).

It normally starts with `192.168.`, `10.` or `172.16`–`172.31`.

The dev server also prints the address it thinks is right when it starts
(Part 4).

> Write down: PC address `_______________`

---

## Part 4. Start the dev server on the PC

1. Open Command Prompt / Terminal **in the project folder**:
   - *Windows:* open the folder in File Explorer, click the address bar, type
     `cmd` and press Enter.
   - *macOS/Linux:* `cd` into the folder.
2. Run it with your Jellyfin address:

   *Windows:*
   ```bat
   py tools\devserver.py --jellyfin http://192.168.1.10:8096
   ```
   *macOS / Linux:*
   ```sh
   python3 tools/devserver.py --jellyfin http://192.168.1.10:8096
   ```
   Replace `192.168.1.10:8096` with your Jellyfin address. If Jellyfin is on the
   same PC, use `http://localhost:8096`.

3. You should see:
   ```
   Probe:        http://192.168.1.20:8000/probe/
   Saphi client: http://192.168.1.20:8000/  (opens /web/saphi/)
   jellyfin-web: http://192.168.1.20:8000/web/  (proxying http://192.168.1.10:8096, shell injected)
   Logs:         ...\logs
   ```
4. **Windows Firewall** may ask whether Python may communicate on networks.
   Allow it on **Private networks**. If you clicked Cancel by mistake, see
   *Troubleshooting → The TV cannot open the page*.
5. **Leave this window open.** Closing it stops the server. Each request the TV
   makes shows up here as a line, which is useful for seeing that it is working.

**Check from the PC first.** Open these in the PC's own browser, using the PC
address from Part 3:

- `http://192.168.1.20:8000/probe/`: a black page titled "Saphi capability probe".
- `http://192.168.1.20:8000/`: the Jellyfin connect screen of the Saphi client.
  Press **Enter** to connect, and you should get to the sign-in screen.
  You can sign in and click around with the keyboard: arrows, Enter, and Escape
  for Back. That proves the PC → Jellyfin part works before you involve the TV.

If port 8000 is already used by something else, add `--port 8090` to the
command and use `:8090` everywhere below.

---

## Part 5. Run the probe on the TV (please do this first)

The probe page reports what the TV's browser can do: its engine, JavaScript
level, which video formats it says it can play, and the code of every remote
button. The results are saved on the PC automatically. This is the most
useful information for the next round of fixes.

1. **Open the TV's browser.** Press the **Home** button on the remote and
   look in the apps for **"Internet browser"** (sometimes "Web browser" or
   "Browser"). On some models it is under **Apps → All apps**.
2. Select the address bar and type, with the on-screen keyboard:
   `192.168.1.20:8000/probe/`
   (your PC address; `http://` is optional).
3. The page shows a table. At the top, the line under "Press remote keys"
   should say **"Results sent (0 keys)"** in green. On the PC, the window
   prints `probe results saved to logs/probe-….json`.
4. **Press every button on the remote, once each, slowly**, and watch the
   yellow text change. In this order:
   - ▲ ▼ ◄ ► (arrows) and **OK**;
   - **Back** (if the browser goes back to the previous page, open the probe
     again and continue with the other keys);
   - **Play, Pause, Play/Pause, Stop, Rewind ◄◄, Fast forward ►►,
     Previous |◄◄, Next ►►|**, whichever your remote has;
   - the four **colour keys**: red, green, yellow, blue;
   - **Info / i, Options, List, Channel +/−, Menu**, and the number keys **0–9**;
   - Don't press **Home** or **Source**: they leave the browser.
5. The status line updates to "Results sent (N keys)" a second after each press.
6. **Take a photo of the table** on the TV as well (a backup in case saving
   fails).

The file is saved as `logs/probe-<id>.json` in the project folder on the PC.
Each time you open the probe makes a new file.

---

## Part 6. Try the Saphi client on the TV

1. In the TV's browser, go to `192.168.1.20:8000` (your PC address).
   It opens the client at `/web/saphi/`.
2. **Bookmark it now**, so next time is one click: use the browser's menu
   (often the **Options** key or a ☆ icon). Saphi cannot install apps, so this
   bookmark is your "app".
3. **Connect screen.** The server address is already filled in (it is your
   PC's address, because the PC passes everything on to Jellyfin). The
   **Connect** button is highlighted: press **OK**.
4. **Sign in.** Choose one:
   - **Quick Connect (easiest):** a 6-digit code appears in large numbers. On
     your phone or PC, open Jellyfin, go to your **profile picture → Quick
     Connect**, type the code and approve. Within about 5 seconds the TV opens
     Home.
   - **Password:** the user name field is highlighted. Press **OK** to open it
     (the TV's keyboard appears), type, and confirm. Press **▼** to the password
     field, **OK**, type, confirm. Then highlight **Sign in** and press **OK**.
5. **Home** shows rows: Continue Watching, Next Up, My Media, and Latest per
   library. Arrows move; **OK** opens; **Back** returns.
6. **Play something.** Open a movie → **Play**. In the player:

   | Key | Does |
   |---|---|
   | OK or Play/Pause | Pause / resume |
   | ◄ / ► (or ◄◄ / ►►) | Back 10 s / forward 30 s. Press several times to jump further; it seeks when you stop pressing |
   | ▲ / ▼ / Info | Show the controls |
   | Back | First hides the controls; press again to stop and go back |
   | Stop | Stop and go back |

   The middle of the bottom bar says **Direct play**, **Direct stream** or
   **Transcoding**. Note which one each video uses.
7. **Exit:** on Home, press **Back** (it jumps to the top row), then press
   **Back** twice quickly.

### Things to test and note

Copy this list and tick or note each item:

- [ ] The client loads on the TV (no blank or black page)
- [ ] Arrows, OK and Back work everywhere. **Back is the most important one**
- [ ] Scrolling along rows and down Home feels smooth enough (or slow?)
- [ ] Posters and pictures appear
- [ ] Quick Connect sign-in works
- [ ] Password sign-in works (the TV keyboard opens in the fields)
- [ ] After closing and reopening the browser, you are still signed in
- [ ] A movie plays. Which method does it show (Direct play / Transcoding)?
- [ ] An H.264 MP4 file plays with **Direct play**
- [ ] An MKV file plays (direct or transcoded?)
- [ ] An HEVC/4K file plays (direct or transcoded?)
- [ ] Sound works; 5.1 sound if you have it
- [ ] Pause, seeking forward and back, Stop
- [ ] After stopping, the movie shows **Resume from …**, and Continue Watching
      has it on Home
- [ ] Playing a TV episode to the end starts the next episode
- [ ] Media keys on the remote (Play, Pause, Stop, ◄◄, ►►) work in the player
- [ ] Anything else odd: write down what you pressed and what happened

### Turn on the debug log (when something goes wrong)

1. On Home, go to the top row (**▲**) → **Settings** → **OK**.
2. Highlight **Debug log** and press **OK** so it says **On**.
3. From now on the TV sends its log to the PC, into `logs/tv.log` (it also
   scrolls past in the PC window). Every key press is logged with its code.
4. With Debug log on, the **blue** key shows the log on the TV screen; press
   blue again to hide it.

In Settings you can also see **Playback capabilities**: the formats the TV's
browser says it plays. And you can lower **Maximum streaming bitrate** if
playback stutters over Wi-Fi.

---

## Part 7 (optional). Install the client on the Jellyfin server

When the client works through the PC, you can put it on the Jellyfin server
itself. The TV then opens it directly, and the PC can be off.

Copy the project's **`app`** folder into Jellyfin's **web folder**, named
**`saphi`**:

| Jellyfin install | Copy `app` to |
|---|---|
| Windows | `C:\Program Files\Jellyfin\Server\jellyfin-web\saphi` |
| Debian / Ubuntu package | `/usr/share/jellyfin/web/saphi` |
| Docker `jellyfin/jellyfin` | mount to `/jellyfin/jellyfin-web/saphi` (see below) |
| Docker linuxserver/jellyfin | mount to `/usr/share/jellyfin/web/saphi` |

*Linux package:*
```sh
sudo cp -r app /usr/share/jellyfin/web/saphi
```
*Docker Compose:* add a volume to your Jellyfin service, then
`docker compose up -d`:
```yaml
    volumes:
      - /path/to/Jellyfin-client-Saphi-OS/app:/jellyfin/jellyfin-web/saphi:ro
```

Then open `http://<jellyfin-ip>:8096/web/saphi/` **on the PC first** to check
it loads. Then open it on the TV and bookmark it in place of the PC address.
You will need to sign in again, because the address changed.

With a package install (not Docker), a Jellyfin upgrade may replace the web
folder. Copy the folder again after upgrading.

---

## Part 8 (optional). The jellyfin-web experiment (Option A)

This is the standard Jellyfin web interface with a small TV adapter added. It
shows whether jellyfin-web itself is usable on the TV, which is useful to
know. While the dev server is running, open on the TV:

`192.168.1.20:8000/web/index.html?saphi-debug=1`

Note: does it load at all, how long it takes, whether it switches to the TV
layout, and how smooth it is. Logs go to `logs/tv.log` as well.

---

## Part 9. Send the results back

From the project folder on the PC, send:

1. **`logs/probe-*.json`**: all of the probe files (the most important).
2. **`logs/tv.log`**, if you turned on Debug log.
3. Your filled-in **checklist** from Part 6.
4. **Photos**: the probe table, and any error messages on the TV.
5. Your **Jellyfin version** (Dashboard → General).
6. Examples of **files that did not play**: the container and codecs
   (Jellyfin → the item → ⋮ → **Media info**).

---

## Troubleshooting

**The TV cannot open the page (it times out or says it cannot connect).**
- First check the same address works in the PC's own browser (Part 4).
- Check the TV and PC are on the same network: in the TV's network settings,
  the TV's IP should start like the PC's (for example both `192.168.1.x`).
- *Windows Firewall:* **Start → "Allow an app through Windows Firewall" →
  Change settings**. Find **Python** and tick **Private**. If Python is not in
  the list, click **Allow another app** and browse to `python.exe`. Also check
  the PC's network is set to **Private**, not Public (**Settings → Network &
  Internet → (your connection) → Network profile type**).
- *macOS:* **System Settings → Network → Firewall → Options**: allow incoming
  connections for Python.
- Third-party antivirus firewalls can block it too. Allow Python or port 8000.
- A guest Wi-Fi or a router with "AP isolation" or "client isolation" blocks
  devices from reaching each other. Use the main network.

**The PC window says `jellyfin unreachable` or the Connect screen says it
cannot reach the server.**
- The `--jellyfin` address is wrong or Jellyfin is not running. Check it
  opens in the PC's browser. Don't add `/web` to the end.

**`py` / `python3` is not recognised.**
- Python is not installed or not on PATH. Reinstall with "Add python.exe to
  PATH" ticked, then open a new Command Prompt. On Windows, `python` may work
  where `py` doesn't.

**`Address already in use` / port 8000 busy.**
- Add `--port 8090` (any free port) and use that port on the TV.

**The probe says "Results not sent".**
- The page was not opened through the dev server (for example as a file).
  Open it from `http://<pc-ip>:8000/probe/`. Take a photo instead if it
  still fails.

**The client page is blank or black on the TV.**
- The TV's browser could not run the code. That is important to know: send
  the probe file and a photo. The probe's "userAgent" line tells which engine
  it is.

**A button on the remote does nothing in the client (especially Back).**
- Expected for some keys until the probe results are in. Turn on Debug log,
  press the key, and send `logs/tv.log`: it records the key code. Meanwhile
  the keyboard keys of a USB keyboard plugged into the TV also work (arrows,
  Enter, Escape = Back).

**A video doesn't start, shows an error, or has no picture.**
- Note what the bottom bar says (Direct play / Transcoding) and the error text.
- If direct play fails, the client asks the server to transcode automatically
  ("Cannot play this format directly. Transcoding…").
- If transcoding fails too, check Jellyfin's **Dashboard → Playback →
  Transcoding** settings, and the server log (Dashboard → Logs).

**Playback stutters.**
- Settings → **Maximum streaming bitrate** → try 10 Mbps. Over Wi-Fi, 4K
  direct play may be too much. Through the PC, the video also travels via the
  PC; installing on the server (Part 7) removes that hop.

**Signed out every time the browser closes.**
- The TV browser may not keep stored data. Note it in your results (the probe
  shows `localStorage`).

**The client looks wrong (cut off or too small).**
- Send a photo, and the probe's "screen" line.
