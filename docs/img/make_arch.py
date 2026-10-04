from PIL import Image, ImageDraw, ImageFont
W, H = 1800, 1000
BG, CARD, CREAM, SAGE, AMB, GRN, RED, BLUSH = (12,28,26), (22,48,45), (244,236,214), (140,178,150), (245,166,35), (74,190,120), (226,92,92), (232,160,176)
im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf"
f_t, f_b, f_s = ImageFont.truetype(F % "-Bold", 58), ImageFont.truetype(F % "-Bold", 28), ImageFont.truetype(F % "", 22)
d.text((60, 36), "Go to sleep. Nightshift is on.", font=f_t, fill=CREAM)
d.text((62, 112), "How it fits together: the agent proposes, the gate decides, the Lantern approves. Devices dial out; nothing dials them.", font=f_s, fill=SAGE)
def box(x, y, w, h, title, lines, col):
    d.rounded_rectangle((x, y, x+w, y+h), 22, fill=CARD, outline=col, width=5)
    d.text((x+22, y+18), title, font=f_b, fill=CREAM)
    for i, l in enumerate(lines): d.text((x+22, y+66+i*30), l, font=f_s, fill=SAGE)
def arrow(x1, y1, x2, y2, label="", col=CREAM, off=(0, -34)):
    d.line((x1, y1, x2, y2), fill=col, width=5)
    import math; a = math.atan2(y2-y1, x2-x1)
    for s in (0.45, -0.45): d.line((x2, y2, x2-26*math.cos(a+s), y2-26*math.sin(a+s)), fill=col, width=5)
    if label:
        tw = d.textlength(label, font=f_s); lx, ly = (x1+x2)/2-tw/2+off[0], (y1+y2)/2+off[1]
        d.rectangle((lx-6, ly-3, lx+tw+6, ly+26), fill=BG); d.text((lx, ly), label, font=f_s, fill=col)
bw, bh, y1 = 360, 190, 200
xs = [60, 510, 960, 1410]
box(xs[0], y1, bw, bh, "Alert or Ask", ["probes every 3 s", "typed question", "mock alert (labelled)"], RED)
box(xs[1], y1, bw, bh, "Agent loop", ["own loop, Gemini", "local Qwen fallback", "thinks out loud"], BLUSH)
box(xs[2], y1, bw, bh, "Gate (policy.yaml)", ["alone, ask, hold, block", "policy decides, not model", "MCP tools, skills"], AMB)
box(xs[3], y1, 330, bh, "SpacetimeDB", ["live tables", "identity-checked", "everyone subscribes"], GRN)
for i, lab in enumerate(["alert", "tools", "grants"]):
    x2 = xs[i+1] if i < 2 else xs[3]
    arrow(xs[i]+bw+6, y1+bh//2, x2-8, y1+bh//2, lab, off=(0, -42))
y2 = 560
box(60, y2, 520, 240, "Executors (hands)", ["snapshot, run, health check, auto-rollback", "Docker web-1, web-2, ssh-box", "laptop sandbox, host target", "real Pixel phone over adb"], GRN)
box(640, y2, 520, 240, "Warden + Lantern (FREE-WILi)", ["one word and a color on the board", "green approves, blue shorter, red denies", "gray undoes, double shake revokes all", "USB; buttons and shake verified"], AMB)
box(1220, y2, 520, 240, "Dashboard + phone", ["night garden, terminal, reasoning", "skills library, thread, replay", "phone approves over Tailscale", "works from anywhere, local fallback"], BLUSH)
arrow(1500, y1+bh+6, 320, y2-8, "", GRN)
arrow(1560, y1+bh+6, 900, y2-8, "", AMB)
arrow(1620, y1+bh+6, 1480, y2-8, "", BLUSH)
d.rounded_rectangle((60, 860, 1740, 960), 18, outline=SAGE, width=3)
d.text((90, 880), "Real: gate, grants, rollback, earned trust, Pixel phone, FREE-WILi buttons, LEDs, shake.  Stand-ins (labelled): containers for servers, mock alert.", font=f_s, fill=CREAM)
d.text((90, 918), "Threat model: a fooled or over-eager agent, not a compromised OS.", font=f_s, fill=SAGE)
im.save("docs/img/architecture.png")
