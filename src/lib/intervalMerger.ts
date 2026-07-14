// intervalMerger.ts

export interface StudyInterval {
  startTimeMs: number;
  endTimeMs: number;
  subject: string;
  taskTitle: string;
  wasMergedFromMultipleDevices?: boolean;
}

export interface MergedResult {
  mergedIntervals: StudyInterval[];
  trueTotalFocusMs: number;
}

/**
 * LEETCODE 56: INTERVAL MERGER FOR WEB PWA
 * Takes an array of raw session blocks from multiple devices and collapses overlaps.
 */
export function mergeOverlappingStudyIntervals(blocks: StudyInterval[]): MergedResult {
  if (!blocks || blocks.length === 0) {
    return { mergedIntervals: [], trueTotalFocusMs: 0 };
  }

  // 1. Sort blocks chronologically by start time
  const sorted = [...blocks].sort((a, b) => a.startTimeMs - b.startTimeMs);
  const merged: StudyInterval[] = [{ ...sorted[0] }];

  // 2. Iterate and merge overlapping time spans
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    // Check if current block starts before or when the last merged block ended
    if (current.startTimeMs <= lastMerged.endTimeMs) {
      // Overlap detected! Expand the boundary to the maximum end timestamp
      lastMerged.endTimeMs = Math.max(lastMerged.endTimeMs, current.endTimeMs);
      lastMerged.wasMergedFromMultipleDevices = true;
    } else {
      // No overlap, push as a distinct study interval
      merged.push({ ...current });
    }
  }

  // 3. Calculate true physical milliseconds studied
  let trueTotalFocusMs = 0;
  for (const span of merged) {
    trueTotalFocusMs += (span.endTimeMs - span.startTimeMs);
  }

  return { mergedIntervals: merged, trueTotalFocusMs };
}
