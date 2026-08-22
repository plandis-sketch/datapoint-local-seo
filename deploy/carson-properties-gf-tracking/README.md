# Gravity Forms Lead Source Attribution — Carson Home Buyer

Cookie-based **first-touch** and **last-touch** attribution for
`carsonhomebuyer.com`. A small JS snippet stores the visitor's traffic source
in two cookies; the values are injected into hidden Gravity Forms fields on
submit, so every lead carries where they first came from and where they came
from most recently.

## Site facts (verified 2026-08-21, live site)

| Item | Value |
|---|---|
| Live domain | `carsonhomebuyer.com` (was `carsonproperties.kinsta.cloud` in staging) |
| Platform | WordPress on Kinsta (Cloudflare in front) |
| Forms plugin | Gravity Forms (active) |
| Forms detected on live | `gform_1`, `gform_2` |
| Theme | Astra + `data-point-astra` child theme |
| Builder | Elementor |
| Page cache | **WP Rocket, active and serving cached HTML** |

> **Why this wasn't deployed automatically:** SFTP port `60135` is not
> reachable from the automation environment (outbound is HTTPS-only), and the
> Application Password returns `401` for *every* credential — a deliberately
> wrong password gives a byte-identical `rest_forbidden`, so
> Kinsta/Cloudflare is stripping the `Authorization` header before it reaches
> WordPress. XML-RPC is also blocked (`403` at nginx). This is unchanged on
> the live domain, so it is a server config issue, not a staging quirk. See
> "If REST auth matters later" at the bottom.

---

## Recommended install — the mu-plugin (one file, no theme edits)

1. Connect over SFTP (Address `129.80.57.27`, Port `60135`, user
   `carsonproperties`) with any SFTP client — FileZilla, Cyberduck — or use the
   **MyKinsta → Sites → Carson Properties** file manager.
2. Go to `wp-content/`. If there is no `mu-plugins/` folder, create one.
3. Upload **`dpm-lead-source-tracking.php`** into `wp-content/mu-plugins/`.
   Must-use plugins auto-activate — nothing to click.
4. **Clear the WP Rocket cache** (WP Rocket → Clear Cache) so pages re-render
   with the tagged form inputs.
5. Load the site and confirm the script is present: view source and search for
   `id="dpm-attribution"`.

Do **not** also use `dpm-attribution.js` if you install the mu-plugin — the
plugin already prints the same logic inline. The `.js` file is only for the
alternate routes below.

### Alternate route A — child theme functions.php
Paste the contents of `functions-snippet.php` into
`wp-content/themes/data-point-astra/functions.php`, and upload
`dpm-attribution.js` to `wp-content/themes/data-point-astra/js/`.

### Alternate route B — Google Tag Manager (JS only)
Add `dpm-attribution.js`'s contents as a **Custom HTML** tag firing on **All
Pages**. You still need the PHP part (mu-plugin or functions snippet) — it is
what tags the form inputs with `data-dpm-key` so the JS can find them.

---

## Step 2 — add the hidden fields to each form

The code matches fields by their **Admin Field Label** (Field → Advanced tab →
"Admin Field Label"), *not* the visible label. Add a **Hidden** field for each
row below to forms 1 and 2 (and any future lead form). You only need the rows
you care about — the minimum useful set is the four **bold** ones plus `gclid`.

| Field type | Admin Field Label | Captures |
|---|---|---|
| Hidden | **ft_source** | First-touch source |
| Hidden | **ft_medium** | First-touch medium |
| Hidden | **ft_campaign** | First-touch campaign |
| Hidden | ft_term | First-touch term |
| Hidden | ft_content | First-touch content |
| Hidden | ft_landing | First-touch landing page |
| Hidden | ft_date | First-touch timestamp |
| Hidden | **lt_source** | Last-touch source |
| Hidden | lt_medium | Last-touch medium |
| Hidden | lt_campaign | Last-touch campaign |
| Hidden | lt_term | Last-touch term |
| Hidden | lt_content | Last-touch content |
| Hidden | lt_landing | Last-touch landing page |
| Hidden | lt_date | Last-touch timestamp |
| Hidden | **gclid** | Google Ads click ID |
| Hidden | fbclid | Meta click ID |
| Hidden | msclkid | Microsoft Ads click ID |

Leave each field's **Default Value blank** — it is filled at render time and
again in the browser. Save the form, then clear the WP Rocket cache. Repeat for
each target form.

> Targeting: the code populates **all** forms by default
> (`$target_form_ids = array( 0 )`). To limit it to specific forms, change that
> to e.g. `array( 1, 2 )`.

---

## Step 3 — test

