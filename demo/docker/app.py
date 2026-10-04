"""Tiny demo web service. /health is 200 only when the config parses and the log dir is not full."""
import os, re, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

CONF = "/etc/app.conf"
LOGDIR = "/var/log/app"
LOG_LIMIT = 20 * 1024 * 1024  # log dir over 20 MB counts as disk full


def check():
    try:
        with open(CONF) as f:
            conf = dict(l.strip().split("=", 1) for l in f if "=" in l)
        if not re.fullmatch(r"\d+", conf.get("port", "")) or not conf.get("mode"):
            return 500, "bad config"
    except Exception as e:
        return 500, f"bad config: {e}"
    try:
        used = sum(os.path.getsize(os.path.join(LOGDIR, n)) for n in os.listdir(LOGDIR))
    except FileNotFoundError:
        return 500, "log dir missing"
    if used > LOG_LIMIT:
        return 503, "log dir full"
    return 200, "ok"


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        code, msg = check() if self.path == "/health" else (200, "web " + os.uname().nodename)
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
with open("/run/app.pid", "w") as f:
    f.write(str(os.getpid()))
print("app up", file=sys.stderr, flush=True)
HTTPServer(("0.0.0.0", 8080), H).serve_forever()
