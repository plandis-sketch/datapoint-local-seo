/**
 * Debug: dump ESPN competitor data structure to find where position lives
 */

const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const resp = await fetch(url);
const data = await resp.json();

const event = data.events?.find(e =>
  e.name?.toLowerCase().includes('valspar') ||
  e.shortName?.toLowerCase().includes('valspar')
) || data.events?.[0];

if (!event) { console.log('No event found'); process.exit(1); }

console.log('Event:', event.name, '| State:', event.status?.type?.state);

const competition = event.competitions?.[0];
const competitors = competition?.competitors || [];

// Dump first 3 competitors' relevant fields
for (const c of competitors.slice(0, 5)) {
  const name = c.athlete?.displayName || 'unknown';
  console.log(`\n=== ${name} ===`);
  console.log('c.status:', JSON.stringify(c.status, null, 2));
  console.log('c.score:', JSON.stringify(c.score));
  console.log('c.sortOrder:', c.sortOrder);
  console.log('c.position:', JSON.stringify(c.position));
  console.log('c.statistics:', JSON.stringify(c.statistics)?.substring(0, 200));
  // Check top-level keys
  const keys = Object.keys(c).filter(k => !['athlete', 'linescores', 'status'].includes(k));
  console.log('Other keys:', keys);
}
