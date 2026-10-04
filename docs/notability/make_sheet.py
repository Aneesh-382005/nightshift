from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black

W, H = landscape(letter)
c = canvas.Canvas("docs/notability/nightshift-sketch.pdf", pagesize=(W, H))
NAVY, AMBER, GREEN, RED, GRAY = HexColor("#0b1020"), HexColor("#f5a524"), HexColor("#22c55e"), HexColor("#ef4444"), HexColor("#9ca3af")

def bg():
    c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)

def box(x, y, w, h, label, sub, color):
    c.setStrokeColor(color); c.setLineWidth(2.5); c.roundRect(x, y, w, h, 14)
    c.setFillColor(black); c.setFont("Helvetica-Bold", 15); c.drawCentredString(x + w/2, y + h/2 + 6, label)
    c.setFont("Helvetica", 10.5); c.setFillColor(HexColor("#444444")); c.drawCentredString(x + w/2, y + h/2 - 12, sub)

def arrow(x1, y, x2):
    c.setStrokeColor(black); c.setLineWidth(2); c.line(x1, y, x2 - 6, y)
    p = c.beginPath(); p.moveTo(x2, y); p.lineTo(x2 - 9, y + 5); p.lineTo(x2 - 9, y - 5); p.close(); c.setFillColor(black); c.drawPath(p, fill=1, stroke=0)

# page 1: flow
bg()
c.setFont("Helvetica-Bold", 28); c.setFillColor(black); c.drawString(40, H - 60, "Sleep. Nightshift's on.")
c.setFont("Helvetica-Oblique", 14); c.setFillColor(HexColor("#555555")); c.drawString(40, H - 84, "Nightshift fixes what breaks while you sleep. The agent proposes. The wristband (the Lantern) decides.")
bw, bh, y = 150, 80, H - 230
xs = [40 + i * (bw + 36) for i in range(4)]
labels = [("1. Alert", "something breaks at 3 a.m."), ("2. Nightshift reads", "logs, finds the cause"), ("3. The Lantern asks", "amber glow, you press"), ("4. Fixed or undone", "health check, auto-rollback")]
cols = [RED, GRAY, AMBER, GREEN]
for (x, (l, s), col) in zip(xs, labels, cols): box(x, y, bw, bh, l, s, col)
for i in range(3): arrow(xs[i] + bw, y + bh/2, xs[i + 1])
c.setFont("Helvetica-Bold", 13); c.setFillColor(black); c.drawString(40, y - 40, "Sketch here: draw what each step looks like (screen, wristband, phone):")
c.setStrokeColor(HexColor("#cccccc")); c.setDash(4, 4)
for x in xs: c.roundRect(x, 60, bw, y - 120, 10)
c.setDash()
c.showPage()

# page 2: the Lantern
bg()
c.setFont("Helvetica-Bold", 26); c.setFillColor(black); c.drawString(40, H - 60, "The Lantern: what the wristband says")
rows = [(AMBER, "Amber, pulsing", "Nightshift wants to fix something and is asking you."), (GREEN, "Green", "Fixed. Health check passed. Or: you approved."), (RED, "Red", "Blocked: the request looked unsafe. No press needed."), (GRAY, "Gray / white", "Press to undo the last change.")]
y0 = H - 130
for i, (col, t, d) in enumerate(rows):
    y = y0 - i * 80
    c.setFillColor(col); c.circle(70, y + 12, 22, fill=1, stroke=0)
    c.setFillColor(black); c.setFont("Helvetica-Bold", 17); c.drawString(110, y + 14, t)
    c.setFont("Helvetica", 13); c.setFillColor(HexColor("#444444")); c.drawString(110, y - 6, d)
c.setFont("Helvetica-Bold", 13); c.setFillColor(black); c.drawString(40, 150, "Sketch here: the wristband and the dashboard side by side.")
c.setStrokeColor(HexColor("#cccccc")); c.setDash(4, 4); c.roundRect(40, 40, W - 80, 95, 10); c.setDash()
c.showPage()

# page 3: notes
bg()
c.setFont("Helvetica-Bold", 26); c.setFillColor(black); c.drawString(40, H - 60, "Notes: how Notability helped")
c.setFont("Helvetica", 13); c.setFillColor(HexColor("#444444"))
for i, line in enumerate(["What I changed after sketching:", "", "", "", "", "Judge-facing one-liner:", "", "", ""]):
    c.drawString(40, H - 110 - i * 36, line)
    c.setStrokeColor(HexColor("#dddddd")); c.line(40, H - 118 - i * 36, W - 40, H - 118 - i * 36)
c.save()
