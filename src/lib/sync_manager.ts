import { db } from "./dexie_db";
import { addFocusRecordToDb, getUsernameFromEmail, auth, database, firestore } from "./firebase";
import { sqliteHelper } from "./sqlite_helper";
import { ref, onValue } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false;

/**
 * Main function to synchronize any pending outbox mutations from Dexie & SQLite simulator to the cloud.
 */
export async function syncPendingOutboxQueue(): Promise<{ successCount: number; failedCount: number }> {
  if (isSyncing) {
    return { successCount: 0, failedCount: 0 };
  }

  // Tester mode interceptor: prevent network writes to production
  if (typeof localStorage !== "undefined" && localStorage.getItem("is_tester_mode") === "true") {
    console.log("[Tester Mode] Network write intercepted in syncPendingOutboxQueue.");
    return { successCount: 0, failedCount: 0 };
  }

  // Guard: Must be online to sync
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { successCount: 0, failedCount: 0 };
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { successCount: 0, failedCount: 0 };
  }

  const username = getUsernameFromEmail(currentUser.email);
  if (!username) {
    return { successCount: 0, failedCount: 0 };
  }

  isSyncing = true;
  let successCount = 0;
  let failedCount = 0;

  try {
    // 1. Run downstream Firestore reconciliation to capture mobile edits/deletions
    try {
      const { reconcileFirestoreHistory } = await import("./firestoreReconciler");
      await reconcileFirestoreHistory(username);
    } catch (reconcileErr) {
      console.warn("[Auto-Sync] Downstream firestore reconciliation failed:", reconcileErr);
    }

    const pendingMutations = await db.outboxQueue.where("status").equals("PENDING").toArray();
    
    if (pendingMutations.length > 0) {
      sqliteHelper.log("warn", `[Auto-Sync] Found ${pendingMutations.length} pending local mutations. Initiating cloud sync...`);
    }

    for (const mutation of pendingMutations) {
      // Clean quarantine check - if somehow a pending mutation already has >= 5 retries, quarantine it now
      if ((mutation.retryCount || 0) >= 5) {
        await db.outboxQueue.update(mutation.queueId!, { status: "QUARANTINED" });
        sqliteHelper.log("warn", `[Auto-Sync] Mutation ${mutation.mutationId} quarantined due to exceeding 5 retry attempts.`);
        continue;
      }

      try {
        const payload = JSON.parse(mutation.payloadJson);

        if (mutation.routingTarget === "FIRESTORE_DIRECT_VAULT" && mutation.actionType === "ARCHIVE_SESSION") {
          // Map Dexie's LocalHistoryVault format to Firebase's FocusRecord format
          const record = {
            id: payload.recordId,
            taskTitle: payload.taskTitle || "General Focus",
            tag: payload.subject || payload.tag || "Study",
            notes: payload.notes || "",
            durationSeconds: Math.floor((payload.totalFocusMs || 0) / 1000),
            durationMinutes: Math.floor((payload.totalFocusMs || 0) / (60 * 1000)),
            dateString: payload.dateString,
            startTime: payload.startTimeFormatted || "00:00",
            endTime: payload.endTimeFormatted || "00:00",
            timestamp: payload.startTimeMs || Date.now(),
            mode: payload.mode || "POMODORO"
          };

          await addFocusRecordToDb(username, record);
          
          // Mark as synced inside Dexie local history
          await db.localHistoryVault.update(payload.recordId, { isSyncedToFirestore: 1 });
          
          sqliteHelper.log("success", `[Auto-Sync] Successfully archived session '${record.taskTitle}' (${record.tag}) to Firestore Direct Vault.`);
        } else if (mutation.routingTarget === "RTDB_LIVE_SYNC") {
          // Process active session live-sync commands via Lamport Monotonic Guard transaction
          let syncPayload = { ...payload };
          
          if (mutation.actionType === "WIPE" || mutation.actionType === "END") {
            const nowMs = Date.now();
            syncPayload = {
              sessionId: "none",
              status: "IDLE",
              tag: "",
              taskTitle: "",
              baseFocusTimeMs: 0,
              lastEventTsMs: nowMs,
              lastEventTimestampMs: nowMs,
              baseFocusFormatted: "00:00:00",
              lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
              timelineJson: "[]",
              isCurrentLeader: 0
            };
          } else {
            // Ensure timestamp keys are set on the payload
            if (!syncPayload.lastEventTsMs) {
              syncPayload.lastEventTsMs = syncPayload.lastEventTimestampMs || Date.now();
            }
            if (!syncPayload.lastEventTimestampMs) {
              syncPayload.lastEventTimestampMs = syncPayload.lastEventTsMs;
            }
          }

          const { syncActiveSessionToRtdb } = await import("./firebase");
          const { rollbackWebActiveSession } = await import("./dexie_db");

          const syncResult = await syncActiveSessionToRtdb(username, syncPayload);

          if (syncResult.success) {
            sqliteHelper.log("success", `[Lamport Guard] Active session write ACCEPTED by cloud: ${mutation.actionType}`);
          } else {
            sqliteHelper.log("warn", `[Lamport Guard] Active session write REJECTED by cloud (concurrency clash). Initiating rollback...`);
            if (syncResult.rollbackState) {
              sqliteHelper.rollbackActiveSession(syncResult.rollbackState);
              await rollbackWebActiveSession(syncResult.rollbackState);
              sqliteHelper.log("success", `[Lamport Guard] Local rollback successfully executed to adopt cloud state.`);
            }
          }
        }

        // Update Dexie outbox status
        await db.outboxQueue.update(mutation.queueId!, { status: "SYNCED" });

        // Update corresponding SQLite simulator table row for consistency and visual logs
        const sqliteTables = sqliteHelper.getTables();
        const sqliteQueue = sqliteTables["outbox_queue"] || [];
        const matchIndex = sqliteQueue.findIndex((q: any) => q.payload_json.includes(mutation.mutationId) || q.id.includes(mutation.mutationId));
        if (matchIndex !== -1) {
          sqliteQueue[matchIndex].status = "SYNCED";
          sqliteHelper.saveTables(sqliteTables);
        }

        successCount++;
      } catch (err: any) {
        console.error("[Auto-Sync] Failed to process outbox row:", mutation, err);
        const nextRetry = (mutation.retryCount || 0) + 1;
        const isQuarantining = nextRetry >= 5;
        await db.outboxQueue.update(mutation.queueId!, {
          retryCount: nextRetry,
          status: isQuarantining ? "QUARANTINED" : "PENDING"
        });
        
        sqliteHelper.log("warn", `[Auto-Sync] Outbox mutation ${mutation.mutationId} failed: ${err.message || err}. Retry #${nextRetry}${isQuarantining ? " -> QUARANTINED" : ""}`);
        failedCount++;
        continue;
      }
    }

    if (successCount > 0) {
      // Dispatch database change event to refresh UI displays
      window.dispatchEvent(new Event("life_os_sqlite_changed"));

      // Trigger event-driven reconciliation on outbox drain completion
      const user = auth.currentUser;
      if (user) {
        const username = getUsernameFromEmail(user.email);
        if (username) {
          import("./firestoreReconciler").then(({ triggerEventDrivenReconciliation }) => {
            triggerEventDrivenReconciliation(username).catch(err => {
              console.error("[Sync Manager] Outbox-drain reconciliation failed:", err);
            });
          });
        }
      }
    }
  } catch (err: any) {
    console.error("[Auto-Sync] Sync operation failed:", err);
  } finally {
    isSyncing = false;
  }

  return { successCount, failedCount };
}

