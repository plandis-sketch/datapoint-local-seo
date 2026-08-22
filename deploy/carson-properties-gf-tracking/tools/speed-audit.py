#!/usr/bin/env python3
"""Front-end performance audit of a WordPress/Elementor site over HTTPS."""
import re, json, sys, gzip, io, os
from concurrent.futures import ThreadPoolExecutor
import urllib.request, urllib.parse, ssl

SITE = sys.argv[1] if len(sys.argv) > 1 else 'https://carsonhomebuyer.com/'
CA = '/root/.ccr/ca-bundle.crt'
PROXY = os.environ.get('HTTPS_PROXY', '')

ctx = ssl.create_default_context(cafile=CA)
opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY}),
    urllib.request.HTTPSHandler(context=ctx),
)
UA = ('Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')


def fetch(url, decode=True):
    """Return (transfer_bytes, raw_bytes, content_type, status)."""
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Accept-Encoding': 'gzip, br, deflate',
    })
    try:
        with opener.open(req, timeout=30) as r:
            body = r.read()
            enc = (r.headers.get('Content-Encoding') or '').lower()
            transfer = len(body)
            raw = body
            if decode and enc == 'gzip':
                try:
                    raw = gzip.decompress(body)
                except Exception:
                    pass
            elif decode and enc == 'br':
                try:
                    import brotli
                    raw = brotli.decompress(body)
                except Exception:
                    raw = body
            return transfer, len(raw), (r.headers.get('Content-Type') or ''), r.status, raw
    except Exception as e:
        return None, None, str(e)[:60], 0, b''


print(f'AUDIT  {SITE}\n' + '=' * 70)

# --- HTML -------------------------------------------------------------
t, u, ctype, status, html_b = fetch(SITE)
html = html_b.decode('utf-8', 'replace')
print(f'\n[HTML]  status={status}  transfer={t/1024:.0f}KB  uncompressed={u/1024:.0f}KB')

# --- DOM size (server-rendered) --------------------------------------
tags = re.findall(r'<([a-zA-Z][a-zA-Z0-9-]*)[\s/>]', html)
VOID = {'meta', 'link', 'br', 'img', 'input', 'source', 'hr', 'path', 'area', 'col', 'base', 'wbr'}
elements = len(tags)
divs = sum(1 for x in tags if x.lower() == 'div')
print(f'[DOM]   ~{elements} elements in server HTML  ({divs} <div>)  target <1500')
depth = 0; maxdepth = 0
for m in re.finditer(r'<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(/?)>', html):
    close, name, attrs, selfclose = m.groups()
    n = name.lower()
    if n in ('script', 'style') or n in VOID or selfclose:
        continue
    if close:
        depth -= 1
    else:
        depth += 1
        maxdepth = max(maxdepth, depth)
print(f'[DOM]   max nesting depth ~{maxdepth}  (Elementor typically 15-25; >30 is heavy)')

# --- asset extraction -------------------------------------------------
def absolute(u_):
    return urllib.parse.urljoin(SITE, u_.replace('&#038;', '&').replace('&amp;', '&'))

head_html = html.split('</head>')[0] if '</head>' in html else html

