/**
 * One-time fix: Update tournament dates in live Firestore
 *
 * Run: node scripts/fix-tournament-dates.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env manually
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

async function fixDates() {
  const tournamentsSnap = await getDocs(collection(db, 'tournaments'));
  const tournament = tournamentsSnap.docs.find(d => d.data().name?.includes('Valspar'));

  if (!tournament) {
    console.log('No Valspar tournament found!');
    process.exit(1);
  }

  console.log(`Found: ${tournament.data().name} (${tournament.id})`);
  console.log('Old dates:', {
    start: tournament.data().dates?.start?.toDate?.(),
    end: tournament.data().dates?.end?.toDate?.(),
    firstTeeTime: tournament.data().firstTeeTime?.toDate?.(),
  });

  await updateDoc(doc(db, 'tournaments', tournament.id), {
    'dates.start': Timestamp.fromDate(new Date('2026-03-19T07:35:00-04:00')),
    'dates.end': Timestamp.fromDate(new Date('2026-03-22T18:00:00-04:00')),
    firstTeeTime: Timestamp.fromDate(new Date('2026-03-19T07:35:00-04:00')),
  });

  console.log('Updated dates to March 19-22, first tee time 7:35 AM EST');
}

fixDates()
  .then(() => process.exit(0))
  .catch(err => { console.error('Error:', err); process.exit(1); });
