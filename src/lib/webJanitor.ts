// webJanitor.ts
import { database } from "./firebase";
import { getActiveUsername, endAndArchiveWebSession } from "./webArchiver";
import { db, LocalHistoryVault } from "./dexie_db";
import { ref, get, set } from "firebase/database";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * RUNS ON BROWSER TAB LOAD OR WINDOW FOCUS
 */
export async function runWebJanitorOnBoot(): Promise<void> {
  try {
    const username = getActiveUsername();
    const sessionRef = ref(database, `/users/${username}/active_session`);
    const snapshot = await get(sessionRef);
    const serverState = snapshot.val();

    if (!serverState) return;

    const nowMs = Date.now();

    if (serverState.status === "FOCUSING" || serverState.status === "PAUSED") {
      const lastEvent = serverState.lastEventTsMs || serverState.lastEventTimestampMs || serverState.startTimeMs || nowMs;
      const elapsedMs = nowMs - lastEvent;

      // --- INTERCEPT ZOMBIE SESSION (> 6 HOURS) ---
      if (serverState.status === "FOCUSING" && elapsedMs > SIX_HOURS_MS) {
        console.warn("Janitor detected zombie web timer running > 6 hours! Executing rescue protocol...");

        // 1. Force update local Dexie scratchpad with a capped 6-hour duration
        await db.localActiveSession.put({
          sessionId: serverState.sessionId || `sess_${nowMs}`,
          status: "PAUSED", // Freeze clock
          tag: serverState.tag || "Study",
          taskTitle: `${serverState.taskTitle || "Session"} [Auto-Capped by Janitor]`,
          baseFocusTimeMs: SIX_HOURS_MS,
          lastEventTsMs: nowMs,
          baseFocusFormatted: "06:00:00",
          lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
          timelineJson: serverState.timelineJson || JSON.stringify(serverState.timeline || []),
          isCurrentLeader: 1
        });

        // 2. Execute standard archival pipeline (saves to Dexie & queues Firestore write)
        await endAndArchiveWebSession();

        // 3. Clean wipe RTDB Hot Node
        await set(sessionRef, {
          sessionId: "none",
          status: "IDLE",
          tag: "",
          taskTitle: "",
          baseFocusTimeMs: 0,
          lastEventTsMs: nowMs,
          baseFocusFormatted: "00:00:00",
          lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
          timelineJson: "[]",
          isCurrentLeader: 0
        });

        console.log("Janitor rescue complete: Session capped at exactly 06:00:00 and archived safely.");
      } else {
        // Adopt active cloud state!
        console.log("[Janitor] Adopting active cloud session state on boot:", serverState);
        await db.localActiveSession.put({
          sessionId: serverState.sessionId || `sess_${nowMs}`,
          status: serverState.status,
          tag: serverState.tag || "Study",
          taskTitle: serverState.taskTitle || "General Focus",
          baseFocusTimeMs: serverState.baseFocusTimeMs || 0,
          lastEventTsMs: lastEvent,
          baseFocusFormatted: serverState.baseFocusFormatted || "00:00:00",
          lastEventFormatted: serverState.lastEventFormatted || new Date(nowMs).toISOString().slice(11, 23),
          timelineJson: serverState.timelineJson || JSON.stringify(serverState.timeline || []),
          isCurrentLeader: serverState.isCurrentLeader !== undefined ? serverState.isCurrentLeader : 1
        });
      }
    }
  } catch (err) {
    console.warn("Web janitor run encountered an error (likely network or auth missing):", err);
  }
}

/**
 * DELETES LOCAL INDEXEDDB RECORDS OLDER THAN 180 DAYS
 * Runs weekly via localStorage check to limit database scans.
 */
export async function executeIndexedDbQuotaPruner(): Promise<void> {
  try {
    const now = Date.now();
    const lastPrune = localStorage.getItem("last_quota_prune_time");
    if (lastPrune && now - Number(lastPrune) < 7 * 24 * 60 * 60 * 1000) {
      // Run already performed within the last 7 days, skip
      return;
    }

    const cutoffMs = now - (180 * 24 * 60 * 60 * 1000); // 180 days ago

    // Filter local history vault records older than cutoff and safely backed up (isSyncedToFirestore === 1)
    const oldRecords = await db.localHistoryVault
      .where("startTimeMs")
      .below(cutoffMs)
      .toArray();

    if (oldRecords.length > 0) {
      // Prune entries that have been synced
      const recordsToPrune = oldRecords.filter((record: LocalHistoryVault) => record.isSyncedToFirestore === 1);
      if (recordsToPrune.length > 0) {
        const idsToDelete = recordsToPrune.map((r: LocalHistoryVault) => r.recordId);
        await db.localHistoryVault.bulkDelete(idsToDelete);
        console.log(`Quota Janitor safely pruned ${idsToDelete.length} synced historical records from IndexedDB.`);
      }
    }
    
    localStorage.setItem("last_quota_prune_time", String(now));
  } catch (err) {
    console.warn("executeIndexedDbQuotaPruner failed:", err);
  }
}
