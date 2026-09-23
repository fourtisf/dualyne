"""
Build the logo pack in brand/ from one definition of the mark.

  pip install fonttools && python3 brand/build.py

Writes brand/svg/*.svg (text converted to outlines, so no font is needed to open them),
then renders brand/png/*.png, brand/favicon.ico and brand/brand-sheet.png with Chromium
(node + playwright-core, see render.mjs; browser at /opt/pw-browsers/chromium or $CHROMIUM).
Change NAME or TAGLINE below and run it again when the final brand is set.
"""
import json
import os
import subprocess
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

NAME = "refract"  # the wordmark is set lowercase
TOKEN = "$RFX"
TAGLINE = "Every AI model, one prompt away."

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "apps", "web", "node_modules", "geist", "dist", "fonts")
MONO = os.path.join(FONTS, "geist-mono", "GeistMono-Medium.ttf")
SANS = os.path.join(FONTS, "geist-sans", "Geist-Regular.ttf")

INK_DARK_BG = "#EDEDEF"  # caret and wordmark on dark backgrounds
INK_LIGHT_BG = "#141418"
CYAN, PINK = "#67E8F9", "#F472B6"
CYAN_DEEP, PINK_DEEP = "#0891B2", "#DB2777"  # the same hues with contrast on white
BG = "#050507"

# The mark, in a 100×100 grid. Its drawn area is x 13–86, y 21–80.
CARET = "M18 26 L42 50 L18 74"
BARS = [(52, 56, 34), (52, 71, 24)]  # x, y, width; height 9, fully rounded


def mark(ink, top, bottom, k=1.0, dx=0.0, dy=0.0):
    """SVG elements for the mark, scaled by k and moved by (dx, dy)."""
    t = f' transform="translate({dx:.2f} {dy:.2f}) scale({k:.4f})"'
    bars = "".join(
        f'<rect x="{x}" y="{y}" width="{w}" height="9" rx="4.5" fill="{c}"/>'
        for (x, y, w), c in zip(BARS, (top, bottom))
    )
    return (
        f'<g{t}><path d="{CARET}" fill="none" stroke="{ink}" stroke-width="10" '
        f'stroke-linecap="round" stroke-linejoin="round"/>{bars}</g>'
    )


def text_path(font_file, text, size, tracking_em, x0, baseline):
    """Outline `text` into one SVG path; returns (d, (xmin, ymin, xmax, ymax), advance)."""
    font = TTFont(font_file)
    glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    s = size / upm
    pen, bounds, x = SVGPathPen(glyphs), BoundsPen(glyphs), 0.0
    for ch in text:
        g = glyphs[cmap[ord(ch)]]
        m = (s, 0, 0, -s, x0 + x * s, baseline)
        g.draw(TransformPen(pen, m))
        g.draw(TransformPen(bounds, m))
        x += g.width + tracking_em * upm
    return pen.getCommands(), bounds.bounds, x * s


def line_baseline(font_file, size, line_top):
    """Baseline of a line-height:1 line box, as the browser places it (hhea metrics)."""
    hhea = TTFont(font_file)["hhea"]
    upm = TTFont(font_file)["head"].unitsPerEm
    asc, desc = hhea.ascent / upm, -hhea.descent / upm
    return line_top + (size * (1 - (asc + desc))) / 2 + size * asc


def svg_doc(view, body, w=None, h=None):
    size = f' width="{w}" height="{h}"' if w else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{size}>{body}</svg>\n'


