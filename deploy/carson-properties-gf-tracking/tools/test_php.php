<?php
/**
 * Harness: load the real mu-plugin against stubbed WordPress/Gravity Forms
 * and exercise populate_fields() + tag_field_input().
 */

define( 'ABSPATH', '/fake/' );

function wp_json_encode( $d ) { return json_encode( $d ); }
function esc_js( $s ) { return addslashes( $s ); }
function esc_attr( $s ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function wp_unslash( $s ) { return is_string( $s ) ? stripslashes( $s ) : $s; }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }

$GLOBALS['hooks'] = array();
function add_action( $h, $cb, $p = 10, $a = 1 ) { $GLOBALS['hooks'][ $h ][] = $cb; }
function add_filter( $h, $cb, $p = 10, $a = 1 ) { $GLOBALS['hooks'][ $h ][] = $cb; }

/** Minimal stand-in for GF_Field. */
class GF_Field_Stub {
	public $id;
	public $type = 'hidden';
	public $adminLabel = '';
	public $defaultValue = '';
	public function __construct( $id, $adminLabel ) {
		$this->id = $id;
		$this->adminLabel = $adminLabel;
	}
}

require '/home/user/datapoint-local-seo/deploy/carson-properties-gf-tracking/dpm-lead-source-tracking.php';

$plugin = new DPM_Lead_Source_Attribution();

$fails = 0;
function check( $label, $actual, $expected ) {
	global $fails;
	$ok = ( $actual === $expected );
	if ( ! $ok ) { $fails++; }
	echo ( $ok ? 'PASS  ' : 'FAIL  ' ) . $label;
	if ( ! $ok ) {
		echo "\n        got=" . var_export( $actual, true ) . '  want=' . var_export( $expected, true );
	}
	echo "\n";
}

function make_form( $labels, $id = 1 ) {
	$fields = array();
	$n = 5;
	foreach ( $labels as $l ) { $fields[] = new GF_Field_Stub( $n++, $l ); }
	return array( 'id' => $id, 'fields' => $fields );
}
function field_by( $form, $label ) {
	foreach ( $form['fields'] as $f ) {
		if ( strtolower( $f->adminLabel ) === $label ) { return $f; }
	}
	return null;
}

echo "=== A: fields populate from cookies ===\n";
$_COOKIE = array(
	'dpm_ft' => json_encode( array( 'utm_source' => 'google', 'utm_medium' => 'cpc', 'utm_campaign' => 'spring', 'landing_page' => '/sell/', 'timestamp' => '2026-08-21T12:00:00.000Z' ) ),
	'dpm_lt' => json_encode( array( 'utm_source' => 'facebook', 'utm_medium' => 'paid-social', 'gclid' => 'abc123' ) ),
);
$form = make_form( array( 'ft_source', 'ft_medium', 'ft_campaign', 'ft_landing', 'ft_date', 'lt_source', 'lt_medium', 'gclid', 'fbclid' ) );
$out = $plugin->populate_fields( $form );
check( 'A1 ft_source', field_by( $out, 'ft_source' )->defaultValue, 'google' );
check( 'A2 ft_medium', field_by( $out, 'ft_medium' )->defaultValue, 'cpc' );
check( 'A3 ft_campaign', field_by( $out, 'ft_campaign' )->defaultValue, 'spring' );
check( 'A4 ft_landing', field_by( $out, 'ft_landing' )->defaultValue, '/sell/' );
check( 'A5 lt_source (last touch, not first)', field_by( $out, 'lt_source' )->defaultValue, 'facebook' );
check( 'A6 lt_medium', field_by( $out, 'lt_medium' )->defaultValue, 'paid-social' );
check( 'A7 gclid reads from last-touch', field_by( $out, 'gclid' )->defaultValue, 'abc123' );
check( 'A8 fbclid absent stays empty', field_by( $out, 'fbclid' )->defaultValue, '' );

echo "\n=== B: WP-slashed cookie (WP addslashes on superglobals) ===\n";
$_COOKIE = array( 'dpm_ft' => addslashes( json_encode( array( 'utm_source' => 'google', 'utm_medium' => 'cpc' ) ) ) );
$form = make_form( array( 'ft_source' ) );
$out = $plugin->populate_fields( $form );
check( 'B1 decodes slashed JSON', field_by( $out, 'ft_source' )->defaultValue, 'google' );

