import Dexie, { Table } from "dexie";

// 1. Define Interfaces matching our Kotlin data classes
export interface LocalActiveSession {
  sessionId: string;
  status: "FOCUSING" | "PAUSED" | "IDLE";
  tag: string;
  taskTitle: string;
  baseFocusTimeMs: number;
  lastEventTsMs: number;
  baseFocusFormatted: string;
  lastEventFormatted: string;
  timelineJson: string; // JSON array of event markers: [{ id, event, tsMs }]
  isCurrentLeader: number;
}

export interface OutboxMutation {
  queueId?: number;
  mutationId: string;
  createdAtMs: number;
  routingTarget: "RTDB_LIVE_SYNC" | "FIRESTORE_DIRECT_VAULT";
  actionType: string;
  payloadJson: string;
  retryCount: number;
  status: "PENDING" | "PROCESSING" | "FAILED" | "SYNCED" | "QUARANTINED";
}

export interface LocalHistoryVault {
  recordId: string;
  dateString: string;
  subject: string;
  taskTitle: string;
  startTimeMs: number;
  endTimeMs: number;
  totalFocusMs: number;
  durationFormatted: string;
  startTimeFormatted: string;
  endTimeFormatted: string;
  isSyncedToFirestore: number;
  mode?: string;
  lastModifiedMs?: number;
  sourceDeviceId?: string;
}

// 2. Initialize the Dexie Database
export class StudyDatabase extends Dexie {
  localActiveSession!: Table<LocalActiveSession, string>;
  outboxQueue!: Table<OutboxMutation, number>;
  localHistoryVault!: Table<LocalHistoryVault, string>;
  timerSettings!: Table<{ key: string; value: any }, string>;

  constructor() {
    super("LifeOS_StudyDatabase");
    
    // Define schemas and indices (similar to Room @Index)
    this.version(1).stores({
      localActiveSession: "sessionId",
      outboxQueue: "++queueId, createdAtMs, status, routingTarget",
      localHistoryVault: "recordId, [dateString+subject], startTimeMs, isSyncedToFirestore"
    });

    this.version(2).stores({
      localActiveSession: "sessionId",
      outboxQueue: "++queueId, createdAtMs, status, routingTarget",
      localHistoryVault: "recordId, dateString, lastModifiedMs, mode"
    });

    this.version(3).stores({
      localActiveSession: "sessionId",
      outboxQueue: "++queueId, createdAtMs, status, routingTarget",
      localHistoryVault: "recordId, dateString, lastModifiedMs, mode",
      timerSettings: "key"
    });
  }
}

// Perform one-time structural wipe of legacy DB if needed before loading
if (typeof window !== "undefined") {
  const isV3Cleaned = localStorage.getItem("lifeos_dexie_v3_wiped");
  if (!isV3Cleaned) {
    localStorage.setItem("lifeos_dexie_v3_wiped", "true");
    Dexie.delete("LifeOS_StudyDatabase").then(() => {
      console.log("[Dexie] Successfully performed structural wipe of legacy DB");
    }).catch(err => {
      console.error("[Dexie] Structural wipe failed:", err);
    });
  }
}

export const db = new StudyDatabase();

// Format helper to format duration ms into HH:MM:SS
function formatMsToHMS(ms: number): string {
  const s = Math.floor(ms / 1000);
  const secs = s % 60;
  const mins = Math.floor(s / 60) % 60;
  const hrs = Math.floor(s / 3600);
  return [hrs, mins, secs].map(v => String(v).padStart(2, "0")).join(":");
}

