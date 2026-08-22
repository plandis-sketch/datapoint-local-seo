# Speed Audit — carsonhomebuyer.com

Front-end audit performed 2026-08-22 against the live site. WordPress + Astra
(`data-point-astra` child) + Elementor Pro, WP Rocket, Gravity Forms, Rank
Math, CleanTalk, on Kinsta behind Cloudflare.

## Scope note — what was and wasn't measurable

Everything below is measured over HTTPS: real transfer sizes, srcset contents,
content negotiation, cache headers, server-rendered DOM, font declarations,
and a crawl of all 30 sitemap pages.

**Lab Core Web Vitals (LCP / TBT / CLS) are not in this report.** The
PageSpeed Insights API's shared quota was exhausted, and headless Chromium
cannot reach this environment's egress proxy (`ERR_PROXY_CONNECTION_FAILED`),
so no Lighthouse run was possible. Run PSI manually on
`https://carsonhomebuyer.com/` for the scores — the fixes below are ranked by
measured bytes and by known LCP mechanics, which does not depend on having the
score.

**No changes have been applied.** Deploy access is still blocked (see the
README) so this is a plan, not a changelog.

---

## Measured baseline — homepage

| Metric | Measured | Target |
|---|---|---|
| Total transfer | **~1,528 KB** | < 1,500 KB |
| Images | **1,201 KB (79% of page)** | < 500 KB |
| HTML | 56 KB transfer / **348 KB uncompressed** | < 100 KB raw |
| CSS | 70 KB transfer / **1,107 KB uncompressed**, 24 files | < 300 KB raw |
| JS | 201 KB transfer / 716 KB uncompressed, 26 files | — |
| Requests | 63 | < 50 |
| Server-rendered DOM | ~1,380 elements, depth 19 | < 1,500 ✅ |
| TTFB | 0.29 – 0.66 s (variable) | < 0.6 s |
| Static asset caching | `max-age=315360000`, Cloudflare `HIT` | ✅ good |
| Compression | Brotli ✅ | ✅ |
| HTTP version | HTTP/2 ✅ | ✅ |
| `<img>` missing width/height | 0 of 24 ✅ | 0 (CLS) |

Good news first: DOM size, asset caching, Brotli, HTTP/2, image dimensions,
and Elementor's modern flexbox containers (252 refs vs 4 legacy sections) are
all already in decent shape. WP Rocket's Delay JS is on and there are **zero**
render-blocking sync scripts in `<head>`. The wins are concentrated in images,
fonts, and CSS.

---

## Site-wide image audit (all 30 pages crawled)

| Finding | Value |
|---|---|
| Unique image URLs referenced | 142 |
| Distinct images | 40 |
| Images over 200 KB | **30** |
| Weight of those 30 | **24.6 MB** |
| Largest single image | **1,578 KB** (`We-Buy-Houses-Williamston-scaled.jpg`) |
| WebP variants generated | **3 of 40** |
| WebP actually served | **No** — see below |
| Estimated saving from resize + WebP | **~19.2 MB (78%)** |

Every one of the top 15 offenders is a **2,560px-wide `-scaled` original** —
WordPress's `big_image_size_threshold` default. Nine images exceed 1 MB each.

```
1578KB  We-Buy-Houses-Williamston-scaled.jpg
1451KB  We-Buy-Houses-In-Charlotte-Michigan-scaled.jpeg
1345KB  We-Buy-Houses-In-St.-Johns-MI-scaled.jpg
1144KB  We-Buy-Houses-In-Holt-scaled.jpeg
1096KB  Sell-My-House-In-St.-Johns-Michigan-scaled.jpg
 ... 25 more over 200KB
```

---

## Priority 1 — The hero image is lazy-loaded on every page

**This is the top LCP fix and it costs nothing but a setting.**

The homepage hero renders as:

```html
<img decoding="async" width="2560" height="1920"
     src="data:image/svg+xml,...(placeholder)..."
     data-lazy-srcset="...A-Property-In-Michigan-Sold-As-Is-scaled.jpeg 2560w, ..."
     data-lazy-sizes="(max-width: 2560px) 100vw, 2560px">
```

Three compounding problems:

