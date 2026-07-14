import { collectionGroup, query, where, getDocs, collection, doc, getDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import { db } from "./dexie_db";
import { formatDuration, formatTimestamp } from "./webArchiver";
import { getWebDeviceId } from "./deviceIdProvider";

/**
 * Reconciles the local history vault in Dexie with updates from Cloud Firestore.
 * This runs downstream synchronization to capture mobile edits and deletions.
 */
export async function reconcileFirestoreHistory(username: string): Promise<void> {
  if (!username) return;

  // Guard: Must be online to sync
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  // Prevents double queries if local test mode intercepts writes
  if (typeof localStorage !== "undefined" && localStorage.getItem("is_tester_mode") === "true") {
    return;
  }

  const lastPullTsStr = localStorage.getItem("life_os_last_vault_pull_ts") || "0";
  const lastPullTs = Number(lastPullTsStr);

  try {
    // Query modified records across the timer module under the timer/daily_records namespace
    const sessionsRef = collection(
      firestore,
      `users/${username}/timer/daily_records`
    );
    const q = query(sessionsRef, where("lastModifiedMs", ">", lastPullTs));

    const snapshot = await getDocs(q);
    
    let maxTimestamp = lastPullTs;

    if (snapshot.empty) {
      // Crucial: Update anchor even when empty so we don't spam queries!
      localStorage.setItem("life_os_last_vault_pull_ts", String(Date.now()));
      return;
    }

    const myDeviceId = getWebDeviceId();

    // Process documents belonging to the current user
    for (const doc of snapshot.docs) {
      try {
        const path = doc.ref.path;
        if (!path.includes(`/users/${username}/timer/daily_records/`)) {
          continue;
        }

        const data = doc.data();
        
        // ECHO GUARD: If this record was uploaded by THIS exact browser, skip re-processing!
        if (data.sourceDeviceId === myDeviceId) {
          console.log(`[Reconciler] Skipping echo payload from self (${myDeviceId})`);
          continue;
        }

        const recordId = data.id || doc.id;
        const lastMod = Number(data.lastModifiedMs) || Date.now();

        if (lastMod > maxTimestamp) {
          maxTimestamp = lastMod;
        }

        if (data.isDeleted === true) {
          // Execute deletion in Dexie
          await db.localHistoryVault.delete(recordId);
          console.log(`[Firestore Reconciler] Tombstone deletion processed for Dexie: ${recordId}`);

          // Execute deletion in SQLite simulator
          try {
            const { sqliteHelper } = await import("./sqlite_helper");
            const tables = sqliteHelper.getTables();
            const history = tables["local_history_vault"] || [];
            const index = history.findIndex((h: any) => h.id === recordId || h.recordId === recordId || h.record_id === recordId);
            if (index !== -1) {
              history.splice(index, 1);
              sqliteHelper.saveTables(tables);
              sqliteHelper.log("success", `[Tombstone] Deleted historical record ${recordId} from SQLite.`);
            }
          } catch (e) {
            console.error("[Tombstone] Failed to delete from SQLite:", e);
          }
        } else {
          // Upsert record into Dexie
          const totalFocusMs = Number(data.totalFocusTimeMs) || (Number(data.durationSeconds) * 1000) || 0;
          const timestamp = Number(data.timestamp) || Date.now();

          const vaultRecord = {
            recordId,
            dateString: data.dateString || new Date(timestamp).toISOString().split("T")[0],
            subject: data.tag || data.subject || "Study",
            taskTitle: data.taskTitle || "General Focus",
            startTimeMs: timestamp,
            endTimeMs: data.endTimeMs || (timestamp + totalFocusMs),
            totalFocusMs,
            durationFormatted: data.durationFormatted || formatDuration(totalFocusMs),
            startTimeFormatted: data.startTimeFormatted || formatTimestamp(timestamp),
            endTimeFormatted: data.endTimeFormatted || formatTimestamp(data.endTimeMs || (timestamp + totalFocusMs)),
            isSyncedToFirestore: 1,
            mode: data.mode || "POMODORO",
            lastModifiedMs: lastMod
          };

          await db.localHistoryVault.put(vaultRecord);
          console.log(`[Firestore Reconciler] Synced record downstream to Dexie: ${vaultRecord.taskTitle} (${recordId})`);

          // Sync downstream to SQLite simulator
          try {
            const { sqliteHelper } = await import("./sqlite_helper");
            const tables = sqliteHelper.getTables();
            const history = tables["local_history_vault"] || [];
            const index = history.findIndex((h: any) => h.id === recordId || h.recordId === recordId || h.record_id === recordId);
            const sqlRecord = {
              id: recordId,
              session_id: data.sessionId || data.session_id || `sess_${timestamp}`,
              tag: data.tag || data.subject || "Study",
              task_title: data.taskTitle || "General Focus",
              total_focus_ms: totalFocusMs,
              created_at_ms: timestamp,
              timeline_json: data.timelineJson || data.timeline_json || "[]"
            };
            if (index !== -1) {
              history[index] = sqlRecord;
            } else {
              history.push(sqlRecord);
            }
            sqliteHelper.saveTables(tables);
            sqliteHelper.log("success", `[Downstream] Synced record downstream to SQLite: ${sqlRecord.task_title}`);
          } catch (e) {
            console.error("[Downstream] Failed to sync to SQLite:", e);
          }
        }
      } catch (docErr) {
        console.warn("[Firestore Reconciler] Error parsing document, skipping but advancing maxTimestamp:", docErr);
        const lastMod = Number(doc.data()?.lastModifiedMs) || Date.now();
        if (lastMod > maxTimestamp) {
          maxTimestamp = lastMod;
        }
      }
    }

    // Ensure we update last pull timestamp so we don't query same records next time
    const nextPullTs = Math.max(maxTimestamp, Date.now());
    localStorage.setItem("life_os_last_vault_pull_ts", String(nextPullTs));

    // Dispatch event to refresh UI lists and displays
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("life_os_sqlite_changed"));
    }
  } catch (err) {
    console.warn("[Firestore Reconciler] Downstream reconciliation failed:", err);
  }
}

