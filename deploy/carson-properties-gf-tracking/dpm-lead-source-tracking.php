<?php
/**
 * Plugin Name: DPM Lead Source Attribution (Carson Properties)
 * Description: Cookie-based first-touch / last-touch attribution captured in JS and injected into Gravity Forms hidden fields on submission. Drop-in, no theme edits required.
 * Author:      Data Point Marketing
 * Version:     1.0.0
 *
 * INSTALL: place this file in wp-content/mu-plugins/ (create the folder if it
 * does not exist). Must-use plugins auto-activate; there is nothing to click.
 * If you prefer a regular plugin, put it in its own folder under
 * wp-content/plugins/ and activate it from Plugins.
 *
 * Then add the hidden fields to each Gravity Form you want tracked — see
 * README.md, "Step 2". Fields are matched by their Admin Field Label.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'DPM_Lead_Source_Attribution' ) ) {

	class DPM_Lead_Source_Attribution {

		/** URL params that count as a real marketing touch. */
		const PARAMS = array(
			'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
			'gclid', 'fbclid', 'msclkid',
		);

		/** How long (days) to keep the first-touch cookie. */
		const COOKIE_DAYS = 90;

		const FT_COOKIE = 'dpm_ft';
		const LT_COOKIE = 'dpm_lt';

		/**
		 * Set to array( 0 ) to populate ALL forms, or list specific form IDs,
		 * e.g. array( 1, 2, 4 ).
		 */
		private $target_form_ids = array( 0 );

		/** admin_label => array( 'first'|'last', cookie_key ) */
		private $field_map = array(
			'ft_source'   => array( 'first', 'utm_source' ),
			'ft_medium'   => array( 'first', 'utm_medium' ),
			'ft_campaign' => array( 'first', 'utm_campaign' ),
			'ft_term'     => array( 'first', 'utm_term' ),
			'ft_content'  => array( 'first', 'utm_content' ),
			'ft_landing'  => array( 'first', 'landing_page' ),
			'ft_date'     => array( 'first', 'timestamp' ),
			'lt_source'   => array( 'last', 'utm_source' ),
			'lt_medium'   => array( 'last', 'utm_medium' ),
			'lt_campaign' => array( 'last', 'utm_campaign' ),
			'lt_term'     => array( 'last', 'utm_term' ),
			'lt_content'  => array( 'last', 'utm_content' ),
			'lt_landing'  => array( 'last', 'landing_page' ),
			'lt_date'     => array( 'last', 'timestamp' ),
			'gclid'       => array( 'last', 'gclid' ),
			'fbclid'      => array( 'last', 'fbclid' ),
			'msclkid'     => array( 'last', 'msclkid' ),
		);

		public function __construct() {
			// 1) Emit the client-side cookie script early in <head>.
			add_action( 'wp_head', array( $this, 'print_tracking_script' ), 1 );

			// 2) Inject cookie values into Gravity Forms hidden fields.
			add_filter( 'gform_pre_render', array( $this, 'populate_fields' ) );
			add_filter( 'gform_pre_validation', array( $this, 'populate_fields' ) );
			add_filter( 'gform_pre_submission_filter', array( $this, 'populate_fields' ) );
			add_filter( 'gform_admin_pre_render', array( $this, 'populate_fields' ) );
		}

		public function print_tracking_script() {
			$params = wp_json_encode( self::PARAMS );
			$days   = (int) self::COOKIE_DAYS;
			$ft     = esc_js( self::FT_COOKIE );
			$lt     = esc_js( self::LT_COOKIE );
			?>
<script id="dpm-attribution">
/* DPM Lead Source Attribution v1.0 */
(function () {
	var defined_params = <?php echo $params; // phpcs:ignore ?>;
	var cookie_days = <?php echo $days; ?>;
	var first_touch_cookie = '<?php echo $ft; ?>';
	var last_touch_cookie = '<?php echo $lt; ?>';

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

	// First touch: set once, never overwrite.
	if (!getCookie(first_touch_cookie)) {
		setCookie(first_touch_cookie, payload, cookie_days);
	}
	// Last touch: overwrite only when this visit carries a real marketing touch,
	// so navigating internally (direct/none) does not wipe the last real source.
	var meaningful = false;
	for (var i = 0; i < defined_params.length; i++) {
		if (current[defined_params[i]]) { meaningful = true; break; }
	}
	if (current['utm_medium'] === 'referral') { meaningful = true; }
	if (meaningful || !getCookie(last_touch_cookie)) {
		setCookie(last_touch_cookie, payload, cookie_days);
	}
})();
</script>
			<?php
		}

		private function read_cookie( $name ) {
			if ( empty( $_COOKIE[ $name ] ) ) {
				return array();
			}
			$raw     = wp_unslash( $_COOKIE[ $name ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			$decoded = json_decode( $raw, true );
			if ( ! is_array( $decoded ) ) {
				// Some setups deliver the value still URL-encoded.
				$decoded = json_decode( rawurldecode( $raw ), true );
			}
			return is_array( $decoded ) ? $decoded : array();
		}

		public function populate_fields( $form ) {
			if ( empty( $form['fields'] ) ) {
				return $form;
			}
			if ( ! in_array( 0, $this->target_form_ids, true )
				&& ! in_array( (int) $form['id'], array_map( 'intval', $this->target_form_ids ), true ) ) {
				return $form;
			}

			$first = $this->read_cookie( self::FT_COOKIE );
			$last  = $this->read_cookie( self::LT_COOKIE );

			foreach ( $form['fields'] as &$field ) {
				$label = isset( $field->adminLabel ) ? strtolower( trim( $field->adminLabel ) ) : '';
				if ( '' === $label || ! isset( $this->field_map[ $label ] ) ) {
					continue;
				}
				list( $which, $key ) = $this->field_map[ $label ];
				$source = ( 'first' === $which ) ? $first : $last;
				if ( isset( $source[ $key ] ) && '' !== $source[ $key ] ) {
					$field->defaultValue = sanitize_text_field( $source[ $key ] );
				}
			}
			unset( $field );

			return $form;
		}
	}

	new DPM_Lead_Source_Attribution();
}
