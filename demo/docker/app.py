"""Tiny demo web service. /health is 200 only when the config parses and the log dir is not full."""
import hashlib, json, os, re, shutil, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

CONF = "/etc/app.conf"
LOGDIR = "/var/log/app"
LOG_LIMIT = 20 * 1024 * 1024  # log dir over 20 MB counts as disk full
STARTED = time.time()
NAME = os.environ.get("NS_NAME") or os.uname().nodename
HEADLINES = {"app dir missing": "app folder missing"}


def status():
    code, msg = check()
    headline = "SERVING" if code == 200 else f"{code} {HEADLINES.get(msg.split(':')[0], msg)}"
    try:
        lines = open(os.path.join(LOGDIR, "app.log"), "rb").read()[-4000:].decode(errors="replace").strip().splitlines()[-3:]
    except OSError:
        lines = []
    try:
        mb = sum(os.path.getsize(os.path.join(LOGDIR, n)) for n in os.listdir(LOGDIR)) // (1024 * 1024)
    except OSError:
        mb = 0
    du = shutil.disk_usage("/var/log")
    return {"name": NAME, "ok": code == 200, "code": code, "headline": headline,
            "level": "ok" if code == 200 else "warn" if code == 503 else "bad",
            "uptimeS": int(time.time() - STARTED), "diskPct": round(du.used * 100 / du.total), "logMB": mb, "log": lines}


def check():
    try:
        with open(CONF) as f:
            conf = dict(l.strip().split("=", 1) for l in f if "=" in l)
        if not re.fullmatch(r"\d+", conf.get("port", "")) or not conf.get("mode"):
            return 500, "bad config"
    except Exception as e:
        return 500, f"bad config: {e}"
    if not os.path.isdir("/srv/app"):
        return 500, "app dir missing"
    try:
        for line in open("/srv/app.manifest"):
            h, f = line.split(None, 1)
            f = os.path.join("/srv", f.strip())
            if not os.path.isfile(f) or hashlib.sha256(open(f, "rb").read()).hexdigest() != h:
                return 500, "app files changed: " + os.path.relpath(f, "/srv")
    except Exception as e:
        return 500, f"app manifest: {e}"
    try:
        used = sum(os.path.getsize(os.path.join(LOGDIR, n)) for n in os.listdir(LOGDIR))
    except FileNotFoundError:
        return 500, "log dir missing"
    if used > LOG_LIMIT:
        return 503, "log dir full"
    return 200, "ok"


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="text/plain; charset=utf-8"):
        body = body if isinstance(body, bytes) else (body + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")   # demo: framing and fetching from anywhere is fine (no X-Frame-Options)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            code, msg = check()
            self.send(code, msg)
            self.note(code)
        elif self.path == "/status":
            self.send(200, json.dumps(status()).encode(), "application/json")
        elif self.path in ("/", "/index.html"):
            try:
                self.send(200, open("/srv/status.html", "rb").read(), "text/html; charset=utf-8")
            except OSError:
                self.send(200, "web " + NAME)
        else:
            self.send(404, "not found")

    def note(self, code):   # only /health is logged, so the page polling /status does not flood the log
        try:
            with open(os.path.join(LOGDIR, "app.log"), "a") as f:
                f.write(f"{time.strftime('%F %T')} GET /health {code}\n")
        except OSError:
            pass

    def log_message(self, *a):
        pass


os.makedirs(LOGDIR, exist_ok=True)
with open("/run/app.pid", "w") as f:
    f.write(str(os.getpid()))
try:
    with open(os.path.join(LOGDIR, "app.log"), "a") as f:
        f.write(f"{time.strftime('%F %T')} app started on {NAME}\n")
except OSError:
    pass
print("app up", file=sys.stderr, flush=True)
HTTPServer(("0.0.0.0", 8080), H).serve_forever()
