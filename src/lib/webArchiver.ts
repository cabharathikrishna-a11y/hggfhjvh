// webArchiver.ts
import { getFirestore } from "firebase/firestore";
import { db, LocalHistoryVault } from "./dexie_db";
import { mergeOverlappingStudyIntervals } from "./intervalMerger";
import { auth, getUsernameFromEmail } from "./firebase";
import { getStartOfDayMs } from "./timeEngine";
import { getWebDeviceId } from "./deviceIdProvider";

// Helper to get active username dynamically
export function getActiveUsername(): string {
  if (auth.currentUser && auth.currentUser.email) {
    return getUsernameFromEmail(auth.currentUser.email);
  }
  return "ranker_01";
}

/**
 * EXECUTED ON THE WEB WHEN THE USER ENDS A SESSION
 */
export async function endAndArchiveWebSession(): Promise<boolean> {
  const session = await db.localActiveSession.toCollection().first();
  if (!session || session.status === "IDLE") return false;

  const nowMs = Date.now();
  const totalFocusMs = calculateLiveElapsedMs(session.baseFocusTimeMs, session.lastEventTsMs, session.status);

  // --- THE 10-SECOND SHORT-CIRCUIT GUARD ---
  if (totalFocusMs < 10000) {
    console.warn("Session aborted: Duration under 10s threshold.");
    await db.localActiveSession.clear();
    await db.outboxQueue.add({
      mutationId: `mut_abort_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "RTDB_LIVE_SYNC",
      actionType: "WIPE",
      payloadJson: JSON.stringify({}),
      retryCount: 0,
      status: "PENDING"
    });
    return false; // Aborted cleanly!
  }

  // --- PREPARE RECORD FOR VAULT & CLOUD ---
  const dateStr = new Date(nowMs).toISOString().split("T")[0]; // "2026-07-13"

  // --- DYNAMIC CAUSALITY GUARD ---
  const todayRecords = await db.localHistoryVault
    .where("dateString")
    .equals(dateStr)
    .toArray();
  const todayTotal = todayRecords.reduce((sum, r) => sum + r.totalFocusMs, 0);
  const newDuration = totalFocusMs;
  const maxAllowed = Date.now() - getStartOfDayMs();
  if ((todayTotal + newDuration) > maxAllowed) {
    console.warn(`Auto-archive rejected: Dynamic causality guard triggered. (todayTotal: ${todayTotal} + newDuration: ${newDuration}) > maxAllowed: ${maxAllowed}`);
    await db.localActiveSession.clear();
    return false;
  }

  const recordId = `sess_${nowMs}_${session.tag.toLowerCase()}`;

  const vaultRecord: LocalHistoryVault = {
    recordId,
    dateString: dateStr,
    subject: session.tag,
    taskTitle: session.taskTitle,
    startTimeMs: session.lastEventTsMs - totalFocusMs,
    endTimeMs: nowMs,
    totalFocusMs,
    durationFormatted: formatDuration(totalFocusMs),
    startTimeFormatted: formatTimestamp(session.lastEventTsMs - totalFocusMs),
    endTimeFormatted: formatTimestamp(nowMs),
    isSyncedToFirestore: 0,
    mode: "POMODORO",
    lastModifiedMs: nowMs,
    sourceDeviceId: getWebDeviceId()
  };

  // 1. Save to local Dexie IndexedDB Vault & Outbox Queue in an atomic transaction with no network calls
  await db.transaction("rw", [db.localHistoryVault, db.localActiveSession, db.outboxQueue], async () => {
    await db.localHistoryVault.put(vaultRecord);
    await db.localActiveSession.clear();

    // 2. Enqueue Direct-to-Vault Firestore Archival (Bypassing RTDB!)
    await db.outboxQueue.add({
      mutationId: `mut_arch_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "FIRESTORE_DIRECT_VAULT",
      actionType: "ARCHIVE_SESSION",
      payloadJson: JSON.stringify(vaultRecord),
      retryCount: 0,
      status: "PENDING"
    });
  });

  console.log(`Session archived locally. Outbox queued for Cloud Firestore.`);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("life_os_sqlite_changed"));
  }

  // Trigger background sync-manager drain after transaction closes
  if (navigator.onLine && (window as any).drainWebOutboxQueue) {
    try {
      (window as any).drainWebOutboxQueue();
    } catch (err) {
      console.error("Failed to trigger background drainer:", err);
    }
  }

  return true;
}

export function calculateLiveElapsedMs(baseMs: number, lastTs: number, status: string): number {
  if (status !== "FOCUSING" || lastTs <= 0) return baseMs;
  return baseMs + (Date.now() - lastTs);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function formatTimestamp(epochMs: number): string {
  if (epochMs <= 0) return "00:00:00:000";
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}:${String(d.getMilliseconds()).padStart(3, "0")}`;
}
