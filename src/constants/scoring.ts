/**
 * Scoring logic for the Masters Pool
 *
 * - Each golfer's points = their current tournament position
 * - Ties: all tied golfers receive the same position points (T3 = 3 pts each)
 * - Missed cut: points = (number who made cut) + 1
 * - Withdrawn: same as missed cut
 * - Entry total = sum of 6 golfers' points
 * - Lowest total wins
 */

export function calculateGolferPoints(
  position: number | null,
  status: 'active' | 'cut' | 'withdrawn',
  cutPlayerCount: number | null
): number {
  if (status === 'cut' || status === 'withdrawn') {
    return (cutPlayerCount ?? 50) + 1;
  }
  return position ?? 999;
}

export function calculateEntryTotal(golferPoints: number[]): number {
  return golferPoints.reduce((sum, pts) => sum + pts, 0);
}