1. **It is lazy-loaded.** The real `src` is a placeholder SVG; the image only
   starts downloading after JS runs. For an above-the-fold LCP element this
   directly delays LCP — the browser cannot even begin the request during
   initial HTML parse. **Confirmed on all 8 pages sampled — every one
   lazy-loads its hero.**
2. **No `fetchpriority="high"` and no preload.** WP Rocket *is* preloading an
   image — but it's the 24 KB logo, not the LCP hero.
3. **`sizes="(max-width: 2560px) 100vw"`** tells the browser the image spans
   the full viewport at any width up to 2560px. On a 1440px retina desktop the
   browser computes 2880px needed and picks the **2560w / 844 KB** candidate.

### Fix
- WP Rocket → **Media → enable "Optimize critical images"** (a.k.a. above-the-fold
  / LCP optimization, WP Rocket 3.16+). It auto-detects the LCP element,
  excludes it from lazyload, and adds `fetchpriority="high"`. This single
  setting addresses items 1 and 2 site-wide.
- If it misidentifies the element, add the hero filenames manually under
  **Media → Excluded images or iframes**.
- Fix `sizes` by setting the hero's display width correctly in Elementor, or
  filter it:

```php
// Correct the sizes attribute so browsers stop picking the 2560w candidate.
// The hero renders inside a max-1600px container, not the full viewport.
add_filter( 'wp_calculate_image_sizes', function ( $sizes, $size ) {
    if ( is_array( $size ) && isset( $size[0] ) && $size[0] >= 2000 ) {
        return '(max-width: 1600px) 100vw, 1600px';
    }
    return $sizes;
}, 10, 2 );
```

**Expected:** LCP image drops from 844 KB to ~140–290 KB before any
re-compression, and starts downloading immediately instead of after JS.

---

## Priority 2 — WebP is generated but never served

Content negotiation proves it:

```
GET .../A-Property-In-Michigan-Sold-As-Is-scaled.jpeg
Accept: image/webp,image/*,*/*
→ Content-Type: image/jpeg     (851,438 bytes)
→ Vary: accept-encoding        (note: NOT "accept")
```

A `...-scaled.jpeg.webp` (688 KB) exists on disk, but requests come back as
JPEG. The `Vary` header doesn't include `accept`, so nothing is negotiating on
image format. WebP coverage is only **3 of 40 images** anyway.

**Important on Kinsta:** Kinsta runs nginx, so `.htaccess` rewrite rules — the
mechanism most WebP guides and WP Rocket's "WebP caching" rely on — **do
nothing here.** Use an image plugin configured to deliver WebP via
`<picture>` tag rewriting instead, which is nginx-safe.

### Fix
1. Install **ShortPixel** or **Imagify** (neither is currently active — only a
   stray Perfmatters reference was found).
2. Enable **WebP + AVIF generation** and set delivery to **"`<picture>` tag"**
   mode, not `.htaccess` rewriting.
3. In the same plugin, set **"Resize large images" to max 1600px** and run the
   **bulk optimizer** across the library at quality 78–80.
4. Prevent recurrence for future uploads:

```php
// Stop WordPress retaining 2560px "-scaled" originals for new uploads.
add_filter( 'big_image_size_threshold', function () {
    return 1600;
} );
```

**Expected:** ~19 MB / 78% off total image weight; homepage images 1,201 KB →
roughly 300–400 KB.

---

## Priority 3 — Font loading is loading ~40 unused variants

WP Rocket is self-hosting Google Fonts (good), but the preloaded stylesheet
requests:

```
family=Roboto:100,100italic,200,200italic,300,300italic,400,400italic,
              500,500italic,600,600italic,700,700italic,800,800italic,900,900italic
      |Roboto Slab:100,100italic,...,900italic
      |Encode Sans:...
```

That's **every weight and italic of Roboto and Roboto Slab** — Elementor's
default behaviour — plus Encode Sans and Manrope. The site realistically uses
two or three weights. Roboto and Roboto Slab may not be used at all if the
design runs on Encode Sans / Manrope.

### Fix
1. **Elementor → Settings → Advanced → Google Fonts Load: `Disabled`** if
   Roboto/Roboto Slab are unused (verify in Site Settings → Global Fonts
   first). This alone drops the whole Roboto payload.
