import { ref, update, onDisconnect, get } from "firebase/database";
import { database as rtdb } from "./firebase";
import { getActiveUsername } from "./webArchiver";

export interface PublicPresenceCard {
  status: "FOCUSING" | "PAUSED" | "BREAKING" | "OFFLINE";
  subject: string;
  todaySavedFocusMs: number;
  todaySavedFormatted: string;
  lastStartTimestampMs: number;
  lastUpdatedFormatted: string;
  online: boolean;
}

/**
 * PUBLISHES YOUR 100-BYTE BUSINESS CARD TO FRIENDS
 * Executed automatically whenever your local timer mutates state.
 */
export async function publishWebPresenceCard(
  status: PublicPresenceCard["status"],
  subject: string = "General Study",
  todaySavedMs: number = 0,
  startTsMs: number = 0
): Promise<void> {
  const username = getActiveUsername();
  const presenceRef = ref(rtdb, `/public_presence/${username}`);

  // Fetch publicPresenceVisible setting from the user's timer_settings
  let isPublicPresenceVisible = true;
  try {
    const settingsSnapshot = await get(ref(rtdb, `/users/${username}/timer_settings/publicPresenceVisible`));
    if (settingsSnapshot.exists() && settingsSnapshot.val() === false) {
      isPublicPresenceVisible = false;
    }
  } catch (err) {
    console.warn("Could not read timer_settings for presence privacy check:", err);
  }

  // Arm server-side disconnect trap so friends know if your browser closes
  try {
    onDisconnect(ref(rtdb, `/public_presence/${username}/online`)).set(false);
    onDisconnect(ref(rtdb, `/public_presence/${username}/status`)).set("OFFLINE");
  } catch (err) {
    console.warn("Disconnect traps failed/not supported:", err);
  }

  let payload: PublicPresenceCard;
  if (!isPublicPresenceVisible) {
    payload = {
      status: "OFFLINE",
      subject: "Offline",
      todaySavedFocusMs: 0,
      todaySavedFormatted: "00:00:00",
      lastStartTimestampMs: 0,
      lastUpdatedFormatted: new Date().toLocaleTimeString(),
      online: false
    };
  } else {
    payload = {
      status,
      subject,
      todaySavedFocusMs: todaySavedMs,
      todaySavedFormatted: formatDuration(todaySavedMs),
      lastStartTimestampMs: status === "FOCUSING" ? startTsMs : 0,
      lastUpdatedFormatted: new Date().toLocaleTimeString(),
      online: true
    };
  }

  await update(presenceRef, payload as any);
  console.log(`Public presence updated for ${username}: [${payload.status}] studying ${payload.subject}`);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