echo "\n=== C: URL-encoded cookie payload ===\n";
$_COOKIE = array( 'dpm_ft' => rawurlencode( json_encode( array( 'utm_source' => 'bing', 'utm_medium' => 'cpc' ) ) ) );
$form = make_form( array( 'ft_source' ) );
$out = $plugin->populate_fields( $form );
check( 'C1 decodes URL-encoded JSON', field_by( $out, 'ft_source' )->defaultValue, 'bing' );

echo "\n=== D: no cookies at all ===\n";
$_COOKIE = array();
$form = make_form( array( 'ft_source', 'gclid' ) );
$out = $plugin->populate_fields( $form );
check( 'D1 ft_source empty', field_by( $out, 'ft_source' )->defaultValue, '' );
check( 'D2 gclid empty', field_by( $out, 'gclid' )->defaultValue, '' );

echo "\n=== E: garbage / hostile cookie must not fatal ===\n";
foreach ( array( 'not json at all', '[1,2,3]', '"a string"', 'null', '{"a":', '<script>x</script>' ) as $junk ) {
	$_COOKIE = array( 'dpm_ft' => $junk );
	$form = make_form( array( 'ft_source' ) );
	$out = $plugin->populate_fields( $form );
	check( 'E survives ' . substr( $junk, 0, 18 ), field_by( $out, 'ft_source' )->defaultValue, '' );
}

echo "\n=== F: value is sanitised ===\n";
$_COOKIE = array( 'dpm_ft' => json_encode( array( 'utm_source' => '<script>alert(1)</script>evil' ) ) );
$form = make_form( array( 'ft_source' ) );
$out = $plugin->populate_fields( $form );
check( 'F1 tags stripped', field_by( $out, 'ft_source' )->defaultValue, 'alert(1)evil' );

echo "\n=== G: non-attribution fields untouched ===\n";
$_COOKIE = array( 'dpm_ft' => json_encode( array( 'utm_source' => 'google' ) ) );
$form = make_form( array( 'email', '', 'phone' ) );
$out = $plugin->populate_fields( $form );
check( 'G1 email untouched', $out['fields'][0]->defaultValue, '' );
check( 'G2 blank admin label untouched', $out['fields'][1]->defaultValue, '' );

echo "\n=== H: empty form / no fields ===\n";
$out = $plugin->populate_fields( array( 'id' => 1, 'fields' => array() ) );
check( 'H1 returns form unchanged', is_array( $out ), true );

echo "\n=== I: tag_field_input adds data-dpm-key ===\n";
$f = new GF_Field_Stub( 7, 'lt_source' );
$html = "<div class='gfield'><input name='input_7' id='input_1_7' type='hidden' value='' /></div>";
$tagged = $plugin->tag_field_input( $html, $f, '', null, 1 );
check( 'I1 attribute added', (bool) strpos( $tagged, 'data-dpm-key="lt_source"' ), true );
check( 'I2 original input intact', (bool) strpos( $tagged, "name='input_7'" ), true );

echo "\n=== J: tag_field_input is idempotent & scoped ===\n";
$twice = $plugin->tag_field_input( $tagged, $f, '', null, 1 );
check( 'J1 not double-tagged', substr_count( $twice, 'data-dpm-key' ), 1 );
$other = new GF_Field_Stub( 8, 'email' );
$untouched = $plugin->tag_field_input( $html, $other, '', null, 1 );
check( 'J2 unmapped field not tagged', strpos( $untouched, 'data-dpm-key' ), false );
$noinput = $plugin->tag_field_input( '<div>no input here</div>', $f, '', null, 1 );
check( 'J3 markup without input untouched', $noinput, '<div>no input here</div>' );

echo "\n=== K: admin_pre_render NOT hooked (would poison saved defaults) ===\n";
check( 'K1 gform_admin_pre_render absent', isset( $GLOBALS['hooks']['gform_admin_pre_render'] ), false );
check( 'K2 gform_pre_render present', isset( $GLOBALS['hooks']['gform_pre_render'] ), true );
check( 'K3 gform_field_content present', isset( $GLOBALS['hooks']['gform_field_content'] ), true );

echo "\n=== L: label matching is case/space tolerant ===\n";
$_COOKIE = array( 'dpm_ft' => json_encode( array( 'utm_source' => 'google' ) ) );
$form = make_form( array( '  FT_Source  ' ) );
$out = $plugin->populate_fields( $form );
check( 'L1 trims and lowercases', $out['fields'][0]->defaultValue, 'google' );

echo "\n" . ( $fails === 0 ? 'ALL PASS' : $fails . ' FAILURE(S)' ) . "\n";
exit( $fails ? 1 : 0 );
