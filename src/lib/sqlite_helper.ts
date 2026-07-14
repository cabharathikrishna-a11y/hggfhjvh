/**
 * Simulated SQLite / Room Database Helper with Schema Versioning, Auto-Drop Migration,
 * and Optimistic Outbox Queue Routing.
 * Fully supports the strict 3-table schema and LeetCode 56 merge operations.
 */

import { startWebFocusSession, pauseWebFocusSession, resumeWebFocusSession, switchWebFocusSubject, endWebFocusSession, processDexieOutboxRow, clearDexieAll, db } from "./dexie_db.ts";

export interface SQLiteOperationLog {
  timestamp: string;
  type: "success" | "info" | "sql" | "warn";
  message: string;
}

export interface FocusInterval {
  start: number;
  end: number;
}

export interface OutboxRecord {
  id: string;
  action: string;
  routing_target: string;
  payload_json: string;
  timestamp: number;
  status: "PENDING" | "SYNCED" | "FAILED";
}

export interface LocalActiveSession {
  session_id: string;
  status: string;
  tag: string;
  task_title: string;
  base_focus_time_ms: number;
  last_event_ts_ms: number;
  base_focus_formatted: string;
  last_event_formatted: string;
  timeline_json: string; // List of FocusInterval objects: [{start, end}]
  is_current_leader: number;
}

export interface HistoryVaultRecord {
  id: string;
  session_id: string;
  tag: string;
  task_title: string;
  total_focus_ms: number;
  created_at_ms: number;
  timeline_json: string; // Merged FocusInterval objects
}

/**
 * LeetCode 56 Interval Merger: Merges overlapping focus segments
 */
