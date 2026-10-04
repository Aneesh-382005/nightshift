"""Tiny demo web service for the VPS stand-in. Runs as the limited user. All paths live under NS_ROOT.
/health is 200 only when: config parses, srv/app exists and matches srv/app.manifest, tmp/ is under 20 MB."""
import hashlib, os, re, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.environ.get("NS_ROOT", os.path.expanduser("~/ns-demo"))
PORT = int(os.environ.get("NS_PORT", "8080"))
CONF = os.path.join(ROOT, "etc/app.conf")
LOGDIR = os.path.join(ROOT, "log/app")
TMPDIR = os.path.join(ROOT, "tmp")
SRV = os.path.join(ROOT, "srv")
TMP_LIMIT = 20 * 1024 * 1024


def check():
    try:
        with open(CONF) as f:
            conf = dict(l.strip().split("=", 1) for l in f if "=" in l)
        if not re.fullmatch(r"\d+", conf.get("port", "")) or not conf.get("mode"):
            return 500, "bad config"
    except Exception as e:
        return 500, f"bad config: {e}"
    if not os.path.isdir(os.path.join(SRV, "app")):
        return 500, "app dir missing"
    try:
        for line in open(os.path.join(SRV, "app.manifest")):
            h, f = line.split(None, 1)
            f = os.path.join(SRV, f.strip())
            if not os.path.isfile(f) or hashlib.sha256(open(f, "rb").read()).hexdigest() != h:
                return 500, "app files changed: " + os.path.relpath(f, SRV)
    except Exception as e:
        return 500, f"app manifest: {e}"
    try:
        used = sum(os.path.getsize(os.path.join(TMPDIR, n)) for n in os.listdir(TMPDIR))
    except FileNotFoundError:
        return 500, "tmp dir missing"
    if used > TMP_LIMIT:
        return 503, "tmp dir full"
    return 200, "ok"


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        code, msg = check() if self.path == "/health" else (200, "vps stand-in " + os.uname().nodename)
        body = (msg + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        try:
            with open(os.path.join(LOGDIR, "app.log"), "a") as f:
                f.write(f"{time.strftime('%F %T')} GET {self.path} {code}\n")
        except OSError:
            pass

    def log_message(self, *a):
        pass


os.makedirs(LOGDIR, exist_ok=True)
print(f"demo app on 127.0.0.1:{PORT}, root {ROOT}", file=sys.stderr, flush=True)
HTTPServer(("127.0.0.1", PORT), H).serve_forever()
