"""Tests for tools/devserver.py. Run with: python3 -m unittest discover tests"""

import gzip
import http.client
import http.server
import json
import os
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
os.environ["SAPHI_QUIET"] = "1"
import devserver  # noqa: E402

INDEX = b"<!DOCTYPE html><html><head><title>Jellyfin</title><script defer src=main.js></script></head><body></body></html>"


class FakeJellyfin(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    seen = []

    def do_GET(self):
        FakeJellyfin.seen.append((self.path, dict(self.headers)))
        if self.path.startswith("/web/index.html"):
            body = INDEX
            if "gzip" in self.headers.get("Accept-Encoding", ""):
                body = gzip.compress(body)
                extra = {"Content-Encoding": "gzip"}
            else:
                extra = {}
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("ETag", '"abc"')
            for k, v in extra.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/Videos/"):
            data = bytes(range(256)) * 4
            rng = self.headers.get("Range")
            if rng:
                start = int(rng.split("=")[1].split("-")[0])
                part = data[start:]
                self.send_response(206)
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, len(data) - 1, len(data)))
            else:
                part = data
                self.send_response(200)
            self.send_header("Content-Length", str(len(part)))
            self.end_headers()
            self.wfile.write(part)
        elif self.path == "/echo-headers":
            body = json.dumps(self.headers.get_all("Cookie") or []).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/System/Info/Public":
            # No Content-Length: forces the proxy to re-chunk.
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(b'{"ServerName":"fake"}')
            self.close_connection = True
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(INDEX)))
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serve(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


class DevServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = serve(devserver.Server(("127.0.0.1", 0), FakeJellyfin))
        cls.logdir = tempfile.mkdtemp()
        up = "http://127.0.0.1:%d" % cls.upstream.server_address[1]
        cls.proxy = serve(devserver.make_server("127.0.0.1", 0, up, cls.logdir))
        cls.port = cls.proxy.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.proxy.shutdown()
        cls.upstream.shutdown()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    def test_injects_shell_into_web_index(self):
        resp, body = self.request("GET", "/web/index.html", headers={"Accept-Encoding": "gzip", "If-None-Match": '"abc"'})
        self.assertEqual(resp.status, 200)
        self.assertIn(b'<script src="/tv/config.js"></script><script src="/tv/saphi.js"></script></head>', body)
        self.assertIsNone(resp.getheader("ETag"))
        _, headers = FakeJellyfin.seen[-1]
        self.assertEqual(headers.get("Accept-Encoding", "identity"), "identity")
        self.assertNotIn("If-None-Match", headers)

    def test_inject_is_idempotent_and_handles_missing_head(self):
        once = devserver.inject_shell(INDEX)
        self.assertEqual(devserver.inject_shell(once), once)
        self.assertTrue(devserver.inject_shell(b"<p>x</p>").startswith(devserver.INJECT))

    def test_serves_shell_and_probe(self):
        resp, body = self.request("GET", "/tv/saphi.js")
        self.assertEqual(resp.status, 200)
        self.assertIn(b"window.NativeShell", body)
        self.assertIn("javascript", resp.getheader("Content-Type"))
        resp, body = self.request("GET", "/probe/")
        self.assertEqual(resp.status, 200)
        self.assertIn(b"Saphi capability probe", body)

    def test_serves_saphi_client(self):
        resp, body = self.request("GET", "/web/saphi/")
        self.assertEqual(resp.status, 200)
        self.assertIn(b"JF.app.start", body)
        self.assertNotIn(b"/tv/saphi.js", body)  # the client is not jellyfin-web

    def test_static_rejects_path_traversal(self):
        resp, _ = self.request("GET", "/tv/..%2f..%2fREADME.md")
        self.assertEqual(resp.status, 404)

    def test_proxies_range_requests(self):
        resp, body = self.request("GET", "/Videos/1/stream?static=true", headers={"Range": "bytes=1000-"})
        self.assertEqual(resp.status, 206)
        self.assertEqual(len(body), 24)
        self.assertEqual(resp.getheader("Content-Range"), "bytes 1000-1023/1024")

    def test_proxies_unsized_body_and_post(self):
        resp, body = self.request("GET", "/System/Info/Public")
        self.assertEqual(json.loads(body), {"ServerName": "fake"})
        resp, body = self.request("POST", "/Sessions/Playing", body=b'{"a":1}',
                                  headers={"Content-Type": "application/json"})
        self.assertEqual(body, b'{"a":1}')

    def test_saves_logs_and_probe_results(self):
        entries = {"entries": [{"t": 0, "level": "warn", "msg": "hello tv"}]}
        resp, _ = self.request("POST", "/tv/log", body=json.dumps(entries))
        self.assertEqual(resp.status, 204)
        with open(os.path.join(self.logdir, "tv.log"), encoding="utf-8") as f:
            self.assertIn("warn  hello tv", f.read())

        resp, body = self.request("POST", "/tv/probe-results", body=json.dumps({"id": "abc123", "keys": [1]}))
        self.assertEqual(json.loads(body)["saved"], "probe-abc123.json")
        self.request("POST", "/tv/probe-results", body=json.dumps({"id": "abc123", "keys": [1, 2]}))
        with open(os.path.join(self.logdir, "probe-abc123.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["keys"], [1, 2])

        resp, body = self.request("POST", "/tv/probe-results", body=json.dumps({"id": "../../etc"}))
        self.assertNotIn("..", json.loads(body)["saved"])

    def test_head_on_web_index_passes_real_length(self):
        resp, body = self.request("HEAD", "/web/index.html")
        self.assertEqual(resp.status, 200)
        self.assertEqual(int(resp.getheader("Content-Length")), len(INDEX))

    def test_repeated_headers_are_kept(self):
        s = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        s.sendall(b"GET /echo-headers HTTP/1.1\r\nHost: x\r\nCookie: a=1\r\nCookie: b=2\r\nConnection: close\r\n\r\n")
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        self.assertEqual(json.loads(data.split(b"\r\n\r\n", 1)[1]), ["a=1", "b=2"])

    def test_oversized_body_gets_413_and_closes_connection(self):
        s = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        s.sendall(b"POST /Items HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\n\r\n" % (devserver.MAX_BODY + 1))
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break  # the server closed the connection
            data += chunk
        s.close()
        self.assertIn(b" 413 ", data.split(b"\r\n")[0])
        self.assertEqual(data.count(b"HTTP/1.1"), 1)

    def test_bad_log_shapes_get_400(self):
        for body in ("[]", '{"entries": 5}', "not json"):
            resp, _ = self.request("POST", "/tv/log", body=body)
            self.assertEqual(resp.status, 400, body)
        resp, _ = self.request("POST", "/tv/log", body='{"entries": [{"t": "x", "msg": "odd"}, 7]}')
        self.assertEqual(resp.status, 204)
        resp, _ = self.request("POST", "/tv/probe-results", body="[1]")
        self.assertEqual(resp.status, 400)

    def test_websocket_upgrade_is_tunnelled(self):
        # A raw echo server stands in for Jellyfin's /socket.
        echo = socket.socket()
        echo.bind(("127.0.0.1", 0))
        echo.listen(1)

        def run():
            c, _ = echo.accept()
            buf = b""
            while b"\r\n\r\n" not in buf:
                buf += c.recv(1024)
            c.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            c.sendall(c.recv(1024))
            c.close()

        threading.Thread(target=run, daemon=True).start()
        proxy = devserver.make_server("127.0.0.1", 0, "http://127.0.0.1:%d" % echo.getsockname()[1])
        serve(proxy)
        try:
            s = socket.create_connection(proxy.server_address, timeout=5)
            s.sendall(b"GET /socket?api_key=x HTTP/1.1\r\nHost: tv\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            head = b""
            while b"\r\n\r\n" not in head:
                head += s.recv(1024)
            self.assertIn(b"101", head.split(b"\r\n")[0])
            s.sendall(b"frame")
            self.assertEqual(s.recv(1024), b"frame")
            s.close()
        finally:
            proxy.shutdown()
            echo.close()


if __name__ == "__main__":
    unittest.main()
