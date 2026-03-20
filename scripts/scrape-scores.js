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
  getFirestore, collection, doc, setDoc, getDocs, getDoc, updateDoc, addDoc,
  query, orderBy, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// --- Load .env (local file) or use environment variables (CI) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = {};
try {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) env[key.trim()] = vals.join('=').trim();
  });
} catch {
  // No .env file — fall back to process.env (GitHub Actions, etc.)
}
// Environment variables take precedence over .env file
const getEnv = (key) => process.env[key] || env[key];

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
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

function calculatePoints(position, status, cutPlayerCount, currentRound) {
  if (status === 'cut') {
    return (cutPlayerCount ?? 50) + 1;
  }
  if (status === 'withdrawn') {
    // R3/R4 withdrawal: last place among cut-makers
    if (currentRound && currentRound >= 3) {
      return cutPlayerCount ?? 50;
    }
    // R1/R2 or unknown round: same as missed cut
    return (cutPlayerCount ?? 50) + 1;
  }
  return position ?? 999;
}

function normalizeName(name) {
  // Normalize for fuzzy matching: lowercase, strip accents/special chars
  return name
    .replace(/ø/g, 'o').replace(/Ø/g, 'o')  // Handle Nordic ø (NFD doesn't decompose it)
    .replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'n')
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

  // 3. Get all tier golfers from Firestore (our roster) + tier mapping
  const tiersSnap = await getDocs(
    query(collection(db, 'tournaments', tournament.id, 'tiers'), orderBy('tierNumber'))
  );
  const allGolfers = [];
  const golferToTier = new Map(); // golferId -> tierNumber
  tiersSnap.docs.forEach(d => {
    const tier = d.data();
    tier.golfers.forEach(g => {
      allGolfers.push(g);
      golferToTier.set(g.id, tier.tierNumber);
    });
  });
  console.log(`Roster: ${allGolfers.length} golfers across ${tiersSnap.docs.length} tiers`);

  // 3b. Read existing golfer scores (for withdrawal detection)
  const existingScoresSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'golferScores')
  );
  const existingScores = new Map();
  existingScoresSnap.docs.forEach(d => existingScores.set(d.id, d.data()));

  // 3c. Read existing entries (for finding affected users on withdrawal)
  const entriesSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'entries')
  );
  const allEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3d. Read existing withdrawal alerts (to avoid duplicates)
  const alertsSnap = await getDocs(
    collection(db, 'tournaments', tournament.id, 'withdrawalAlerts')
  );
  const existingAlertGolferIds = new Set(
    alertsSnap.docs.map(d => d.data().golferId)
  );

  // 4. Fetch ESPN API (try fetch first, fall back to curl)
  let espnData;
  try {
    const resp = await fetch(ESPN_API);
    if (!resp.ok) throw new Error(`ESPN API returned ${resp.status}`);
    espnData = await resp.json();
  } catch {
    // Fallback: use curl (works in some environments where fetch is blocked)
    try {
      const raw = execSync(`curl -s "${ESPN_API}"`, { timeout: 15000 }).toString();
      espnData = JSON.parse(raw);
    } catch (err2) {
      console.error('Failed to fetch ESPN via both fetch and curl:', err2.message);
      return;
    }
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

  // Check if tournament has started
  const eventStatus = event.status || {};
  const eventState = eventStatus.type?.state || 'pre'; // "pre", "in", "post"
  console.log(`Event state: ${eventState} (${eventStatus.type?.description || '?'})`);

  if (eventState === 'pre') {
    console.log('Tournament hasn\'t started yet. Scores will populate once play begins.');
    // Name matching check
    let matchCount = 0;
    const espnNames = new Set();
    for (const competitor of competitors) {
      const name = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
      if (name) espnNames.add(name);
      if (name && findBestMatch(name, allGolfers)) matchCount++;
    }
    console.log(`Pre-check: ${matchCount}/${allGolfers.length} of our golfers found in ESPN field`);

    // Check for pre-tournament withdrawals (golfer in our pool but dropped from ESPN field)
    const missingGolfers = allGolfers.filter(g => {
      return !competitors.some(c => {
        const name = c.athlete?.displayName || c.athlete?.fullName || '';
        return findBestMatch(name, [g]);
      });
    });
    if (missingGolfers.length > 0) {
      console.log('Missing from ESPN field (possible pre-tournament WD):');
      for (const g of missingGolfers) {
        console.log(`  - ${g.name}`);
        // Create WD alert if not already created and entries exist
        if (!existingAlertGolferIds.has(g.id)) {
          const tierNumber = golferToTier.get(g.id);
          const tierKey = `tier${tierNumber}`;
          const affected = allEntries.filter(e => e.picks?.[tierKey] === g.id).map(e => e.id);
          if (affected.length > 0) {
            // Deadline = firstTeeTime (swap before tournament starts)
            const deadline = tournament.firstTeeTime?.toDate?.()
              ? tournament.firstTeeTime.toDate()
              : new Date(tournament.firstTeeTime);
            await addDoc(
              collection(db, 'tournaments', tournament.id, 'withdrawalAlerts'),
              {
                golferId: g.id,
                golferName: g.name,
                tierNumber,
                affectedEntryIds: affected,
                swapDeadline: Timestamp.fromDate(deadline),
                status: 'active',
                createdAt: Timestamp.now(),
              }
            );
            // Also mark them as withdrawn in golferScores
            await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', g.id), {
              name: g.name,
              position: null,
              score: '--',
              today: '--',
              thru: '--',
              status: 'withdrawn',
              points: 999,
              roundScores: { r1: null, r2: null, r3: null, r4: null },
              teeTime: null,
              lastUpdated: Timestamp.now(),
              source: 'scrape',
            });
            const names = allEntries.filter(e => affected.includes(e.id)).map(e => e.participantName);
            console.log(`    PRE-TOURNAMENT WD ALERT: ${affected.length} entries affected (${names.join(', ')})`);
          }
        }
      }
    }
    return;
  }

  // Determine current round from ESPN
  const espnRound = eventStatus.period || tournament.currentRound;

  // Determine cut info — count golfers without CUT/WD status
  let cutPlayerCount = tournament.cutPlayerCount;
  const activeCompetitors = competitors.filter(c => {
    const s = (c.status?.displayValue || '').toUpperCase();
    // If status field doesn't exist, player is active
    return !s || (s !== 'CUT' && s !== 'MC' && s !== 'WD' && s !== 'DQ');
  });

  // 7. Build ESPN tee time map
  const espnTeeTimeMap = new Map(); // espnName -> teeTime Date
  for (const competitor of competitors) {
    const name = competitor.athlete?.displayName || competitor.athlete?.fullName || '';
    const teeTimeStr = competitor.status?.teeTime || competitor.teeTime;
    if (teeTimeStr) {
      espnTeeTimeMap.set(name, new Date(teeTimeStr));
    }
  }

  // 7b. Build position map from score groupings (handles ties)
  // ESPN provides competitor.order (sequential) and competitor.score (to par string)
  // Group by score to compute tied positions: T3, T10, etc.
  const sortedCompetitors = [...competitors].sort((a, b) => (a.order || 999) - (b.order || 999));
  const positionMap = new Map(); // competitor id -> { position, tied }
  let rank = 1;
  let i = 0;
  while (i < sortedCompetitors.length) {
    const score = sortedCompetitors[i].score;
    // Count how many share this score
    let j = i;
    while (j < sortedCompetitors.length && sortedCompetitors[j].score === score) j++;
    const tied = (j - i) > 1;
    for (let k = i; k < j; k++) {
      positionMap.set(sortedCompetitors[k].id, { position: rank, tied });
    }
    rank += (j - i);
    i = j;
  }

  // 8. Match ESPN golfers to our roster and update scores
  let matched = 0;
  const newWithdrawals = []; // Track new WDs this cycle

  for (const competitor of competitors) {
    const athlete = competitor.athlete || {};
    const espnName = athlete.displayName || athlete.fullName || '';
    if (!espnName) continue;

    // Find matching golfer in our roster
    const golfer = findBestMatch(espnName, allGolfers);
    if (!golfer) continue; // Not in our pool — skip

    // Parse position & status from ESPN data
    // ESPN golf API uses competitor.order for ranking and competitor.status for WD/CUT,
    // but status may be undefined during active play. Fall back to positionMap built from scores.
    let position, status;
    const statusDisplay = (competitor.status?.displayValue || '').toUpperCase().trim();
    if (statusDisplay === 'CUT' || statusDisplay === 'MC') {
      position = null;
      status = 'cut';
    } else if (statusDisplay === 'WD' || statusDisplay === 'W/D') {
      position = null;
      status = 'withdrawn';
    } else if (statusDisplay === 'DQ') {
      position = null;
      status = 'cut';
    } else {
      // Active player — use position map computed from score groupings
      const posInfo = positionMap.get(competitor.id);
      position = posInfo?.position ?? competitor.order ?? null;
      status = 'active';
    }

    // Detect new withdrawal
    const prevScore = existingScores.get(golfer.id);
    if (status === 'withdrawn' && prevScore?.status !== 'withdrawn') {
      newWithdrawals.push(golfer);
    }

    // Score to par (main tournament score)
    const scoreToPar = typeof competitor.score === 'string'
      ? competitor.score
      : competitor.score?.displayValue || 'E';

    // Today / Thru parsing
    // Derive from linescores and status since competitor.status may be undefined
    let today = '--';
    let thru = '--';

    if (competitor.status?.thru !== undefined && competitor.status?.thru !== null) {
      thru = competitor.status.thru.toString();
      if (thru === '18' || (thru === '0' && status !== 'active')) thru = 'F';
    }

    if (statusDisplay === 'F' || statusDisplay === 'CUT' || statusDisplay === 'WD' ||
        statusDisplay === 'MC' || statusDisplay === 'DQ') {
      thru = 'F';
      const currentRoundLS = (competitor.linescores || []).find(ls => ls.period === espnRound);
      today = currentRoundLS?.displayValue || currentRoundLS?.value?.toString() || '--';
    } else if (competitor.status?.displayValue) {
      today = competitor.status.displayValue;
    } else {
      // No status field — derive today/thru from linescores
      const linescores = competitor.linescores || [];
      const currentRoundLS = linescores.find(ls => ls.period === espnRound);
      if (currentRoundLS) {
        if (currentRoundLS.value !== undefined) {
          today = currentRoundLS.displayValue || currentRoundLS.value.toString();
        }
        // If they have a score for current round, check if they're done
        const holesCompleted = currentRoundLS.statistics?.find?.(s => s.name === 'holesCompleted');
        if (holesCompleted) {
          thru = holesCompleted.value === 18 ? 'F' : holesCompleted.value.toString();
        }
      }
    }

    // Round scores from linescores array
    const roundScores = { r1: null, r2: null, r3: null, r4: null };
    const linescores = competitor.linescores || [];
    for (const ls of linescores) {
      const period = ls.period;
      if (period >= 1 && period <= 4 && ls.value !== undefined) {
        roundScores[`r${period}`] = ls.value;
      }
    }

    // Tee time
    const teeTimeDate = espnTeeTimeMap.get(espnName);
    const teeTime = teeTimeDate ? Timestamp.fromDate(teeTimeDate) : (prevScore?.teeTime || null);

    // Calculate points
    const effectiveCutCount = cutPlayerCount || activeCompetitors.length || 65;
    const points = calculatePoints(position, status, effectiveCutCount, espnRound);

    // Write to Firestore
    await setDoc(doc(db, 'tournaments', tournament.id, 'golferScores', golfer.id), {
      name: golfer.name,
      position,
      score: scoreToPar,
      today,
      thru,
      status,
      points,
      roundScores,
      teeTime,
      lastUpdated: Timestamp.now(),
      source: 'scrape',
    });
    matched++;
  }

  // 9. Process new withdrawals — only create swap alerts for pre-tournament WDs
  //    Mid-round WDs (R1-R4) get penalty points but no swap opportunity
  for (const golfer of newWithdrawals) {
    // Mid-round withdrawal: log it but don't create swap alert
    if (espnRound >= 1 && eventState === 'in') {
      const roundLabel = espnRound <= 2 ? 'before the cut' : 'after the cut';
      console.log(`  ${golfer.name} withdrew mid-tournament in R${espnRound} (${roundLabel}) — no swap allowed.`);
      continue;
    }
    // Skip if we already have an alert for this golfer
    if (existingAlertGolferIds.has(golfer.id)) {
      console.log(`  Withdrawal alert already exists for ${golfer.name}, skipping.`);
      continue;
    }

    const tierNumber = golferToTier.get(golfer.id);
    if (!tierNumber) continue;

    // Find all entries that picked this golfer
    const tierKey = `tier${tierNumber}`;
    const affectedEntryIds = allEntries
      .filter(e => e.picks?.[tierKey] === golfer.id)
      .map(e => e.id);

    if (affectedEntryIds.length === 0) {
      console.log(`  ${golfer.name} withdrew but nobody picked them. No alert needed.`);
      continue;
    }

    // Calculate swap deadline = latest tee time of golfers in this tier
    // (gives users until the last golfer in the tier tees off)
    const tier = tiersSnap.docs.find(d => d.data().tierNumber === tierNumber)?.data();
    let latestTeeTime = null;
    if (tier) {
      for (const tg of tier.golfers) {
        const score = existingScores.get(tg.id);
        if (score?.teeTime) {
          const tt = score.teeTime.toDate ? score.teeTime.toDate() : new Date(score.teeTime);
          if (!latestTeeTime || tt > latestTeeTime) latestTeeTime = tt;
        }
      }
    }
    // Fallback: 2 hours from now if no tee time data
    if (!latestTeeTime) {
      latestTeeTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    }

    // Create the withdrawal alert
    const alertData = {
      golferId: golfer.id,
      golferName: golfer.name,
      tierNumber,
      affectedEntryIds,
      swapDeadline: Timestamp.fromDate(latestTeeTime),
      status: 'active',
      createdAt: Timestamp.now(),
    };

    await addDoc(
      collection(db, 'tournaments', tournament.id, 'withdrawalAlerts'),
      alertData
    );

    console.log(`  WITHDRAWAL ALERT: ${golfer.name} (Tier ${tierNumber})`);
    console.log(`    ${affectedEntryIds.length} entries affected`);
    console.log(`    Swap deadline: ${latestTeeTime.toLocaleTimeString()}`);

    // Find affected participant names for logging
    const affectedNames = allEntries
      .filter(e => affectedEntryIds.includes(e.id))
      .map(e => e.participantName || e.entryLabel);
    console.log(`    Affected: ${affectedNames.join(', ')}`);
  }

  // Update current round on tournament
  if (espnRound && espnRound !== tournament.currentRound) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      currentRound: espnRound,
    });
    console.log(`Updated current round to ${espnRound}`);
  }

  // Update cutPlayerCount after the cut (round 3+)
  if (activeCompetitors.length > 0 && espnRound >= 3 && !tournament.cutPlayerCount) {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      cutPlayerCount: activeCompetitors.length,
    });
    console.log(`Set cut player count to ${activeCompetitors.length}`);
  }

  // Check if tournament is complete
  if (eventState === 'post' && tournament.status !== 'complete') {
    await updateDoc(doc(db, 'tournaments', tournament.id), {
      status: 'complete',
    });
    console.log('Tournament complete!');
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
