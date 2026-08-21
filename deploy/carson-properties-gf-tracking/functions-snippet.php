<?php
/**
 * ALTERNATE ROUTE — child theme functions.php snippet.
 *
 * Use this ONLY if you are not installing the mu-plugin
 * (dpm-lead-source-tracking.php). Paste everything below the opening tag into
 * wp-content/themes/data-point-astra/functions.php, and upload
 * dpm-attribution.js to wp-content/themes/data-point-astra/js/.
 *
 * The mu-plugin is the preferred option: it needs no theme edits and survives
 * theme updates. Do not run both at once — you would enqueue the JS twice.
 */

// 1) Load the cookie script in <head> (not the footer).
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script(
		'dpm-attribution',
		get_stylesheet_directory_uri() . '/js/dpm-attribution.js',
		array(),
		'1.0',
		false
	);
} );

// 2) Inject cookie values into Gravity Forms hidden fields (matched by Admin Label).
add_filter( 'gform_pre_render', 'dpm_populate_attribution_fields' );
add_filter( 'gform_pre_validation', 'dpm_populate_attribution_fields' );
add_filter( 'gform_pre_submission_filter', 'dpm_populate_attribution_fields' );
add_filter( 'gform_admin_pre_render', 'dpm_populate_attribution_fields' );

function dpm_populate_attribution_fields( $form ) {
	if ( empty( $form['fields'] ) ) {
		return $form;
	}

	// array( 0 ) = all forms; or list IDs e.g. array( 1, 2, 4 ).
	$target_form_ids = array( 0 );
	if ( ! in_array( 0, $target_form_ids, true )
		&& ! in_array( (int) $form['id'], array_map( 'intval', $target_form_ids ), true ) ) {
		return $form;
	}

	$read = function ( $name ) {
		if ( empty( $_COOKIE[ $name ] ) ) {
			return array();
		}
		$raw     = wp_unslash( $_COOKIE[ $name ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) ) {
			$decoded = json_decode( rawurldecode( $raw ), true );
		}
		return is_array( $decoded ) ? $decoded : array();
	};

	$first = $read( 'dpm_ft' );
	$last  = $read( 'dpm_lt' );

	// admin_label => array( 'first'|'last', cookie_key )
	$field_map = array(
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

	foreach ( $form['fields'] as &$field ) {
		$label = isset( $field->adminLabel ) ? strtolower( trim( $field->adminLabel ) ) : '';
		if ( '' === $label || ! isset( $field_map[ $label ] ) ) {
			continue;
		}
		list( $which, $key ) = $field_map[ $label ];
		$source = ( 'first' === $which ) ? $first : $last;
		if ( isset( $source[ $key ] ) && '' !== $source[ $key ] ) {
			$field->defaultValue = sanitize_text_field( $source[ $key ] );
		}
	}
	unset( $field );

	return $form;
}
