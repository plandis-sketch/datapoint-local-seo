import { useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTournament, useTiers, useGolferScores, useEntries } from '../hooks/useTournament';
import TierBadge from '../components/common/TierBadge';
import { useNavigate } from 'react-router-dom';

export default function MyEntries() {
  const { user } = useAuth();
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);
  const navigate = useNavigate();

  const scoreMap = useMemo(() => {
    const map = new Map<string, { points: number; score: string; position: number | null }>();
    scores.forEach((s) => map.set(s.id, { points: s.points, score: s.score, position: s.position }));
    return map;
  }, [scores]);

  const golferNameMap = useMemo(() => {
    const map = new Map<string, string>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, g.name)));
    return map;
  }, [tiers]);

  const golferTierMap = useMemo(() => {
    const map = new Map<string, number>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, t.tierNumber)));
    return map;
  }, [tiers]);

  const myEntries = useMemo(() => {
    return entries
      .filter((e) => e.userId === user?.uid)
      .map((entry) => {
        const pickIds = [entry.picks.tier1, entry.picks.tier2, entry.picks.tier3, entry.picks.tier4, entry.picks.tier5, entry.picks.tier6];
        const golferDetails = pickIds.map((id) => ({
          id,
          name: golferNameMap.get(id) || 'Unknown',
          tier: golferTierMap.get(id) || 0,
          points: scoreMap.get(id)?.points ?? 0,
          score: scoreMap.get(id)?.score ?? '--',
        }));
        const totalScore = golferDetails.reduce((sum, g) => sum + g.points, 0);
        return { ...entry, golferDetails, totalScore };
      })
      .sort((a, b) => a.entryNumber - b.entryNumber);
  }, [entries, user, scoreMap, golferNameMap, golferTierMap]);

  if (!tournament) {
    return <div className="text-center py-12 text-gray-500">No active tournament.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Entries</h1>
          <p className="text-gray-500 mt-1">{myEntries.length} entr{myEntries.length === 1 ? 'y' : 'ies'} submitted</p>
        </div>
        {!tournament.picksLocked && (
          <button
            onClick={() => navigate('/draft')}
            className="bg-masters-green text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-masters-dark transition"
          >
            + New Entry
          </button>
        )}
      </div>

      {myEntries.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm">
          <span className="text-4xl">&#128203;</span>
          <p className="text-gray-500 mt-3">You haven't submitted any entries yet.</p>
          <button
            onClick={() => navigate('/draft')}
            className="mt-4 bg-masters-green text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-masters-dark transition"
          >
            Make Your Picks
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {myEntries.map((entry) => (
            <div key={entry.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      entry.paid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {entry.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <span className="text-xl font-bold text-masters-green">{entry.totalScore || '--'}</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {entry.golferDetails.map((g) => (
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <TierBadge tierNumber={g.tier} size="sm" />
                      <span className="text-gray-700">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs">{g.score}</span>
                      <span className="font-semibold text-gray-900 w-8 text-right">{g.points || '--'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
