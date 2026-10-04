// Optional phone-browser Leash: a tiny page with the five buttons and the current screen.
// Off unless --http-port is given. Every request needs the token (printed at startup), so open the
// printed URL on the phone. Plain HTTP: use it on the local network or phone hotspot only.
import http from 'node:http';
import crypto from 'node:crypto';
import type { ButtonName } from './bridge.js';

const NAMES: ButtonName[] = ['green', 'blue', 'red', 'gray', 'yellow'];
const COLORS: Record<string, string> = { green: '#1a9d3a', blue: '#2a63d4', red: '#d03030', gray: '#777', yellow: '#c9a300' };
const LABELS: Record<string, string> = { green: 'Approve 120s', blue: 'Approve 30s', red: 'Deny / revoke all', gray: 'Undo last', yellow: 'Audit' };

export function startHttp(opts: {
  host: string; port: number; token: string;
  state: () => { lines: string[]; led: number[]; mode: string };
  press: (b: ButtonName) => void;
}) {
  const ok = (given: string | null) => {
    const a = Buffer.from(given ?? ''), b = Buffer.from(opts.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const page = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Nightshift Leash</title>
<style>body{font-family:system-ui;margin:0;padding:16px;background:#111;color:#eee}#s{border-radius:12px;padding:16px;margin-bottom:16px;background:#222;min-height:120px;border-left:12px solid #333}
#s b{font-size:28px;display:block;margin-bottom:8px}button{display:block;width:100%;padding:20px;margin:10px 0;border:0;border-radius:12px;color:#fff;font-size:20px}</style>
<div id=s></div>${NAMES.map(n => `<button style="background:${COLORS[n]}" data-n=${n}>${LABELS[n]}</button>`).join('')}
<script>const t=new URLSearchParams(location.search).get('t')||'';
async function poll(){try{const r=await fetch('/state?t='+encodeURIComponent(t));const j=await r.json();const el=document.getElementById('s');
el.style.borderColor='rgb('+j.led.join(',')+')';el.replaceChildren();const b=document.createElement('b');b.textContent=j.lines[0];el.append(b);
for(const l of j.lines.slice(1)){const d=document.createElement('div');d.textContent=l;el.append(d)}}catch(e){}}
document.querySelectorAll('button').forEach(b=>b.onclick=()=>fetch('/press?t='+encodeURIComponent(t)+'&name='+b.dataset.n,{method:'POST'}).then(poll));
poll();setInterval(poll,1000);</script>`;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (!ok(u.searchParams.get('t'))) { res.writeHead(403).end('forbidden'); return; }
    if (u.pathname === '/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(opts.state()));
    } else if (u.pathname === '/press' && req.method === 'POST') {
      const n = u.searchParams.get('name') as ButtonName;
      if (!NAMES.includes(n)) { res.writeHead(400).end('bad button'); return; }
      opts.press(n);
      res.writeHead(204).end();
    } else if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(page);
    } else res.writeHead(404).end();
  });
  srv.listen(opts.port, opts.host);
  return srv;
}