css = [absolute(m) for m in re.findall(r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)', html)]
css += [absolute(m) for m in re.findall(r'<link[^>]+href=["\']([^"\']+)["\'][^>]*rel=["\']stylesheet["\']', html)]
js = [absolute(m) for m in re.findall(r'<script[^>]+src=["\']([^"\']+)', html)]
imgs = set()
for pat in (r'<img[^>]+src=["\']([^"\']+)', r'<img[^>]+data-src=["\']([^"\']+)',
            r'url\((?:&quot;|["\'])?(/wp-content/uploads/[^)"\'&]+)'):
    for m in re.findall(pat, html):
        if not m.startswith('data:'):
            imgs.add(absolute(m))
css, js = list(dict.fromkeys(css)), list(dict.fromkeys(js))

# --- render blocking --------------------------------------------------
blocking_css = [m for m in re.findall(r'<link[^>]+rel=["\']stylesheet["\'][^>]*>', head_html)
                if 'media=' not in m or re.search(r'media=["\'](all|screen)["\']', m)]
head_scripts = re.findall(r'<script[^>]*src=[^>]*>', head_html)
blocking_js = [s for s in head_scripts if 'defer' not in s and 'async' not in s]

print(f'\n[REQUESTS] css={len(css)}  js={len(js)}  images_in_html={len(imgs)}')
print(f'[BLOCKING] render-blocking <link> in head: {len(blocking_css)}')
print(f'[BLOCKING] sync <script src> in head: {len(blocking_js)}')

# --- fonts ------------------------------------------------------------
gf = re.findall(r'https://fonts\.googleapis\.com/[^"\'\s>]+', html)
gstatic = re.findall(r'https://fonts\.gstatic\.com/[^"\'\s>]+', html)
local_fonts = set(re.findall(r'[^"\'\s(]+\.(?:woff2|woff|ttf)', html))
print(f'\n[FONTS] google font <link>s: {len(gf)}   gstatic refs: {len(gstatic)}   local font files referenced: {len(local_fonts)}')
fams = set()
for u_ in gf:
    for fam in re.findall(r'family=([^&:]+)', urllib.parse.unquote(u_)):
        fams.add(fam)
    print('   ', u_[:160])
if fams:
    print('    families:', ', '.join(sorted(fams)))
print(f"[FONTS] font-display:swap present in HTML: {'yes' if 'font-display:swap' in html.replace(' ','') else 'no'}")
print(f"[FONTS] <link rel=preconnect fonts.gstatic>: {'yes' if 'preconnect' in html and 'gstatic' in html else 'no'}")

# --- plugin / stack fingerprint ---------------------------------------
print('\n[STACK]')
sig = {
    'Elementor': r'/plugins/elementor/',
    'Elementor Pro': r'/plugins/elementor-pro/',
    'WP Rocket': r'wp-rocket|data-rocket|rocket-loader',
    'Gravity Forms': r'/plugins/gravityforms/',
    'Rank Math': r'rank-math|rankmath',
    'CleanTalk': r'cleantalk',
    'Astra child': r'themes/data-point-astra',
    'jQuery Migrate': r'jquery-migrate',
    'Google Tag Manager': r'googletagmanager\.com',
    'Google Analytics': r'gtag/js|google-analytics\.com',
    'Meta Pixel': r'connect\.facebook\.net',
    'Elementor Containers (flexbox)': r'e-con|e-flex',
    'Elementor legacy sections': r'elementor-section',
    'ShortPixel': r'shortpixel',
    'Smush': r'wp-smush',
    'Imagify': r'imagify',
    'Perfmatters': r'perfmatters',
    'Autoptimize': r'autoptimize',
    'WebP in HTML': r'\.webp',
    'lazy loading': r'loading=["\']lazy',
    'Delay JS (rocket)': r'rocket-browser-checker|rocketlazyloadscript',
    'Critical/used CSS': r'data-rocket-async|rocket-critical|usedcss',
}
for name, pat in sig.items():
    n = len(re.findall(pat, html, re.I))
    if n:
        print(f'    {name:34s} {n} ref(s)')

# elementor per-page css
epc = re.findall(r'/uploads/elementor/css/([a-z0-9\-]+\.css)', html)
print(f'    Elementor per-page CSS files: {len(set(epc))} {sorted(set(epc))[:6]}')

# --- measure assets ---------------------------------------------------
def measure(url):
    t_, u_, ct, st, _ = fetch(url)
    return url, t_, u_, ct, st

print('\n[MEASURING ASSETS] ...')
all_assets = [('css', u_) for u_ in css] + [('js', u_) for u_ in js] + [('img', u_) for u_ in imgs]
results = []
with ThreadPoolExecutor(max_workers=12) as ex:
    futs = {ex.submit(measure, u_): (k, u_) for k, u_ in all_assets}
    for f in futs:
        kind, _ = futs[f]
        try:
            url, t_, u_, ct, st = f.result()
        except Exception:
            continue
        results.append((kind, url, t_ or 0, u_ or 0, st))

by = {}
for kind, url, t_, u_, st in results:
    by.setdefault(kind, []).append((t_, u_, url, st))

total_t = 0
print(f"\n{'type':5s} {'count':>5s} {'transfer':>11s} {'uncompressed':>13s}")
for kind in ('css', 'js', 'img'):
    rows = by.get(kind, [])
    st_ = sum(r[0] for r in rows); su = sum(r[1] for r in rows)
    total_t += st_
    print(f'{kind:5s} {len(rows):5d} {st_/1024:9.0f}KB {su/1024:11.0f}KB')
print(f"{'HTML':5s} {1:5d} {t/1024:9.0f}KB {u/1024:11.0f}KB")
total_t += t
print(f'\n[TOTAL] ~{total_t/1024:.0f}KB transferred over {len(results)+1} requests '
      f'(images below the fold may be lazy-loaded in a real browser)')

print('\n[TOP 15 HEAVIEST ASSETS BY TRANSFER]')
flat = sorted(results, key=lambda r: -(r[2] or 0))[:15]
for kind, url, t_, u_, st in flat:
    short = url.replace(SITE, '/').split('?')[0]
    if len(short) > 74:
        short = short[:36] + '...' + short[-35:]
    print(f'  {kind:4s} {t_/1024:7.0f}KB  {short}')

# --- image specifics --------------------------------------------------
print('\n[IMAGES] heaviest, with format/size flags')
img_rows = sorted(by.get('img', []), key=lambda r: -r[0])
for t_, u_, url, st in img_rows[:12]:
    name = url.split('/')[-1].split('?')[0]
    fmt = name.split('.')[-1].lower()
    flags = []
    if t_ > 200 * 1024:
        flags.append('OVER-200KB')
    if fmt in ('png',) and t_ > 100 * 1024:
        flags.append('PNG->WebP/JPEG')
    if fmt in ('jpg', 'jpeg', 'png'):
        flags.append('no-WebP')
    m = re.search(r'-(\d{3,4})x(\d{3,4})\.', name)
    if m and max(int(m.group(1)), int(m.group(2))) > 1600:
        flags.append('OVERSIZED>1600px')
    print(f'  {t_/1024:7.0f}KB  {name[:52]:52s} {" ".join(flags)}')

# img tags missing dimensions (CLS risk)
img_tags = re.findall(r'<img[^>]*>', html)
no_dim = [i for i in img_tags if not (re.search(r'\swidth=', i) and re.search(r'\sheight=', i))]
no_lazy = [i for i in img_tags if 'loading=' not in i]
print(f'\n[CLS]   <img> tags total={len(img_tags)}  missing width/height={len(no_dim)}  '
      f'missing loading attr={len(no_lazy)}')

print('\n[CACHE HEADERS on a static asset]')
if by.get('css'):
    probe = by['css'][0][2]
    req = urllib.request.Request(probe, headers={'User-Agent': UA})
    try:
        with opener.open(req, timeout=20) as r:
            for h in ('cache-control', 'expires', 'cf-cache-status', 'ki-cache-type', 'age'):
                v = r.headers.get(h)
                if v:
                    print(f'    {h}: {v}')
    except Exception as e:
        print('    probe failed', e)
