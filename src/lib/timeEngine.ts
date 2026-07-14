import { database } from "./firebase";
import { ref, onValue } from "firebase/database";

let serverTimeOffsetMs = 0;

if (typeof window !== "undefined" && database) {
  try {
    const offsetRef = ref(database, ".info/serverTimeOffset");
    onValue(offsetRef, (snapshot) => {
      const val = snapshot.val();
      if (typeof val === "number") {
        serverTimeOffsetMs = val;
        console.log("[TimeEngine] NTP universal time offset synced:", serverTimeOffsetMs, "ms");
      }
    }, (error) => {
      console.warn("[TimeEngine] serverTimeOffset subscription error:", error);
    });
  } catch (err) {
    console.warn("[TimeEngine] Failed to initialize serverTimeOffset listener:", err);
  }
}

export function getUniversalTimeMs(): number {
  return Date.now() + serverTimeOffsetMs;
}

export function getStartOfDayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