/**
 * Unified event-driven reconciliation trigger supporting the 3-Phase Execution Lifecycle.
 */
export async function triggerEventDrivenReconciliation(username: string): Promise<void> {
  if (!username) return;

  // Guard: Must be online to sync
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  // Prevents double queries if local test mode intercepts writes
  if (typeof localStorage !== "undefined" && localStorage.getItem("is_tester_mode") === "true") {
    return;
  }

  console.log(`[Reconciliation Trigger] Event-driven reconciliation fired! Starting Phase 1...`);

  // --- PHASE 1: The Optimistic High-Water Mark (Instant UI Snap) ---
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    const summaryDocRef = doc(firestore, `users/${username}/timer/daily_folders`, todayStr);
    const docSnap = await getDoc(summaryDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      const remoteDailyTotalSeconds = Number(data.totalDurationSeconds) || 0;
      
      localStorage.setItem("life_os_remote_daily_total", String(remoteDailyTotalSeconds));
      localStorage.setItem("life_os_remote_daily_total_date", todayStr);
      console.log(`[Phase 1] Optimistic High-Water Mark fetched: ${remoteDailyTotalSeconds}s. Snapping UI...`);
      
      // Dispatch event to instantly update displays
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("life_os_sqlite_changed"));
      }
    }
  } catch (err) {
    console.warn("[Phase 1] Failed to fetch lightweight high-water mark:", err);
  }

  // --- PHASE 2: Heavyweight/Incremental Pull ---
  // Background download of detailed sessions since the last pull anchor
  console.log(`[Phase 2] Initiating incremental background pull of detailed records...`);
  await reconcileFirestoreHistory(username);

  // --- PHASE 3: State Consolidation & Clean-up ---
  // The High-Water Mark status clears, locking both devices to the verified authoritative total
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("life_os_remote_daily_total");
    localStorage.removeItem("life_os_remote_daily_total_date");
    console.log(`[Phase 3] High-Water Mark status cleared. Consensus lock active.`);
  }

  // Final consolidated dispatch
  console.log(`[Phase 3] Consolidating states and concluding reconciliation.`);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("life_os_sqlite_changed"));
  }
}

