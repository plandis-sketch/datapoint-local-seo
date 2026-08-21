# Gravity Forms Lead Source Attribution — Carson Properties

Cookie-based **first-touch** and **last-touch** attribution for
`carsonproperties.kinsta.cloud`. A small JS snippet stores the visitor's
traffic source in two cookies; a PHP filter injects those values into hidden
Gravity Forms fields on submit, so every lead carries where they first came
from and where they came from most recently.

## Site facts (detected 2026-08-21)

| Item | Value |
|---|---|
| Platform | WordPress on Kinsta (Cloudflare in front) |
| Forms plugin | Gravity Forms (active) |
| Forms detected | `gform_1`, `gform_2`, `gform_4` |
| Theme | Astra + `data-point-astra` child theme |
| Builder | Elementor |

> **Why this wasn't deployed automatically:** SFTP port `60135` is not
> reachable from the automation environment (outbound is HTTPS-only), and the
> `hermes` Application Password returns `401` for every request — Kinsta/
> Cloudflare is stripping the `Authorization` header before it reaches
> WordPress, so the REST API can't authenticate. Both auto-deploy paths are
> blocked, so the code is packaged here for a quick manual drop-in. See
> "If REST auth matters later" at the bottom.

---

## Recommended install — the mu-plugin (one file, no theme edits)

1. Connect over SFTP (Address `129.80.57.27`, Port `60135`, user
   `carsonproperties`) with any SFTP client — FileZilla, Cyberduck, or the
   **Kinsta MyKinsta → Sites → Carson Properties → SFTP/SSH** file manager.
2. Go to `wp-content/`. If there is no `mu-plugins/` folder, create one.
3. Upload **`dpm-lead-source-tracking.php`** into `wp-content/mu-plugins/`.
   Must-use plugins auto-activate — nothing to click.
4. Load the site and confirm the script is present:
   view source and search for `id="dpm-attribution"`.

Do **not** also use `dpm-attribution.js` if you install the mu-plugin — the
plugin already prints the cookie logic inline. The `.js` file is only for the
alternate routes below.

### Alternate route A — child theme functions.php
Paste the contents of `functions-snippet.php` into
`wp-content/themes/data-point-astra/functions.php`, and upload
`dpm-attribution.js` to `wp-content/themes/data-point-astra/js/`.

### Alternate route B — Google Tag Manager (JS only)
If the site uses GTM, add `dpm-attribution.js`'s contents as a **Custom HTML**
tag firing on **All Pages**. You still need the PHP field-population part
(mu-plugin or functions snippet) — GTM can't populate server-rendered fields.

---

## Step 2 — add the hidden fields to each form

The PHP matches fields by their **Admin Field Label** (Field → Advanced tab →
"Admin Field Label"), *not* the visible label. Add a **Hidden** field for each
row below to forms 1, 2, and 4 (and any future lead form). You only need the
rows you care about — the minimum useful set is the four **bold** ones plus
`gclid`.

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

Leave the field's **Default Value blank** — PHP fills it at render time. Save
the form. Repeat for each target form.

> Targeting: the plugin populates **all** forms by default
> (`$target_form_ids = array( 0 )`). To limit it to specific forms, edit that
> line to e.g. `array( 1, 2, 4 )`.

---

## Step 3 — test

1. Clear cookies for the site (or use a private window).
2. Visit with UTM + gclid:
   `https://carsonproperties.kinsta.cloud/?utm_source=google&utm_medium=cpc&utm_campaign=test&gclid=test123`
3. DevTools → Application → Cookies → confirm `dpm_ft` and `dpm_lt` hold JSON
   like `{"utm_source":"google","utm_medium":"cpc",...}`.
4. Open a form page, submit a test entry. In **Forms → Entries**, confirm
   `ft_source`/`lt_source`/`gclid` are populated.
5. Come back with a different source:
   `?utm_source=facebook&utm_medium=paid-social&utm_campaign=retarget`
   Submit again → **ft_** fields still show `google/cpc` (first touch sticks),
   **lt_** fields now show `facebook/paid-social` (last touch updates).
6. Clear cookies, visit with no params → source records as `direct/none`.

---

## Notes

- **Last-touch only overwrites on a real touch.** Plain internal navigation
  (no UTM/referrer) will not clobber the last real source with `direct/none`.
- **Cookie window:** 90 days (`COOKIE_DAYS` in the PHP, `cookie_days` in the JS).
- **Consent/GDPR:** these are marketing/analytics cookies. If a consent banner
  is added later, categorise them accordingly.
- **Downstream:** the captured fields flow through GF notifications, entries,
  exports, and any Zapier/webhook feed. `gclid` is what you need for Google Ads
  offline-conversion imports.

## If REST auth matters later

To make the WordPress REST API usable for automation, the `Authorization`
header must reach PHP. On Kinsta this is usually fixed by adding to the site's
nginx/`.htaccess` a rule to pass `HTTP_AUTHORIZATION`, or by asking Kinsta
support to enable Authorization-header pass-through. Until then, use SFTP or
the MyKinsta file manager for deploys.
