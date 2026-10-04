#!/usr/bin/env python3
"""Render the morning recap MP4 from recap.json. Fixed script, no model-written code.
Usage: uv run --with pillow python render.py recap.json out.mp4
Pillow draws 1280x720 frames in the night-garden style, raw RGB is piped to the system ffmpeg (H.264, yuv420p, faststart).
Prints one JSON status line. Fonts: system DejaVu only."""
import json, math, os, random, subprocess, sys, time
from datetime import datetime
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 24
CREAM = (243, 234, 210)
AMBER = (242, 178, 76)
GREEN = (127, 207, 138)
TEAL = (111, 168, 160)
ROSE = (199, 125, 125)
BG_TOP, BG_BOT = (6, 18, 28), (13, 42, 38)
HOW = {  # how -> (chip text, color)
    "alone": ("fixed alone", GREEN), "approved": ("approved by the Lantern", AMBER), "escalated": ("needs you", AMBER),
    "undone": ("undone", TEAL), "failed": ("needs you", ROSE), "open": ("working", CREAM),
}
FONT_DIR = "/usr/share/fonts/truetype/dejavu/"


def font(name, size):
    try:
        return ImageFont.truetype(FONT_DIR + name, size)
    except OSError:
        return ImageFont.load_default(size)


SERIF_B, SANS, SANS_B = "DejaVuSerif-Bold.ttf", "DejaVuSans.ttf", "DejaVuSans-Bold.ttf"
ease_out = lambda x: 1 - (1 - max(0.0, min(1.0, x))) ** 3
clamp01 = lambda x: max(0.0, min(1.0, x))
mix = lambda a, b, t: tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def tw(d, text, f):
    return d.textlength(text, font=f)


def blit(frame, layer, xy, alpha=1.0):
    if alpha <= 0:
        return
    if alpha >= 0.999:
        frame.paste(layer, xy, layer)
    else:
        mask = layer.getchannel("A").point(lambda v: int(v * alpha))
        frame.paste(layer, xy, mask)


def centered(text, f, color, width=W, height=None):
    height = height or int(f.size * 1.5)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text(((width - tw(d, text, f)) / 2, 0), text, font=f, fill=color + (255,))
    return img


def background():
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=mix(BG_TOP, BG_BOT, y / H))
    # moon with glow
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([1040 - 120, 130 - 120, 1040 + 120, 130 + 120], fill=(246, 239, 208, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    bg.paste(glow, (0, 0), glow)
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([1040 - 56, 130 - 56, 1040 + 56, 130 + 56], fill=255)
    md.ellipse([1040 - 24, 130 - 66, 1040 + 88, 130 + 46], fill=0)   # crescent bite
    bg.paste(Image.new("RGB", (W, H), (246, 239, 208)), (0, 0), mask)
    # ground hill
    d.ellipse([-200, 640, W + 200, 900], fill=(9, 30, 30))
    return bg


def petal_poly(cx, cy, ang, length, width, n=24):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = math.cos(a) * length / 2 + length / 2, math.sin(a) * width / 2
        pts.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    return pts


_sprite_cache = {}


def flower_sprite(color, size):
    key = (color, size)
    if key in _sprite_cache:
        return _sprite_cache[key]
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    for k in range(6):
        d.polygon(petal_poly(c, c, k * math.pi / 3, S * 0.46, S * 0.26), fill=color + (255,))
    for k in range(6):
        d.polygon(petal_poly(c, c, k * math.pi / 3 + math.pi / 6, S * 0.34, S * 0.18), fill=mix(color, CREAM, 0.35) + (255,))
    d.ellipse([c - S * 0.1, c - S * 0.1, c + S * 0.1, c + S * 0.1], fill=(250, 240, 200, 255))
    img = img.resize((size, size), Image.LANCZOS)
    _sprite_cache[key] = img
    return img


def draw_flower(frame, d, x, ground_y, head_y, color, size, t, phase, bloom):
    sway = math.sin(t * 1.4 + phase) * 7 * bloom
    hx = x + sway
    stem = mix((22, 70, 52), (40, 110, 70), bloom)
    d.line([(x, ground_y), (x + sway * 0.4, (ground_y + head_y) / 2), (hx, head_y + size * 0.4)], fill=stem, width=5, joint="curve")
    s = max(10, int(size * (0.35 + 0.65 * bloom)))
    dim = mix((60, 80, 80), color, 0.35 + 0.65 * bloom)
    sp = flower_sprite(dim, s)
    frame.paste(sp, (int(hx - s / 2), int(head_y - s / 2)), sp)


def hhmm(us):
    return datetime.fromtimestamp(us / 1e6).strftime("%-I:%M %p")


def pick_cards(incs, k=4):
    order = ["alone", "approved", "undone", "escalated", "failed", "open"]
    chosen = []
    for how in order:  # one of each kind first (most recent of that kind)
        for i in reversed(incs):
            if i["how"] == how and i not in chosen and len(chosen) < k:
                chosen.append(i)
                break
    for i in reversed(incs):
        if len(chosen) < k and i not in chosen:
            chosen.append(i)
    return sorted(chosen, key=lambda i: i["tsUs"])


def fit(d, text, f, maxw):
    if tw(d, text, f) <= maxw:
        return text
    while text and tw(d, text + "...", f) > maxw:
        text = text[:-1]
    return text.rstrip() + "..."


def card_layer(inc):
    cw, ch = 960, 330
    img = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    chip, col = HOW.get(inc["how"], HOW["failed"])
    line3 = "needed a human" if inc["how"] in ("escalated", "failed") else "fixed: " + inc["fixed"]
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], radius=28, fill=(14, 40, 44, 238), outline=col + (255,), width=3)
    d.text((220, 38), inc["device"], font=font(SERIF_B, 58), fill=CREAM + (255,))
    d.text((220, 118), fit(d, inc["broke"], font(SANS, 30), cw - 220 - 36), font=font(SANS, 30), fill=mix(CREAM, BG_BOT, 0.25) + (255,))
    d.text((220, 176), fit(d, line3, font(SANS_B, 30), cw - 220 - 36), font=font(SANS_B, 30), fill=col + (255,))
    secs = f"in {inc['seconds']} s   ·   " if inc.get("seconds") is not None else ""
    d.text((220, 250), secs + hhmm(inc["tsUs"]), font=font(SANS, 26), fill=mix(CREAM, BG_BOT, 0.45) + (255,))
    f = font(SANS_B, 26)
    cwid = tw(d, chip, f) + 40
    d.rounded_rectangle([cw - cwid - 34, 36, cw - 34, 84], radius=24, fill=col + (255,))
    d.text((cw - cwid - 34 + 20, 44), chip, font=f, fill=(10, 30, 32, 255))
    return img, col


