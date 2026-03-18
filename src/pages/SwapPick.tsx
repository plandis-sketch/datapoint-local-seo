import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  useTournament, useTiers, useGolferScores, useEntries,
  useWithdrawalAlerts, swapPick,
} from '../hooks/useTournament';
import TierBadge from '../components/common/TierBadge';
import { TIER_COLORS } from '../constants/theme';

export default function SwapPick() {
  const { alertId } = useParams<{ alertId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const { alerts } = useWithdrawalAlerts(tournament?.id);
  const [swapping, setSwapping] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [selectedGolfer, setSelectedGolfer] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const alert = alerts.find((a) => a.id === alertId);

  // Countdown timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Find user's affected entries
  const affectedEntries = useMemo(() => {
    if (!alert || !user) return [];
    return entries.filter(
      (e) => e.userId === user.uid && alert.affectedEntryIds.includes(e.id)
    );
  }, [alert, entries, user]);

  // Auto-select first entry if only one
  useEffect(() => {
    if (affectedEntries.length === 1 && !selectedEntryId) {
      setSelectedEntryId(affectedEntries[0].id);
    }
  }, [affectedEntries, selectedEntryId]);

  // Get the tier for the withdrawn golfer
  const tier = useMemo(() => {
    if (!alert) return null;
    return tiers.find((t) => t.tierNumber === alert.tierNumber);
  }, [alert, tiers]);

  // Available golfers: same tier, not withdrawn, haven't teed off yet
  const availableGolfers = useMemo(() => {
    if (!tier || !alert) return [];
    const scoreMap = new Map(scores.map((s) => [s.id, s]));

    return tier.golfers.filter((g) => {
      // Exclude the withdrawn golfer
      if (g.id === alert.golferId) return false;

      const score = scoreMap.get(g.id);
      // Exclude other withdrawn golfers
      if (score?.status === 'withdrawn') return false;

      // Exclude golfers who have already teed off (thru > 0 or teeTime passed)
      if (score?.teeTime) {
        const teeTime = score.teeTime.toDate?.() ? score.teeTime.toDate() : new Date(score.teeTime as any);
        if (teeTime.getTime() <= now) return false;
      }
      // If they've already started playing, exclude
      if (score?.thru && score.thru !== '--' && score.thru !== '0') return false;

      return true;
    });
  }, [tier, alert, scores, now]);

  // Check deadline
  const deadlinePassed = alert?.swapDeadline
    ? (alert.swapDeadline.toDate?.() ? alert.swapDeadline.toDate() : new Date(alert.swapDeadline as any)).getTime() <= now
    : false;

  const timeRemaining = useMemo(() => {
    if (!alert?.swapDeadline) return '';
    const deadline = alert.swapDeadline.toDate?.() ? alert.swapDeadline.toDate() : new Date(alert.swapDeadline as any);
    const diff = deadline.getTime() - now;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    if (mins > 0) return `${mins}m ${secs}s remaining`;
    return `${secs}s remaining`;
  }, [alert, now]);

  const handleSwap = async () => {
    if (!tournament || !selectedEntryId || !selectedGolfer || !alert) return;
    setSwapping(true);
    try {
      const tierKey = `picks.tier${alert.tierNumber}`;
      await swapPick(tournament.id, selectedEntryId, tierKey, selectedGolfer);
      setSwapped(true);
    } catch (err) {
      console.error('Swap failed:', err);
    } finally {
      setSwapping(false);
    }
  };

  if (!alert) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Alert not found or already resolved.</p>
        <button
          onClick={() => navigate('/my-entries')}
          className="mt-4 text-masters-green font-semibold hover:underline"
        >
          Back to My Entries
        </button>
      </div>
    );
  }

  if (swapped) {
    const newGolfer = tier?.golfers.find((g) => g.id === selectedGolfer);
    return (
      <div className="text-center py-12">
        <span className="text-5xl">&#9989;</span>
        <h2 className="text-2xl font-bold text-masters-green mt-4">Pick Swapped!</h2>
        <p className="text-gray-600 mt-2">
          {alert.golferName} &rarr; <strong>{newGolfer?.name || 'New pick'}</strong>
        </p>
        <button
          onClick={() => navigate('/my-entries')}
          className="mt-6 bg-masters-green text-white px-6 py-3 rounded-lg font-semibold hover:bg-masters-dark transition"
        >
          View My Entries
        </button>
      </div>
    );
  }

  const tierConfig = TIER_COLORS[(alert.tierNumber || 1) - 1];

  return (
    <div>
      {/* Alert Banner */}
      <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-2xl">&#9888;&#65039;</span>
          <div>
            <h2 className="font-bold text-amber-900 text-lg">Golfer Withdrawal</h2>
            <p className="text-amber-800 mt-1">
              <strong>{alert.golferName}</strong> (Tier {alert.tierNumber}) has withdrawn from the tournament.
              You can swap your pick for another golfer in the same tier who hasn't teed off yet.
            </p>
            <p className={`text-sm font-semibold mt-2 ${deadlinePassed ? 'text-red-600' : 'text-amber-700'}`}>
              {deadlinePassed ? 'Swap window has closed.' : timeRemaining}
            </p>
          </div>
        </div>
      </div>

      {deadlinePassed ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          The swap deadline has passed. Your entry will keep the withdrawn golfer's penalty score.
          <button
            onClick={() => navigate('/my-entries')}
            className="mt-3 block text-masters-green font-semibold hover:underline"
          >
            Back to My Entries
          </button>
        </div>
      ) : (
        <>
          {/* Entry selector (if multiple affected) */}
          {affectedEntries.length > 1 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-700 mb-2">Select Entry to Swap</h3>
              <div className="grid grid-cols-2 gap-2">
                {affectedEntries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => { setSelectedEntryId(entry.id); setSelectedGolfer(null); }}
                    className={`px-4 py-3 rounded-lg text-sm font-medium border-2 transition ${
                      selectedEntryId === entry.id
                        ? 'border-masters-green bg-green-50 text-masters-green'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {entry.entryLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Available replacements */}
          {selectedEntryId && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className={`${tierConfig?.bg || 'bg-gray-500'} px-4 py-3 flex items-center gap-3`}>
                <TierBadge tierNumber={alert.tierNumber} />
                <span className={`font-semibold ${tierConfig?.text || 'text-white'}`}>
                  Pick a Replacement
                </span>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableGolfers.length === 0 ? (
                  <p className="col-span-full text-gray-500 text-sm py-4 text-center">
                    No golfers available — all have teed off.
                  </p>
                ) : (
                  availableGolfers.map((golfer) => {
                    const score = scores.find((s) => s.id === golfer.id);
                    const teeTime = score?.teeTime
                      ? (score.teeTime.toDate?.() ? score.teeTime.toDate() : new Date(score.teeTime as any))
                      : null;

                    return (
                      <button
                        key={golfer.id}
                        onClick={() => setSelectedGolfer(golfer.id)}
                        className={`px-3 py-3 rounded-lg text-sm font-medium transition border-2 text-left ${
                          selectedGolfer === golfer.id
                            ? 'border-masters-green bg-masters-green text-white'
                            : 'border-gray-200 hover:border-masters-green hover:bg-green-50 text-gray-700'
                        }`}
                      >
                        <div>{golfer.name}</div>
                        {teeTime && (
                          <div className={`text-xs mt-1 ${selectedGolfer === golfer.id ? 'text-green-100' : 'text-gray-400'}`}>
                            Tees off: {teeTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Confirm swap */}
          {selectedGolfer && (
            <div className="mt-6 sticky bottom-4">
              <button
                onClick={handleSwap}
                disabled={swapping}
                className="w-full py-4 rounded-xl font-bold text-lg bg-masters-green text-white hover:bg-masters-dark transition shadow-lg"
              >
                {swapping
                  ? 'Swapping...'
                  : `Swap to ${tier?.golfers.find((g) => g.id === selectedGolfer)?.name}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
