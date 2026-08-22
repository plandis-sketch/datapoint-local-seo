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

// 1) Load the cookie + field-fill script in <head> (not the footer).
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script(
		'dpm-attribution',
		get_stylesheet_directory_uri() . '/js/dpm-attribution.js',
		array(),
		'1.1',
		false
	);
} );

// 2) Server-side value injection. Correct on uncached renders and for
//    AJAX/multi-page forms; dpm-attribution.js re-fills in the browser so a
//    cached page never serves one visitor's values to another.
//    Deliberately NOT hooked to gform_admin_pre_render — that filter feeds the
//    form editor, and an admin saving the form there would bake their own
//    attribution values in as the fields' stored defaults.
add_filter( 'gform_pre_render', 'dpm_populate_attribution_fields' );
add_filter( 'gform_pre_validation', 'dpm_populate_attribution_fields' );
add_filter( 'gform_pre_submission_filter', 'dpm_populate_attribution_fields' );

// 3) Tag the rendered inputs so the JS can find them. The attribute is
//    identical for every visitor, so it is safe to cache.
add_filter( 'gform_field_content', 'dpm_tag_attribution_input', 10, 5 );

/** admin_label => array( 'first'|'last', cookie_key ) */
function dpm_attribution_field_map() {
	return array(
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
}

/** Normalised admin label, or '' when the field is not one of ours. */
function dpm_attribution_mapped_key( $field ) {
	$label = isset( $field->adminLabel ) ? strtolower( trim( (string) $field->adminLabel ) ) : '';
	$map   = dpm_attribution_field_map();
	return ( '' !== $label && isset( $map[ $label ] ) ) ? $label : '';
}

function dpm_attribution_read_cookie( $name ) {
	if ( empty( $_COOKIE[ $name ] ) ) {
		return array();
	}
	$raw     = wp_unslash( $_COOKIE[ $name ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	$decoded = json_decode( $raw, true );
	if ( ! is_array( $decoded ) ) {
		$decoded = json_decode( rawurldecode( $raw ), true );
	}
	return is_array( $decoded ) ? $decoded : array();
}

function dpm_populate_attribution_fields( $form ) {
	if ( empty( $form['fields'] ) ) {
		return $form;
	}

	// array( 0 ) = all forms; or list IDs e.g. array( 1, 2 ).
	$target_form_ids = array( 0 );
	if ( ! in_array( 0, $target_form_ids, true )
		&& ! in_array( (int) $form['id'], array_map( 'intval', $target_form_ids ), true ) ) {
		return $form;
	}

	$first = dpm_attribution_read_cookie( 'dpm_ft' );
	$last  = dpm_attribution_read_cookie( 'dpm_lt' );
	$map   = dpm_attribution_field_map();

	foreach ( $form['fields'] as &$field ) {
		$key = dpm_attribution_mapped_key( $field );
		if ( '' === $key ) {
			continue;
		}
		list( $which, $cookie_key ) = $map[ $key ];
		$source = ( 'first' === $which ) ? $first : $last;
		if ( isset( $source[ $cookie_key ] ) && '' !== $source[ $cookie_key ] ) {
			$field->defaultValue = sanitize_text_field( $source[ $cookie_key ] );
		}
	}
	unset( $field );

	return $form;
}

function dpm_tag_attribution_input( $content, $field, $value, $entry_id, $form_id ) {
	$key = dpm_attribution_mapped_key( $field );
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
