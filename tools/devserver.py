#!/usr/bin/env python3
"""Development server for the Saphi client. Python 3.8+ standard library only.

Serves:
  /probe/...      the capability probe (probe/)
  /tv/...         the Saphi shell (shell/)
  POST /tv/log    log entries from the TV  -> logs/tv.log
  POST /tv/probe-results  probe results from the TV -> logs/probe-<time>.json

With --jellyfin URL it also reverse-proxies everything else to that Jellyfin
server and injects the Saphi shell into jellyfin-web's index.html, so the TV
can open http://<this-pc>:8000/web/ and get jellyfin-web with the shell.
WebSocket upgrades (/socket) are tunnelled through.

  python3 tools/devserver.py --jellyfin http://192.168.1.10:8096
"""

import argparse
import datetime
import http.client
import http.server
import json
import mimetypes
import os
import select
import socket
import socketserver
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = {
    "/probe/": os.path.join(ROOT, "probe"),
    "/tv/": os.path.join(ROOT, "shell"),
}
INJECT = b'<script src="/tv/config.js"></script><script src="/tv/saphi.js"></script>'
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}
MAX_BODY = 5 * 1024 * 1024


def inject_shell(html):
    """Insert the shell scripts before </head> (or at the start if missing)."""
    if b'src="/tv/saphi.js"' in html:
        return html
    idx = html.lower().find(b"</head>")
    if idx == -1:
        return INJECT + html
    return html[:idx] + INJECT + html[idx:]


