import { useState, useMemo } from 'react';
import { useTournament, useTiers, useGolferScores, useEntries } from '../hooks/useTournament';
import TierBadge from '../components/common/TierBadge';

type Tab = 'pool' | 'golfers';

export default function Leaderboard() {
  const [tab, setTab] = useState<Tab>('pool');
  const { tournament } = useTournament();
  const { tiers } = useTiers(tournament?.id);
  const { scores } = useGolferScores(tournament?.id);
  const { entries } = useEntries(tournament?.id);

  // Build a map of golferId -> score info
  const scoreMap = useMemo(() => {
    const map = new Map<string, { points: number; score: string; position: number | null; status: string }>();
    scores.forEach((s) => map.set(s.id, { points: s.points, score: s.score, position: s.position, status: s.status }));
    return map;
  }, [scores]);

  // Build a map of golferId -> golfer name (from tiers)
  const golferNameMap = useMemo(() => {
    const map = new Map<string, string>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, g.name)));
    return map;
  }, [tiers]);

  // Build a map of golferId -> tier number
  const golferTierMap = useMemo(() => {
    const map = new Map<string, number>();
    tiers.forEach((t) => t.golfers.forEach((g) => map.set(g.id, t.tierNumber)));
    return map;
  }, [tiers]);

  // Calculate entry totals
  const rankedEntries = useMemo(() => {
    return entries
      .map((entry) => {
        const pickIds = [entry.picks.tier1, entry.picks.tier2, entry.picks.tier3, entry.picks.tier4, entry.picks.tier5, entry.picks.tier6];
        const golferDetails = pickIds.map((id) => ({
          id,
          name: golferNameMap.get(id) || 'Unknown',
          tier: golferTierMap.get(id) || 0,
          points: scoreMap.get(id)?.points ?? 0,
          score: scoreMap.get(id)?.score ?? '--',
          position: scoreMap.get(id)?.position ?? null,
        }));
        const totalScore = golferDetails.reduce((sum, g) => sum + g.points, 0);
        return { ...entry, golferDetails, totalScore };
      })
      .sort((a, b) => a.totalScore - b.totalScore);
  }, [entries, scoreMap, golferNameMap, golferTierMap]);

  // Sorted golfer scores
  const sortedScores = useMemo(
    () => [...scores].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [scores]
  );

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No active tournament.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{tournament.name}</h1>
        <p className="text-gray-500 mt-1">
          {tournament.status === 'in_progress'
            ? `Round ${tournament.currentRound} — Live Leaderboard`
            : tournament.status === 'complete'
              ? 'Final Results'
              : 'Waiting for tournament to start'}
        </p>
      </div>

      {/* Tab selector */}
      <div className="flex bg-white rounded-xl shadow-sm p-1 mb-6">
        <button
          onClick={() => setTab('pool')}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition ${
            tab === 'pool' ? 'bg-masters-green text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Pool Standings
        </button>
        <button
          onClick={() => setTab('golfers')}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition ${
            tab === 'golfers' ? 'bg-masters-green text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Golfer Leaderboard
        </button>
      </div>

      {tab === 'pool' ? (
        <div className="space-y-3">
          {rankedEntries.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No entries yet.</p>
          ) : (
            rankedEntries.map((entry, idx) => {
              const isTop3 = idx < 3;
              return (
                <div
                  key={entry.id}
                  className={`bg-white rounded-xl shadow-sm overflow-hidden ${
                    isTop3 ? 'ring-2 ring-masters-yellow' : ''
                  }`}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          idx === 0
                            ? 'bg-masters-yellow text-gray-900'
                            : idx === 1
                              ? 'bg-gray-300 text-gray-700'
                              : idx === 2
                                ? 'bg-orange-300 text-gray-800'
                                : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div>
                        <span className="font-semibold text-gray-900">{entry.entryLabel}</span>
                      </div>
                    </div>
                    <span className="text-xl font-bold text-masters-green">{entry.totalScore || '--'}</span>
                  </div>
                  <div className="px-4 py-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                    {entry.golferDetails.map((g) => (
                      <div key={g.id} className="flex items-center gap-1.5 text-gray-600">
                        <TierBadge tierNumber={g.tier} size="sm" />
                        <span className="truncate">{g.name}</span>
                        <span className="font-semibold text-gray-900 ml-auto">{g.points || '--'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-masters-green text-white">
              <tr>
                <th className="text-left px-4 py-3">Pos</th>
                <th className="text-left px-4 py-3">Golfer</th>
                <th className="text-center px-4 py-3">Score</th>
                <th className="text-center px-4 py-3">Today</th>
                <th className="text-center px-4 py-3">Thru</th>
                <th className="text-center px-4 py-3">Pts</th>
              </tr>
            </thead>
            <tbody>
              {sortedScores.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    No scores yet. Admin will enter scores once the tournament begins.
                  </td>
                </tr>
              ) : (
                sortedScores.map((s, idx) => (
                  <tr key={s.id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="px-4 py-2.5 font-semibold">
                      {s.status === 'cut' ? 'CUT' : s.status === 'withdrawn' ? 'WD' : s.position ?? '--'}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-2.5 text-center">{s.score}</td>
                    <td className="px-4 py-2.5 text-center">{s.today || '--'}</td>
                    <td className="px-4 py-2.5 text-center">{s.thru || '--'}</td>
                    <td className="px-4 py-2.5 text-center font-bold text-masters-green">{s.points}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
