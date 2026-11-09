#!/usr/bin/env python3
"""A fake Jellyfin server for developing and testing the Saphi client.

Implements only the API the client uses, over a small generated library
(two movies, one series with two seasons). Images are SVG placeholders;
videos are short test clips made with ffmpeg on first use (WebM/VP8, which
open-source Chromium can play, and MP4/H.264).

It also serves the client at /web/saphi/ (the same path as installing it into
a real server's web folder) and records what the client reports, at
/_test/state, for the end-to-end tests.

  python3 tools/fakejellyfin.py --port 8096
  # open http://localhost:8096/web/saphi/   user "demo", password "demo"

Standard library only (plus ffmpeg on PATH for the clips).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import uuid
import http.server
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")
TICKS = 10_000_000
SERVER_ID = "f00dfeedf00dfeedf00dfeedf00dfeed"
USER = {"Id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", "Name": "demo"}
PASSWORD = "demo"


def gid(name):
    return uuid.uuid5(uuid.NAMESPACE_URL, "fake-jellyfin/" + name).hex


def build_library():
    items = {}

    def add(item):
        items[item["Id"]] = item
        return item

    movies = add({"Id": gid("view-movies"), "Name": "Movies", "Type": "CollectionFolder", "CollectionType": "movies",
                  "ImageTags": {"Primary": "v1"}, "IsFolder": True})
    shows = add({"Id": gid("view-shows"), "Name": "Shows", "Type": "CollectionFolder", "CollectionType": "tvshows",
                 "ImageTags": {"Primary": "v1"}, "IsFolder": True})
    for i, (name, year, clip) in enumerate([("Big Test Movie", 2019, "webm"), ("The H.264 Story", 2021, "mp4")]):
        add({"Id": gid("movie-%d" % i), "Name": name, "Type": "Movie", "MediaType": "Video", "ParentId": movies["Id"],
             "ProductionYear": year, "RunTimeTicks": 12 * TICKS, "Overview": "A short test clip, %s." % clip,
             "OfficialRating": "PG", "CommunityRating": 7.5 + i, "Genres": ["Test", "Drama"],
             "ImageTags": {"Primary": "p1"}, "BackdropImageTags": ["b1"], "Clip": clip,
             "UserData": {"PlaybackPositionTicks": 0, "Played": False, "PlayedPercentage": 0}})
    series = add({"Id": gid("series"), "Name": "Test Series", "Type": "Series", "ParentId": shows["Id"],
                  "ProductionYear": 2020, "Overview": "Two seasons of test clips.", "IsFolder": True,
                  "ImageTags": {"Primary": "p1"}, "BackdropImageTags": ["b1"],
                  "UserData": {"UnplayedItemCount": 6, "Played": False}})
    for s in (1, 2):
        season = add({"Id": gid("season-%d" % s), "Name": "Season %d" % s, "Type": "Season", "IndexNumber": s,
                      "SeriesId": series["Id"], "SeriesName": series["Name"], "ParentId": series["Id"],
                      "ImageTags": {"Primary": "p1"}, "IsFolder": True, "UserData": {"Played": False}})
        for e in (1, 2, 3):
            add({"Id": gid("ep-%d-%d" % (s, e)), "Name": "Episode %d" % e, "Type": "Episode", "MediaType": "Video",
                 "IndexNumber": e, "ParentIndexNumber": s, "SeasonId": season["Id"], "SeasonName": season["Name"],
                 "SeriesId": series["Id"], "SeriesName": series["Name"], "ParentId": season["Id"],
                 "RunTimeTicks": 12 * TICKS, "Overview": "Episode %d of season %d." % (e, s),
                 "ImageTags": {"Primary": "p1"}, "SeriesPrimaryImageTag": "p1",
                 "ParentBackdropItemId": series["Id"], "ParentBackdropImageTags": ["b1"], "Clip": "webm",
                 "UserData": {"PlaybackPositionTicks": 0, "Played": False, "PlayedPercentage": 0}})
    return items


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.items = build_library()
        self.tokens = {}
        self.qc = {}  # secret -> {"code", "approved", "polls"}
        self.reports = []  # (kind, body)
        self.playback_requests = []
        self.qc_auto_approve_after = None  # polls; None = only via /_test/approve
        self.clip_dir = tempfile.mkdtemp(prefix="fakejf-")
        self.clips = {}

    def clip(self, kind):
        with self.lock:
            if kind in self.clips:
                return self.clips[kind]
            path = os.path.join(self.clip_dir, "clip." + kind)
            if kind == "webm":
                args = ["-c:v", "libvpx", "-b:v", "300k", "-c:a", "libvorbis"]
            else:
                args = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"]
            cmd = ["ffmpeg", "-loglevel", "error", "-y",
                   "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=12",
                   "-f", "lavfi", "-i", "sine=frequency=440:duration=12"] + args + ["-shortest", path]
            subprocess.run(cmd, check=True)
            self.clips[kind] = path
            return path


STATE = State()


def public(item):
    return {k: v for k, v in item.items() if k != "Clip"}


def svg(text, w, h, hue):
    text = re.sub(r"[<>&\"]", "", text)[:40]
    return ("<svg xmlns='http://www.w3.org/2000/svg' width='%d' height='%d' viewBox='0 0 %d %d'>"
            "<rect width='100%%' height='100%%' fill='hsl(%d,45%%,30%%)'/>"
            "<text x='50%%' y='50%%' fill='white' font-family='sans-serif' font-size='%d' "
            "text-anchor='middle' dominant-baseline='middle'>%s</text></svg>"
            % (w, h, w, h, hue, max(14, w // 12), text)).encode()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "FakeJellyfin/10.11"

    # ------------------------------------------------------------ plumbing
    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_empty(self, status=204):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def body_json(self):
        try:
            return json.loads(self._body or b"{}")
        except ValueError:
            return {}

    def auth_token(self):
        h = self.headers.get("Authorization", "") or self.headers.get("X-Emby-Authorization", "")
        m = re.search(r'Token="([^"]+)"', h)
        if m:
            return m.group(1)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        return (q.get("api_key") or q.get("ApiKey") or [None])[0]

    def authed(self):
        if self.auth_token() in STATE.tokens:
            return True
        self.send_json({"error": "unauthorized"}, 401)
        return False

    def log_message(self, fmt, *args):
        if not os.environ.get("SAPHI_QUIET"):
            sys.stderr.write("fakejf %s\n" % (fmt % args))

    # ------------------------------------------------------------ routing
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Emby-Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.route("GET")

    def do_HEAD(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        # Always consume the body, so keep-alive connections stay in sync.
        n = int(self.headers.get("Content-Length") or 0)
        self._body = self.rfile.read(n) if n else b""
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        # Case-insensitive query keys, as ASP.NET does.
        q = {k.lower(): v for k, v in q.items()}

        if path in ("/", "/web", "/web/"):
            self.send_response(302)
            self.send_header("Location", "/web/saphi/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path.startswith("/web/saphi/") or path == "/web/saphi":
            return self.static(path[len("/web/saphi/"):] if path != "/web/saphi" else "")
        if path == "/tv/log" and method == "POST":
            self.body_json()
            return self.send_empty()
        if path.startswith("/_test/"):
            return self.test_api(method, path, q)

        # Public endpoints
        if path == "/System/Info/Public":
            return self.send_json({"Id": SERVER_ID, "ServerName": "Fake Jellyfin", "Version": "10.11.0",
                                   "ProductName": "Jellyfin Server", "StartupWizardCompleted": True})
        if path == "/Users/AuthenticateByName" and method == "POST":
            b = self.body_json()
            if b.get("Username") == USER["Name"] and b.get("Pw") == PASSWORD:
                return self.send_json(self.new_session())
            return self.send_json({"error": "bad credentials"}, 401)
        if path == "/QuickConnect/Enabled":
            return self.send_json(True)
        if path == "/QuickConnect/Initiate" and method == "POST":
            secret = uuid.uuid4().hex
            code = "%06d" % (int(secret[:8], 16) % 1000000)
            STATE.qc[secret] = {"code": code, "approved": False, "polls": 0}
            return self.send_json({"Secret": secret, "Code": code, "Authenticated": False})
        if path == "/QuickConnect/Connect":
            entry = STATE.qc.get(q.get("secret", ""))
            if not entry:
                return self.send_json({"error": "unknown secret"}, 404)
            entry["polls"] += 1
            if STATE.qc_auto_approve_after is not None and entry["polls"] >= STATE.qc_auto_approve_after:
                entry["approved"] = True
            return self.send_json({"Secret": q["secret"], "Code": entry["code"], "Authenticated": entry["approved"]})
        if path == "/Users/AuthenticateWithQuickConnect" and method == "POST":
            entry = STATE.qc.get(self.body_json().get("Secret", ""))
            if entry and entry["approved"]:
                return self.send_json(self.new_session())
            return self.send_json({"error": "not approved"}, 401)

        m = re.match(r"^/Items/([0-9a-f]+)/Images/(\w+)(?:/\d+)?$", path)
        if m:
            item = STATE.items.get(m.group(1))
            if not item:
                return self.send_empty(404)
            w = int(q.get("fillwidth") or 400)
            h = int(q.get("fillheight") or 600)
            body = svg(item["Name"], w, h, int(m.group(1)[:2], 16) * 360 // 256)
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        m = re.match(r"^/Videos/([0-9a-f]+)/(stream(?:\.\w+)?|transcode\.webm)$", path)
        if m:
            if not self.authed():
                return
            item = STATE.items.get(m.group(1))
            if not item or "Clip" not in item:
                return self.send_empty(404)
            kind = "webm" if m.group(2) == "transcode.webm" else item["Clip"]
            return self.send_file(STATE.clip(kind), "video/webm" if kind == "webm" else "video/mp4")

        # Authenticated API
        if not self.authed():
            return
        if path == "/Users/Me":
            return self.send_json(USER)
        if path == "/Sessions/Logout" and method == "POST":
            STATE.tokens.pop(self.auth_token(), None)
            return self.send_empty()
        if path == "/UserViews":
            views = [public(i) for i in STATE.items.values() if i["Type"] == "CollectionFolder"]
            return self.send_json({"Items": views, "TotalRecordCount": len(views)})
        if path == "/UserItems/Resume":
            res = [public(i) for i in STATE.items.values()
                   if i.get("UserData", {}).get("PlaybackPositionTicks") and not i["UserData"].get("Played")]
            return self.send_json({"Items": res, "TotalRecordCount": len(res)})
        if path == "/Shows/NextUp":
            eps = sorted((i for i in STATE.items.values() if i["Type"] == "Episode"),
                         key=lambda e: (e["ParentIndexNumber"], e["IndexNumber"]))
            watched = [e for e in eps if e["UserData"].get("Played")]
            nxt = [e for e in eps if not e["UserData"].get("Played")]
            res = [public(nxt[0])] if watched and nxt else []
            return self.send_json({"Items": res, "TotalRecordCount": len(res)})
        if path == "/Items/Latest":
            parent = q.get("parentid")
            res = [public(i) for i in STATE.items.values()
                   if i.get("ParentId") == parent and i["Type"] in ("Movie", "Series")]
            return self.send_json(res)
        if path == "/Items":
            parent = q.get("parentid")
            types = (q.get("includeitemtypes") or "").split(",")
            res = [public(i) for i in STATE.items.values()
                   if (not parent or i.get("ParentId") == parent) and (not types[0] or i["Type"] in types)]
            res.sort(key=lambda i: i["Name"])
            start = int(q.get("startindex") or 0)
            limit = int(q.get("limit") or 100)
            return self.send_json({"Items": res[start:start + limit], "TotalRecordCount": len(res)})
        m = re.match(r"^/Items/([0-9a-f]+)$", path)
        if m:
            item = STATE.items.get(m.group(1))
            return self.send_json(public(item)) if item else self.send_empty(404)
        m = re.match(r"^/Shows/([0-9a-f]+)/Seasons$", path)
        if m:
            res = [public(i) for i in STATE.items.values() if i["Type"] == "Season" and i["SeriesId"] == m.group(1)]
            res.sort(key=lambda i: i["IndexNumber"])
            return self.send_json({"Items": res, "TotalRecordCount": len(res)})
        m = re.match(r"^/Shows/([0-9a-f]+)/Episodes$", path)
        if m:
            eps = [i for i in STATE.items.values() if i["Type"] == "Episode" and i["SeriesId"] == m.group(1)]
            eps.sort(key=lambda e: (e["ParentIndexNumber"], e["IndexNumber"]))
            if q.get("seasonid"):
                eps = [e for e in eps if e["SeasonId"] == q["seasonid"]]
            if q.get("startitemid"):
                ids = [e["Id"] for e in eps]
                if q["startitemid"] in ids:
                    eps = eps[ids.index(q["startitemid"]):]
            if q.get("limit"):
                eps = eps[:int(q["limit"])]
            res = [public(e) for e in eps]
            return self.send_json({"Items": res, "TotalRecordCount": len(res)})
        m = re.match(r"^/Items/([0-9a-f]+)/PlaybackInfo$", path)
        if m and method == "POST":
            return self.playback_info(m.group(1), self.body_json())
        if path in ("/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped") and method == "POST":
            body = self.body_json()
            STATE.reports.append((path.rsplit("/", 1)[-1], body))
            item = STATE.items.get(body.get("ItemId", ""))
            if item and "UserData" in item:
                pos = body.get("PositionTicks") or 0
                item["UserData"]["PlaybackPositionTicks"] = pos
                if path.endswith("Stopped") and item.get("RunTimeTicks") and pos >= item["RunTimeTicks"] * 0.9:
                    item["UserData"].update({"Played": True, "PlaybackPositionTicks": 0, "PlayedPercentage": 0})
                elif item.get("RunTimeTicks"):
                    item["UserData"]["PlayedPercentage"] = 100.0 * pos / item["RunTimeTicks"]
            return self.send_empty()
        if path == "/Videos/ActiveEncodings" and method == "DELETE":
            STATE.reports.append(("StopEncoding", q))
            return self.send_empty()
        m = re.match(r"^/UserPlayedItems/([0-9a-f]+)$", path)
        if m:
            item = STATE.items.get(m.group(1))
            if not item:
                return self.send_empty(404)
            item.setdefault("UserData", {})["Played"] = method == "POST"
            item["UserData"]["PlaybackPositionTicks"] = 0
            return self.send_json(item["UserData"])
        return self.send_json({"error": "not implemented in fake: %s %s" % (method, path)}, 404)

    # ------------------------------------------------------------ handlers
    def new_session(self):
        token = uuid.uuid4().hex
        STATE.tokens[token] = USER["Id"]
        return {"AccessToken": token, "User": USER, "ServerId": SERVER_ID,
                "SessionInfo": {"DeviceId": re.search(r'DeviceId="([^"]*)"', self.headers.get("Authorization", "")).group(1)}}

    def playback_info(self, item_id, body):
        item = STATE.items.get(item_id)
        if not item or "Clip" not in item:
            return self.send_json({"ErrorCode": "NoCompatibleStream"})
        STATE.playback_requests.append(body)
        profile = body.get("DeviceProfile") or {}
        container = item["Clip"]
        vcodec = "vp8" if container == "webm" else "h264"
        direct = False
        if body.get("EnableDirectPlay", True):
            for p in profile.get("DirectPlayProfiles", []):
                if p.get("Type") == "Video" and container in p.get("Container", "").split(",") \
                        and vcodec in (p.get("VideoCodec") or vcodec).split(","):
                    direct = True
        play_session = uuid.uuid4().hex
        source = {"Id": item_id, "Protocol": "File", "Container": container, "ETag": "etag1",
                  "RunTimeTicks": item["RunTimeTicks"], "SupportsDirectPlay": direct,
                  "SupportsDirectStream": direct, "SupportsTranscoding": True,
                  "DefaultAudioStreamIndex": 1,
                  "MediaStreams": [{"Type": "Video", "Codec": vcodec, "Index": 0},
                                   {"Type": "Audio", "Codec": "vorbis" if container == "webm" else "aac", "Index": 1}]}
        if not direct:
            source["TranscodingUrl"] = ("/Videos/%s/transcode.webm?MediaSourceId=%s&PlaySessionId=%s&StartTimeTicks=%s&ApiKey=%s"
                                        % (item_id, item_id, play_session, body.get("StartTimeTicks") or 0,
                                           self.auth_token()))
            source["TranscodingSubProtocol"] = "http"
            source["TranscodingContainer"] = "webm"
        return self.send_json({"MediaSources": [source], "PlaySessionId": play_session})

    def test_api(self, method, path, q):
        if path == "/_test/state":
            return self.send_json({"reports": STATE.reports, "playback": STATE.playback_requests,
                                   "qc": STATE.qc, "tokens": len(STATE.tokens)})
        if path == "/_test/approve":
            for entry in STATE.qc.values():
                entry["approved"] = True
            return self.send_json({"ok": True})
        if path == "/_test/reset":
            STATE.items = build_library()
            STATE.reports = []
            STATE.playback_requests = []
            STATE.qc = {}
            return self.send_json({"ok": True})
        return self.send_empty(404)

    def static(self, rel):
        rel = urllib.parse.unquote(rel) or "index.html"
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        if not full.startswith(os.path.realpath(APP_DIR) + os.sep) or not os.path.isfile(full):
            return self.send_empty(404)
        ctype = {".html": "text/html", ".js": "application/javascript", ".css": "text/css",
                 ".svg": "image/svg+xml", ".png": "image/png"}.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text", "application/j")) else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_file(self, path, ctype):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        status = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                status = 206
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8096)
    ap.add_argument("--auto-approve", type=int, default=None, metavar="N",
                    help="approve Quick Connect codes after N polls")
    args = ap.parse_args()
    if not shutil.which("ffmpeg"):
        print("warning: ffmpeg not found, playback will fail", file=sys.stderr)
    STATE.qc_auto_approve_after = args.auto_approve
    srv = Server((args.host, args.port), Handler)
    print("Fake Jellyfin on http://localhost:%d/web/saphi/  (user demo / password demo)" % args.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(STATE.clip_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
