/* DPM Lead Source Attribution v1.0
 * Standalone version. Use ONLY if you are NOT using the mu-plugin
 * (the mu-plugin already prints this logic inline).
 * Deploy via GTM Custom HTML tag (All Pages) OR enqueue from functions.php:
 *
 *   add_action('wp_enqueue_scripts', function () {
 *       wp_enqueue_script('dpm-attribution',
 *           get_stylesheet_directory_uri() . '/js/dpm-attribution.js',
 *           array(), '1.0', false);
 *   });
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
  function getParams() {
    var params = new URLSearchParams(window.location.search);
    var data = {}, has_any = false;
    defined_params.forEach(function (key) {
      var val = params.get(key);
      if (val) { data[key] = val; has_any = true; }
    });
    if (!has_any) {
      var ref = document.referrer;
      if (ref) {
        try {
          var host = new URL(ref).hostname;
          if (host && host !== window.location.hostname) {
            data['utm_source'] = host;
            data['utm_medium'] = 'referral';
            has_any = true;
          }
        } catch (e) {}
      }
    }
    if (!has_any) {
      data['utm_source'] = 'direct';
      data['utm_medium'] = 'none';
    }
    data['landing_page'] = window.location.pathname;
    data['timestamp'] = new Date().toISOString();
    return data;
  }

  var current = getParams();
  var payload = JSON.stringify(current);

  if (!getCookie(first_touch_cookie)) {
    setCookie(first_touch_cookie, payload, cookie_days);
  }

  var meaningful = false;
  for (var i = 0; i < defined_params.length; i++) {
    if (current[defined_params[i]]) { meaningful = true; break; }
  }
  if (current['utm_medium'] === 'referral') { meaningful = true; }
  if (meaningful || !getCookie(last_touch_cookie)) {
    setCookie(last_touch_cookie, payload, cookie_days);
  }
})();
