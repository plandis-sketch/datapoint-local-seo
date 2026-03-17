import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTournament, useTiers, useEntries, submitEntry } from '../hooks/useTournament';
import { TIER_COLORS } from '../constants/theme';
import TierBadge from '../components/common/TierBadge';
import { Timestamp } from 'firebase/firestore';

export default function Draft() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Locked if admin set picksLocked OR if first tee time has passed
  const teeTimePassed = tournament?.firstTeeTime
    ? tournament.firstTeeTime.toDate().getTime() <= Date.now()
    : false;
  const isLocked = tournament?.picksLocked || teeTimePassed;
  const allTiersPicked = tiers.length === 6 && tiers.every((t) => picks[`tier${t.tierNumber}`]);

  // Count user's existing entries
  const userEntries = entries.filter((e) => e.userId === user?.uid);
  const nextEntryNumber = userEntries.length + 1;

  const handlePick = (tierNumber: number, golferId: string) => {
    if (isLocked) return;
    setPicks((prev) => ({ ...prev, [`tier${tierNumber}`]: golferId }));
  };

  const handleSubmit = async () => {
    if (!tournament || !user || !allTiersPicked) return;
    setSubmitting(true);
    setError('');

    try {
      await submitEntry(tournament.id, {
        userId: user.uid,
        participantName: user.displayName,
        entryNumber: nextEntryNumber,
        entryLabel: `${user.displayName} #${nextEntryNumber}`,
        picks: {
          tier1: picks.tier1,
          tier2: picks.tier2,
          tier3: picks.tier3,
          tier4: picks.tier4,
          tier5: picks.tier5,
          tier6: picks.tier6,
        },
        totalScore: 0,
        paid: false,
        submittedAt: Timestamp.now(),
      });
      setSubmitted(true);
      setPicks({});
    } catch (err: any) {
      setError(err.message || 'Failed to submit entry.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No active tournament. Check back when the admin sets one up.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="text-center py-12">
        <span className="text-5xl">&#127942;</span>
        <h2 className="text-2xl font-bold text-masters-green mt-4">Entry Submitted!</h2>
        <p className="text-gray-600 mt-2">
          {user?.displayName} #{nextEntryNumber - 1} has been locked in.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-6 bg-masters-green text-white px-6 py-3 rounded-lg font-semibold hover:bg-masters-dark transition"
        >
          Submit Another Entry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{tournament.name} — Draft</h1>
        <p className="text-gray-500 mt-1">
          {isLocked
            ? 'Picks are locked. Contact the admin for any changes.'
            : `Select 1 golfer from each tier. This will be entry #${nextEntryNumber}.`}
        </p>
      </div>

      {isLocked && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-700 text-sm font-medium">
          Picks are locked — the tournament has started.
        </div>
      )}

      <div className="space-y-6">
        {tiers.map((tier) => {
          const tierConfig = TIER_COLORS[tier.tierNumber - 1];
          const selectedGolferId = picks[`tier${tier.tierNumber}`];

          return (
            <div key={tier.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className={`${tierConfig?.bg || 'bg-gray-500'} px-4 py-3 flex items-center gap-3`}>
                <TierBadge tierNumber={tier.tierNumber} />
                <span className={`font-semibold ${tierConfig?.text || 'text-white'}`}>
                  {tier.label || tierConfig?.label}
                </span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                {tier.golfers.map((golfer) => {
                  const isSelected = selectedGolferId === golfer.id;
                  return (
                    <button
                      key={golfer.id}
                      onClick={() => handlePick(tier.tierNumber, golfer.id)}
                      disabled={isLocked}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium transition border-2 ${
                        isSelected
                          ? 'border-masters-green bg-masters-green text-white'
                          : 'border-gray-200 hover:border-masters-green hover:bg-green-50 text-gray-700'
                      } ${isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {golfer.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 bg-red-50 text-red-600 text-sm rounded-lg p-3">{error}</div>
      )}

      {!isLocked && tiers.length > 0 && (
        <div className="mt-8 sticky bottom-4">
          <button
            onClick={handleSubmit}
            disabled={!allTiersPicked || submitting}
            className={`w-full py-4 rounded-xl font-bold text-lg transition shadow-lg ${
              allTiersPicked
                ? 'bg-masters-green text-white hover:bg-masters-dark'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {submitting
              ? 'Submitting...'
              : allTiersPicked
                ? `Submit Entry #${nextEntryNumber}`
                : `Select all 6 tiers (${Object.keys(picks).length}/6)`}
          </button>
        </div>
      )}
    </div>
  );
}
