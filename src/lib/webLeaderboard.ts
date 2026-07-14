import { ref, onValue } from "firebase/database";
import { database as rtdb } from "./firebase";
import { PublicPresenceCard } from "./webPresence";

export interface LeaderboardPeer extends PublicPresenceCard {
  username: string;
  liveTotalMs: number;
  liveDisplayFormatted: string;
  rank: number;
}

/**
 * 1. LISTEN TO PUBLIC PRESENCE NODES (Low Bandwidth)
 */
export function subscribeToFriendsPresence(
  friendsList: string[],
  onLeaderboardUpdate: (rankedPeers: LeaderboardPeer[]) => void
): () => void {
  const friendsMap: Record<string, PublicPresenceCard> = {};
  const unsubscribers: Array<() => void> = [];

  friendsList.forEach(username => {
    const friendRef = ref(rtdb, `/public_presence/${username}`);
    const unsubscribe = onValue(friendRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        friendsMap[username] = data;
      } else {
        delete friendsMap[username];
      }
    });
    unsubscribers.push(unsubscribe);
  });

  let uiLoop: any = null;
  
  const startLoop = () => {
    if (uiLoop) clearInterval(uiLoop);
    uiLoop = window.setInterval(() => {
      if (document.hidden) {
        console.log("[Leaderboard] Tab hidden. Throttling UI math to save battery.");
        return;
      }
      const ranked = computeLiveLeaderboard(friendsMap);
      onLeaderboardUpdate(ranked);
    }, 1000); // Re-calculate ranks locally every second
  };

  startLoop();

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (uiLoop) {
        clearInterval(uiLoop);
        uiLoop = null;
      }
    } else {
      startLoop();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Return cleanup function
  return () => {
    unsubscribers.forEach(unsub => unsub());
    if (uiLoop) clearInterval(uiLoop);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

/**
 * 2. DYNAMIC LEADERBOARD SORTING ENGINE
 */
export function computeLiveLeaderboard(map: Record<string, PublicPresenceCard>): LeaderboardPeer[] {
  const nowMs = Date.now();
  const peers: Omit<LeaderboardPeer, "rank">[] = [];

  for (const [username, card] of Object.entries(map)) {
    let liveTotalMs = card.online ? (card.todaySavedFocusMs || 0) : 0;

    // Add running unsaved delta if they are actively focusing and online
    if (card.status === "FOCUSING" && card.lastStartTimestampMs > 0 && card.online) {
      liveTotalMs += (nowMs - card.lastStartTimestampMs);
    }

    const liveDisplayFormatted = card.online ? formatDuration(liveTotalMs) : "00:00:00";

    peers.push({
      ...card,
      username,
      liveTotalMs,
      liveDisplayFormatted
    });
  }

  // Sort descending by live total study time
  peers.sort((a, b) => b.liveTotalMs - a.liveTotalMs);

  // Assign competitive ranks
  return peers.map((peer, index) => ({
    ...peer,
    rank: index + 1
  }));
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