export function mergeFocusIntervals(intervals: FocusInterval[]): FocusInterval[] {
  if (intervals.length <= 1) return intervals;
  
  // Sort intervals by start timestamp
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: FocusInterval[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    
    // If the current interval overlaps with the previous merged one, merge them
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export class SQLiteOpenHelper {
  private static STORAGE_KEY_VERSION = "life_os_sqlite_version";
  private static STORAGE_KEY_LOGS = "life_os_sqlite_logs";
  private static STORAGE_KEY_TABLES = "life_os_sqlite_tables";

  constructor() {
    this.initDatabase();
  }

  private initDatabase() {
    const version = this.getVersion();
    if (!localStorage.getItem(SQLiteOpenHelper.STORAGE_KEY_TABLES)) {
      if (version === 1) {
        this.setupLegacyV1Tables();
      } else {
        this.setupStrictV2Tables();
      }
    }
  }

  public getVersion(): number {
    const stored = localStorage.getItem(SQLiteOpenHelper.STORAGE_KEY_VERSION);
    return stored ? parseInt(stored, 10) : 1;
  }

  private setVersion(version: number) {
    localStorage.setItem(SQLiteOpenHelper.STORAGE_KEY_VERSION, String(version));
    this.log("info", `Database version updated to ${version}`);
  }

  public getLogs(): SQLiteOperationLog[] {
    const logs = localStorage.getItem(SQLiteOpenHelper.STORAGE_KEY_LOGS);
    return logs ? JSON.parse(logs) : [];
  }

  public clearLogs() {
    localStorage.removeItem(SQLiteOpenHelper.STORAGE_KEY_LOGS);
    this.log("info", "SQLite Logs cleared.");
  }

  public log(type: SQLiteOperationLog["type"], message: string) {
    const logs = this.getLogs();
    const newLog: SQLiteOperationLog = {
      timestamp: new Date().toLocaleTimeString() + "." + String(Date.now() % 1000).padStart(3, "0"),
      type,
      message
    };
    logs.push(newLog);
    if (logs.length > 100) logs.shift();
    localStorage.setItem(SQLiteOpenHelper.STORAGE_KEY_LOGS, JSON.stringify(logs));
    console.log(`[SQLiteHelper] [${type.toUpperCase()}] ${message}`);
  }

  private setupLegacyV1Tables() {
    const tables = {
      old_timer_config: [
        { id: "1", duration_minutes: 25, is_silent: 0 },
        { id: "2", duration_minutes: 50, is_silent: 1 }
      ],
      legacy_active_timer: [
        { session_id: "active_v1_001", status: "RUNNING", current_seconds: 1200 }
      ]
    };
    localStorage.setItem(SQLiteOpenHelper.STORAGE_KEY_TABLES, JSON.stringify(tables));
    this.log("info", "Initialized legacy Database structures (VERSION = 1).");
  }

  private setupStrictV2Tables() {
    const tables = {
      local_active_session: [],
      outbox_queue: [],
      local_history_vault: []
    };
    localStorage.setItem(SQLiteOpenHelper.STORAGE_KEY_TABLES, JSON.stringify(tables));
    this.log("info", "Initialized strict 3-table ACID Database structures (VERSION = 2).");
  }

  public getTables(): Record<string, any[]> {
    const raw = localStorage.getItem(SQLiteOpenHelper.STORAGE_KEY_TABLES);
    return raw ? JSON.parse(raw) : {};
  }

  public saveTables(tables: Record<string, any[]>) {
    localStorage.setItem(SQLiteOpenHelper.STORAGE_KEY_TABLES, JSON.stringify(tables));
  }

  public execSQL(sql: string) {
    const cleanSql = sql.trim().replace(/\s+/g, " ");
    this.log("sql", cleanSql);

    const tables = this.getTables();

    if (cleanSql.toUpperCase().startsWith("DROP TABLE IF EXISTS")) {
      const parts = cleanSql.split(/\s+/);
      const tableName = parts[parts.length - 1].replace(";", "");
      if (tables[tableName]) {
        delete tables[tableName];
        this.log("success", `Table '${tableName}' dropped successfully.`);
      } else {
        this.log("info", `Table '${tableName}' did not exist (skipped).`);
      }
    } else if (cleanSql.toUpperCase().includes("CREATE TABLE IF NOT EXISTS LOCAL_ACTIVE_SESSION")) {
      if (!tables["local_active_session"]) tables["local_active_session"] = [];
      if (!tables["outbox_queue"]) tables["outbox_queue"] = [];
      if (!tables["local_history_vault"]) tables["local_history_vault"] = [];
      this.log("success", "Verified/Created local_active_session, outbox_queue, and local_history_vault tables.");
    } else {
      this.log("info", `Executed Custom Query: "${cleanSql.substring(0, 60)}..."`);
    }

    this.saveTables(tables);
  }

  public migrate1To2(): { success: boolean; logs: SQLiteOperationLog[] } {
    this.log("info", "Initiating SQLite Database Migration from VERSION 1 to 2...");
    try {
      // 1. Drop legacy configuration tables or old flat scratchpads
      this.execSQL("DROP TABLE IF EXISTS old_timer_config;");
      this.execSQL("DROP TABLE IF EXISTS legacy_active_timer;");

      // 2. Clear stale SharedPreferences / DataStore flags
      this.clearStaleSharedPreferences();

      // 3. Re-verify our strict ACID-compliant tables exist
      this.execSQL(`
        CREATE TABLE IF NOT EXISTS local_active_session (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            tag TEXT DEFAULT 'Study',
            task_title TEXT DEFAULT 'General Focus',
            base_focus_time_ms INTEGER DEFAULT 0,
            last_event_ts_ms INTEGER DEFAULT 0,
            base_focus_formatted TEXT DEFAULT '00:00:00',
            last_event_formatted TEXT DEFAULT '00:00:00:000',
            timeline_json TEXT DEFAULT '[]',
            is_current_leader INTEGER DEFAULT 1
        );
      `);

      // Seed a default session to verify ACID compliance and make it interactive
      const tables = this.getTables();
      tables["local_active_session"] = tables["local_active_session"] || [];
      tables["outbox_queue"] = tables["outbox_queue"] || [];
      tables["local_history_vault"] = tables["local_history_vault"] || [];

      if (tables["local_active_session"].length === 0) {
        tables["local_active_session"].push({
          session_id: "sess_pioneer",
          status: "IDLE",
          tag: "Study",
          task_title: "General Focus",
          base_focus_time_ms: 0,
          last_event_ts_ms: Date.now(),
          base_focus_formatted: "00:00:00",
          last_event_formatted: new Date().toLocaleTimeString() + ":000",
          timeline_json: "[]",
          is_current_leader: 1
        });
        this.log("success", "Seeded default ACID compliant row into local_active_session.");
      }

      this.saveTables(tables);
      this.setVersion(2);
      this.log("success", "Migration complete! SQLite Database is now in sync at version 2.");
      return { success: true, logs: this.getLogs() };
    } catch (err: any) {
      this.log("warn", `Migration failed: ${err.message || err}`);
      return { success: false, logs: this.getLogs() };
    }
  }

  public resetToV1(): SQLiteOperationLog[] {
    this.log("info", "Resetting Database back to Legacy Version 1 structures...");
    localStorage.removeItem(SQLiteOpenHelper.STORAGE_KEY_TABLES);
    this.setVersion(1);
    this.setupLegacyV1Tables();

    // Clear Dexie database asynchronously
    clearDexieAll().then(() => {
      this.log("success", "[Dexie.js] Cleared Dexie database completely on Reset.");
    }).catch(err => {
      this.log("warn", `[Dexie.js] Failed to clear Dexie database: ${err.message || err}`);
    });

    return this.getLogs();
  }

  private clearStaleSharedPreferences() {
    this.log("info", "Clearing stale SharedPreferences / DataStore flags...");
    const keysToClear = [
      "life_os_timer_is_running",
      "life_os_last_resume_time",
      "life_os_accumulated_time",
      "life_os_stopwatch_seconds"
    ];
    keysToClear.forEach(key => {
      localStorage.removeItem(key);
      this.log("info", `Pruned cached state key: "${key}"`);
    });
  }

  public getActiveSession(): LocalActiveSession | null {
    const tables = this.getTables();
    const list = tables["local_active_session"] || [];
    return list.length > 0 ? (list[0] as LocalActiveSession) : null;
  }

  public getOutboxQueue(): OutboxRecord[] {
    const tables = this.getTables();
    return tables["outbox_queue"] || [];
  }

  public getHistoryVault(): HistoryVaultRecord[] {
    const tables = this.getTables();
    return tables["local_history_vault"] || [];
  }

  private formatMsToHMS(ms: number): string {
    const s = Math.floor(ms / 1000);
    const secs = s % 60;
    const mins = Math.floor(s / 60) % 60;
    const hrs = Math.floor(s / 3600);
    return [hrs, mins, secs].map(v => String(v).padStart(2, "0")).join(":");
  }

  private formatTimestamp(ms: number): string {
    const date = new Date(ms);
    const timeStr = date.toLocaleTimeString();
    const millis = String(ms % 1000).padStart(3, "0");
    return `${timeStr}:${millis}`;
  }

  /**
   * 1. startFocus
   */
  public startFocus(tag: string, taskTitle: string): { session: LocalActiveSession; outbox: OutboxRecord } {
    const tables = this.getTables();
    const now = Date.now();
    const sessionId = "sess_" + now;

    const session: LocalActiveSession = {
      session_id: sessionId,
      status: "FOCUSING",
      tag,
      task_title: taskTitle,
      base_focus_time_ms: 0,
      last_event_ts_ms: now,
      base_focus_formatted: "00:00:00",
      last_event_formatted: this.formatTimestamp(now),
      timeline_json: "[]",
      is_current_leader: 1
    };

    tables["local_active_session"] = [session];
    this.log("sql", `INSERT OR REPLACE INTO local_active_session (session_id, status, tag, task_title, base_focus_time_ms, last_event_ts_ms, is_current_leader) VALUES ('${sessionId}', 'FOCUSING', '${tag}', '${taskTitle}', 0, ${now}, 1);`);

    const outboxId = "outbox_" + now;
    const outbox: OutboxRecord = {
      id: outboxId,
      action: "START",
      routing_target: "RTDB_LIVE_SYNC",
      payload_json: JSON.stringify({ sessionId, status: "FOCUSING", tag, base_focus_time_ms: 0, last_event_ts_ms: now }),
      timestamp: now,
      status: "PENDING"
    };

    tables["outbox_queue"] = tables["outbox_queue"] || [];
    tables["outbox_queue"].push(outbox);
    this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target, status) VALUES ('${outboxId}', 'START', 'RTDB_LIVE_SYNC', 'PENDING');`);

    this.saveTables(tables);

    // Call Dexie database asynchronously
    startWebFocusSession(tag, taskTitle).then(() => {
      this.log("success", `[Dexie.js] startWebFocusSession complete for session_id: ${sessionId}`);
    }).catch(err => {
      this.log("warn", `[Dexie.js] startWebFocusSession failed: ${err.message || err}`);
    });

    return { session, outbox };
  }

  /**
   * 2. pauseFocus
   */
  public pauseFocus(): { session: LocalActiveSession | null; outbox: OutboxRecord | null } {
    const tables = this.getTables();
    const session = this.getActiveSession();
    if (!session) {
      this.log("warn", "Cannot pause focus: no active session found.");
      return { session: null, outbox: null };
    }

    const now = Date.now();
    const delta = now - session.last_event_ts_ms;
    
    // Add current focusing segment to the timeline
    const timeline: FocusInterval[] = JSON.parse(session.timeline_json || "[]");
    if (session.status === "FOCUSING") {
      timeline.push({ start: session.last_event_ts_ms, end: now });
    }

    const nextBaseFocus = session.base_focus_time_ms + (session.status === "FOCUSING" ? delta : 0);

    session.status = "PAUSED";
    session.base_focus_time_ms = nextBaseFocus;
    session.last_event_ts_ms = now;
    session.base_focus_formatted = this.formatMsToHMS(nextBaseFocus);
    session.last_event_formatted = this.formatTimestamp(now);
    session.timeline_json = JSON.stringify(timeline);

    tables["local_active_session"] = [session];
    this.log("sql", `UPDATE local_active_session SET base_focus_time_ms = ${nextBaseFocus}, status = 'PAUSED', last_event_ts_ms = ${now}, timeline_json = '${session.timeline_json}' WHERE session_id = '${session.session_id}';`);

    const outboxId = "outbox_" + now;
    const outbox: OutboxRecord = {
      id: outboxId,
      action: "PAUSE",
      routing_target: "RTDB_LIVE_SYNC",
      payload_json: JSON.stringify({ sessionId: session.session_id, status: "PAUSED", base_focus_time_ms: nextBaseFocus, last_event_ts_ms: now }),
      timestamp: now,
      status: "PENDING"
    };

    tables["outbox_queue"] = tables["outbox_queue"] || [];
    tables["outbox_queue"].push(outbox);
    this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target, status) VALUES ('${outboxId}', 'PAUSE', 'RTDB_LIVE_SYNC', 'PENDING');`);

    this.saveTables(tables);

    // Call Dexie database asynchronously
    pauseWebFocusSession().then(() => {
      this.log("success", `[Dexie.js] pauseWebFocusSession complete`);
    }).catch(err => {
      this.log("warn", `[Dexie.js] pauseWebFocusSession failed: ${err.message || err}`);
    });

    return { session, outbox };
  }

  /**
   * 3. resumeFocus
   */
  public resumeFocus(): { session: LocalActiveSession | null; outbox: OutboxRecord | null } {
    const tables = this.getTables();
    const session = this.getActiveSession();
    if (!session) {
      this.log("warn", "Cannot resume focus: no active session found.");
      return { session: null, outbox: null };
    }

    const now = Date.now();
    session.status = "FOCUSING";
    session.last_event_ts_ms = now;
    session.last_event_formatted = this.formatTimestamp(now);

    tables["local_active_session"] = [session];
    this.log("sql", `UPDATE local_active_session SET status = 'FOCUSING', last_event_ts_ms = ${now} WHERE session_id = '${session.session_id}';`);

    const outboxId = "outbox_" + now;
    const outbox: OutboxRecord = {
      id: outboxId,
      action: "RESUME",
      routing_target: "RTDB_LIVE_SYNC",
      payload_json: JSON.stringify({ sessionId: session.session_id, status: "FOCUSING", last_event_ts_ms: now }),
      timestamp: now,
      status: "PENDING"
    };

    tables["outbox_queue"] = tables["outbox_queue"] || [];
    tables["outbox_queue"].push(outbox);
    this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target, status) VALUES ('${outboxId}', 'RESUME', 'RTDB_LIVE_SYNC', 'PENDING');`);

    this.saveTables(tables);

    // Call Dexie database asynchronously
    resumeWebFocusSession().then(() => {
      this.log("success", `[Dexie.js] resumeWebFocusSession complete`);
    }).catch(err => {
      this.log("warn", `[Dexie.js] resumeWebFocusSession failed: ${err.message || err}`);
    });

    return { session, outbox };
  }

  /**
   * 4. switchSubject
   */
  public switchSubject(newSubject: string): { session: LocalActiveSession | null; outbox: OutboxRecord | null } {
    const tables = this.getTables();
    const session = this.getActiveSession();
    if (!session) {
      this.log("warn", "Cannot switch subject: no active session found.");
      return { session: null, outbox: null };
    }

    const now = Date.now();
    const delta = now - session.last_event_ts_ms;
    const timeline: FocusInterval[] = JSON.parse(session.timeline_json || "[]");

    if (session.status === "FOCUSING") {
      timeline.push({ start: session.last_event_ts_ms, end: now });
    }

    const nextBaseFocus = session.base_focus_time_ms + (session.status === "FOCUSING" ? delta : 0);

    session.tag = newSubject;
    session.base_focus_time_ms = nextBaseFocus;
    session.last_event_ts_ms = now;
    session.base_focus_formatted = this.formatMsToHMS(nextBaseFocus);
    session.last_event_formatted = this.formatTimestamp(now);
    session.timeline_json = JSON.stringify(timeline);

    tables["local_active_session"] = [session];
    this.log("sql", `UPDATE local_active_session SET tag = '${newSubject}', base_focus_time_ms = ${nextBaseFocus}, last_event_ts_ms = ${now}, timeline_json = '${session.timeline_json}' WHERE session_id = '${session.session_id}';`);

    const outboxId = "outbox_" + now;
    const outbox: OutboxRecord = {
      id: outboxId,
      action: "SWITCH",
      routing_target: "RTDB_LIVE_SYNC",
      payload_json: JSON.stringify({ sessionId: session.session_id, tag: newSubject, last_event_ts_ms: now, base_focus_time_ms: nextBaseFocus }),
      timestamp: now,
      status: "PENDING"
    };

    tables["outbox_queue"] = tables["outbox_queue"] || [];
    tables["outbox_queue"].push(outbox);
    this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target, status) VALUES ('${outboxId}', 'SWITCH', 'RTDB_LIVE_SYNC', 'PENDING');`);

    this.saveTables(tables);

    // Call Dexie database asynchronously
    switchWebFocusSubject(newSubject).then(() => {
      this.log("success", `[Dexie.js] switchWebFocusSubject complete for subject: ${newSubject}`);
    }).catch(err => {
      this.log("warn", `[Dexie.js] switchWebFocusSubject failed: ${err.message || err}`);
    });

    return { session, outbox };
  }

  /**
   * 5. endSession
   */
  public endSession(): { success: boolean; error?: string; record?: HistoryVaultRecord; outbox?: OutboxRecord } {
    const tables = this.getTables();
    const session = this.getActiveSession();
    if (!session) {
      return { success: false, error: "No active session to end." };
    }

    const now = Date.now();
    const delta = now - session.last_event_ts_ms;
    const timeline: FocusInterval[] = JSON.parse(session.timeline_json || "[]");

    if (session.status === "FOCUSING") {
      timeline.push({ start: session.last_event_ts_ms, end: now });
    }

    const totalFocusMs = session.base_focus_time_ms + (session.status === "FOCUSING" ? delta : 0);

    // Call Dexie endWebFocusSession as well
    endWebFocusSession().then((res) => {
      this.log("success", `[Dexie.js] endWebFocusSession finished (success: ${res.success}, error: ${res.error || "none"})`);
    }).catch(err => {
      this.log("warn", `[Dexie.js] endWebFocusSession failed: ${err.message || err}`);
    });

    // --- 10-Second Short-Circuit Guard ---
    if (totalFocusMs < 10000) {
      this.log("warn", `Session ending aborted by 10s short-circuit guard (${totalFocusMs}ms focus total). Wiping session scratchpad.`);
      tables["local_active_session"] = [];
      
      const outboxId = "outbox_wipe_" + now;
      const outbox: OutboxRecord = {
        id: outboxId,
        action: "WIPE",
        routing_target: "RTDB_LIVE_SYNC",
        payload_json: "{}",
        timestamp: now,
        status: "PENDING"
      };
      tables["outbox_queue"] = tables["outbox_queue"] || [];
      tables["outbox_queue"].push(outbox);
      this.log("sql", `DELETE FROM local_active_session WHERE session_id = '${session.session_id}';`);
      this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target) VALUES ('${outboxId}', 'WIPE', 'RTDB_LIVE_SYNC');`);
      
      this.saveTables(tables);
      return { success: true, error: "Session too short (< 10s). Wiped and aborted." };
    }

    // --- LeetCode 56 Merger ---
    this.log("info", `Initiating LeetCode 56 Interval Merger on active session timeline. Unmerged segments count: ${timeline.length}`);
    const mergedTimeline = mergeFocusIntervals(timeline);
    this.log("success", `LeetCode 56 merge completed! Redundant focus segments merged: ${timeline.length} → ${mergedTimeline.length}`);

    // --- Insert Compiled Record to Local History Vault ---
    const recordId = "vault_" + now;
    const record: HistoryVaultRecord = {
      id: recordId,
      session_id: session.session_id,
      tag: session.tag,
      task_title: session.task_title,
      total_focus_ms: totalFocusMs,
      created_at_ms: now,
      timeline_json: JSON.stringify(mergedTimeline)
    };

    tables["local_history_vault"] = tables["local_history_vault"] || [];
    tables["local_history_vault"].push(record);
    this.log("sql", `INSERT INTO local_history_vault (id, session_id, tag, task_title, total_focus_ms, created_at_ms, timeline_json) VALUES ('${recordId}', '${session.session_id}', '${session.tag}', '${session.task_title}', ${totalFocusMs}, ${now}, '${record.timeline_json}');`);

    // --- Wipe Local Scratchpad ---
    tables["local_active_session"] = [];
    this.log("sql", `DELETE FROM local_active_session WHERE session_id = '${session.session_id}';`);

    // --- Route directly to Firestore Cold Vault (Bypassing RTDB!) ---
    const outboxId = "outbox_archive_" + now;
    const outbox: OutboxRecord = {
      id: outboxId,
      action: "ARCHIVE_SESSION",
      routing_target: "FIRESTORE_DIRECT_VAULT",
      payload_json: JSON.stringify(record),
      timestamp: now,
      status: "PENDING"
    };

    tables["outbox_queue"] = tables["outbox_queue"] || [];
    tables["outbox_queue"].push(outbox);
    this.log("sql", `INSERT INTO outbox_queue (id, action, routing_target, payload_json) VALUES ('${outboxId}', 'ARCHIVE_SESSION', 'FIRESTORE_DIRECT_VAULT', '...');`);

    this.saveTables(tables);
    return { success: true, record, outbox };
  }

  /**
   * Simulate a single outbox row execution/transmission
   */
  public processOutboxRow(recordId: string): boolean {
    const tables = this.getTables();
    const queue = tables["outbox_queue"] || [];
    const index = queue.findIndex(q => q.id === recordId);
    if (index === -1) return false;

    queue[index].status = "SYNCED";
    this.log("success", `Outbox message [${queue[index].action}] processed successfully to target: ${queue[index].routing_target}`);
    this.saveTables(tables);

    // Call Dexie database to update corresponding outbox mutation to SYNCED
    db.outboxQueue.where("status").equals("PENDING").toArray().then(pending => {
      if (pending.length > 0) {
        processDexieOutboxRow(pending[0].queueId!).then(() => {
          this.log("success", `[Dexie.js] Synced Dexie outbox mutation: ${pending[0].actionType}`);
        });
      }
    }).catch(err => {
      this.log("warn", `[Dexie.js] Failed to query Dexie outbox queue: ${err.message || err}`);
    });

    return true;
  }

  /**
   * Helper to insert a mock active session row directly
   */
  public insertActiveSession(row: any) {
    const tables = this.getTables();
    if (!tables["local_active_session"]) {
      tables["local_active_session"] = [];
    }
    const now = Date.now();
    tables["local_active_session"] = [{
      session_id: row.session_id || "session_" + now,
      status: row.status || "IDLE",
      tag: row.tag || "Study",
      task_title: row.task_title || "General Focus",
      base_focus_time_ms: row.base_focus_time_ms || 0,
      last_event_ts_ms: row.last_event_ts_ms || now,
      base_focus_formatted: row.base_focus_formatted || "00:00:00",
      last_event_formatted: row.last_event_formatted || this.formatTimestamp(now),
      timeline_json: row.timeline_json || "[]",
      is_current_leader: row.is_current_leader !== undefined ? row.is_current_leader : 1
    }];
    this.saveTables(tables);
    this.log("success", `Inserted/Replaced active session: ${row.session_id || "Session"}`);
  }

  /**
   * Executes a local rollback of SQLite simulator active session to adopt winning cloud state.
   */
  public rollbackActiveSession(session: any) {
    const tables = this.getTables();
    if (!session || session.status === "IDLE" || session.sessionId === "none" || session.session_id === "none") {
      tables["local_active_session"] = [];
    } else {
      const sId = session.sessionId || session.session_id || "sess_unknown";
      const totalFocusMs = session.baseFocusTimeMs || session.base_focus_time_ms || 0;
      const ts = session.lastEventTsMs || session.lastEventTimestampMs || Date.now();
      
      const formatDuration = (ms: number): string => {
        const sec = Math.floor(ms / 1000);
        return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
      };

      const localSess: LocalActiveSession = {
        session_id: sId,
        status: session.status || "IDLE",
        tag: session.tag || "",
        task_title: session.taskTitle || session.task_title || "",
        base_focus_time_ms: totalFocusMs,
        last_event_ts_ms: ts,
        base_focus_formatted: formatDuration(totalFocusMs),
        last_event_formatted: this.formatTimestamp(ts),
        timeline_json: session.timelineJson || session.timeline_json || "[]",
        is_current_leader: 1
      };
      tables["local_active_session"] = [localSess];
    }
    this.saveTables(tables);
    this.log("warn", "[Rollback] Lamport Monotonic Guard rejected local update. Rolled back SQLite active session.");
  }
}

export const sqliteHelper = new SQLiteOpenHelper();
