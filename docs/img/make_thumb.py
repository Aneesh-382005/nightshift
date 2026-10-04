from PIL import Image, ImageDraw, ImageFont
import random, math
W, H = 1500, 1000
BG, CARD, CREAM, SAGE, AMB, GRN = (10,24,22), (22,48,45), (244,236,214), (140,178,150), (245,166,35), (74,190,120)
im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
random.seed(4)
for _ in range(120):
    x, y, r = random.randint(0, W), random.randint(0, 520), random.choice([1,1,2,2,3]); d.ellipse((x-r, y-r, x+r, y+r), fill=(200,205,190))
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf"
big, mid, sm = ImageFont.truetype(F % "-Bold", 104), ImageFont.truetype(F % "-Bold", 40), ImageFont.truetype(F % "", 32)
# moon
d.ellipse((1130, 90, 1330, 290), fill=CREAM); d.ellipse((1180, 70, 1380, 270), fill=BG)
d.text((90, 150), "Go to sleep.", font=big, fill=CREAM); d.text((90, 270), "Nightshift is on.", font=big, fill=AMB)
d.text((94, 420), "Earned autonomy for machines.", font=mid, fill=CREAM)
d.text((94, 480), "AI heals the safe things, asks on a wristband for the rest,", font=sm, fill=SAGE)
d.text((94, 524), "and can undo or kill anything.", font=sm, fill=SAGE)
# hills
d.polygon([(0, 760), (300, 690), (650, 740), (1000, 680), (1500, 750), (1500, 1000), (0, 1000)], fill=CARD)
# flowers
def flower(cx, cy, col, n=8):
    d.line((cx, cy, cx, cy+150), fill=(60,120,80), width=8)
    for i in range(n):
        a = i*2*math.pi/n; px, py = cx+math.cos(a)*34, cy+math.sin(a)*34
        d.ellipse((px-22, py-22, px+22, py+22), fill=col)
    d.ellipse((cx-16, cy-16, cx+16, cy+16), fill=CREAM)
for cx, col in [(220,(232,160,176)), (480,(245,166,35)), (760,(244,236,214)), (1040,(160,140,220)), (1290,(74,190,120))]: flower(cx, 780, col)
# lantern word
d.rounded_rectangle((90, 610, 560, 700), 20, fill=(8,16,16), outline=GRN, width=5)
d.text((120, 630), "HEALTHY", font=mid, fill=GRN)
for i in range(7):
    cx = 640+i*52; d.ellipse((cx-17, 640-17+10, cx+17, 640+17+10), fill=AMB if i < 6 else GRN)
d.text((90, 930), "Nightshift  |  MHacks 26  |  SpacetimeDB + FREE-WILi + Gemini", font=sm, fill=SAGE)
im.save("docs/img/thumbnail.png")