/**
 * Start automatic background sync manager that listens to connectivity events
 * and triggers periodic queue flushes when online.
 */
export function startAutoSyncManager() {
  if (typeof window === "undefined") return;

  // Bind the global drain function requested by manual log engine
  (window as any).drainWebOutboxQueue = syncPendingOutboxQueue;

  const handleOnlineStatus = () => {
    console.log("[Auto-Sync] Browser went ONLINE. Initiating outbox sync...");
    syncPendingOutboxQueue();

    // Trigger event-driven reconciliation on network reconnection
    const user = auth.currentUser;
    if (user) {
      const username = getUsernameFromEmail(user.email);
      if (username) {
        import("./firestoreReconciler").then(({ triggerEventDrivenReconciliation }) => {
          triggerEventDrivenReconciliation(username).catch(err => {
            console.error("[Sync Manager] Reconnection reconciliation failed:", err);
          });
        });
      }
    }
  };

  const handleOfflineStatus = () => {
    console.log("[Auto-Sync] Browser went OFFLINE. Operations will be queued locally.");
    sqliteHelper.log("warn", "[Network] Offline mode active. Your session updates are safely saved to local Dexie.js database.");
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      console.log("[ON_RESUME] Application resumed from background. Triggering event-driven reconciliation...");
      const user = auth.currentUser;
      if (user) {
        const username = getUsernameFromEmail(user.email);
        if (username && navigator.onLine) {
          import("./firestoreReconciler").then(({ triggerEventDrivenReconciliation }) => {
            triggerEventDrivenReconciliation(username).catch(err => {
              console.error("[Sync Manager] On-resume reconciliation failed:", err);
            });
          });
        }
      }
    }
  };

  window.addEventListener("online", handleOnlineStatus);
  window.addEventListener("offline", handleOfflineStatus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Trigger sync on boot if online
  if (navigator.onLine) {
    syncPendingOutboxQueue();
    const user = auth.currentUser;
    if (user) {
      const username = getUsernameFromEmail(user.email);
      if (username) {
        import("./firestoreReconciler").then(({ triggerEventDrivenReconciliation }) => {
          triggerEventDrivenReconciliation(username).catch(err => {
            console.error("[Sync Manager] Boot reconciliation failed:", err);
          });
        });
      }
    }
  }

  // Periodic interval check every 30 seconds to catch any missed queued items
  syncTimer = setInterval(() => {
    if (navigator.onLine && auth.currentUser) {
      syncPendingOutboxQueue();
    }
  }, 30000);

  // Web Core Signal Watcher to listen to user config/profile modifications in real-time
  let unsubOnValue: (() => void) | null = null;
  const unsubAuth = auth.onAuthStateChanged((user) => {
    if (unsubOnValue) {
      unsubOnValue();
      unsubOnValue = null;
    }

    if (user) {
      const username = getUsernameFromEmail(user.email);
      if (username) {
        const signalRef = ref(database, `users/${username}/timer/profileLastUpdatedTs`);
        unsubOnValue = onValue(signalRef, async (snapshot) => {
          const remoteTs = snapshot.val();
          if (remoteTs) {
            const localTs = localStorage.getItem("last_profile_ts");
            if (String(remoteTs) !== localTs) {
              console.log(`[Signal Watcher] Profile updated timestamp changed (${localTs} -> ${remoteTs}). Re-fetching settings...`);
              try {
                const docRef = doc(firestore, "users", username, "timer", "config");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                  const settings = docSnap.data();
                  
                  // Write it into the local Dexie store
                  await db.timerSettings.put({ key: "config", value: settings });
                  
                  // Update individual settings in localStorage to update the workspace UI instantly
                  if (settings) {
                    if (settings.timerDurationMinutes !== undefined) {
                      localStorage.setItem("life_os_pomodoro_minutes", JSON.stringify(settings.timerDurationMinutes));
                    }
                    if (settings.stopwatchBreakDurationMinutes !== undefined) {
                      localStorage.setItem("life_os_break_minutes", JSON.stringify(settings.stopwatchBreakDurationMinutes));
                    }
                    if (settings.autoStartBreak !== undefined) {
                      localStorage.setItem("life_os_auto_start_break", JSON.stringify(settings.autoStartBreak));
                    }
                    if (settings.autoStartPomo !== undefined) {
                      localStorage.setItem("life_os_auto_start_pomo", JSON.stringify(settings.autoStartPomo));
                    }
                    if (settings.autoStartStopwatchAfterBreak !== undefined) {
                      localStorage.setItem("life_os_auto_start_sw_after_break", JSON.stringify(settings.autoStartStopwatchAfterBreak));
                    }
                    if (settings.publicPresenceVisible !== undefined) {
                      localStorage.setItem("life_os_public_presence_visible", JSON.stringify(settings.publicPresenceVisible));
                    }
                  }
                  
                  // Update localStorage with the new timestamp
                  localStorage.setItem("last_profile_ts", String(remoteTs));
                  console.log("[Signal Watcher] Config document fetched and written to Dexie & localStorage successfully.");
                  
                  // Dispatch global change events to refresh UI displays
                  window.dispatchEvent(new Event("life_os_sqlite_changed"));
                  window.dispatchEvent(new Event("life_os_timer_settings_changed"));
                }
              } catch (err) {
                console.error("[Signal Watcher] Firestore settings re-fetch failed:", err);
              }
            }
          }
        });
      }
    }
  });

  return () => {
    window.removeEventListener("online", handleOnlineStatus);
    window.removeEventListener("offline", handleOfflineStatus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    unsubAuth();
    if (unsubOnValue) {
      unsubOnValue();
    }
  };
}