// 3. Web Optimistic Start Method with Dexie Transaction
export async function startWebFocusSession(tag: string, taskTitle: string): Promise<void> {
  const nowMs = Date.now();
  const sessionId = `sess_${nowMs}`;
  
  await db.transaction("rw", [db.localActiveSession, db.outboxQueue], async () => {
    // Clear any previous active session
    await db.localActiveSession.clear();

    // A. Overwrite local scratchpad
    await db.localActiveSession.put({
      sessionId,
      status: "FOCUSING",
      tag,
      taskTitle,
      baseFocusTimeMs: 0,
      lastEventTsMs: nowMs,
      baseFocusFormatted: "00:00:00",
      lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
      timelineJson: JSON.stringify([{ id: `-Nx_${nowMs}`, event: "start", tsMs: nowMs }]),
      isCurrentLeader: 1
    });

    // B. Queue for Firebase RTDB Live Sync
    await db.outboxQueue.add({
      mutationId: `mut_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "RTDB_LIVE_SYNC",
      actionType: "START",
      payloadJson: JSON.stringify({ sessionId, status: "FOCUSING", tag, taskTitle }),
      retryCount: 0,
      status: "PENDING"
    });
  });
}

// 4. Web Optimistic Pause Method with Dexie Transaction
export async function pauseWebFocusSession(): Promise<void> {
  const nowMs = Date.now();
  const sessions = await db.localActiveSession.toArray();
  if (sessions.length === 0) return;
  
  const current = sessions[0];
  if (current.status !== "FOCUSING") return;

  const delta = nowMs - current.lastEventTsMs;
  const nextBase = current.baseFocusTimeMs + delta;
  
  const timeline = JSON.parse(current.timelineJson || "[]");
  timeline.push({ id: `-Nx_${nowMs}`, event: "pause", tsMs: nowMs });

  await db.transaction("rw", [db.localActiveSession, db.outboxQueue], async () => {
    await db.localActiveSession.put({
      ...current,
      status: "PAUSED",
      baseFocusTimeMs: nextBase,
      lastEventTsMs: nowMs,
      baseFocusFormatted: formatMsToHMS(nextBase),
      lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
      timelineJson: JSON.stringify(timeline)
    });

    await db.outboxQueue.add({
      mutationId: `mut_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "RTDB_LIVE_SYNC",
      actionType: "PAUSE",
      payloadJson: JSON.stringify({ sessionId: current.sessionId, status: "PAUSED", baseFocusTimeMs: nextBase }),
      retryCount: 0,
      status: "PENDING"
    });
  });
}

// 5. Web Optimistic Resume Method with Dexie Transaction
export async function resumeWebFocusSession(): Promise<void> {
  const nowMs = Date.now();
  const sessions = await db.localActiveSession.toArray();
  if (sessions.length === 0) return;

  const current = sessions[0];
  if (current.status !== "PAUSED") return;

  const timeline = JSON.parse(current.timelineJson || "[]");
  timeline.push({ id: `-Nx_${nowMs}`, event: "resume", tsMs: nowMs });

  await db.transaction("rw", [db.localActiveSession, db.outboxQueue], async () => {
    await db.localActiveSession.put({
      ...current,
      status: "FOCUSING",
      lastEventTsMs: nowMs,
      lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
      timelineJson: JSON.stringify(timeline)
    });

    await db.outboxQueue.add({
      mutationId: `mut_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "RTDB_LIVE_SYNC",
      actionType: "RESUME",
      payloadJson: JSON.stringify({ sessionId: current.sessionId, status: "FOCUSING" }),
      retryCount: 0,
      status: "PENDING"
    });
  });
}

// 6. Web Subject Switch Method with Dexie Transaction
export async function switchWebFocusSubject(newSubject: string): Promise<void> {
  const nowMs = Date.now();
  const sessions = await db.localActiveSession.toArray();
  if (sessions.length === 0) return;

  const current = sessions[0];
  const delta = current.status === "FOCUSING" ? (nowMs - current.lastEventTsMs) : 0;
  const nextBase = current.baseFocusTimeMs + delta;

  const timeline = JSON.parse(current.timelineJson || "[]");
  timeline.push({ id: `-Nx_${nowMs}`, event: "switch", tsMs: nowMs, newSubject });

  await db.transaction("rw", [db.localActiveSession, db.outboxQueue], async () => {
    await db.localActiveSession.put({
      ...current,
      tag: newSubject,
      baseFocusTimeMs: nextBase,
      lastEventTsMs: nowMs,
      baseFocusFormatted: formatMsToHMS(nextBase),
      lastEventFormatted: new Date(nowMs).toISOString().slice(11, 23),
      timelineJson: JSON.stringify(timeline)
    });

    await db.outboxQueue.add({
      mutationId: `mut_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "RTDB_LIVE_SYNC",
      actionType: "SWITCH_SUBJECT",
      payloadJson: JSON.stringify({ sessionId: current.sessionId, tag: newSubject, baseFocusTimeMs: nextBase }),
      retryCount: 0,
      status: "PENDING"
    });
  });
}

