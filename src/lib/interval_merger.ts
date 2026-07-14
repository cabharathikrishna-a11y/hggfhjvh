import { LocalHistoryVault } from "./dexie_db";

/**
 * LeetCode 56 Interval Deduplication Algorithm:
 * Merges overlapping physical focus time intervals to prevent double-counting across multi-device logs,
 * returning the deduplicated focus duration in milliseconds.
 */
export function mergeAndCalculateTotalFocusMs(records: LocalHistoryVault[]): number {
  if (records.length === 0) return 0;

  // Build physical intervals [startTimeMs, endTimeMs]
  const intervals: { start: number; end: number }[] = records.map(rec => {
    const start = rec.startTimeMs;
    const end = Math.max(rec.endTimeMs || 0, start + (rec.totalFocusMs || 0));
    return { start, end };
  });

  // Sort intervals by start time
  const sorted = [...intervals].sort((a, b) => a.start - b.start);

  // Merge overlapping intervals (LeetCode 56)
  const merged: { start: number; end: number }[] = [];
  merged.push(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push(curr);
    }
  }

  // Calculate sum of durations of merged intervals
  return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}
