/**
 * Automatic Score Scraper — Valspar Championship 2026
 *
 * Fetches live scores from ESPN's Golf API and writes to Firestore.
 * Also auto-locks picks when firstTeeTime has passed.
 *
 * Usage:
 *   node scripts/scrape-scores.js              # Run once
 *   node scripts/scrape-scores.js --loop 5     # Run every 5 minutes
 *   node scripts/scrape-scores.js --loop 1     # Run every 1 minute (during active play)
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, getDocs, updateDoc,
  query, orderBy, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// --- Load .env ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length) env[key.trim()] = vals.join('=').trim();
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- ESPN API ---
// ESPN PGA Tour scoreboard endpoint — returns JSON with all tournament data
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// --- Helpers ---

function parsePosition(displayValue) {
  // ESPN returns positions like "T3", "1", "CUT", "WD"
  if (!displayValue) return { position: null, status: 'active' };
  const val = displayValue.toString().toUpperCase().trim();
  if (val === 'CUT' || val === 'MC') return { position: null, status: 'cut' };
  if (val === 'WD' || val === 'W/D') return { position: null, status: 'withdrawn' };
  if (val === 'DQ') return { position: null, status: 'cut' };
  // "T3" -> 3, "1" -> 1
  const num = parseInt(val.replace(/^T/, ''));
  return { position: isNaN(num) ? null : num, status: 'active' };
}

function calculatePoints(position, status, cutPlayerCount) {
  if (status === 'cut' || status === 'withdrawn') {
    return (cutPlayerCount ?? 50) + 1;
  }
  return position ?? 999;
}

function normalizeName(name) {
  // Normalize for fuzzy matching: lowercase, strip accents, extra spaces
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBestMatch(espnName, tierGolfers) {
  const normalized = normalizeName(espnName);

  // Exact match first
  for (const g of tierGolfers) {
    if (normalizeName(g.name) === normalized) return g;
  }

  // Last name match (most common)
  const espnLast = normalized.split(' ').pop();
  const espnFirst = normalized.split(' ')[0];

  for (const g of tierGolfers) {
    const parts = normalizeName(g.name).split(' ');
    const gLast = parts.pop();
    const gFirst = parts[0];
    if (gLast === espnLast && gFirst === espnFirst) return g;
  }

  // Just last name (fallback for unique last names)
  const lastNameMatches = tierGolfers.filter(g => {
    const gLast = normalizeName(g.name).split(' ').pop();
    return gLast === espnLast;
  });
  if (lastNameMatches.length === 1) return lastNameMatches[0];

  return null;
}

// --- Main Scraper ---

async function scrapeAndUpdate() {
  const now = new Date();
  console.log(`\n[${now.toLocaleTimeString()}] Fetching ESPN scores...`);

  // 1. Get active tournament from Firestore
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournaments = tournamentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tournament = tournaments.find(t => t.status !== 'complete') || tournaments[0];

  if (!tournament) {
    console.log('No tournament found in Firestore.');
    return;
  }
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);

  // 2. Auto-lock picks if tee time has passed
  const firstTeeTime = tournament.firstTeeTime?.toDate?.() || new Date(tournament.firstTeeTime);
  if (now >= firstTeeTime && !tournament.picksLocked) {
    console.log('First tee time has passed — locking picks!');
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      picksLocked: true,
      status: 'in_progress',
    });
    console.log('Picks locked. Status set to in_progress.');
  }

  // 3. Get all tier golfers from Firestore (our roster)
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  tiersSnap.docs.forEach(d => {
    const tier = d.data();
    tier.golfers.forEach(g => allGolfers.push(g));
  });
  console.log(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  // 4. Fetch ESPN API
  let espnData;
  try {
    const resp = await fetch(ESPN_API);
    if (!resp.ok) throw new Error(`ESPN API returned ${resp.status}`);
    espnData = await resp.json();
  } catch (err) {
    console.error('Failed to fetch ESPN:', err.message);
    return;
  }

  // 5. Find the Valspar tournament in ESPN data
  const events = espnData.events || [];
  // Try to find by name match, or just use the first/only event
  let event = events.find(e =>
    e.name?.toLowerCase().includes('valspar') ||
    e.shortName?.toLowerCase().includes('valspar')
  );
  if (!event && events.length > 0) {
    // During tournament week, there's usually only one event
    event = events[0];
    console.log(`Using event: ${event.name || event.shortName}`);
  }
  if (!event) {
    console.log('No matching event found on ESPN. Tournament may not have started yet.');
    return;
  }

  // 6. Extract competitor data
  const competitions = event.competitions || [];
  if (competitions.length === 0) {
    console.log('No competition data available yet.');
    return;
  }

  const competition = competitions[0];
  const competitors = competition.competitors || [];
  console.log(`ESPN has ${competitors.length} competitors`);

  // Determine current round from ESPN
  const espnStatus = event.status || {};
  const espnRound = espnStatus.period || tournament.currentRound;

  // Determine cut info
  let cutPlayerCount = tournament.cutPlayerCount;
  const activeCount = competitors.filter(c => {
    const pos = c.status?.position?.displayName || '';
    return pos !== 'CUT' && pos !== 'MC' && pos !== 'WD' && pos !== 'DQ';
  }).length;

  // 7. Match ESPN golfers to our roster and update scores
  let matched = 0;
  let unmatched = 0;

  for (const competitor of competitors) {
    const athlete = competitor.athlete || {};
    const espnName = athlete.displayName || athlete.shortName || '';
    if (!espnName) continue;

    // Find matching golfer in our roster
    const golfer = findBestMatch(espnName, allGolfers);
    if (!golfer) {
      // Not in our pool — skip (many ESPN golfers won't be in our 60)
      continue;
    }

    // Parse position & status
    const posDisplay = competitor.status?.position?.displayName ||
                       competitor.sortOrder?.toString() || '';
    const { position, status } = parsePosition(posDisplay);

    // Score data
    const scoreToPar = competitor.score?.displayValue || 'E';
    const today = competitor.status?.displayValue || '--';
    const thru = competitor.status?.thru?.toString() || competitor.status?.displayValue || '--';

    // Round scores
    const roundScores = { r1: null, r2: null, r3: null, r4: null };
    const linescores = competitor.linescores || [];
    linescores.forEach((ls, idx) => {
      if (idx < 4 && ls.value !== undefined) {
        roundScores[`r${idx + 1}`] = ls.value;
      }
    });

    // Calculate points
    const points = calculatePoints(position, status, cutPlayerCount || activeCount);

    // Write to Firestore
    await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
      name: golfer.name,
      position,
      score: scoreToPar,
      today: thru === 'F' || thru === '18' ? today : today,
      thru: thru === '0' ? '--' : thru,
      status,
      points,
      roundScores,
      lastUpdated: Timestamp.now(),
      source: 'scrape',
    });
    matched++;
  }

  // Update current round on tournament
  if (espnRound && espnRound !== tournament.currentRound) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      currentRound: espnRound,
    });
    console.log(`Updated current round to ${espnRound}`);
  }

  // Update cutPlayerCount if we detected it
  if (activeCount > 0 && espnRound >= 3 && !tournament.cutPlayerCount) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      cutPlayerCount: activeCount,
    });
    console.log(`Set cut player count to ${activeCount}`);
  }

  console.log(`Updated ${matched} golfer scores (${competitors.length - matched} ESPN golfers not in our pool)`);
  console.log('Done!');
}

// --- Loop Mode ---

const args = process.argv.slice(2);
const loopIdx = args.indexOf('--loop');

if (loopIdx !== -1) {
  const minutes = parseInt(args[loopIdx + 1]) || 5;
  console.log(`Running every ${minutes} minute(s). Press Ctrl+C to stop.`);

  const run = async () => {
    try {
      await scrapeAndUpdate();
    } catch (err) {
      console.error('Error:', err.message);
    }
  };

  run(); // Run immediately
  setInterval(run, minutes * 60 * 1000);
} else {
  scrapeAndUpdate()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
}
