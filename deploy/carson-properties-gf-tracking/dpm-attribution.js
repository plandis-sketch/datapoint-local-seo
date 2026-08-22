/* DPM Lead Source Attribution v1.1
 * Standalone version. Use ONLY if you are NOT using the mu-plugin
 * (the mu-plugin already prints this logic inline — do not run both).
 * Deploy via GTM Custom HTML tag (All Pages) OR enqueue from functions.php:
 *
 *   add_action('wp_enqueue_scripts', function () {
 *       wp_enqueue_script('dpm-attribution',
 *           get_stylesheet_directory_uri() . '/js/dpm-attribution.js',
 *           array(), '1.1', false);
 *   });
 *
 * Two jobs:
 *   1. Maintain the first-touch / last-touch cookies.
 *   2. Fill any Gravity Forms hidden field carrying data-dpm-key with the
 *      cookie value. Job 2 is what makes this safe under page caching
 *      (WP Rocket): the PHP-rendered value can be cached and served to the
 *      wrong visitor, so the browser always re-fills from that visitor's
 *      own cookies.
 */
(function () {
  var defined_params = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'msclkid'
  ];
  var cookie_days = 90;
  var first_touch_cookie = 'dpm_ft';
  var last_touch_cookie = 'dpm_lt';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  /**
   * Returns { data: {...}, touch: bool }.
   * `touch` is true only when this pageview carries a REAL marketing touch
   * (a tracked URL param, or an off-site referrer). It must be reported by
   * this function rather than re-derived from `data`, because a direct visit
   * writes the literal string 'direct' into data.utm_source — inspecting
   * data afterwards would read that as a genuine touch and clobber the
   * last-touch cookie on every internal pageview.
   */
  function getParams() {
    var params = new URLSearchParams(window.location.search);
    var data = {}, touch = false;

    defined_params.forEach(function (key) {
      var val = params.get(key);
      if (val) { data[key] = val; touch = true; }
    });

    if (!touch) {
      var ref = document.referrer;
      if (ref) {
        try {
          var host = new URL(ref).hostname;
          if (host && host !== window.location.hostname) {
            data['utm_source'] = host;
            data['utm_medium'] = 'referral';
            touch = true;
          }
        } catch (e) {}
      }
    }

    if (!touch) {
      data['utm_source'] = 'direct';
      data['utm_medium'] = 'none';
    }

    data['landing_page'] = window.location.pathname;
    data['timestamp'] = new Date().toISOString();

    return { data: data, touch: touch };
  }

  var current = getParams();
  var payload = JSON.stringify(current.data);

  // First touch: written once, never overwritten.
  if (!getCookie(first_touch_cookie)) {
    setCookie(first_touch_cookie, payload, cookie_days);
  }
  // Last touch: only a real touch replaces it, so internal navigation and
  // direct returns never overwrite the source that actually drove the visit.
  if (current.touch || !getCookie(last_touch_cookie)) {
    setCookie(last_touch_cookie, payload, cookie_days);
  }

  /* ---- Fill Gravity Forms hidden fields from the cookies ---- */

  // admin label => [which cookie, key within it]
  var FIELD_MAP = {
    ft_source: ['ft', 'utm_source'],
    ft_medium: ['ft', 'utm_medium'],
    ft_campaign: ['ft', 'utm_campaign'],
    ft_term: ['ft', 'utm_term'],
    ft_content: ['ft', 'utm_content'],
    ft_landing: ['ft', 'landing_page'],
    ft_date: ['ft', 'timestamp'],
    lt_source: ['lt', 'utm_source'],
    lt_medium: ['lt', 'utm_medium'],
    lt_campaign: ['lt', 'utm_campaign'],
    lt_term: ['lt', 'utm_term'],
    lt_content: ['lt', 'utm_content'],
    lt_landing: ['lt', 'landing_page'],
    lt_date: ['lt', 'timestamp'],
    gclid: ['lt', 'gclid'],
    fbclid: ['lt', 'fbclid'],
    msclkid: ['lt', 'msclkid']
  };

  function readCookieObj(name) {
    var raw = getCookie(name);
    if (!raw) { return {}; }
    try {
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  }

  function fillFields() {
    var first = readCookieObj(first_touch_cookie);
    var last = readCookieObj(last_touch_cookie);
    var inputs = document.querySelectorAll('input[data-dpm-key]');
    for (var i = 0; i < inputs.length; i++) {
      var map = FIELD_MAP[inputs[i].getAttribute('data-dpm-key')];
      if (!map) { continue; }
      var val = (map[0] === 'ft' ? first : last)[map[1]];
      // Always assign — an empty write clears any stale cached value.
      inputs[i].value = (val === undefined || val === null) ? '' : val;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fillFields);
  } else {
    fillFields();
  }
  // Gravity Forms re-renders the markup for AJAX and multi-page forms.
  if (window.jQuery) {
    window.jQuery(document).on('gform_post_render', fillFields);
  }
})();
