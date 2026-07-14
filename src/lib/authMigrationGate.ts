import { database } from "./firebase";
import { ref, get, set } from "firebase/database";

/**
 * One-time execution method that targets the old un-namespaced RTDB root path /users/$username
 * and sets flat values directly to null to clear the remote tree completely.
 */
export async function wipeLegacyCloudRoot(username: string): Promise<void> {
  if (!username) return;
  const storageKey = `lifeos_legacy_cloud_root_wiped_${username}`;
  if (localStorage.getItem(storageKey) === "true") return;

  try {
    console.log(`[Janitor] Performing one-time legacy cloud root wipe for users/${username}`);
    const legacyRef = ref(database, `users/${username}`);
    await set(legacyRef, null);
    localStorage.setItem(storageKey, "true");
    console.log(`[Janitor] Legacy cloud root users/${username} set to null.`);
  } catch (err) {
    console.error(`[Janitor] Failed to wipe legacy cloud root:`, err);
  }
}

/**
 * Enforces Firebase RTDB schema consensus for a user after successful authentication.
 * Checks for `schema_version: 2` at the user's root node.
 * If missing:
 *  1. Overwrites the user's path to strip deprecated fields while preserving core user metadata.
 *  2. Executes `set(..., null)` on obsolete legacy sub-nodes to prune RTDB bandwidth bloat.
 *  3. Initializes clean baseline `/active_session` and `/public_presence` states.
 */
export async function enforceFirebaseSchemaConsensus(username: string): Promise<{ success: boolean; migrated: boolean; message: string }> {
  if (!username) {
    return { success: false, migrated: false, message: "Invalid username specified." };
  }

  // Execute one-time legacy cloud root wipe if not done yet
  await wipeLegacyCloudRoot(username);

  const userRef = ref(database, `users/${username}`);

  try {
    const snapshot = await get(userRef);
    const userData = snapshot.exists() ? snapshot.val() : {};

    // Check if user has already migrated to schema_version: 2
    if (userData && userData.schema_version === 2) {
      console.log(`[Consensus] User ${username} is already migrated to schema_version: 2.`);
      return { success: true, migrated: false, message: "User node already at version 2." };
    }

    console.log(`[Consensus] Migrating ${username} to schema_version: 2...`);

    // 1. Whitelist of user info fields to preserve while stripping deprecated ones (like lastButtonClicked, focusStatus, isStopwatchMode)
    const preserveFields = ["name", "nickname", "email", "photoURL", "isGoogleUser", "status", "lastUpdatedTimestamp"];
    const cleanedUserInfo: any = {};
    
    preserveFields.forEach((field) => {
      if (userData[field] !== undefined) {
        cleanedUserInfo[field] = userData[field];
      }
    });

    // Explicitly set schema_version to 2
    cleanedUserInfo.schema_version = 2;

    // Overwrite the user root node with the clean metadata profile
    await set(userRef, cleanedUserInfo);

    // 2. Clear obsolete sub-nodes that bloat bandwidth
    const obsoleteSubNodes = ["focus_records", "history_logs", "bells", "requests", "transfer", "today_stats", "active_timer"];
    for (const subNode of obsoleteSubNodes) {
      await set(ref(database, `users/${username}/${subNode}`), null);
    }

    // Also clear the obsolete root bell node just in case
    await set(ref(database, `bells/${username}`), null);

    // 3. Initialize clean baselines for active_session and public_presence
    const nowMs = Date.now();
    const cleanActiveSession = {
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
    };

    const cleanPublicPresence = {
      status: "IDLE",
      lastActiveMs: nowMs,
      device: "web_pwa_client"
    };

    await set(ref(database, `users/${username}/active_session`), cleanActiveSession);
    await set(ref(database, `public_presence/${username}`), cleanPublicPresence);

    console.log(`[Consensus] Successfully migrated user ${username} to schema_version: 2. Baselines initialized.`);
    return { success: true, migrated: true, message: "Schema version 2 consensus enforced successfully." };
  } catch (err: any) {
    console.error(`[Consensus] Schema consensus failed for ${username}:`, err);
    return { success: false, migrated: false, message: `Consensus failure: ${err.message || err}` };
  }
}
