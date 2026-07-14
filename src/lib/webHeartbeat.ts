import { db } from "./dexie_db";
import { publishWebPresenceCard } from "./webPresence";
import { auth } from "./firebase";

let heartbeatInterval: any = null;

/**
 * THE 60-SECOND HEARTBEAT
 * Absorbs running unsaved delta into saved base time every minute.
 * Must be called inside or driven by the Web Worker to survive tab backgrounding!
 */
export function startWebHeartbeatLoop(): void {
  if (typeof window === "undefined") return;
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  let lastPulseDate = new Date().toISOString().split("T")[0];

  heartbeatInterval = window.setInterval(async () => {
    // Sync only if online, authenticated, and sync is not disabled
    if (!navigator.onLine || !auth.currentUser) return;
    if (localStorage.getItem("life_os_offline_mode_active") === "true") return;

    // Read active session from Dexie IndexedDB
    const session = await db.localActiveSession.toCollection().first();
    if (!session || session.status !== "FOCUSING") return;

    const nowMs = Date.now();
    const currentDate = new Date().toISOString().split("T")[0];

    // --- MIDNIGHT BOUNDARY RESET ---
    if (currentDate !== lastPulseDate) {
      console.log(`[Heartbeat] Midnight crossed: Date changed from ${lastPulseDate} to ${currentDate}. Resetting todaySavedFocusMs and local scratchpad anchor.`);
      await publishWebPresenceCard("FOCUSING", session.tag, 0, nowMs);
      await db.localActiveSession.update(session.sessionId, {
        baseFocusTimeMs: 0,
        lastEventTsMs: nowMs
      });
      lastPulseDate = currentDate;
      return;
    }

    const elapsedDelta = nowMs - session.lastEventTsMs;

    // If we have accumulated at least 60 seconds of focus, pulse the cloud!
    if (elapsedDelta >= 60000) {
      console.log("Heartbeat pulse: Absorbing 60s unsaved delta into public base time...");
      
      const newSessionSavedTotal = session.baseFocusTimeMs + elapsedDelta;

      // Calculate total focus time for today to update public presence card
      const todayStr = new Date().toISOString().split("T")[0];
      const todayLocalStr = new Date(nowMs - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0];

      let todaySavedFocusMsFromHistory = 0;
      try {
        const records = await db.localHistoryVault.toArray();
        todaySavedFocusMsFromHistory = records
          .filter(rec => rec.dateString === todayStr || rec.dateString === todayLocalStr)
          .reduce((sum, r) => sum + r.totalFocusMs, 0);
      } catch (err) {
        console.warn("Heartbeat failed to query localHistoryVault:", err);
      }

      // Live Time = Saved Base + Running Delta
      const todaySavedFocusMs = todaySavedFocusMsFromHistory + newSessionSavedTotal;
      
      // 1. Update public card with new base total and reset timestamp anchor to right now
      await publishWebPresenceCard("FOCUSING", session.tag, todaySavedFocusMs, nowMs);

      // 2. Update Dexie scratchpad anchor so local math stays aligned
      await db.localActiveSession.update(session.sessionId, {
        baseFocusTimeMs: newSessionSavedTotal,
        lastEventTsMs: nowMs
      });
    }
  }, 60000);
}