// 7. Web End & Save Session Method with 10s short-circuit and LeetCode 56 Merger
export async function endWebFocusSession(): Promise<{ success: boolean; error?: string }> {
  const nowMs = Date.now();
  const sessions = await db.localActiveSession.toArray();
  if (sessions.length === 0) {
    return { success: false, error: "No active session to end." };
  }

  const current = sessions[0];
  const delta = current.status === "FOCUSING" ? (nowMs - current.lastEventTsMs) : 0;
  const totalFocusMs = current.baseFocusTimeMs + delta;

  // --- 10-Second Short-Circuit Guard ---
  if (totalFocusMs < 10000) {
    await db.transaction("rw", [db.localActiveSession, db.outboxQueue], async () => {
      await db.localActiveSession.clear();
      await db.outboxQueue.add({
        mutationId: `mut_wipe_${nowMs}`,
        createdAtMs: nowMs,
        routingTarget: "RTDB_LIVE_SYNC",
        actionType: "WIPE",
        payloadJson: "{}",
        retryCount: 0,
        status: "PENDING"
      });
    });
    return { success: false, error: "Session too short to save (<10s). Local scratchpad wiped." };
  }

  // --- LeetCode 56 Segment Merger logic applied to timelineJson ---
  const events = JSON.parse(current.timelineJson || "[]");
  // Build intervals from events (start -> pause/switch/end)
  const intervals: { start: number; end: number }[] = [];
  let currentStart = current.lastEventTsMs;
  
  // Find start/resume/pause events and pair them
  let segmentStart: number | null = null;
  events.forEach((evt: any) => {
    if (evt.event === "start" || evt.event === "resume") {
      segmentStart = evt.tsMs;
    } else if ((evt.event === "pause" || evt.event === "switch") && segmentStart !== null) {
      intervals.push({ start: segmentStart, end: evt.tsMs });
      segmentStart = null;
    }
  });
  if (segmentStart !== null) {
    intervals.push({ start: segmentStart, end: nowMs });
  }

  // Merge overlapping intervals (LeetCode 56)
  const mergedIntervals: { start: number; end: number }[] = [];
  if (intervals.length > 0) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    mergedIntervals.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      const last = mergedIntervals[mergedIntervals.length - 1];
      const curr = sorted[i];
      if (curr.start <= last.end) {
        last.end = Math.max(last.end, curr.end);
      } else {
        mergedIntervals.push(curr);
      }
    }
  }

  const dateString = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
  const recordId = `vault_${nowMs}`;

  const historyRecord: LocalHistoryVault = {
    recordId,
    dateString,
    subject: current.tag,
    taskTitle: current.taskTitle,
    startTimeMs: events[0]?.tsMs || nowMs,
    endTimeMs: nowMs,
    totalFocusMs,
    durationFormatted: formatMsToHMS(totalFocusMs),
    startTimeFormatted: new Date(events[0]?.tsMs || nowMs).toLocaleTimeString(),
    endTimeFormatted: new Date(nowMs).toLocaleTimeString(),
    isSyncedToFirestore: 0,
    mode: "POMODORO",
    lastModifiedMs: nowMs
  };

  await db.transaction("rw", [db.localActiveSession, db.localHistoryVault, db.outboxQueue], async () => {
    // Save to Vault
    await db.localHistoryVault.put(historyRecord);
    // Clear Scratchpad
    await db.localActiveSession.clear();
    // Enqueue Archive Mutation directly to Firestore Direct Vault (Bypassing RTDB!)
    await db.outboxQueue.add({
      mutationId: `mut_archive_${nowMs}`,
      createdAtMs: nowMs,
      routingTarget: "FIRESTORE_DIRECT_VAULT",
      actionType: "ARCHIVE_SESSION",
      payloadJson: JSON.stringify(historyRecord),
      retryCount: 0,
      status: "PENDING"
    });
  });

  return { success: true };
}

// Process single Outbox mutation row (Simulated or triggered)
export async function processDexieOutboxRow(queueId: number): Promise<void> {
  await db.outboxQueue.update(queueId, { status: "SYNCED" });
}

// Clear all data
export async function clearDexieAll(): Promise<void> {
  await db.localActiveSession.clear();
  await db.outboxQueue.clear();
  await db.localHistoryVault.clear();
}

/**
 * Executes a local rollback to adopt the winning server state
 * in case the Lamport Monotonic Guard rejects our optimistic write.
 */
export async function rollbackWebActiveSession(session: any): Promise<void> {
  await db.localActiveSession.clear();
  if (session && session.status !== "IDLE" && session.sessionId !== "none" && session.session_id !== "none") {
    const sId = session.sessionId || session.session_id || "sess_unknown";
    await db.localActiveSession.put({
      sessionId: sId,
      status: session.status || "IDLE",
      tag: session.tag || "",
      taskTitle: session.taskTitle || session.task_title || "",
      baseFocusTimeMs: session.baseFocusTimeMs || session.base_focus_time_ms || 0,
      lastEventTsMs: session.lastEventTsMs || session.lastEventTimestampMs || Date.now(),
      baseFocusFormatted: formatMsToHMS(session.baseFocusTimeMs || session.base_focus_time_ms || 0),
      lastEventFormatted: new Date(session.lastEventTsMs || session.lastEventTimestampMs || Date.now()).toISOString().slice(11, 23),
      timelineJson: session.timelineJson || session.timeline_json || "[]",
      isCurrentLeader: 1
    });
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("life_os_sqlite_changed"));
  }
}