def main(src, out):
    t_start = time.time()
    rc = json.load(open(src))
    incs = rc.get("incidents", [])
    cards = pick_cards(incs) if incs else []
    extra = max(0, len(incs) - len(cards))
    T_TITLE, T_CARD, T_TOTALS, T_OUT = 3.0, 3.0, 5.0, 4.0
    n_card_scenes = max(1, len(cards))
    total = T_TITLE + n_card_scenes * T_CARD + T_TOTALS + T_OUT
    frames = int(total * FPS)
    bg = background()
    rnd = random.Random(7)
    stars = [(rnd.randint(20, W - 20), rnd.randint(14, 330), rnd.random() * 6.28, rnd.choice([1, 1, 2])) for _ in range(46)]

    devices = []
    for i in incs:
        if i["device"] not in devices:
            devices.append(i["device"])
    devices = devices[:6] or ["night"]
    last_how = {}
    for i in incs:
        last_how[i["device"]] = i["how"]
    garden = []
    for k, dev in enumerate(devices):
        gx = 200 + k * (W - 400) / max(1, len(devices) - 1) if len(devices) > 1 else W / 2
        garden.append((dev, gx, HOW.get(last_how.get(dev, "alone"), HOW["alone"])[1], k * 1.3))
    first_card_t = {}
    for ci, c in enumerate(cards):
        first_card_t.setdefault(c["device"], T_TITLE + ci * T_CARD)

    title = centered("While you slept", font(SERIF_B, 100), CREAM, height=140)
    sub = f"{rc['window']['firstLocal']}  to  {rc['window']['lastLocal']}"
    subl = centered(sub, font(SANS, 34), mix(CREAM, BG_BOT, 0.3), height=50)
    nlab = centered(f"{rc['counts']['incidents']} incident{'s' if rc['counts']['incidents'] != 1 else ''} while the lights were out", font(SANS, 30), AMBER, height=46)
    card_layers = [card_layer(c) for c in cards]
    quiet = centered("A quiet night. Nothing broke.", font(SERIF_B, 56), GREEN, height=84)
    outro = centered("Sleep. Nightshift's on.", font(SERIF_B, 76), CREAM, height=110)

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    c = rc["counts"]; cost = rc["cost"]; tr = rc["trust"]
    nums = [(c["fixedAlone"], "fixed alone", GREEN), (c["approved"], "you approved", AMBER), (c["blocked"], "blocked", ROSE), (c["undone"], "undone", TEAL)]
    big, lab = font(SERIF_B, 120), font(SANS, 30)
    usd = cost["usd"]
    cost_s = f"${usd:.2f}" if usd >= 0.01 else f"${usd:.3f}"
    foot = f"cost {cost_s}   ·   {cost['commands']} commands   ·   {cost['presses']} presses"
    trust_s = f"{tr['trusted']} of {tr['total']} fixes now trusted to run alone" if tr["total"] else ""
    footl = centered(foot, font(SANS, 32), CREAM, height=48)
    trustl = centered(trust_s, font(SANS, 30), GREEN, height=44) if trust_s else None
    morel = centered(f"+{extra} more handled", font(SANS, 26), mix(CREAM, BG_BOT, 0.4), height=40) if extra else None
    t_cards0, t_tot0, t_out0 = T_TITLE, T_TITLE + n_card_scenes * T_CARD, T_TITLE + n_card_scenes * T_CARD + T_TOTALS

    for fi in range(frames):
        t = fi / FPS
        fr = bg.copy()
        d = ImageDraw.Draw(fr)
        for (sx, sy, ph, sz) in stars:
            b = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * 1.8 + ph))
            col = mix(BG_TOP, CREAM, b * 0.8)
            d.ellipse([sx - sz, sy - sz, sx + sz, sy + sz], fill=col)
        # garden
        for dev, gx, col, ph in garden:
            start = first_card_t.get(dev, t_tot0 - 0.5)
            bloom = ease_out((t - start) / 0.9) if t >= start else 0.0
            if t >= t_tot0:
                bloom = 1.0
            draw_flower(fr, d, gx, 700, 640, col, 70, t, ph, bloom)
            lw = tw(d, dev, font(SANS, 18))
            d.text((gx - lw / 2, 690), dev, font=font(SANS, 18), fill=mix((20, 50, 50), CREAM, 0.35 + 0.65 * bloom))
        # timeline along y=560
        if cards and T_TITLE - 0.3 <= t < t_tot0:
            x0, x1, y = 160, W - 160, 570
            d.line([(x0, y), (x1, y)], fill=(40, 80, 80), width=3)
            for ci, cd in enumerate(cards):
                px = x0 + (x1 - x0) * (ci + 0.5) / len(cards)
                lit = t >= T_TITLE + ci * T_CARD
                col = HOW.get(cd["how"], HOW["failed"])[1]
                d.ellipse([px - 9, y - 9, px + 9, y + 9], fill=col if lit else (40, 80, 80))
                lbl = hhmm(cd["tsUs"]); lf = font(SANS, 20)
                d.text((px - tw(d, lbl, lf) / 2, y + 16), lbl, font=lf, fill=mix((40, 80, 80), CREAM, 0.7 if lit else 0.0))
        # scenes
        if t < T_TITLE:
            a = ease_out(t / 1.0) * (1 - clamp01((t - 2.5) / 0.5))
            blit(fr, title, (0, 220), a)
            blit(fr, subl, (0, 360), clamp01((t - 0.6) / 0.8) * (1 - clamp01((t - 2.5) / 0.5)))
            blit(fr, nlab, (0, 420), clamp01((t - 1.0) / 0.8) * (1 - clamp01((t - 2.5) / 0.5)))
        elif t < t_tot0:
            ci = int((t - t_cards0) // T_CARD)
            lt = (t - t_cards0) - ci * T_CARD
            if not cards:
                blit(fr, quiet, (0, 300), clamp01(lt / 0.6) * (1 - clamp01((lt - 2.5) / 0.5)))
            else:
                layer, col = card_layers[ci]
                slide = (1 - ease_out(lt / 0.6)) * 220
                a = clamp01(lt / 0.4) * (1 - clamp01((lt - 2.6) / 0.4))
                x, y = int(160 + slide), 170
                blit(fr, layer, (x, y), a)
                sp = flower_sprite(col, 150)
                sway = math.sin(t * 1.4) * 4
                fa = a
                if fa > 0:
                    m = sp.getchannel("A").point(lambda v: int(v * fa))
                    fr.paste(sp, (int(x + 40 + sway), y + 90), m)
        elif t < t_out0:
            lt = t - t_tot0
            fade = clamp01(lt / 0.5) * (1 - clamp01((lt - 4.6) / 0.4))
            colw = (W - 200) / 4
            for k, (val, label, col) in enumerate(nums):
                p = ease_out((lt - 0.2 - k * 0.15) / 1.2)
                shown = int(round(val * p))
                cx = 100 + colw * k + colw / 2
                s = str(shown)
                layer = Image.new("RGBA", (int(colw), 200), (0, 0, 0, 0))
                ld = ImageDraw.Draw(layer)
                ld.text(((colw - tw(ld, s, big)) / 2, 0), s, font=big, fill=col + (255,))
                ld.text(((colw - tw(ld, label, lab)) / 2, 150), label, font=lab, fill=CREAM + (255,))
                blit(fr, layer, (int(cx - colw / 2), 190), fade)
            blit(fr, footl, (0, 440), fade * clamp01((lt - 1.0) / 0.5))
            if trustl:
                blit(fr, trustl, (0, 496), fade * clamp01((lt - 1.4) / 0.5))
            if morel:
                blit(fr, morel, (0, 548), fade * clamp01((lt - 1.8) / 0.5))
        else:
            lt = t - t_out0
            blit(fr, outro, (0, 280), clamp01(lt / 1.0) * (1 - clamp01((lt - 3.6) / 0.4)))
        ff.stdin.write(fr.tobytes())
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError("ffmpeg failed")
    print(json.dumps({"ok": True, "path": os.path.abspath(out), "seconds": round(total, 1), "frames": frames,
                      "renderS": round(time.time() - t_start, 1), "sizeKB": os.path.getsize(out) // 1024,
                      "incidents": len(incs), "cards": len(cards)}))


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as e:  # one JSON status line even on failure
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
