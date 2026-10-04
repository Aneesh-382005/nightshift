from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black
W, H = landscape(letter)
c = canvas.Canvas("docs/notability/v2.pdf", pagesize=(W, H))
AMB, GRN, RED, GRY, NAVY = HexColor("#d98a00"), HexColor("#1f9d55"), HexColor("#d63b3b"), HexColor("#7b8494"), HexColor("#16322f")
INK, SUB = HexColor("#111111"), HexColor("#444444")
def bg(): c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
def title(t, s=None):
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 26); c.drawString(40, H-56, t)
    if s: c.setFillColor(SUB); c.setFont("Helvetica-Oblique", 13); c.drawString(40, H-78, s)
def box(x, y, w, h, label, sub="", col=INK, fs=13):
    c.setStrokeColor(col); c.setLineWidth(2.2); c.roundRect(x, y, w, h, 10)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", fs); c.drawCentredString(x+w/2, y+h/2+(5 if sub else -4), label)
    if sub: c.setFont("Helvetica", 9.5); c.setFillColor(SUB); c.drawCentredString(x+w/2, y+h/2-10, sub)
def arrow(x1, y1, x2, y2):
    c.setStrokeColor(INK); c.setLineWidth(1.8); c.line(x1, y1, x2, y2)
def dash(x, y, w, h):
    c.setStrokeColor(HexColor("#bbbbbb")); c.setDash(4, 4); c.roundRect(x, y, w, h, 8); c.setDash()

# 1 flow
bg(); title("Sleep. Nightshift's on.", "Nightshift fixes what breaks while you sleep. The agent proposes. The Lantern (a wristband) decides.")
bw, bh, y = 160, 80, H-220; xs = [40+i*(bw+34) for i in range(4)]
for x, (l, s, col) in zip(xs, [("1. Something breaks","service, config, disk, phone",RED),("2. Nightshift thinks","reads logs, checks skills",GRY),("3. The Lantern asks","amber glow, you press",AMB),("4. Fixed or undone","health check, auto-rollback",GRN)]): box(x, y, bw, bh, l, s, col)
for i in range(3): arrow(xs[i]+bw, y+bh/2, xs[i+1], y+bh/2)
c.setFillColor(INK); c.setFont("Helvetica-Bold", 12); c.drawString(40, y-34, "Sketch each step (screen, wristband, phone):")
for x in xs: dash(x, 50, bw, y-100)
c.showPage()
# 2 lantern
bg(); title("The Lantern: one word, one color", "Green approves, blue approves shorter, red denies, gray undoes, yellow shows events, double shake revokes everything.")
rows = [("WATCH","gold sweep",AMB,"a routine check ran"),("DOWN","red flash",RED,"a check failed"),("THINK","amber chase",AMB,"the agent is investigating"),("APPROVE / HOLD","amber pulse",AMB,"needs your press (HOLD: press the same button twice)"),
        ("FIXING","amber solid",AMB,"approved, running"),("HEALTHY","green",GRN,"health check passed"),("TRUST 1..3 / EARNED","gold LEDs fill",AMB,"safe fixes counted, then it earns autonomy"),("ESCALATE","red and amber",RED,"nobody pressed in time"),("BLOCKED","red",RED,"policy stopped it, no press can allow it")]
for i, (w, l, col, d) in enumerate(rows):
    yy = H-125-i*44
    c.setFillColor(col); c.circle(58, yy+6, 13, fill=1, stroke=0)
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 14); c.drawString(86, yy+8, w)
    c.setFont("Helvetica", 11); c.setFillColor(SUB); c.drawString(86, yy-8, l+": "+d)
c.setFillColor(INK); c.setFont("Helvetica-Bold", 12); c.drawString(500, H-125, "Sketch the board and your hand here:"); dash(500, 90, 240, 400)
c.showPage()
# 3 dashboard wireframe
bg(); title("The night-garden dashboard", "Sketch your own layout, or label what each block shows.")
blocks = [(40,H-190,700,100,"HERO: Sleep. Nightshift's on. + moon + big state sentence"),(40,H-300,700,95,"THE GARDEN: one flower per device (bloom, wilted, asking, blocked)"),
          (40,H-470,340,160,"AGENT TERMINAL: every command, output, health"),(400,H-470,340,160,"AGENT REASONING: live thoughts + the skill it used"),
          (40,H-560,340,80,"NIGHTSHIFT THREAD: ask a question, replies with cards"),(400,H-560,340,80,"TONIGHT: incident stories with a why line"),
          (40,H-600+0,700,0,"")]
for x,y2,w,h,l in blocks:
    if h:
        c.setStrokeColor(NAVY); c.setLineWidth(1.6); c.roundRect(x,y2,w,h,8); c.setFillColor(SUB); c.setFont("Helvetica-Bold",9.5); c.drawString(x+8,y2+h-16,l)
c.setFillColor(SUB); c.setFont("Helvetica", 10); c.drawString(40, 42, "Also: Earned trust plant, cost of a fix, Skills library (from the database), Good morning report, Replay the night.")
c.showPage()
# 4 architecture
bg(); title("How it fits together", "Draw the arrows yourself. Devices dial out; nothing dials them.")
box(40,H-190,150,60,"Alert / Ask","mock monitor, typed question",RED); box(230,H-190,170,60,"Agent loop","Gemini, local model fallback",GRY)
box(440,H-190,150,60,"Gate (policy)","allow, ask, hold, block",NAVY); box(630,H-190,120,60,"SpacetimeDB","live tables, identities",NAVY)
for a in [(190,H-160,230,H-160),(400,H-160,440,H-160),(590,H-160,630,H-160)]: arrow(*a)
box(60,H-340,130,55,"Executors","docker, adb, ssh, host",GRN); box(230,H-340,130,55,"Skills library","markdown in the database",GRY)
box(400,H-340,130,55,"Warden","approve, deny, undo, kill",AMB); box(570,H-340,170,55,"Dashboard + phone","Tailscale from anywhere",NAVY)
c.setFillColor(INK); c.setFont("Helvetica-Bold", 12); c.drawString(40, H-385, "Your sketch: where does the Lantern sit? who talks to whom?"); dash(40, 50, 700, H-460)
c.showPage()
# 5 notes
bg(); title("Notes: how Notability helped")
c.setFont("Helvetica", 13); c.setFillColor(SUB)
for i, l in enumerate(["What I changed after sketching:", "", "", "", "One line for the judges:", "", "", ""]):
    c.drawString(40, H-110-i*38, l); c.setStrokeColor(HexColor("#dddddd")); c.line(40, H-120-i*38, W-40, H-120-i*38)
c.save()