2. Otherwise trim Global Fonts to 400 + 700 (+ one accent weight).
3. Confirm `font-display: swap` — it was **not** detectable in the HTML.

**Expected:** 50–150 KB saved and one render-blocking preload chain removed.

---

## Priority 4 — 22 render-blocking stylesheets, 1.1 MB of raw CSS

24 CSS files, 22 render-blocking `<link>`s in `<head>`, 1,107 KB uncompressed.
No "Remove Unused CSS" marker appears in the HTML, so that WP Rocket feature is
off. Six separate Elementor per-page CSS files are loading
(`post-7`, `post-14`, `post-40`, `post-48`, `base-desktop`, `base-mobile`).

### Fix
- WP Rocket → **File Optimization → Remove Unused CSS** (preferred over
  "Combine CSS"). On an Elementor site this typically cuts delivered CSS by
  70–90% and eliminates the blocking chain.
- Elementor → Settings → Performance → **Improved CSS Loading** and
  **Inline Font Icons**.
- Elementor → Experiments → **Optimized DOM Output**.
- After any of these: clear WP Rocket cache **and** Elementor → Tools →
  **Regenerate CSS & Data**.

⚠️ Test the Gravity Forms pages after enabling Remove Unused CSS — it
occasionally strips form styling and needs a safelist entry.

---

## Priority 5 — HTML payload and edge caching

**348 KB of uncompressed HTML** on the homepage (231–348 KB across the site) is
heavy to parse on mid-range mobile. Rank Math accounts for 235 references —
largely JSON-LD schema. Worth reviewing which schema types are enabled.

**Edge cache is being bypassed for HTML:**

```
cf-cache-status: DYNAMIC
ki-cf-cache-status: BYPASS
ki-cache-type: None
set-cookie: __cf_bm=...        ← Cloudflare bot-management cookie
```

WP Rocket is generating the page at origin (its footer comment is present),
but neither Kinsta's edge cache nor Cloudflare is serving the HTML, so every
visitor waits on origin — consistent with the variable 0.29–0.66 s TTFB.

Kinsta provides its own server-level full-page cache and **advises against
running a second page cache on top of it**. Worth a ticket to Kinsta support
asking why `ki-cache-type` is `None` and whether WP Rocket's page caching
should be disabled in favour of Kinsta's. I'd raise it as a question rather
than flipping it blind — mis-sequencing two page caches can serve stale or
logged-in content.

---

## Expected outcome

| | Now | After P1–P4 |
|---|---|---|
| Homepage transfer | ~1,528 KB | **~600–700 KB** |
| Homepage images | 1,201 KB | ~300–400 KB |
| LCP image bytes | 844 KB, lazy-loaded | ~150–290 KB, preloaded |
| Library-wide image weight | 24.6 MB | ~5.4 MB |
| Render-blocking CSS | 22 files | 1–3 |

Ordering matters: **P1 and P2 are ~80% of the benefit** and are both settings
changes plus one bulk operation. P3 and P4 are cleanup. P5 is a hosting
question.

---

## Verification after changes

1. PSI mobile + desktop on `/`, `/sell-your-house/`, and one city page
   (`/sell-your-house/okemos/` — it carries a 961 KB image today).
2. Confirm the hero is no longer lazy-loaded: view source, check the hero
   `<img>` has a real `src` and `fetchpriority="high"`, not a `data:` placeholder.
3. Confirm WebP delivery: `curl -H 'Accept: image/webp' -I <image-url>` should
   return `Content-Type: image/webp`.
4. Re-run the audit script for a like-for-like byte comparison.
5. Clear every layer after changes: WP Rocket cache → Elementor Regenerate CSS
   → Kinsta cache → Cloudflare cache.

## Maintenance

- [ ] Set `big_image_size_threshold` to 1600 so new uploads can't reintroduce 2,560px files
- [ ] Let ShortPixel/Imagify auto-compress on upload
- [ ] `define( 'WP_POST_REVISIONS', 5 );` in wp-config.php — Elementor stores a full `_elementor_data` blob per revision
- [ ] Re-run PSI monthly; scores drift as city pages are added
- [ ] Each new city page currently ships a ~1 MB hero — fix the upload pipeline and the problem stops recurring