1. Clear cookies for the site (or use a private window).
2. Visit with UTM + gclid:
   `https://carsonhomebuyer.com/?utm_source=google&utm_medium=cpc&utm_campaign=test&gclid=test123`
3. DevTools → Application → Cookies → confirm `dpm_ft` and `dpm_lt` hold JSON
   like `{"utm_source":"google","utm_medium":"cpc",...}`.
4. Open a form page. Inspect a hidden input — it should carry
   `data-dpm-key="lt_source"` and a filled `value`.
5. Submit a test entry. In **Forms → Entries**, confirm `ft_source`,
   `lt_source` and `gclid` are populated.
6. **Click around the site, then submit again** — the values must be unchanged.
   (This is the regression that v1.1 fixes; see below.)
7. Come back with a different source:
   `?utm_source=facebook&utm_medium=paid-social&utm_campaign=retarget`
   Submit again → **ft_** fields still show `google/cpc` (first touch sticks),
   **lt_** fields now show `facebook/paid-social` (last touch updates).
8. Clear cookies, visit with no params → records as `direct/none`.

---

## Behavior notes

- **First touch** is written once and never overwritten. 90-day window
  (`COOKIE_DAYS` in the PHP, `cookie_days` in the JS).
- **Last touch** is replaced *only* on a real marketing touch — a tracked URL
  param or an off-site referrer. Internal navigation and direct returns leave
  it alone.
- **Page caching:** WP Rocket is active on this site, so the server-rendered
  field value can be cached and served to a later visitor. The browser
  therefore always re-fills the inputs from that visitor's own cookies, and
  writes an empty string where they have no value, so a cached value from
  someone else is never submitted. This is why the PHP tags inputs with
  `data-dpm-key` — that attribute is identical for every visitor and safe to
  cache, while the value is not.
- **Consent/GDPR:** these are marketing/analytics cookies. If a consent banner
  is added later, categorise them accordingly.
- **Downstream:** captured fields flow through GF notifications, entries,
  exports, and any Zapier/webhook feed. `gclid` is what you need for Google Ads
  offline-conversion imports.

## Changelog

**v1.1** — bug-fix release, found by testing the logic before deploy:

1. **Last-touch was clobbered on every direct or internal pageview**, wiping
   `gclid` and the real source. `getParams()` computed the correct
   "was there a real touch" flag but discarded it, and the caller re-derived it
   by checking whether `utm_source` was set — always true, because a direct
   visit writes the literal string `'direct'` there. A visitor who arrived from
   a Google ad and then clicked one internal link submitted `direct/none` with
   no `gclid`. The flag is now returned and used directly.
2. **Cached pages could serve one visitor's attribution to another.** With WP
   Rocket active, PHP-injected values are baked into cached HTML. Added the
   `data-dpm-key` attribute plus client-side filling so each browser writes its
   own values (and clears stale ones).
3. **Removed the `gform_admin_pre_render` hook.** It feeds the form editor — an
   admin opening a form and clicking Save could have persisted their own
   attribution values as the fields' stored defaults.
4. Re-fills on Gravity Forms' `gform_post_render` so AJAX and multi-page forms
   are covered.

## Verification

Logic is covered by test harnesses run against these exact files (in the
session scratchpad, not shipped):

- `test_js.js` — 25 assertions over the cookie state machine and field filling:
  first/last-touch precedence, internal navigation, direct return, external
  referral, cached-page cross-visitor isolation, unmapped keys. Run against
  **both** `dpm-attribution.js` and the JS extracted from the mu-plugin, so the
  two copies cannot drift.
- `test_php.php` — 34 assertions over `populate_fields()` and
  `tag_field_input()` against stubbed WordPress/Gravity Forms: cookie decoding
  (plain, WP-slashed, URL-encoded), malformed and hostile cookie payloads,
  sanitisation, field targeting, idempotent tagging, and an assertion that
  `gform_admin_pre_render` is not hooked.

All pass. `php -l` and `node --check` are clean on all files. Note this is
logic-level verification — the end-to-end test in Step 3 still needs to be run
on the live site after deploy, since neither Gravity Forms itself nor WP Rocket
can be exercised from here.

## If REST auth matters later

To make the WordPress REST API usable for automation, the `Authorization`
header must reach PHP. On Kinsta this is normally fixed by adding
`fastcgi_param HTTP_AUTHORIZATION $http_authorization;` to the site's nginx
config, or by asking Kinsta support to enable Authorization-header
pass-through. Logged into wp-admin, **Tools → Site Health** includes an
"Authorization header" check that confirms it. Until then, deploys go over SFTP
or the MyKinsta file manager.
