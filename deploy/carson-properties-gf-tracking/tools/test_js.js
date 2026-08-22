// Harness: run the attribution JS against simulated visits, inspect cookies
// and the hidden-field values it writes.
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');

// If handed the PHP mu-plugin, extract the inline JS and resolve its PHP echoes,
// so the exact shipped code is what gets tested.
if (path.endsWith('.php')) {
  const m = src.match(/<script id="dpm-attribution">([\s\S]*?)<\/script>/);
  if (!m) { console.error('could not extract inline JS from PHP'); process.exit(2); }
  src = m[1]
    .replace(/<\?php\s*echo\s*\$params;[^?]*\?>/g,
      JSON.stringify(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid']))
    .replace(/<\?php\s*echo\s*\$days;\s*\?>/g, '90')
    .replace(/<\?php\s*echo\s*\$ft;\s*\?>/g, 'dpm_ft')
    .replace(/<\?php\s*echo\s*\$lt;\s*\?>/g, 'dpm_lt');
  if (/<\?php/.test(src)) {
    console.error('unresolved PHP left in extracted JS:', src.match(/<\?php[^>]*>/g));
    process.exit(2);
  }
}

function makeInput(key) {
  return { _k: key, value: 'STALE_CACHED_VALUE', getAttribute: function () { return this._k; } };
}

function makeEnv(url, referrer, jar, inputs) {
  const u = new URL(url);
  const doc = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll() { return inputs; },
    get cookie() {
      return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(str) {
      const [pair] = str.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
    },
    referrer: referrer || '',
  };
  return {
    document: doc,
    window: { location: { search: u.search, pathname: u.pathname, hostname: u.hostname } },
    URLSearchParams, URL, Date, JSON, RegExp,
    decodeURIComponent, encodeURIComponent,
  };
}

function visit(jar, url, referrer, inputs) {
  const env = makeEnv(url, referrer, jar, inputs || []);
  new Function(...Object.keys(env), src)(...Object.values(env));
}

const read = (jar, name) => (jar[name] ? JSON.parse(decodeURIComponent(jar[name])) : null);

const SITE = 'https://carsonhomebuyer.com';
let fails = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `\n        got=${JSON.stringify(actual)}  want=${JSON.stringify(expected)}`));
}

console.log('=== A: paid landing, then internal navigation ===');
{
  const jar = {};
  visit(jar, `${SITE}/?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=abc123`, '');
  check('A1 ft_source', read(jar, 'dpm_ft').utm_source, 'google');
  check('A2 lt_source', read(jar, 'dpm_lt').utm_source, 'google');
  check('A3 gclid captured', read(jar, 'dpm_lt').gclid, 'abc123');
  visit(jar, `${SITE}/contact/`, `${SITE}/`);           // same-host referrer
  check('A4 ft survives internal nav', read(jar, 'dpm_ft').utm_source, 'google');
  check('A5 lt survives internal nav', read(jar, 'dpm_lt').utm_source, 'google');
  check('A6 gclid survives internal nav', read(jar, 'dpm_lt').gclid, 'abc123');
}

console.log('\n=== B: first touch sticks, last touch updates ===');
{
  const jar = {};
  visit(jar, `${SITE}/?utm_source=google&utm_medium=cpc`, '');
  visit(jar, `${SITE}/?utm_source=facebook&utm_medium=paid-social`, '');
  check('B1 ft still google', read(jar, 'dpm_ft').utm_source, 'google');
  check('B2 lt now facebook', read(jar, 'dpm_lt').utm_source, 'facebook');
  check('B3 lt_medium paid-social', read(jar, 'dpm_lt').utm_medium, 'paid-social');
}

console.log('\n=== C: external referral ===');
{
  const jar = {};
  visit(jar, `${SITE}/`, 'https://www.zillow.com/listing');
  check('C1 source', read(jar, 'dpm_ft').utm_source, 'www.zillow.com');
  check('C2 medium', read(jar, 'dpm_ft').utm_medium, 'referral');
}

console.log('\n=== D: pure direct visit ===');
{
  const jar = {};
  visit(jar, `${SITE}/`, '');
  check('D1 source', read(jar, 'dpm_ft').utm_source, 'direct');
  check('D2 medium', read(jar, 'dpm_ft').utm_medium, 'none');
}

console.log('\n=== E: paid landing, then DIRECT return (bookmark / type-in) ===');
{
  const jar = {};
  visit(jar, `${SITE}/?utm_source=google&utm_medium=cpc&gclid=abc123`, '');
  visit(jar, `${SITE}/`, '');
  check('E1 ft still google', read(jar, 'dpm_ft').utm_source, 'google');
  check('E2 lt not clobbered by direct', read(jar, 'dpm_lt').utm_source, 'google');
  check('E3 gclid survives', read(jar, 'dpm_lt').gclid, 'abc123');
}

console.log('\n=== F: referral then direct — referral must survive ===');
{
  const jar = {};
  visit(jar, `${SITE}/`, 'https://www.zillow.com/listing');
  visit(jar, `${SITE}/about/`, `${SITE}/`);
  check('F1 lt still referral source', read(jar, 'dpm_lt').utm_source, 'www.zillow.com');
}

console.log('\n=== G: hidden fields filled from cookies (cache-safe) ===');
{
  const jar = {};
  const inputs = ['ft_source', 'ft_medium', 'ft_campaign', 'lt_source', 'gclid', 'fbclid'].map(makeInput);
  visit(jar, `${SITE}/?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=abc123`, '', inputs);
  const by = k => inputs.find(i => i._k === k).value;
  check('G1 ft_source input', by('ft_source'), 'google');
  check('G2 ft_medium input', by('ft_medium'), 'cpc');
  check('G3 ft_campaign input', by('ft_campaign'), 'spring');
  check('G4 lt_source input', by('lt_source'), 'google');
  check('G5 gclid input', by('gclid'), 'abc123');
  check('G6 absent fbclid clears stale cached value', by('fbclid'), '');
}

console.log('\n=== H: second visitor on a CACHED page gets their own values ===');
{
  // Visitor B loads HTML cached from visitor A (inputs pre-filled with A's data).
  const jarB = {};
  const inputs = [makeInput('lt_source'), makeInput('gclid')];
  inputs[0].value = 'google';    // visitor A's cached value
  inputs[1].value = 'A_GCLID';
  visit(jarB, `${SITE}/?utm_source=facebook&utm_medium=paid-social`, '', inputs);
  check('H1 lt_source overwritten with B\'s source', inputs[0].value, 'facebook');
  check('H2 A\'s gclid does not leak to B', inputs[1].value, '');
}

console.log('\n=== I: unmapped/unknown key is left alone ===');
{
  const jar = {};
  const odd = makeInput('not_a_real_key');
  visit(jar, `${SITE}/?utm_source=google`, '', [odd]);
  check('I1 untouched', odd.value, 'STALE_CACHED_VALUE');
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails ? 1 : 0);