def write(rel, content):
    path = os.path.join(HERE, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    return path


# ---------- SVG ----------

# Mark alone: a square around the drawn area (x 13–86, y 21–80) with even margins.
MARK_VIEW = "9.5 10.5 80 80"
variants = {
    "": (INK_DARK_BG, CYAN, PINK),  # for dark backgrounds (the default)
    "-on-light": (INK_LIGHT_BG, CYAN_DEEP, PINK_DEEP),
    "-white": ("#FFFFFF",) * 3,
    "-black": ("#000000",) * 3,
}
for suffix, (ink, a, b) in variants.items():
    write(f"svg/refract-mark{suffix}.svg", svg_doc(MARK_VIEW, mark(ink, a, b)))

# Horizontal logo: mark + wordmark, laid out like the site's nav (font 100 units).
F = 100
K = 4 / 3  # mark grid unit at this font size (22px box for 16.5px text)
GAP = 0.36 * F  # from the mark's right edge to the first letter's ink
baseline = line_baseline(MONO, F, (100 * K - F) / 2)
_, (ink_left, _, _, _), _ = text_path(MONO, NAME, F, -0.01, 0, baseline)
text_x = 86 * K + GAP - ink_left
word_d, (wx0, wy0, wx1, wy1), _ = text_path(MONO, NAME, F, -0.01, text_x, baseline)
left, top = 13 * K, min(21 * K, wy0)
right, bottom = wx1, max(80 * K, wy1)
PAD = 12
LOGO_VIEW = f"{left - PAD:.2f} {top - PAD:.2f} {right - left + 2 * PAD:.2f} {bottom - top + 2 * PAD:.2f}"
LOGO_W, LOGO_H = right - left + 2 * PAD, bottom - top + 2 * PAD
for suffix, (ink, a, b) in variants.items():
    body = mark(ink, a, b, K) + f'<path d="{word_d}" fill="{ink}"/>'
    write(f"svg/refract-logo{suffix}.svg", svg_doc(LOGO_VIEW, body))

# App icon: the mark on the brand background, rounded like an iOS icon (radius 22.37%).
APP = svg_doc(
    "0 0 1024 1024",
    f'<rect width="1024" height="1024" rx="229" fill="{BG}"/>'
    f'<rect x="1" y="1" width="1022" height="1022" rx="228" fill="none" stroke="#FFFFFF" stroke-opacity=".07" stroke-width="2"/>'
    + mark(INK_DARK_BG, CYAN, PINK, k=10.24 * 0.78, dx=512 - 49.5 * 10.24 * 0.78, dy=512 - 50.5 * 10.24 * 0.78),
)
write("svg/refract-app-icon.svg", APP)
# Square avatar for X, Telegram, Discord (they crop to a circle; the mark stays inside it).
AVATAR = svg_doc(
    "0 0 800 800",
    f'<rect width="800" height="800" fill="{BG}"/>'
    + mark(INK_DARK_BG, CYAN, PINK, k=5.2, dx=400 - 49.5 * 5.2, dy=400 - 50.5 * 5.2),
)
write("svg/refract-avatar.svg", AVATAR)

# $RFX token: the brand spectrum disc with the white mark.
COIN = svg_doc(
    "0 0 512 512",
    '<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#22D3EE"/><stop offset=".55" stop-color="#7C3AED"/>'
    '<stop offset="1" stop-color="#DB2777"/></linearGradient></defs>'
    '<circle cx="256" cy="256" r="256" fill="url(#c)"/>'
    '<circle cx="256" cy="256" r="244" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="10"/>'
    + mark("#FFFFFF", "#FFFFFF", "#FFFFFF", k=3.3, dx=256 - 49.5 * 3.3, dy=256 - 50.5 * 3.3),
)
write("svg/rfx-token.svg", COIN)

# X / Twitter header 1500×500: logo left, tagline under it.
tag_d, (tx0, ty0, tx1, ty1), _ = text_path(SANS, TAGLINE, 44, -0.01, 0, 0)
lk = 520 / LOGO_W
banner_logo = (
    f'<g transform="translate({150:.2f} {205 - LOGO_H * lk:.2f}) scale({lk:.4f}) translate({-(left - PAD):.2f} {-(top - PAD):.2f})">'
    + mark(INK_DARK_BG, CYAN, PINK, K)
    + f'<path d="{word_d}" fill="{INK_DARK_BG}"/></g>'
)
BANNER = svg_doc(
    "0 0 1500 500",
    f'<rect width="1500" height="500" fill="{BG}"/>'
    f'{banner_logo}<path d="{tag_d}" fill="#8A8A94" transform="translate({150 + 13 * K * lk - tx0:.2f} 300)"/>',
)
write("svg/refract-x-banner.svg", BANNER)

# ---------- PNG (Chromium) ----------

jobs = []  # (svg, png, width, height, transparent)
for suffix in variants:
    jobs.append((f"svg/refract-mark{suffix}.svg", f"png/refract-mark{suffix}-1024.png", 1024, 1024, True))
    h = round(2000 * LOGO_H / LOGO_W)
    jobs.append((f"svg/refract-logo{suffix}.svg", f"png/refract-logo{suffix}-2000.png", 2000, h, True))
for size in (1024, 512, 192, 180, 32):
    jobs.append(("svg/refract-app-icon.svg", f"png/refract-app-icon-{size}.png", size, size, True))
for size in (1024, 512, 256, 200):
    jobs.append(("svg/rfx-token.svg", f"png/rfx-token-{size}.png", size, size, True))
jobs.append(("svg/refract-avatar.svg", "png/refract-avatar-800.png", 800, 800, False))
jobs.append(("svg/refract-x-banner.svg", "png/refract-x-banner-1500x500.png", 1500, 500, False))

# Brand sheet: one page with the logo, variants, colours, type and usage rules.
def inline(rel):
    with open(os.path.join(HERE, rel)) as f:
        return f.read().replace("<svg ", '<svg style="display:block;width:100%;height:100%" ', 1)


def swatch(hexv, name, use, dark_text=False):
    fg = "#141418" if dark_text else "#FFFFFF"
    return (
        f'<div class="sw"><div class="chip" style="background:{hexv};color:{fg}">{hexv}</div>'
        f'<b>{name}</b><span>{use}</span></div>'
    )


WOFF = "../apps/web/node_modules/geist/dist/fonts"
SHEET = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Geist;src:url({WOFF}/geist-sans/Geist-Regular.woff2);font-weight:400}}
@font-face{{font-family:Geist;src:url({WOFF}/geist-sans/Geist-SemiBold.woff2);font-weight:600}}
@font-face{{font-family:"Geist Mono";src:url({WOFF}/geist-mono/GeistMono-Medium.woff2);font-weight:500}}
*{{box-sizing:border-box}}
body{{margin:0;width:1600px;height:960px;background:{BG};color:#EDEDEF;font:400 15px/1.5 Geist,sans-serif;padding:64px 72px}}
h2{{font:600 13px/1 Geist;letter-spacing:.12em;text-transform:uppercase;color:#8A8A94;margin:0 0 16px}}
.top{{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:40px}}
.top .meta{{font:500 14px/1.6 "Geist Mono";color:#8A8A94;text-align:right}}
.grid{{display:grid;gap:20px}}
.card{{border:1px solid rgba(255,255,255,.08);border-radius:18px;background:#0B0B10;display:flex;align-items:center;justify-content:center}}
.logos{{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:44px}}
.logos .card{{height:150px;padding:0 34px}}
.row{{display:grid;grid-template-columns:1.25fr 1fr;gap:56px}}
.sws{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}
.sw .chip{{height:84px;border-radius:12px;display:flex;align-items:flex-end;padding:10px 12px;font:500 13px "Geist Mono";border:1px solid rgba(255,255,255,.08);margin-bottom:8px}}
.sw b{{display:block;font-weight:600;font-size:14px}} .sw span{{color:#8A8A94;font-size:13px}}
.type{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}}
.type .card{{flex-direction:column;align-items:flex-start;justify-content:flex-end;height:150px;padding:20px 22px}}
.type .aa{{font-size:44px;line-height:1}} .type small{{color:#8A8A94;font-size:13px;margin-top:10px}}
.apps{{grid-template-columns:repeat(3,minmax(0,1fr))}}
.apps .card{{height:190px;flex-direction:column;gap:14px}}
.apps .card div{{width:104px;height:104px}} .apps small{{color:#8A8A94;font-size:13px}}
ul{{margin:28px 0 0;padding:0;list-style:none;display:grid;gap:10px}}
li{{color:#C9C9D1;font-size:14.5px;padding-left:18px;position:relative}}
li:before{{content:"";position:absolute;left:0;top:9px;width:8px;height:3px;border-radius:2px;background:{CYAN}}}
</style></head><body>
<div class="top"><div style="width:420px;height:78px">{inline("svg/refract-logo.svg")}</div>
<div class="meta">brand kit · v1<br>{TOKEN} · {TAGLINE}</div></div>
<h2>Logo</h2>
<div class="grid logos">
<div class="card"><div style="width:100%;height:52px">{inline("svg/refract-logo.svg")}</div></div>
<div class="card" style="background:#FAF9F5"><div style="width:100%;height:52px">{inline("svg/refract-logo-on-light.svg")}</div></div>
<div class="card" style="background:#7C3AED;border:0"><div style="width:100%;height:52px">{inline("svg/refract-logo-white.svg")}</div></div>
<div class="card" style="background:#E7E7EA"><div style="width:100%;height:52px">{inline("svg/refract-logo-black.svg")}</div></div>
</div>
<div class="row"><div>
<h2>Colour</h2>
<div class="sws">
{swatch(BG, "Night", "Background")}
{swatch(INK_DARK_BG, "Paper", "Text, caret", True)}
{swatch(CYAN, "Signal cyan", "First answer", True)}
{swatch(PINK, "Signal pink", "Second answer", True)}
{swatch("#8B5CF6", "Violet", "Accents, token")}
{swatch(INK_LIGHT_BG, "Ink", "On light backgrounds")}
{swatch(CYAN_DEEP, "Deep cyan", "Cyan on light")}
{swatch(PINK_DEEP, "Deep pink", "Pink on light")}
</div>
<div class="type">
<div class="card"><span class="aa" style="font-weight:600;letter-spacing:-.03em">Aa Geist</span><small>Headings and interface · Geist SemiBold / Regular</small></div>
<div class="card"><span class="aa" style="font-family:'Geist Mono';font-weight:500">{NAME}</span><small>Wordmark and code · Geist Mono Medium</small></div>
</div>
</div><div>
<h2>Icons</h2>
<div class="grid apps">
<div class="card"><div>{inline("svg/refract-app-icon.svg")}</div><small>App icon</small></div>
<div class="card"><div>{inline("svg/rfx-token.svg")}</div><small>{TOKEN} token</small></div>
<div class="card"><div style="border-radius:52px;overflow:hidden">{inline("svg/refract-avatar.svg")}</div><small>Social avatar</small></div>
</div>
<ul>
<li>Keep clear space around the logo of at least the caret's height.</li>
<li>Smallest sizes: the mark at 16 px, the full logo at 96 px wide.</li>
<li>Use the on-light version on white or pale backgrounds.</li>
<li>The two lines are always cyan over pink, or both one colour.</li>
<li>Don't stretch, rotate, outline or add shadows or glows to the logo.</li>
</ul>
</div></div>
</body></html>"""
write("sheet.html", SHEET)
jobs.append(("sheet.html", "brand-sheet.png", 1600, 960, False))

render = os.path.join(HERE, "render.mjs")
subprocess.run(
    ["node", render, json.dumps([(os.path.join(HERE, a), os.path.join(HERE, b), w, h, t) for a, b, w, h, t in jobs])],
    check=True,
    cwd=HERE,
)

# favicon.ico (16, 32, 48) from the app icon.
from PIL import Image  # noqa: E402

Image.open(os.path.join(HERE, "png", "refract-app-icon-512.png")).save(
    os.path.join(HERE, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)]
)
os.remove(os.path.join(HERE, "sheet.html"))
print(f"built {len(jobs)} PNGs, {len(os.listdir(os.path.join(HERE, 'svg')))} SVGs, favicon.ico", file=sys.stderr)
