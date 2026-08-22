<?php
/**
 * Plugin Name: DPM Lead Source Attribution (Carson Home Buyer)
 * Description: Cookie-based first-touch / last-touch attribution captured in JS and injected into Gravity Forms hidden fields on submission. Drop-in, no theme edits required. Safe under page caching.
 * Author:      Data Point Marketing
 * Version:     1.1.0
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

		/** How long (days) to keep the cookies. */
		const COOKIE_DAYS = 90;

		const FT_COOKIE = 'dpm_ft';
		const LT_COOKIE = 'dpm_lt';

		/**
		 * Set to array( 0 ) to populate ALL forms, or list specific form IDs,
		 * e.g. array( 1, 2 ).
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
			// 1) Emit the client-side cookie + field-fill script early in <head>.
			add_action( 'wp_head', array( $this, 'print_tracking_script' ), 1 );

			// 2) Server-side value injection. Correct on uncached renders and for
			//    AJAX/multi-page forms; the JS re-fills in the browser so a cached
			//    page never serves one visitor's values to another.
			add_filter( 'gform_pre_render', array( $this, 'populate_fields' ) );
			add_filter( 'gform_pre_validation', array( $this, 'populate_fields' ) );
			add_filter( 'gform_pre_submission_filter', array( $this, 'populate_fields' ) );

			// NOTE: deliberately NOT hooked to gform_admin_pre_render. That filter
			// feeds the form editor, and an admin saving the form there would bake
			// their own attribution values in as the fields' stored defaults.

			// 3) Tag the rendered inputs so the JS can find them. The attribute is
			//    identical for every visitor, so it is safe to cache.
			add_filter( 'gform_field_content', array( $this, 'tag_field_input' ), 10, 5 );
		}

		public function print_tracking_script() {
			$params = wp_json_encode( self::PARAMS );
			$days   = (int) self::COOKIE_DAYS;
			$ft     = esc_js( self::FT_COOKIE );
			$lt     = esc_js( self::LT_COOKIE );
			?>
<script id="dpm-attribution">
/* DPM Lead Source Attribution v1.1 */
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
</script>
			<?php
		}

		/** True when this form is in scope. */
		private function targets_form( $form ) {
			if ( in_array( 0, $this->target_form_ids, true ) ) {
				return true;
			}
			return in_array( (int) $form['id'], array_map( 'intval', $this->target_form_ids ), true );
		}

		/** Normalised admin label, or '' when the field is not one of ours. */
		private function mapped_key( $field ) {
			$label = isset( $field->adminLabel ) ? strtolower( trim( (string) $field->adminLabel ) ) : '';
			return ( '' !== $label && isset( $this->field_map[ $label ] ) ) ? $label : '';
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
			if ( empty( $form['fields'] ) || ! $this->targets_form( $form ) ) {
				return $form;
			}

			$first = $this->read_cookie( self::FT_COOKIE );
			$last  = $this->read_cookie( self::LT_COOKIE );

			foreach ( $form['fields'] as &$field ) {
				$key = $this->mapped_key( $field );
				if ( '' === $key ) {
					continue;
				}
				list( $which, $cookie_key ) = $this->field_map[ $key ];
				$source = ( 'first' === $which ) ? $first : $last;
				if ( isset( $source[ $cookie_key ] ) && '' !== $source[ $cookie_key ] ) {
					$field->defaultValue = sanitize_text_field( $source[ $cookie_key ] );
				}
			}
			unset( $field );

			return $form;
		}

		/**
		 * Add data-dpm-key to our hidden inputs so the browser can fill them.
		 * Visitor-independent, so it survives page caching intact.
		 */
		public function tag_field_input( $content, $field, $value, $entry_id, $form_id ) {
			$key = $this->mapped_key( $field );
			if ( '' === $key || false === strpos( $content, '<input' ) ) {
				return $content;
			}
			if ( false !== strpos( $content, 'data-dpm-key' ) ) {
				return $content;
			}
			return preg_replace(
				'/<input\s/',
				'<input data-dpm-key="' . esc_attr( $key ) . '" ',
				$content,
				1
			);
		}
	}

	new DPM_Lead_Source_Attribution();
}
