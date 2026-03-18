/**
 * Scoring logic for the Masters Pool
 *
 * - Each golfer's points = their current tournament position
 * - Ties: all tied golfers receive the same position points (T3 = 3 pts each)
 * - Missed cut: points = (number who made cut) + 1
 * - Withdrawn R1/R2 (before cut): same as missed cut (cutPlayerCount + 1)
 * - Withdrawn R3/R4 (after cut): last place among cut-makers (cutPlayerCount)
 * - Entry total = sum of 6 golfers' points
 * - Lowest total wins
 */

export function calculateGolferPoints(
  position: number | null,
  status: 'active' | 'cut' | 'withdrawn',
  cutPlayerCount: number | null,
  currentRound?: number
): number {
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

export function calculateEntryTotal(golferPoints: number[]): number {
  return golferPoints.reduce((sum, pts) => sum + pts, 0);
}
