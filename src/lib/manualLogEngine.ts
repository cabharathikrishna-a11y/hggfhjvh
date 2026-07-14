import { db, LocalHistoryVault } from "./dexie_db";
import { getStartOfDayMs } from "./timeEngine";
import { getWebDeviceId } from "./deviceIdProvider";

const MAX_DAILY_MANUAL_MS = 6 * 60 * 60 * 1000; // 6 Hours in Milliseconds

export interface ManualLogResult {
  success: boolean;
  message: string;
}

/**
 * LOG MANUAL WEB FOCUS SESSION WITH 6-HOUR DAILY CAP
 */
export async function logManualWebStudySession(
  taskTitle: string,
  subjectTag: string,
  durationMinutes: number
): Promise<ManualLogResult> {
  if (!durationMinutes || durationMinutes <= 0) {
    return { success: false, message: "Please enter a valid duration greater than 0 minutes." };
  }

  const nowMs = Date.now();
  const durationMs = durationMinutes * 60 * 1000;
  const dateStr = new Date(nowMs).toISOString().split("T")[0]; // "2026-07-13"

  try {
    // --- STEP 1: THE 6-HOUR DAILY QUOTA CHECK ---
    // Query Dexie IndexedDB for today's manual records (where recordId starts with "manual_" or mode is "MANUAL_LOG")
    const todayRecords = await db.localHistoryVault
      .where("dateString")
      .equals(dateStr)
      .toArray();

    const todayManualRecords = todayRecords.filter(
      (record) => record.recordId.startsWith("manual_") || record.mode === "MANUAL_LOG"
    );

    const existingManualTodayMs = todayManualRecords.reduce((sum, r) => sum + r.totalFocusMs, 0);
    const projectedTotalMs = existingManualTodayMs + durationMs;

    if (projectedTotalMs > MAX_DAILY_MANUAL_MS) {
      const remainingMs = Math.max(0, MAX_DAILY_MANUAL_MS - existingManualTodayMs);
      const remainingMins = Math.floor(remainingMs / (60 * 1000));
      console.warn(`Manual log rejected: Exceeds 6-hour daily limit. Remaining: ${remainingMins}m.`);
      return {
        success: false,
        message: `Daily manual log limit (6 hours) reached! You can only log up to ${remainingMins} more minutes today.`
      };
    }

    // --- STEP 1B: DYNAMIC CAUSALITY GUARD ---
    const maxAllowed = Date.now() - getStartOfDayMs();
    const todayTotal = todayRecords.reduce((sum, r) => sum + r.totalFocusMs, 0);
    const newDuration = durationMs;
    if ((todayTotal + newDuration) > maxAllowed) {
      console.warn(`Manual log rejected: Dynamic causality guard triggered. (todayTotal: ${todayTotal} + newDuration: ${newDuration}) > maxAllowed: ${maxAllowed}`);
      return {
        success: false,
        message: "Dynamic causality guard: Total logged focus time cannot exceed elapsed time since midnight!"
      };
    }

    // --- STEP 2: PREPARE RECORD WITH MANUAL_LOG MODE ---
    const approximatedStartMs = nowMs - durationMs;
    const recordId = `manual_${nowMs}_${subjectTag.toLowerCase()}`;

    const manualVaultRecord: LocalHistoryVault = {
      recordId,
      dateString: dateStr,
      subject: subjectTag,
      taskTitle,
      startTimeMs: approximatedStartMs,
      endTimeMs: nowMs,
      totalFocusMs: durationMs,
      durationFormatted: formatDuration(durationMs),
      startTimeFormatted: formatTimestamp(approximatedStartMs),
      endTimeFormatted: formatTimestamp(nowMs),
      isSyncedToFirestore: 0,
      mode: "MANUAL_LOG", // Explicitly stamp the mode
      lastModifiedMs: nowMs,
      sourceDeviceId: getWebDeviceId()
    };

    // --- STEP 3: ATOMIC DEXIE TRANSACTION & OUTBOX ENQUEUE ---
    const cloudPayload = JSON.stringify({
      recordId,
      dateString: dateStr,
      subject: subjectTag,
      taskTitle,
      mode: "MANUAL_LOG", // Explicitly replaces Pomodoro/Stopwatch
      totalFocusMs: durationMs, // Ensure syncPendingOutboxQueue gets this
      durationFormatted: formatDuration(durationMs),
      startTimeFormatted: formatTimestamp(approximatedStartMs),
      endTimeFormatted: formatTimestamp(nowMs),
      loggedByDevice: "web_pwa_client",
      isManualEntry: true,
      lastModifiedMs: nowMs,
      sourceDeviceId: getWebDeviceId()
    });

    await db.transaction("rw", [db.localHistoryVault, db.outboxQueue], async () => {
      // Save to local IndexedDB Vault
      await db.localHistoryVault.put(manualVaultRecord);

      // Enqueue Outbox mutation
      await db.outboxQueue.add({
        mutationId: `mut_manual_${nowMs}`,
        createdAtMs: nowMs,
        routingTarget: "FIRESTORE_DIRECT_VAULT",
        actionType: "ARCHIVE_SESSION",
        payloadJson: cloudPayload,
        retryCount: 0,
        status: "PENDING"
      });
    });

    console.log(`Manual Web Log of ${durationMinutes}m saved! Triggering background drainer...`);

    if (typeof window !== "undefined") {
      // Dispatch database change event to refresh any local UI counters
      window.dispatchEvent(new Event("life_os_sqlite_changed"));
    }

    if (navigator.onLine && (window as any).drainWebOutboxQueue) {
      try {
        (window as any).drainWebOutboxQueue();
      } catch (err) {
        console.error("Failed to trigger background drainer:", err);
      }
    }

    return { success: true, message: `Successfully logged ${durationMinutes}m of manual study time!` };
  } catch (error: any) {
    console.error("Error in logManualWebStudySession:", error);
    return { success: false, message: `Failed to log manual study session: ${error.message || error}` };
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(
    Math.floor((sec % 3600) / 60)
  ).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function formatTimestamp(epochMs: number): string {
  if (epochMs <= 0) return "00:00:00:000";
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}:${String(d.getMilliseconds()).padStart(3, "0")}`;
}