def is_web_index(path):
    p = urllib.parse.urlsplit(path).path.lower()
    return p in ("/web/", "/web/index.html", "/web")


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "SaphiDev/0.1"
    protocol_version = "HTTP/1.1"
    jellyfin = None  # urllib.parse.SplitResult
    log_dir = os.path.join(ROOT, "logs")

    # ------------------------------------------------------------ dispatch

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/tv/log":
            return self._save_log()
        if path == "/tv/probe-results":
            return self._save_probe()
        self._dispatch()

    do_PUT = do_DELETE = do_OPTIONS = do_PATCH = do_POST

    def _dispatch(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/":
            return self._redirect("/web/" if self.jellyfin else "/probe/")
        for prefix, directory in STATIC.items():
            if path == prefix.rstrip("/"):
                return self._redirect(prefix)
            if path.startswith(prefix):
                return self._static(directory, path[len(prefix):])
        if self.jellyfin:
            return self._proxy()
        self._send(404, b"not found\n", "text/plain")

    # ------------------------------------------------------------ helpers

    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _redirect(self, location):
        self._send(302, b"", "text/plain", {"Location": location})

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        return self.rfile.read(length) if length else b""

    def _static(self, directory, rel):
        rel = urllib.parse.unquote(rel) or "index.html"
        full = os.path.realpath(os.path.join(directory, rel))
        if not full.startswith(os.path.realpath(directory) + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found\n", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    def _append(self, name, text):
        os.makedirs(self.log_dir, exist_ok=True)
        with open(os.path.join(self.log_dir, name), "a", encoding="utf-8") as f:
            f.write(text)

    def _save_log(self):
        try:
            data = json.loads(self._read_body() or b"{}")
        except ValueError:
            return self._send(400, b"bad json\n", "text/plain")
        lines = []
        for e in data.get("entries", []):
            ts = datetime.datetime.fromtimestamp(e.get("t", 0) / 1000).strftime("%H:%M:%S.%f")[:-3]
            lines.append("%s %-5s %s\n" % (ts, e.get("level", "log"), e.get("msg", "")))
        text = "".join(lines)
        self._append("tv.log", text)
        sys.stdout.write(text)
        self._send(204, b"", "text/plain")

    def _save_probe(self):
        try:
            data = json.loads(self._read_body() or b"{}")
        except ValueError:
            return self._send(400, b"bad json\n", "text/plain")
        run = str(data.get("id", ""))
        if not (run.isascii() and run.isalnum()) or len(run) > 32:
            run = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        name = "probe-%s.json" % run  # one file per page load, rewritten as keys come in
        os.makedirs(self.log_dir, exist_ok=True)
        with open(os.path.join(self.log_dir, name), "w", encoding="utf-8") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print("probe results saved to logs/%s" % name)
        self._send(200, json.dumps({"saved": name}).encode(), "application/json")

    # ------------------------------------------------------------ proxy

    def _upstream_headers(self):
        headers = {}
        for k, v in self.headers.items():
            if k.lower() in HOP_BY_HOP or k.lower() == "host":
                continue
            headers[k] = v
        headers["Host"] = self.jellyfin.netloc
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["X-Forwarded-Host"] = self.headers.get("Host", "")
        headers["X-Forwarded-Proto"] = "http"
        if is_web_index(self.path):
            # Plain, uncached HTML is needed to inject into.
            for k in list(headers):
                if k.lower() in ("if-none-match", "if-modified-since", "accept-encoding"):
                    headers.pop(k)
        return headers

    def _connect(self):
        j = self.jellyfin
        cls = http.client.HTTPSConnection if j.scheme == "https" else http.client.HTTPConnection
        return cls(j.hostname, j.port or (443 if j.scheme == "https" else 80), timeout=60)

    def _proxy(self):
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._tunnel()
        try:
            body = self._read_body()
        except ValueError:
            return self._send(413, b"too large\n", "text/plain")
        conn = self._connect()
        try:
            conn.request(self.command, self.path, body=body or None, headers=self._upstream_headers())
            resp = conn.getresponse()
        except OSError as e:
            conn.close()
            return self._send(502, ("jellyfin unreachable: %s\n" % e).encode(), "text/plain")

        try:
            if is_web_index(self.path) and resp.status == 200:
                html = inject_shell(resp.read())
                extra = {k: v for k, v in resp.getheaders()
                         if k.lower() not in HOP_BY_HOP | {"content-length", "content-type", "etag", "last-modified"}}
                return self._send(200, html, resp.getheader("Content-Type", "text/html"), extra)

            self.send_response(resp.status, resp.reason)
            unsized = resp.getheader("Content-Length") is None and self.command != "HEAD" \
                and resp.status not in (204, 304)
            chunked = unsized and self.request_version == "HTTP/1.1"
            if unsized and not chunked:
                self.close_connection = True  # HTTP/1.0: the end of the body is the close
            for k, v in resp.getheaders():
                if k.lower() not in HOP_BY_HOP:
                    self.send_header(k, v)
            if chunked:
                self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            if self.command == "HEAD":
                return
            while True:
                chunk = resp.read1(64 * 1024) if hasattr(resp, "read1") else resp.read(64 * 1024)
                if not chunk:
                    break
                if chunked:
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                else:
                    self.wfile.write(chunk)
            if chunked:
                self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True  # the TV stopped reading (seek, stop)
        finally:
            conn.close()

    def _tunnel(self):
        j = self.jellyfin
        try:
            upstream = socket.create_connection((j.hostname, j.port or 80), timeout=10)
        except OSError:
            return self._send(502, b"jellyfin unreachable\n", "text/plain")
        lines = ["%s %s HTTP/1.1" % (self.command, self.path)]
        for k, v in self.headers.items():
            lines.append("%s: %s" % (k, j.netloc if k.lower() == "host" else v))
        upstream.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
        client = self.connection
        upstream.settimeout(None)
        client.settimeout(None)
        socks = [client, upstream]
        try:
            while True:
                readable, _, _ = select.select(socks, [], [], 300)
                if not readable:
                    break
                for s in readable:
                    data = s.recv(64 * 1024)
                    if not data:
                        return
                    (upstream if s is client else client).sendall(data)
        except OSError:
            pass
        finally:
            upstream.close()
            self.close_connection = True

    def log_message(self, fmt, *args):
        if os.environ.get("SAPHI_QUIET"):
            return
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(host, port, jellyfin=None, log_dir=None):
    attrs = {"jellyfin": urllib.parse.urlsplit(jellyfin.rstrip("/")) if jellyfin else None}
    if log_dir:
        attrs["log_dir"] = log_dir
    handler = type("BoundHandler", (Handler,), attrs)
    return Server((host, port), handler)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--jellyfin", help="Jellyfin server URL to proxy, e.g. http://192.168.1.10:8096")
    args = ap.parse_args()

    srv = make_server(args.host, args.port, args.jellyfin)
    ip = "<this-pc-ip>"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    print("Probe:        http://%s:%d/probe/" % (ip, args.port))
    if args.jellyfin:
        print("jellyfin-web: http://%s:%d/web/  (proxying %s, shell injected)" % (ip, args.port, args.jellyfin))
    print("Logs:         %s" % os.path.join(ROOT, "logs"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
