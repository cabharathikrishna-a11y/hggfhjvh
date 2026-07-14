import React, { useState, useEffect, useRef, useMemo } from "react";
import { FocusRecord, Task } from "../types.ts";
import { Play, Pause, RotateCcw, Flame, Users, Calendar, Sparkles, Maximize2, Minimize2, Eye, Clipboard, List, Tag, BellRing, Plus, Sliders, AlertTriangle, Coffee, Database, Activity, CheckSquare, RefreshCw, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Real-time integration imports
import { ringFriendBell, getUsernameFromEmail, addFocusRecordToDb, removeFocusRecordFromDb, getProfileImageUrl, startWebBreak, saveTimerSettings, toggleWebSessionMode, database } from "../lib/firebase.ts";
import { ref, onValue, off } from "firebase/database";
import { User } from "firebase/auth";
import { sqliteHelper } from "../lib/sqlite_helper";
import { mergeOverlappingStudyIntervals, StudyInterval } from "../lib/intervalMerger";
import { runWebJanitorOnBoot, executeIndexedDbQuotaPruner } from "../lib/webJanitor";
import { db } from "../lib/dexie_db";
import { publishWebPresenceCard } from "../lib/webPresence";
import { startWebHeartbeatLoop } from "../lib/webHeartbeat";
import { subscribeToFriendsPresence, LeaderboardPeer } from "../lib/webLeaderboard";
import { initializeWebAudio, sendWebNudgeBuzzer, listenForIncomingWebNudges } from "../lib/webBuzzer";
import { logManualWebStudySession } from "../lib/manualLogEngine";
import { getUniversalTimeMs } from "../lib/timeEngine";

function safeParse<T>(str: string | null, fallback: T): T {
  if (str === null || str === undefined || str === "undefined" || str === "") return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.warn("JSON parse failed for string:", str, e);
    return fallback;
  }
}

const MOTIVATIONAL_QUOTES = [
  "Focus is a muscle, and you are building it right now.",
  "Deep work is the superpower of the 21st century.",
  "Your attention is your most valuable asset. Guard it fiercely.",
  "Simplify, then focus.",
  "Quiet the mind, concentrate the effort, achieve the flow.",
  "One task. One focus. Pure execution.",
  "Where attention goes, energy flows and results show.",
  "The secret of change is to focus all of your energy, not on fighting the old, but on building the new.",
  "Work deeply. Create beautifully.",
  "Do not mistake activity for achievement. Stay focused.",
  "Be present in all things and thankful for all things."
];

const sanitizeName = (nameString: string) => {
  if (!nameString) return "Focus Partner";
  const nameTrimmed = nameString.trim();
  if (nameTrimmed.startsWith("data:image/") || nameTrimmed.startsWith("base64:") || nameTrimmed.startsWith("/") || nameTrimmed.length > 50) {
    return "Focus Partner";
  }
  return nameTrimmed;
};

const renderAvatar = (avatarString: string, sizeClass: string = "w-8 h-8 text-xl") => {
  if (!avatarString) return null;
  
  let src = avatarString;
  if (avatarString.startsWith("base64:")) {
    const rawBase64 = avatarString.substring("base64:".length);
    src = `data:image/jpeg;base64,${rawBase64}`;
  } else {
    // Extra safety: check if the string itself is a raw base64 image (typically starts with '/9j/' or other Base64 characters and is long)
    const isRawBase64 = avatarString.length > 100 && !avatarString.startsWith("http") && !avatarString.startsWith("data:image");
    if (isRawBase64) {
      src = `data:image/jpeg;base64,${avatarString}`;
    }
  }
  
  const isImage = src.startsWith("data:image/") || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:");
  
  if (isImage) {
    return (
      <div className={`rounded-full overflow-hidden flex items-center justify-center bg-gray-950 border border-gray-800 shrink-0 ${sizeClass}`}>
        <img 
          src={src} 
          referrerPolicy="no-referrer" 
          className="w-full h-full object-cover" 
          alt="Avatar" 
        />
      </div>
    );
  }
  
  return (
    <div className={`rounded-full flex items-center justify-center bg-blue-500/10 border border-blue-500/20 shrink-0 ${sizeClass}`}>
      <span className="leading-none select-none flex items-center justify-center text-center">{avatarString}</span>
    </div>
  );
};

interface TimerViewProps {
  tasks: Task[];
  focusRecords: FocusRecord[];
  onAddFocusRecord: (record: FocusRecord) => void;
  currentUser: User | null;
  friendsStatuses: Record<string, any>;
  myStatusNode?: any;
  myProfile?: { nickname: string; emoji: string; photoURL?: string };
  onTriggerSaveModal?: (data: {
    elapsedSecs: number;
    defaultTaskTitle: string;
    defaultTag: string;
    defaultNotes: string;
    startTime: string;
    isPomodoro: boolean;
  }) => void;
}

export default function TimerView({ 
  tasks, 
  focusRecords, 
  onAddFocusRecord, 
  currentUser, 
  friendsStatuses, 
  myStatusNode,
  myProfile,
  onTriggerSaveModal
}: TimerViewProps) {
  // Optimistic UI state to bypass Firebase roundtrip latency
  const [optimisticState, setOptimisticState] = useState<any | null>(null);
  const [optimisticHandoffLock, setOptimisticHandoffLock] = useState<{ delta: number, expiresAt: number } | null>(null);

  // Sync trigger to force render when localStorage changes externally
  const [syncTrigger, setSyncTrigger] = useState(0);

  const [nudgeAlert, setNudgeAlert] = useState<string | null>(null);

  // Step 6 Social Presence & Nudge initialization
  useEffect(() => {
    // 1. Listen to incoming web nudges and trigger visual alert/sound
    const unsubscribeNudges = listenForIncomingWebNudges((sender) => {
      setNudgeAlert(`🔔 Accountability Notification: You were nudged by ${sender}!`);
    });

    // 2. Fire 60s background heartbeat pulse loop
    startWebHeartbeatLoop();

    // 3. Pre-load web audio on first click to satisfy browser user-interaction rules
    const handleFirstClick = () => {
      initializeWebAudio().catch(err => console.warn("Failed to initialize web audio:", err));
      window.removeEventListener("click", handleFirstClick);
    };
    window.addEventListener("click", handleFirstClick);

    return () => {
      unsubscribeNudges();
      window.removeEventListener("click", handleFirstClick);
    };
  }, []);

  // Active timer structure we will work with (either optimistic or from myStatusNode)
  const activeTimerData = useMemo(() => {
    if (optimisticState) {
      return optimisticState;
    }
    return myStatusNode?.active_session || myStatusNode?.active_timer || {};
  }, [optimisticState, myStatusNode]);

  const [pomodoroMinutes, setPomodoroMinutes] = useState<number>(() => {
    const saved = localStorage.getItem("life_os_pomodoro_minutes");
    return safeParse(saved, 25);
  });
  const [breakMinutes, setBreakMinutes] = useState<number>(() => {
    const saved = localStorage.getItem("life_os_break_minutes");
    return safeParse(saved, 5);
  });
  const [autoStartBreak, setAutoStartBreak] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_auto_start_break");
    return safeParse(saved, true);
  });
  const [autoStartPomo, setAutoStartPomo] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_auto_start_pomo");
    return safeParse(saved, true);
  });
  const [autoStartStopwatchAfterBreak, setAutoStartStopwatchAfterBreak] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_auto_start_sw_after_break");
    return safeParse(saved, false);
  });
  const [publicPresenceVisible, setPublicPresenceVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_public_presence_visible");
    return safeParse(saved, true);
  });

  // Sync settings dynamically from Firebase
  useEffect(() => {
    const settings = myStatusNode?.timer_settings;
    if (!settings) return;
    
    if (settings.timerDurationMinutes !== undefined) {
      setPomodoroMinutes(settings.timerDurationMinutes);
      localStorage.setItem("life_os_pomodoro_minutes", JSON.stringify(settings.timerDurationMinutes));
    }
    if (settings.stopwatchBreakDurationMinutes !== undefined) {
      setBreakMinutes(settings.stopwatchBreakDurationMinutes);
      localStorage.setItem("life_os_break_minutes", JSON.stringify(settings.stopwatchBreakDurationMinutes));
    }
    if (settings.autoStartBreak !== undefined) {
      setAutoStartBreak(settings.autoStartBreak);
      localStorage.setItem("life_os_auto_start_break", JSON.stringify(settings.autoStartBreak));
    }
    if (settings.autoStartPomo !== undefined) {
      setAutoStartPomo(settings.autoStartPomo);
      localStorage.setItem("life_os_auto_start_pomo", JSON.stringify(settings.autoStartPomo));
    }
    if (settings.autoStartStopwatchAfterBreak !== undefined) {
      setAutoStartStopwatchAfterBreak(settings.autoStartStopwatchAfterBreak);
      localStorage.setItem("life_os_auto_start_sw_after_break", JSON.stringify(settings.autoStartStopwatchAfterBreak));
    }
    if (settings.publicPresenceVisible !== undefined) {
      setPublicPresenceVisible(settings.publicPresenceVisible);
      localStorage.setItem("life_os_public_presence_visible", JSON.stringify(settings.publicPresenceVisible));
    }
  }, [myStatusNode?.timer_settings]);

  // Timer States (Internal Local Fallbacks)
  const [localIsPomodoro, setLocalIsPomodoro] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_is_pomodoro");
    return safeParse(saved, false);
  });
  const [localIsRunning, setLocalIsRunning] = useState<boolean>(() => {
    const saved = localStorage.getItem("life_os_timer_is_running");
    return safeParse(saved, false);
  });

  // Live ticking state (updates 5 times per second to drive precise, drift-free animations and elapsed calculations)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 200);
    return () => clearInterval(timer);
  }, []);

  // Sync serverTimeOffset from Firebase RTDB to align clocks between multiple devices
  const [serverOffset, setServerOffset] = useState<number>(0);
  useEffect(() => {
    if (!currentUser) {
      setServerOffset(0);
      return;
    }
    const offsetRef = ref(database, ".info/serverTimeOffset");
    const callback = (snapshot: any) => {
      const offsetVal = snapshot.val();
      if (typeof offsetVal === "number") {
        console.log("[TimerView] Synced server time offset:", offsetVal, "ms");
        setServerOffset(offsetVal);
      }
    };
    onValue(offsetRef, callback);
    return () => {
      off(offsetRef, "value", callback);
    };
  }, [currentUser]);

  // Synchronized current timestamp aligning with the Firebase server using NTP Universal Clock
  const synchronizedNow = getUniversalTimeMs();

  // Instantiate Web Worker inside TimerView to offload Phase-Locked Timer ticks
  const workerRef = useRef<Worker | null>(null);
  const [workerElapsedMs, setWorkerElapsedMs] = useState<number>(0);

  useEffect(() => {
    const worker = new Worker(
      new URL("../lib/timer.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, elapsedMs } = event.data;
      if (type === "TICK") {
        setWorkerElapsedMs(elapsedMs);
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // Compute live values for all visual rendering
  const liveIsRunning = currentUser ? (activeTimerData?.status === "FOCUSING" || activeTimerData?.status === "BREAK") : localIsRunning;
  const liveIsPomodoro = (currentUser && activeTimerData && activeTimerData.status !== "RELAXING" && activeTimerData.isStopwatchMode !== undefined)
    ? !activeTimerData.isStopwatchMode 
    : localIsPomodoro;

  // Sync state parameters to Web Worker
  useEffect(() => {
    if (!workerRef.current) return;

    if (liveIsRunning) {
      let baseMs = 0;
      let lastEventTs = 0;

      if (currentUser) {
        const activeTimer = activeTimerData || {};
        const status = activeTimer.status || "RELAXING";
        const isBreakPhase = status === "BREAK" || (status === "PAUSED" && activeTimer.pausedFromStatus === "BREAK");
        
        baseMs = isBreakPhase 
          ? (activeTimer.accumulatedBreakMs ? Number(activeTimer.accumulatedBreakMs) : 0)
          : (activeTimer.accumulatedFocusMs ? Number(activeTimer.accumulatedFocusMs) : 0);
        lastEventTs = activeTimer.startTimeMs ? Number(activeTimer.startTimeMs) : 0;
      } else {
        baseMs = accumulatedTimeMsRef.current || 0;
        lastEventTs = lastResumeTimeMsRef.current || 0;
      }

      workerRef.current.postMessage({
        type: "START",
        payload: {
          baseFocusTimeMs: baseMs,
          lastEventTsMs: lastEventTs,
          serverTimeOffsetMs: serverOffset
        }
      });
    } else {
      workerRef.current.postMessage({ type: "STOP" });
      setWorkerElapsedMs(0);
    }
  }, [liveIsRunning, activeTimerData, currentUser, serverOffset]);

  const liveElapsedSecs = useMemo(() => {
    if (liveIsRunning && workerElapsedMs > 0) {
      return Math.max(0, Math.round(workerElapsedMs / 1000));
    }

    if (currentUser) {
      const activeTimer = activeTimerData || {};
      const status = activeTimer.status || "RELAXING";
      if (status === "RELAXING") {
        return 0;
      }
      const startTimeMs = activeTimer.startTimeMs ? Number(activeTimer.startTimeMs) : 0;
      const accumulatedFocusMs = activeTimer.accumulatedFocusMs ? Number(activeTimer.accumulatedFocusMs) : 0;
      const accumulatedBreakMs = activeTimer.accumulatedBreakMs ? Number(activeTimer.accumulatedBreakMs) : 0;
      const isBreakPhase = status === "BREAK" || (status === "PAUSED" && activeTimer.pausedFromStatus === "BREAK");
      
      if (isBreakPhase) {
        let elapsedMs = accumulatedBreakMs;
        if (status === "BREAK" && startTimeMs > 0) {
          elapsedMs += Math.max(0, synchronizedNow - startTimeMs);
        }
        return Math.max(0, Math.round(elapsedMs / 1000));
      } else {
        let elapsedMs = accumulatedFocusMs;
        if (status === "FOCUSING" && startTimeMs > 0) {
          elapsedMs += Math.max(0, synchronizedNow - startTimeMs); // Use 'synchronizedNow' to guarantee recalculation on every second!
        }
        return Math.max(0, Math.round(elapsedMs / 1000));
      }
    } else {
      // Offline mode fallback using local storage resume markers
      const lastResume = safeParse(localStorage.getItem("life_os_last_resume_time"), null);
      const accumulated = safeParse(localStorage.getItem("life_os_accumulated_time"), 0);
      let elapsedMs = accumulated;
      if (localIsRunning && lastResume && Number(lastResume) > 0) {
        elapsedMs += Math.max(0, now - Number(lastResume));
      }
      return Math.max(0, Math.round(elapsedMs / 1000));
    }
  }, [currentUser, activeTimerData, liveIsRunning, workerElapsedMs, localIsRunning, now, synchronizedNow, syncTrigger]);

  const liveTimeLeft = useMemo(() => {
    if (currentUser) {
      const activeTimer = activeTimerData || {};
      const status = activeTimer.status || "RELAXING";
      const targetEndTimeMs = activeTimer.targetEndTimeMs ? Number(activeTimer.targetEndTimeMs) : 0;
      
      if (status === "BREAK" && targetEndTimeMs > 0) {
        return Math.max(0, Math.round((targetEndTimeMs - synchronizedNow) / 1000));
      }
      if (status === "FOCUSING" && targetEndTimeMs > 0 && !activeTimer.isStopwatchMode) {
        return Math.max(0, Math.round((targetEndTimeMs - synchronizedNow) / 1000));
      }
    }
    const status = activeTimerData?.status || "RELAXING";
    const isBreakPhase = status === "BREAK" || (status === "PAUSED" && activeTimerData?.pausedFromStatus === "BREAK");
    const duration = isBreakPhase 
      ? ((activeTimerData?.breakDurationMinutes || breakMinutes) * 60) 
      : ((activeTimerData?.focusDurationMinutes || pomodoroMinutes) * 60);
    return (liveIsPomodoro || isBreakPhase) ? Math.max(0, duration - liveElapsedSecs) : duration;
  }, [currentUser, activeTimerData, liveIsPomodoro, pomodoroMinutes, breakMinutes, liveElapsedSecs, now, synchronizedNow]);

  const liveStopwatchSeconds = liveIsPomodoro ? 0 : liveElapsedSecs;

  // Shadow variables for downstream use (JSX and handlers) so they use the correct live ticking values
  const isRunning = liveIsRunning;
  const isPomodoro = liveIsPomodoro;
  const timeLeft = liveTimeLeft;
  const stopwatchSeconds = liveStopwatchSeconds;

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(() => {
    const saved = localStorage.getItem("life_os_selected_task_id");
    return safeParse(saved, null);
  });
  const [activeTag, setActiveTag] = useState<string>(() => {
    const saved = localStorage.getItem("life_os_active_tag");
    return safeParse(saved, "Study");
  });
  const [sessionNotes, setSessionNotes] = useState<string>(() => {
    const saved = localStorage.getItem("life_os_session_notes");
    return safeParse(saved, "");
  });

  // Synchronize the real-time presence card automatically when the timer state changes!
  useEffect(() => {
    if (!currentUser) return;
    const status = activeTimerData?.status || "RELAXING";
    const subject = activeTimerData?.tag || activeTag || "Study";
    const todaySavedFocusMs = getTodayLoggedSecs() * 1000;

    let presenceStatus: "FOCUSING" | "PAUSED" | "BREAKING" | "OFFLINE" = "OFFLINE";
    let startTs = 0;

    if (status === "FOCUSING") {
      presenceStatus = "FOCUSING";
      startTs = activeTimerData?.startTimeMs || Date.now();
    } else if (status === "PAUSED") {
      presenceStatus = "PAUSED";
    } else if (status === "BREAK") {
      presenceStatus = "BREAKING";
    }

    publishWebPresenceCard(presenceStatus, subject, todaySavedFocusMs, startTs).catch(err => {
      console.warn("Failed to automatically publish presence:", err);
    });
  }, [activeTimerData, currentUser, activeTag]);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [sqliteUpdateCounter, setSqliteUpdateCounter] = useState(0);
  const [dexieStatus, setDexieStatus] = useState<{
    activeSessionsCount: number;
    pendingMutationsCount: number;
    historyRecordsCount: number;
    activeSessionStatus: string;
  }>({
    activeSessionsCount: 0,
    pendingMutationsCount: 0,
    historyRecordsCount: 0,
    activeSessionStatus: "NONE"
  });

  useEffect(() => {
    const onSqliteChanged = () => {
      setSqliteUpdateCounter(prev => prev + 1);
    };
    window.addEventListener("life_os_sqlite_changed", onSqliteChanged);

    // Run self-healing janitor and IndexedDB quota pruner on load
    const runJanitors = async () => {
      try {
        const { runWebJanitorOnBoot, executeIndexedDbQuotaPruner } = await import("../lib/webJanitor");
        await runWebJanitorOnBoot();
        await executeIndexedDbQuotaPruner();
      } catch (err) {
        console.error("Failed to run web janitors:", err);
      }
    };
    runJanitors();

    return () => window.removeEventListener("life_os_sqlite_changed", onSqliteChanged);
  }, []);

  useEffect(() => {
    const updateDexieStatus = async () => {
      try {
        const { db } = await import("../lib/dexie_db");
        const active = await db.localActiveSession.toArray();
        const pending = await db.outboxQueue.where("status").equals("PENDING").toArray();
        const history = await db.localHistoryVault.toArray();
        setDexieStatus({
          activeSessionsCount: active.length,
          pendingMutationsCount: pending.length,
          historyRecordsCount: history.length,
          activeSessionStatus: active.length > 0 ? active[0].status : "IDLE"
        });
      } catch (err) {
        console.error("Failed to query Dexie:", err);
      }
    };
    updateDexieStatus();
  }, [sqliteUpdateCounter]);
  const [currentQuote, setCurrentQuote] = useState("");

  // Manual Time Entry States
  const [manualMinutes, setManualMinutes] = useState<string>("");
  const [manualReason, setManualReason] = useState<string>("");
  const [isSubmittingManual, setIsSubmittingManual] = useState<boolean>(false);
  const [manualSubmitStatus, setManualSubmitStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Constants & Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<string>(
    safeParse(localStorage.getItem("life_os_start_time"), "")
  );
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Visual/Animated bell ring cooldown state
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});

  const [selectedFilter, setSelectedFilter] = useState<"Today" | "7 Days" | "30 Days" | "All Time">("Today");
  const [showLimitAlert, setShowLimitAlert] = useState(false);
  const [limitAlertMessage, setLimitAlertMessage] = useState("");

  const getOverlapSecondsForDate = (r: any, targetDateStr: string) => {
    try {
      const dateStr = r.dateString || targetDateStr;
      let timeParts = (r.endTime || "").split(" ");
      let time = timeParts[0];
      let ampm = timeParts[1];
      if (!time) return r.durationSeconds || (r.durationMinutes * 60) || 0;
      let [hours, minutes] = time.split(":").map(Number);
      if (ampm && ampm.toLowerCase() === "pm" && hours < 12) {
        hours += 12;
      }
      if (ampm && ampm.toLowerCase() === "am" && hours === 12) {
        hours = 0;
      }
      
      const endLocalDate = new Date(dateStr + "T00:00:00");
      endLocalDate.setHours(hours, minutes, 0, 0);
      const endMs = endLocalDate.getTime();
      
      const durationSeconds = r.durationSeconds || (r.durationMinutes * 60) || 0;
      const startMs = endMs - (durationSeconds * 1000);
      
      const targetDate = new Date(targetDateStr + "T00:00:00");
      const targetStartMs = targetDate.getTime();
      
      const targetEndMs = targetStartMs + 24 * 60 * 60 * 1000 - 1;
      
      const overlapStart = Math.max(startMs, targetStartMs);
      const overlapEnd = Math.min(endMs, targetEndMs);
      
      if (overlapEnd > overlapStart) {
        return Math.round((overlapEnd - overlapStart) / 1000);
      }
      return 0;
    } catch (e) {
      if (r.dateString === targetDateStr || !r.dateString) {
        return r.durationSeconds || (r.durationMinutes * 60) || 0;
      }
      return 0;
    }
  };

  const getFilteredFocusSecondsForUser = (userNode: any, filter: "Today" | "7 Days" | "30 Days" | "All Time") => {
    if (!userNode) return 0;
    if (filter === "Today") {
      return getTodayFocusSecondsForUser(userNode);
    }

    const activeTimer = userNode.active_session || userNode.active_timer || {};
    const status = activeTimer.status || "RELAXING";
    const startTimeMs = activeTimer.startTimeMs || 0;
    const accumulatedFocusMs = activeTimer.accumulatedFocusMs || 0;

    let liveDelta = 0;
    if (status === "FOCUSING" && startTimeMs > 0) {
      liveDelta = (synchronizedNow - startTimeMs) + accumulatedFocusMs;
    } else if (status === "BREAK") {
      liveDelta = accumulatedFocusMs;
    } else if (status === "PAUSED") {
      liveDelta = accumulatedFocusMs;
    }

    const historyLogs = userNode.history_logs;
    let recordsList: any[] = [];
    if (historyLogs) {
      if (Array.isArray(historyLogs)) {
        recordsList = historyLogs.filter(Boolean);
      } else if (typeof historyLogs === "object") {
        recordsList = Object.keys(historyLogs).map(k => {
          if (typeof historyLogs[k] === "object" && historyLogs[k] !== null) {
            return { id: k, ...historyLogs[k] };
          }
          return null;
        }).filter(Boolean);
      }
    }

    const targetDates: string[] = [];
    const today = new Date();
    const daysCount = filter === "7 Days" ? 7 : (filter === "30 Days" ? 30 : 365);
    
    if (filter !== "All Time") {
      for (let i = 0; i < daysCount; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        targetDates.push(d.toISOString().split("T")[0]);
      }
    }

    const completedSeconds = recordsList.reduce((sum, r) => {
      if (filter === "All Time") {
        const computedSecs = r.durationSeconds || (r.durationMinutes * 60) || 0;
        return sum + computedSecs;
      } else {
        let overlapSum = 0;
        for (const dateStr of targetDates) {
          overlapSum += getOverlapSecondsForDate(r, dateStr);
        }
        return sum + overlapSum;
      }
    }, 0);

    return Math.round((completedSeconds * 1000 + liveDelta) / 1000);
  };

  // Calculate today's completed focus records seconds using LeetCode 56 Interval Deduplication to prevent double-counting
  const todayCompletedSeconds = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const todayLocalStr = new Date().toLocaleDateString('en-CA');
    const startOfTodayLocal = new Date();
    startOfTodayLocal.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfTodayLocal.getTime();

    const todayRecords = focusRecords.filter(r => {
      if (!r) return false;
      if (r.dateString === todayStr || r.dateString === todayLocalStr) return true;
      if (r.timestamp && r.timestamp >= startOfTodayMs) return true;
      return false;
    });

    const intervals: StudyInterval[] = todayRecords.map(r => {
      const durationMs = (r.durationSeconds || (r.durationMinutes * 60) || 0) * 1000;
      const startTimeMs = r.timestamp || (Date.now() - durationMs);
      const endTimeMs = startTimeMs + durationMs;
      return {
        startTimeMs,
        endTimeMs,
        subject: r.tag || "",
        taskTitle: r.taskTitle || ""
      };
    });

    const { trueTotalFocusMs } = mergeOverlappingStudyIntervals(intervals);
    const localTotalSeconds = Math.round(trueTotalFocusMs / 1000);

    // Phase 1: The Optimistic High-Water Mark (Instant UI Snap)
    // Display Total = max(Local Daily Total, Remote Daily Total)
    const remoteDate = typeof localStorage !== "undefined" ? localStorage.getItem("life_os_remote_daily_total_date") : null;
    const remoteTotalSeconds = remoteDate === todayStr && typeof localStorage !== "undefined"
      ? Number(localStorage.getItem("life_os_remote_daily_total") || "0")
      : 0;

    return Math.max(localTotalSeconds, remoteTotalSeconds);
  }, [focusRecords]);

  const formatSecondsForLeaderboard = (totalSecs: number, filter: string) => {
    if (filter === "Today") {
      return formatSecondsToDetailed(totalSecs);
    }
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Persist states to localStorage with change-guards to avoid event storms
  useEffect(() => {
    const val = JSON.stringify(isPomodoro);
    if (localStorage.getItem("life_os_is_pomodoro") !== val) {
      localStorage.setItem("life_os_is_pomodoro", val);
      window.dispatchEvent(new Event("life_os_timer_changed"));
    }
  }, [isPomodoro]);

  useEffect(() => {
    const val = JSON.stringify(isRunning);
    if (localStorage.getItem("life_os_timer_is_running") !== val) {
      localStorage.setItem("life_os_timer_is_running", val);
      window.dispatchEvent(new Event("life_os_timer_changed"));
    }
  }, [isRunning]);

  useEffect(() => {
    const val = JSON.stringify(timeLeft);
    if (localStorage.getItem("life_os_timer_left") !== val) {
      localStorage.setItem("life_os_timer_left", val);
      window.dispatchEvent(new Event("life_os_timer_changed"));
    }
  }, [timeLeft]);

  useEffect(() => {
    const val = JSON.stringify(stopwatchSeconds);
    if (localStorage.getItem("life_os_stopwatch_seconds") !== val) {
      localStorage.setItem("life_os_stopwatch_seconds", val);
      window.dispatchEvent(new Event("life_os_timer_changed"));
    }
  }, [stopwatchSeconds]);

  useEffect(() => {
    localStorage.setItem("life_os_pomodoro_minutes", JSON.stringify(pomodoroMinutes));
  }, [pomodoroMinutes]);

  useEffect(() => {
    localStorage.setItem("life_os_selected_task_id", JSON.stringify(selectedTaskId));
  }, [selectedTaskId]);

  useEffect(() => {
    localStorage.setItem("life_os_active_tag", JSON.stringify(activeTag));
  }, [activeTag]);

  useEffect(() => {
    localStorage.setItem("life_os_session_notes", JSON.stringify(sessionNotes));
  }, [sessionNotes]);

  // Sync from other components via life_os_timer_changed event
  useEffect(() => {
    const handleTimerChangedExternal = () => {
      const storedRunning = localStorage.getItem("life_os_timer_is_running") === "true";
      const storedIsPomodoro = localStorage.getItem("life_os_is_pomodoro") === "true";

      if (!storedRunning) {
        lastResumeTimeMsRef.current = null;
        accumulatedTimeMsRef.current = 0;
      } else {
        const savedLastResume = localStorage.getItem("life_os_last_resume_time");
        const savedAccumulated = localStorage.getItem("life_os_accumulated_time");
        if (savedLastResume) {
          lastResumeTimeMsRef.current = safeParse(savedLastResume, null);
        }
        if (savedAccumulated) {
          accumulatedTimeMsRef.current = safeParse(savedAccumulated, 0);
        }
      }

      setLocalIsRunning(prev => prev !== storedRunning ? storedRunning : prev);
      setLocalIsPomodoro(prev => prev !== storedIsPomodoro ? storedIsPomodoro : prev);

      const storedTaskIdVal = localStorage.getItem("life_os_selected_task_id");
      const storedTaskId = safeParse(storedTaskIdVal, null);
      setSelectedTaskId(prev => prev !== storedTaskId ? storedTaskId : prev);

      const storedTagVal = localStorage.getItem("life_os_active_tag");
      const storedTag = safeParse(storedTagVal, "Study");
      setActiveTag(prev => prev !== storedTag ? storedTag : prev);

      const storedNotesVal = localStorage.getItem("life_os_session_notes");
      const storedNotes = safeParse(storedNotesVal, "");
      setSessionNotes(prev => prev !== storedNotes ? storedNotes : prev);

      // Force a visual update
      setSyncTrigger(prev => prev + 1);
    };

    window.addEventListener("life_os_timer_changed", handleTimerChangedExternal);
    return () => {
      window.removeEventListener("life_os_timer_changed", handleTimerChangedExternal);
    };
  }, [tasks]);

  // Keep mutable references of elapsed times to avoid stale closures in keep-alive syncs
  const timeLeftRef = useRef(timeLeft);
  const stopwatchSecondsRef = useRef(stopwatchSeconds);
  const lastResumeTimeMsRef = useRef<number | null>(
    safeParse(localStorage.getItem("life_os_last_resume_time"), null)
  );
  const accumulatedTimeMsRef = useRef<number>(
    safeParse(localStorage.getItem("life_os_accumulated_time"), 0)
  );
  const clientIdRef = useRef<string>("");
  if (!clientIdRef.current) {
    let id = localStorage.getItem("life_os_web_device_id");
    if (!id) {
      id = "web_" + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("life_os_web_device_id", id);
    }
    clientIdRef.current = id;
  }
  const isLocalSessionOwnerRef = useRef<boolean>(true);

  // Sync refs to localStorage
  useEffect(() => {
    localStorage.setItem("life_os_start_time", JSON.stringify(startTimeRef.current));
  }, [isRunning]);

  useEffect(() => {
    localStorage.setItem("life_os_last_resume_time", JSON.stringify(lastResumeTimeMsRef.current));
    localStorage.setItem("life_os_accumulated_time", JSON.stringify(accumulatedTimeMsRef.current));
  }, [isRunning, stopwatchSeconds, timeLeft]);

  // State Contract Synchronization Tracking Refs
  const lastButtonClickedRef = useRef<string | null>(null);
  const lastButtonClickedTimestampRef = useRef<number>(0);
  const lastUpdatedTimestampRef = useRef<number>(0);

  const recordLocalButtonClick = (actionName: string) => {
    const now = Date.now();
    lastButtonClickedRef.current = actionName;
    lastButtonClickedTimestampRef.current = now;
    lastUpdatedTimestampRef.current = now;
  };

  const lastProcessedStatusRef = useRef<{
    isFocusing: boolean;
    isStopwatchMode: boolean;
    lastResumeTimeMs: number;
    accumulatedTimeMs: number;
  } | null>(null);

  const isApplyingRemoteUpdateRef = useRef<boolean>(false);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    stopwatchSecondsRef.current = stopwatchSeconds;
  }, [stopwatchSeconds]);



  // Stable mock start times so mock users' live focus times tick cleanly
  const mockStartTimes = useRef({
    madhavan: Date.now() - 42 * 60 * 1000,
    shalini: Date.now() - 18 * 60 * 1000
  });

  // Calculate local start of today (midnight) for timezone-robust calculations
  const startOfTodayLocal = new Date();
  startOfTodayLocal.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfTodayLocal.getTime();
  const todayStr = new Date().toISOString().split("T")[0];
  const todayLocalStr = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD"

  const isRecordToday = (rec: any) => {
    if (!rec) return false;
    if (rec.timestamp && rec.timestamp >= startOfTodayMs) return true;
    if (rec.dateString === todayStr || rec.dateString === todayLocalStr) return true;
    return false;
  };

  const getTodayLoggedSecs = () => {
    return focusRecords
      .filter(isRecordToday)
      .reduce((sum, r) => sum + (r.durationSeconds || (r.durationMinutes * 60) || 0), 0);
  };

  const getTodayFocusSecondsForUser = (userNode: any) => {
    if (!userNode) return 0;
    const activeTimer = userNode.active_session || userNode.active_timer || {};
    const todayStats = userNode.today_stats || {};

    const status = activeTimer.status || "RELAXING";
    const startTimeMs = activeTimer.startTimeMs || 0;
    const accumulatedFocusMs = activeTimer.accumulatedFocusMs || 0;
    const todayFocusTimeMs = todayStats.todayFocusTimeMs || 0;

    let liveDelta = 0;
    if (status === "FOCUSING" && startTimeMs > 0) {
      liveDelta = (synchronizedNow - startTimeMs) + accumulatedFocusMs;
    } else if (status === "BREAK") {
      liveDelta = accumulatedFocusMs;
    } else if (status === "PAUSED") {
      liveDelta = accumulatedFocusMs;
    } else if (status === "RELAXING") {
      if (optimisticHandoffLock && Date.now() < optimisticHandoffLock.expiresAt) {
        liveDelta = optimisticHandoffLock.delta;
      }
    }

    return Math.round((todayFocusTimeMs + liveDelta) / 1000);
  };

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatSecondsToDetailed = (totalSecs: number) => {
    if (totalSecs <= 0) return "0s";
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Sync passive database and clear optimistic state once synced
  useEffect(() => {
    if (!myStatusNode || !optimisticState) return;
    const activeTimer = myStatusNode.active_session || myStatusNode.active_timer || {};
    if (activeTimer.status === optimisticState.status) {
      setOptimisticState(null);
    }
  }, [myStatusNode, optimisticState]);

  // Safety timeout to clear optimistic state if it never syncs
  useEffect(() => {
    if (!optimisticState) return;
    const timeout = setTimeout(() => {
      setOptimisticState(null);
    }, 5000); // 5 seconds safety gate
    return () => clearTimeout(timeout);
  }, [optimisticState]);

  // Sync state variables from active_timer passively
  useEffect(() => {
    const activeTimer = activeTimerData;
    if (!optimisticState && !myStatusNode) return;
    const status = activeTimer.status || "RELAXING";
    const isStopwatchMode = !!activeTimer.isStopwatchMode;

    const incomingIsFocusing = status === "FOCUSING";
    
    // Only set if different to prevent re-render loops!
    setLocalIsRunning(prev => prev !== incomingIsFocusing ? incomingIsFocusing : prev);
    if (status !== "RELAXING") {
      setLocalIsPomodoro(prev => {
        const next = !isStopwatchMode;
        return prev !== next ? next : prev;
      });
    }

    if (activeTimer.tag) {
      setActiveTag(prev => prev !== activeTimer.tag ? activeTimer.tag : prev);
    }
    if (activeTimer.taskTitle) {
      const foundTask = tasks.find(t => t.title.toLowerCase() === activeTimer.taskTitle.toLowerCase());
      if (foundTask) {
        setSelectedTaskId(prev => prev !== foundTask.id ? foundTask.id : prev);
      }
    }
  }, [activeTimerData, optimisticState, myStatusNode, tasks]);

  // Mode toggle between Pomodoro and Stopwatch
  const handleToggleMode = async (toPomodoro: boolean) => {
    if (isRunning) return; // Prevent changing mode while running
    if (currentUser && activeTimerData?.status && activeTimerData.status !== "RELAXING") {
      return; // Prevent changing mode if there's an active session
    }
    
    setLocalIsPomodoro(toPomodoro);
    localStorage.setItem("life_os_is_pomodoro", JSON.stringify(toPomodoro));
    
    if (currentUser) {
      const username = getUsernameFromEmail(currentUser.email);
      try {
        await toggleWebSessionMode(username, toPomodoro);
      } catch (err) {
        console.error("Error toggling timer mode:", err);
      }
    }
  };

  const handleUpdatePomodoroMinutes = async (mins: number) => {
    if (isRunning) return;
    let val = mins;
    if (val < 1) val = 1;
    if (val > 1440) val = 1440; // Max 24 hours
    setPomodoroMinutes(val);
    localStorage.setItem("life_os_pomodoro_minutes", JSON.stringify(val));
    if (currentUser) {
      const username = getUsernameFromEmail(currentUser.email);
      await saveTimerSettings(username, {
        timerDurationMinutes: val
      });
    }
  };

  const handleUpdateBreakMinutes = async (mins: number) => {
    if (isRunning) return;
    let val = mins;
    if (val < 1) val = 1;
    if (val > 1440) val = 1440;
    setBreakMinutes(val);
    localStorage.setItem("life_os_break_minutes", JSON.stringify(val));
    if (currentUser) {
      const username = getUsernameFromEmail(currentUser.email);
      await saveTimerSettings(username, {
        stopwatchBreakDurationMinutes: val
      });
    }
  };

  // Start / Pause timer
  const handleStartPause = async () => {
    // Check daily focus limit and session limit
    if (!isRunning) {
      if (todayCompletedSeconds >= 72000) {
        setLimitAlertMessage("⚠️ Daily focus limit of 20 hours reached! Timer cannot be started.");
        setShowLimitAlert(true);
        return;
      }
      const accumulatedMs = currentUser
        ? (myStatusNode?.active_session?.accumulatedFocusMs || myStatusNode?.active_timer?.accumulatedFocusMs || myStatusNode?.active_session?.baseFocusTimeMs || myStatusNode?.active_timer?.baseFocusTimeMs || 0)
        : safeParse(localStorage.getItem("life_os_accumulated_time"), 0);
      const accumulatedSecs = Math.round(accumulatedMs / 1000);
      if (accumulatedSecs >= 21600) {
        setLimitAlertMessage("⚠️ Session focus limit of 6 hours reached! Resuming this session would exceed the limit. Please start a new session.");
        setShowLimitAlert(true);
        return;
      }
    }

    if (!currentUser) {
      // Offline start/pause fallback using local storage resume markers
      const running = localStorage.getItem("life_os_timer_is_running") === "true";
      const nextRunning = !running;

      const savedSecs = localStorage.getItem("life_os_stopwatch_seconds");
      let currentStopwatchSecs = safeParse(savedSecs, 0);

      let lastResume = null;
      let accumulated = 0;

      if (nextRunning) {
        lastResume = Date.now();
        const savedAccumulated = localStorage.getItem("life_os_accumulated_time");
        accumulated = safeParse(savedAccumulated, currentStopwatchSecs * 1000);
        localStorage.setItem("life_os_last_resume_time", JSON.stringify(lastResume));
        localStorage.setItem("life_os_accumulated_time", JSON.stringify(accumulated));
      } else {
        const savedLastResume = localStorage.getItem("life_os_last_resume_time");
        const savedAccumulated = localStorage.getItem("life_os_accumulated_time");
        if (savedLastResume) {
          const lastResumeVal = safeParse(savedLastResume, 0);
          const savedAccumVal = safeParse(savedAccumulated, 0);
          if (lastResumeVal > 0) {
            const elapsedMs = Date.now() - lastResumeVal;
            accumulated = savedAccumVal + elapsedMs;
            currentStopwatchSecs = Math.round(accumulated / 1000);
          }
        }
        localStorage.setItem("life_os_last_resume_time", "null");
        localStorage.setItem("life_os_accumulated_time", JSON.stringify(accumulated));
        localStorage.setItem("life_os_stopwatch_seconds", JSON.stringify(currentStopwatchSecs));
      }

      localStorage.setItem("life_os_timer_is_running", JSON.stringify(nextRunning));
      setLocalIsRunning(nextRunning);
      window.dispatchEvent(new Event("life_os_timer_changed"));
      return;
    }
    const username = getUsernameFromEmail(currentUser.email);
    const activeTask = tasks.find(t => t.id === selectedTaskId);
    const taskTitle = activeTask ? activeTask.title : "General Focus Session";

    const prevActiveTimer = myStatusNode?.active_session || myStatusNode?.active_timer || {};
    const currentTimerStatus = prevActiveTimer.status || "RELAXING";

    if (isRunning && currentTimerStatus !== "BREAK") {
      const nowMs = synchronizedNow;
      const prevAccumulated = prevActiveTimer.accumulatedFocusMs || 0;
      const prevAccumulatedBreak = prevActiveTimer.accumulatedBreakMs || 0;
      let additional = 0;
      let additionalBreak = 0;
      if (prevActiveTimer.status === "FOCUSING" && prevActiveTimer.startTimeMs) {
        additional = nowMs - prevActiveTimer.startTimeMs;
      }
      if (prevActiveTimer.status === "BREAK" && prevActiveTimer.startTimeMs) {
        additionalBreak = nowMs - prevActiveTimer.startTimeMs;
      }
      setOptimisticState({
        status: "PAUSED",
        pausedFromStatus: prevActiveTimer.status || "FOCUSING",
        startTimeMs: 0,
        accumulatedFocusMs: prevAccumulated + additional,
        accumulatedBreakMs: prevAccumulatedBreak + additionalBreak,
        isStopwatchMode: prevActiveTimer.isStopwatchMode !== undefined ? prevActiveTimer.isStopwatchMode : !isPomodoro,
        tag: activeTag,
        taskTitle: taskTitle
      });

      // SQLite Action Matrix - Button 2: Pause Focus (Local Write)
      const sqlRes = sqliteHelper.pauseFocus();
      window.dispatchEvent(new Event("life_os_sqlite_changed"));
      if (sqlRes.outbox) {
        // Enqueued to Outbox, simulate 1000ms sync backoff latency
        setTimeout(() => {
          sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
          window.dispatchEvent(new Event("life_os_sqlite_changed"));
        }, 1000);
      }
    } else {
      const nowMs = synchronizedNow;
      const prevActiveTimer = myStatusNode?.active_session || myStatusNode?.active_timer || {};
      const prevAccumulated = prevActiveTimer.accumulatedFocusMs || 0;
      const isResumingBreak = prevActiveTimer.status === "PAUSED" && prevActiveTimer.pausedFromStatus === "BREAK";

      setOptimisticState({
        status: isResumingBreak ? "BREAK" : "FOCUSING",
        startTimeMs: nowMs,
        accumulatedFocusMs: prevAccumulated,
        accumulatedBreakMs: prevActiveTimer.accumulatedBreakMs || 0,
        isStopwatchMode: prevActiveTimer.isStopwatchMode !== undefined ? prevActiveTimer.isStopwatchMode : !isPomodoro,
        tag: activeTag,
        taskTitle: taskTitle
      });

      // SQLite Action Matrix - Button 1 (Start Focus) & Button 3 (Resume Focus)
      const isResumingSession = prevActiveTimer.status === "PAUSED";
      const sqlRes = isResumingSession 
        ? sqliteHelper.resumeFocus() 
        : sqliteHelper.startFocus(activeTag || "Study", taskTitle);
      window.dispatchEvent(new Event("life_os_sqlite_changed"));

      if (sqlRes.outbox) {
        // Enqueued to Outbox, simulate 1000ms sync backoff latency
        setTimeout(() => {
          sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
          window.dispatchEvent(new Event("life_os_sqlite_changed"));
        }, 1000);
      }
    }
  };

  // Complete session automatically
  const handleTimerComplete = async () => {
    if (!currentUser) {
      // Offline complete fallback
      const activeTask = tasks.find(t => t.id === selectedTaskId);
      const defaultTaskTitle = activeTask ? activeTask.title : "General Focus";
      const finalTag = activeTag || "Study";
      const startTime = new Date(Date.now() - pomodoroMinutes * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (onTriggerSaveModal) {
        onTriggerSaveModal({
          elapsedSecs: pomodoroMinutes * 60,
          defaultTaskTitle,
          defaultTag: finalTag,
          defaultNotes: "Pomodoro session completed",
          startTime,
          isPomodoro: true
        });
      } else {
        const id = Date.now().toString();
        onAddFocusRecord({
          id,
          taskTitle: defaultTaskTitle,
          tag: finalTag,
          notes: "Pomodoro session completed",
          durationSeconds: pomodoroMinutes * 60,
          durationMinutes: pomodoroMinutes,
          dateString: new Date().toISOString().split("T")[0],
          startTime,
          endTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          mode: "POMODORO"
        });
      }
      return;
    }
    const username = getUsernameFromEmail(currentUser.email);
    const status = activeTimerData?.status || "RELAXING";

    setSessionNotes("");

    if (status === "BREAK") {
      // Break session completed
      if (autoStartPomo || autoStartStopwatchAfterBreak) {
        const activeTask = tasks.find(t => t.id === selectedTaskId);
        const taskTitle = activeTask ? activeTask.title : "General Focus";
        const sqlRes = sqliteHelper.startFocus(activeTag || "Study", taskTitle);
        window.dispatchEvent(new Event("life_os_sqlite_changed"));
        if (sqlRes.outbox) {
          setTimeout(() => {
            sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
            window.dispatchEvent(new Event("life_os_sqlite_changed"));
          }, 1000);
        }
      } else {
        if (workerRef.current) {
          workerRef.current.postMessage({ command: "STOP" });
        }
        const sqlRes = sqliteHelper.endSession();
        window.dispatchEvent(new Event("life_os_sqlite_changed"));
        if (sqlRes.outbox) {
          setTimeout(() => {
            sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
            window.dispatchEvent(new Event("life_os_sqlite_changed"));
          }, 1000);
        }
      }
    } else {
      // Focus session completed
      const prevActiveTimer = myStatusNode?.active_session || myStatusNode?.active_timer || {};
      let focusMs = prevActiveTimer.accumulatedFocusMs || 0;
      if (prevActiveTimer.status === "FOCUSING" && prevActiveTimer.startTimeMs) {
        focusMs += (synchronizedNow - prevActiveTimer.startTimeMs);
      }
      setOptimisticHandoffLock({ delta: focusMs, expiresAt: Date.now() + 3000 });

      // End session and compile record via SQLite
      if (workerRef.current) {
        workerRef.current.postMessage({ command: "STOP" });
      }
      const sqlRes = sqliteHelper.endSession();
      window.dispatchEvent(new Event("life_os_sqlite_changed"));
      if (sqlRes.outbox) {
        setTimeout(() => {
          sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
          window.dispatchEvent(new Event("life_os_sqlite_changed"));
        }, 1000);
      }

      if (autoStartBreak) {
        await startWebBreak(username, breakMinutes, !isPomodoro).catch((err: any) => console.error("Start auto break failed:", err));
      }
    }
    
    // Play sound notification using AudioContext
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {}
  };

  // Skip or stop stopwatch manually and log
  const handleSkipStop = async () => {
    if (!currentUser) {
      // Offline stop fallback
      const running = localStorage.getItem("life_os_timer_is_running") === "true";
      const isPom = localStorage.getItem("life_os_is_pomodoro") === "true";
      let currentSeconds = 0;

      if (isPom) {
        const storedTimeLeftVal = localStorage.getItem("life_os_timer_left");
        const timeLeftVal = safeParse(storedTimeLeftVal, 25 * 60);
        currentSeconds = pomodoroMinutes * 60 - timeLeftVal;
      } else {
        const savedSecs = localStorage.getItem("life_os_stopwatch_seconds");
        currentSeconds = safeParse(savedSecs, 0);

        if (running) {
          const savedLastResume = localStorage.getItem("life_os_last_resume_time");
          const savedAccumulated = localStorage.getItem("life_os_accumulated_time");
          if (savedLastResume) {
            const lastResumeVal = safeParse(savedLastResume, 0);
            const savedAccumVal = safeParse(savedAccumulated, 0);
            if (lastResumeVal > 0) {
              const elapsedMs = Date.now() - lastResumeVal;
              currentSeconds = Math.round((savedAccumVal + elapsedMs) / 1000);
            }
          }
        }
      }

      if (currentSeconds <= 0 && !running) {
        // Just reset
        localStorage.setItem("life_os_timer_is_running", "false");
        localStorage.setItem("life_os_stopwatch_seconds", "0");
        localStorage.setItem("life_os_last_resume_time", "null");
        localStorage.setItem("life_os_accumulated_time", "0");
        setLocalIsRunning(false);
        window.dispatchEvent(new Event("life_os_timer_changed"));
        return;
      }

      const activeTask = tasks.find(t => t.id === selectedTaskId);
      const defaultTaskTitle = activeTask ? activeTask.title : "General Focus";
      const finalTag = activeTag || "Study";
      const startTime = new Date(Date.now() - currentSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (onTriggerSaveModal) {
        onTriggerSaveModal({
          elapsedSecs: currentSeconds,
          defaultTaskTitle,
          defaultTag: finalTag,
          defaultNotes: isPom ? "Pomodoro session log" : "Stopwatch log",
          startTime,
          isPomodoro: isPom
        });
      } else {
        const id = Date.now().toString();
        onAddFocusRecord({
          id,
          taskTitle: defaultTaskTitle,
          tag: finalTag,
          notes: isPom ? "Pomodoro session log" : "Stopwatch log",
          durationSeconds: currentSeconds,
          durationMinutes: Math.round(currentSeconds / 60),
          dateString: new Date().toISOString().split("T")[0],
          startTime,
          endTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          mode: isPom ? "POMODORO" : "STOPWATCH"
        });
      }
      return;
    }
    const username = getUsernameFromEmail(currentUser.email);
    const activeTask = tasks.find(t => t.id === selectedTaskId);
    const taskTitle = activeTask ? activeTask.title : "General Focus Session";

    const nowMs = synchronizedNow;
    const prevActiveTimer = myStatusNode?.active_session || myStatusNode?.active_timer || {};
    let focusMs = prevActiveTimer.accumulatedFocusMs || 0;
    if (prevActiveTimer.status === "FOCUSING" && prevActiveTimer.startTimeMs) {
      focusMs += (nowMs - prevActiveTimer.startTimeMs);
    }
    let breakMs = prevActiveTimer.accumulatedBreakMs || 0;
    if (prevActiveTimer.status === "BREAK" && prevActiveTimer.startTimeMs) {
      breakMs += (nowMs - prevActiveTimer.startTimeMs);
    }

    // SQLite Action Matrix - Button 5: End & Save Session (with 10-Second Guard and LeetCode 56 Merger)
    if (workerRef.current) {
      workerRef.current.postMessage({ command: "STOP" });
    }
    const sqlRes = sqliteHelper.endSession();
    window.dispatchEvent(new Event("life_os_sqlite_changed"));
    if (sqlRes.outbox) {
      // Simulate network sync latency
      setTimeout(() => {
        sqliteHelper.processOutboxRow(sqlRes.outbox!.id);
        window.dispatchEvent(new Event("life_os_sqlite_changed"));
      }, 1000);
    }

    setOptimisticState({
      status: "RELAXING",
      startTimeMs: 0,
      accumulatedFocusMs: focusMs,
      accumulatedBreakMs: breakMs,
      isStopwatchMode: prevActiveTimer.isStopwatchMode !== undefined ? prevActiveTimer.isStopwatchMode : !isPomodoro,
      tag: activeTag,
      taskTitle: taskTitle
    });

    setOptimisticHandoffLock({ delta: focusMs, expiresAt: Date.now() + 3000 });
    setSessionNotes("");
  };

  const handleStartBreakManual = async () => {
    if (!currentUser) {
      // Offline fallback
      setLocalIsRunning(false);
      localStorage.setItem("life_os_timer_is_running", "false");
      window.dispatchEvent(new Event("life_os_timer_changed"));
      return;
    }
    const username = getUsernameFromEmail(currentUser.email);
    await startWebBreak(username, breakMinutes, !isPomodoro).catch((err: any) => {
      console.error("Start break failed:", err);
    });
  };

  // Real-time daily and session focus limit checks (20 hours & 6 hours)
  useEffect(() => {
    if (isRunning) {
      const currentSessionSecs = isPomodoro ? (pomodoroMinutes * 60 - timeLeft) : stopwatchSeconds;
      const totalTodaySecs = todayCompletedSeconds + currentSessionSecs;
      
      if (currentSessionSecs >= 21600) { // 6 hours session limit
        if (isPomodoro) {
          handleTimerComplete();
        } else {
          handleSkipStop();
        }
        setLimitAlertMessage("⚠️ Session focus limit of 6 hours reached! The session has been completed and logged.");
        setShowLimitAlert(true);
      } else if (totalTodaySecs >= 72000) { // 20 hours daily limit
        handleStartPause(); // Auto-pause
        setLimitAlertMessage("⚠️ Daily focus limit of 20 hours reached! Timer has been paused.");
        setShowLimitAlert(true);
      }
    }
  }, [now, isRunning, todayCompletedSeconds, isPomodoro, pomodoroMinutes, timeLeft, stopwatchSeconds, handleTimerComplete, handleSkipStop, handleStartPause]);

  // Monitor countdown completion (both Pomodoro focus and all break phases)
  useEffect(() => {
    const isBreakPhase = activeTimerData?.status === "BREAK";
    if (isRunning && timeLeft === 0) {
      if (isPomodoro || isBreakPhase) {
        handleTimerComplete();
      }
    }
  }, [isPomodoro, activeTimerData?.status, isRunning, timeLeft, handleTimerComplete]);

  // Set random quote when entering immersive mode, and rotate it every 30 seconds
  useEffect(() => {
    if (!isImmersive) {
      setCurrentQuote("");
      return;
    }

    const selectRandomQuote = () => {
      const randomQuote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
      setCurrentQuote(randomQuote);
    };

    selectRandomQuote();
    const interval = setInterval(selectRandomQuote, 30000);

    return () => clearInterval(interval);
  }, [isImmersive]);

  // Monitor user activity in immersive mode to hide controls after 5 seconds of silence
  useEffect(() => {
    if (!isImmersive) {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      return;
    }

    const resetTimer = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 5000);
    };

    resetTimer();

    const handleActivity = () => {
      resetTimer();
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    window.addEventListener("click", handleActivity);

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("click", handleActivity);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isImmersive]);

  const activeTask = tasks.find(t => t.id === selectedTaskId);

  // Current active session's seconds (live)
  const currentSessionSeconds = useMemo(() => {
    const activeStatus = activeTimerData?.status || "RELAXING";
    const isBreak = activeStatus === "BREAK" || (activeStatus === "PAUSED" && activeTimerData?.pausedFromStatus === "BREAK");
    
    if (isBreak) {
      return Math.max(0, Math.round((activeTimerData?.accumulatedFocusMs || 0) / 1000));
    }
    
    if (activeStatus === "PAUSED") {
      return Math.max(0, Math.round((activeTimerData?.accumulatedFocusMs || 0) / 1000));
    }
    
    return isPomodoro 
      ? (pomodoroMinutes * 60 - timeLeft)
      : stopwatchSeconds;
  }, [activeTimerData, isPomodoro, pomodoroMinutes, timeLeft, stopwatchSeconds]);

  const totalFocusSeconds = Math.min(20 * 3600, todayCompletedSeconds + currentSessionSeconds);

  // Calculate my total focus seconds exactly the same way as friends
  let myTotalFocusSeconds = 0;
  if (myStatusNode) {
    const overriddenNode = {
      ...myStatusNode,
      active_session: activeTimerData,
      active_timer: activeTimerData
    };
    myTotalFocusSeconds = getFilteredFocusSecondsForUser(overriddenNode, selectedFilter);
  } else {
    // Offline user focus records fallback
    let cutoffTime = 0;
    if (selectedFilter === "7 Days") {
      cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    } else if (selectedFilter === "30 Days") {
      cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    }
    const completedSecs = focusRecords.reduce((sum, r) => {
      if (cutoffTime > 0 && r.timestamp < cutoffTime) return sum;
      return sum + (r.durationSeconds || (r.durationMinutes * 60) || 0);
    }, 0);
    myTotalFocusSeconds = completedSecs + (selectedFilter === "Today" ? currentSessionSeconds : 0);
  }

  // Construct our real-time/mock friends list
  const myUsername = currentUser ? getUsernameFromEmail(currentUser.email) : "me";
  const myName = myProfile?.nickname || currentUser?.displayName || "You";
  const myEmoji = myProfile?.emoji || "👨‍💻";

  const rtdbStatus = activeTimerData?.status || "RELAXING";
  let meStatus = "Relaxing";
  let meTask = activeTask ? activeTask.title : "General Focus Session";
  let meEmoji = myProfile?.emoji || myStatusNode?.emoji || "👨‍💻";

  if (currentUser) {
    if (rtdbStatus === "FOCUSING") {
      meStatus = "Focusing";
    } else if (rtdbStatus === "BREAK") {
      meStatus = "On Break";
      meTask = activeTimerData?.taskTitle || "Taking a Break";
    } else if (rtdbStatus === "PAUSED") {
      meStatus = "Paused";
      meTask = activeTimerData?.taskTitle || "General Focus Session";
    } else {
      meStatus = "Relaxing";
      meTask = "Chilling";
    }
  } else {
    meStatus = isRunning ? "Focusing" : "Idle";
  }

  const meEntry = {
    name: `${myName} (You)`,
    username: myUsername,
    status: meStatus,
    task: meTask,
    emoji: meEmoji,
    photoURL: myProfile?.photoURL || currentUser?.photoURL || "",
    time: formatSecondsForLeaderboard(myTotalFocusSeconds, selectedFilter),
    focusSeconds: myTotalFocusSeconds,
    isReal: !!currentUser,
    isMe: true
  };

  const allFriends = currentUser 
    ? [
        meEntry,
        ...Object.keys(friendsStatuses)
          .filter(username => username !== myUsername)
          .map(username => {
            const info = friendsStatuses[username];
            const activeTimer = info.active_session || info.active_timer || {};
            const friendRtdbStatus = activeTimer.status || "RELAXING";
            
            let status = "Relaxing";
            let task = activeTimer.taskTitle || "Chilling";
            let defaultEmoji = "😌";
            
            if (friendRtdbStatus === "FOCUSING") {
              status = "Focusing";
              defaultEmoji = "🚀";
            } else if (friendRtdbStatus === "PAUSED") {
              status = "Paused";
              defaultEmoji = "⏸️";
              task = activeTimer.taskTitle || "General Focus Session";
            } else if (friendRtdbStatus === "BREAK") {
              status = "On Break";
              defaultEmoji = "☕";
              task = activeTimer.taskTitle || "Taking a Break";
            } else {
              status = "Relaxing";
              task = "Chilling";
            }
            
            // Compute their total focus seconds for selected filter
            const totalSecs = getFilteredFocusSecondsForUser(info, selectedFilter);
            
            return {
              name: info.nickname || info.displayName || username,
              username: username,
              status: status,
              task: task,
              emoji: info.emoji || defaultEmoji,
              photoURL: info.photoURL || "",
              time: formatSecondsForLeaderboard(totalSecs, selectedFilter),
              focusSeconds: totalSecs,
              isReal: true,
              isMe: false
            };
          })
      ]
    : [
        meEntry,
        { 
          name: "Madhavan", 
          username: "madhavan", 
          status: "Focusing", 
          task: "Kubernetes Orchestration", 
          emoji: "🚀", 
          photoURL: "",
          time: formatSecondsForLeaderboard(Math.round((Date.now() - mockStartTimes.current.madhavan) / 1000) * (selectedFilter === "7 Days" ? 6 : selectedFilter === "30 Days" ? 22 : selectedFilter === "All Time" ? 48 : 1), selectedFilter), 
          focusSeconds: Math.round((Date.now() - mockStartTimes.current.madhavan) / 1000) * (selectedFilter === "7 Days" ? 6 : selectedFilter === "30 Days" ? 22 : selectedFilter === "All Time" ? 48 : 1),
          isReal: false,
          isMe: false
        },
        { 
          name: "Shalini", 
          username: "shalini", 
          status: "Paused", 
          task: "Designing UI Wireframes", 
          emoji: "⏸️", 
          photoURL: "",
          time: formatSecondsForLeaderboard(1080 * (selectedFilter === "7 Days" ? 5 : selectedFilter === "30 Days" ? 18 : selectedFilter === "All Time" ? 35 : 1), selectedFilter), 
          focusSeconds: 1080 * (selectedFilter === "7 Days" ? 5 : selectedFilter === "30 Days" ? 18 : selectedFilter === "All Time" ? 35 : 1),
          isReal: false,
          isMe: false
        },
        { 
          name: "Subash", 
          username: "subash", 
          status: "On Break", 
          task: "Coffee & Stretch", 
          emoji: "☕", 
          photoURL: "",
          time: formatSecondsForLeaderboard(0, selectedFilter), 
          focusSeconds: 0,
          isReal: false,
          isMe: false
        }
      ];

  const mergedFriends = [...allFriends].sort((a, b) => b.focusSeconds - a.focusSeconds);

  // Ring a bell on a friend (either real RTDB push or simulated mock toast)
  const handleRingBell = async (friend: any) => {
    if (cooldowns[friend.username] > 0) return;

    // Set cooldown
    setCooldowns(prev => ({ ...prev, [friend.username]: 10 }));
    const interval = setInterval(() => {
      setCooldowns(prev => {
        const val = prev[friend.username] || 0;
        if (val <= 1) {
          clearInterval(interval);
          const next = { ...prev };
          delete next[friend.username];
          return next;
        }
        return { ...prev, [friend.username]: val - 1 };
      });
    }, 1000);

    if (friend.isReal && currentUser) {
      const myUsername = getUsernameFromEmail(currentUser.email);
      await ringFriendBell(
        friend.username,
        currentUser.displayName || myUsername,
        myUsername
      );
    }
  };

  // Find all active focusing members whose timers are running
  const activeFocusingMembers: any[] = [];

  // Add ourselves first if we are focusing (isRunning)
  if (isRunning) {
    activeFocusingMembers.push({
      name: myProfile?.nickname || currentUser?.displayName || "You",
      emoji: myProfile?.emoji || myStatusNode?.emoji || "👨‍💻",
      photoURL: myProfile?.photoURL || currentUser?.photoURL || null,
      isMe: true,
      task: activeTask ? activeTask.title : "General Focus Session"
    });
  }

  // Add any friends/peers currently in "Focusing" status
  mergedFriends.forEach(friend => {
    if (friend.status === "Focusing") {
      activeFocusingMembers.push({
        name: friend.name,
        emoji: friend.emoji,
        photoURL: friend.photoURL || null,
        isMe: false,
        task: friend.task
      });
    }
  });

  // Fallback so there's always at least one focusing member showing (ourselves) if no one is running
  if (activeFocusingMembers.length === 0) {
    activeFocusingMembers.push({
      name: myProfile?.nickname || currentUser?.displayName || "You",
      emoji: myProfile?.emoji || myStatusNode?.emoji || "👨‍💻",
      photoURL: myProfile?.photoURL || currentUser?.photoURL || null,
      isMe: true,
      task: activeTask ? activeTask.title : "Idle"
    });
  }

  const activeStatus = activeTimerData?.status || "RELAXING";
  const isBreakPhase = activeStatus === "BREAK" || (activeStatus === "PAUSED" && activeTimerData?.pausedFromStatus === "BREAK");

  // Radial Progress parameters
  const totalDuration = isBreakPhase
    ? ((activeTimerData?.breakDurationMinutes || breakMinutes) * 60)
    : (isPomodoro ? ((activeTimerData?.focusDurationMinutes || pomodoroMinutes) * 60) : 3600); // standard stopwatch orbit visual anchor
  const elapsed = isBreakPhase
    ? totalDuration - timeLeft
    : (isPomodoro ? totalDuration - timeLeft : stopwatchSeconds);
  const percentage = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
  const radius = 90;
  const stroke = 8;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Mode active checks
  const isStopwatchActive = !isPomodoro && (isRunning || stopwatchSeconds > 0 || (currentUser && activeStatus !== "RELAXING"));
  const isPomodoroActive = isPomodoro && (isRunning || timeLeft < pomodoroMinutes * 60 || (currentUser && activeStatus !== "RELAXING"));
  const hasStarted = currentUser
    ? (activeStatus !== "RELAXING")
    : (isPomodoro 
        ? (timeLeft < pomodoroMinutes * 60 || isRunning) 
        : (stopwatchSeconds > 0 || isRunning));

  const isFocusingNow = currentUser 
    ? (activeStatus === "FOCUSING")
    : localIsRunning;

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setManualSubmitStatus({ type: "error", message: "You must be logged in to submit manual entries." });
      return;
    }
    let mins = Number(manualMinutes);
    if (isNaN(mins) || mins <= 0) {
      setManualSubmitStatus({ type: "error", message: "Please enter a valid positive number of minutes." });
      return;
    }

    // Client-side input validation: clamp input between 1 and 360 minutes
    mins = Math.max(1, Math.min(360, mins));

    if (!manualReason.trim()) {
      setManualSubmitStatus({ type: "error", message: "Please enter a reason for the manual entry." });
      return;
    }

    setIsSubmittingManual(true);
    setManualSubmitStatus(null);
    try {
      const result = await logManualWebStudySession(manualReason.trim(), activeTag || "Study", mins);
      if (result.success) {
        setManualMinutes("");
        setManualReason("");
        setManualSubmitStatus({
          type: "success",
          message: result.message
        });
        setTimeout(() => setManualSubmitStatus(null), 5000);
        // Force SQLite/Dexie status refresh and trigger global changes
        window.dispatchEvent(new Event("life_os_sqlite_changed"));
        setSqliteUpdateCounter(prev => prev + 1);
      } else {
        setManualSubmitStatus({
          type: "error",
          message: result.message
        });
      }
    } catch (err: any) {
      console.error("Error submitting manual entry:", err);
      setManualSubmitStatus({
        type: "error",
        message: err.message || "Failed to submit manual entry request."
      });
    } finally {
      setIsSubmittingManual(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="timer-container">
      {/* Interactive timer circular view (col-span-2) */}
      <div className="lg:col-span-2 space-y-6">
        {/* Timer main panel */}
        <div className="bg-gray-900/40 p-8 rounded-2xl border border-gray-800 text-center flex flex-col items-center justify-center relative overflow-hidden min-h-[450px]">
          {/* Immersive Mode toggle */}
          <button
            onClick={() => setIsImmersive(true)}
            className="absolute top-4 right-4 p-2 bg-gray-950 text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700 rounded-lg transition-all cursor-pointer"
            title="Go distraction-free"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          {/* Mode Switcher Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-gray-950 border border-gray-800 rounded-xl mb-4 relative z-10">
            <button
              onClick={() => handleToggleMode(true)}
              disabled={isRunning}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isPomodoro
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-300 disabled:opacity-50"
              }`}
            >
              Pomodoro
            </button>
            <button
              onClick={() => handleToggleMode(false)}
              disabled={isRunning}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                !isPomodoro
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-300 disabled:opacity-50"
              }`}
            >
              Stopwatch
            </button>
          </div>

          {/* Core Radial Timer Layout */}
          <div className="relative flex items-center justify-center w-56 h-56 mb-8 mt-2">
            <svg className="w-full h-full transform -rotate-90">
              {/* Outer orbit backgound */}
              <circle
                className="text-gray-800/40"
                strokeWidth={stroke}
                stroke="currentColor"
                fill="transparent"
                r={normalizedRadius}
                cx="112"
                cy="112"
              />
              {/* Active orbit border indicator */}
              <circle
                className="text-blue-500 transition-all duration-300"
                strokeWidth={stroke}
                strokeDasharray={circumference + " " + circumference}
                style={{ strokeDashoffset }}
                strokeLinecap="round"
                stroke="currentColor"
                fill="transparent"
                r={normalizedRadius}
                cx="112"
                cy="112"
              />
            </svg>

            {/* Inner text timer */}
            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
              <span className="font-sans text-4xl font-bold tracking-tight text-white">
                {formatTime((isPomodoro || isBreakPhase) ? timeLeft : stopwatchSeconds)}
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
                {activeStatus === "BREAK" 
                  ? "On Break" 
                  : (activeStatus === "PAUSED" 
                      ? "Paused" 
                      : (isRunning ? "Focusing" : (hasStarted ? "Paused" : "Idle")))}
              </span>
            </div>
          </div>

          {/* Interactive controls */}
          <div className="flex flex-col items-center gap-4 w-full max-w-sm mt-4">
            <div className="flex items-center justify-center gap-2 sm:gap-3 py-1 flex-nowrap w-full">
              {/* Main Play / Pause / Resume action */}
              <button
                id="timer-play-pause-btn"
                type="button"
                onClick={handleStartPause}
                className={`flex items-center gap-1.5 px-3 py-2.5 sm:px-5 sm:py-3 rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg transform active:scale-95 shrink-0 ${
                  (isRunning && activeStatus !== "BREAK") 
                    ? "bg-yellow-600 text-white shadow-yellow-600/10 hover:bg-yellow-500" 
                    : "bg-blue-600 text-white shadow-blue-600/20 hover:bg-blue-500"
                }`}
              >
                {(isRunning && activeStatus !== "BREAK") ? (
                  <>
                    <Pause className="h-4 w-4 fill-white" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-white ml-0.5" />
                    <span>{hasStarted ? "Resume" : "Start Focus"}</span>
                  </>
                )}
              </button>

              {/* Start Break Button (Only shown while actively focusing) */}
              {isFocusingNow && (
                <button
                  type="button"
                  onClick={handleStartBreakManual}
                  className="flex items-center gap-1.5 px-3 py-2.5 sm:px-5 sm:py-3 bg-emerald-600/15 hover:bg-emerald-600 border border-emerald-500/30 hover:border-emerald-500 text-emerald-400 hover:text-white rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg transform active:scale-95 shrink-0"
                  title="Take a break now"
                >
                  <Coffee className="h-4 w-4" />
                  <span>Start Break</span>
                </button>
              )}

              {/* Explicit "End Session" or "Stop" button */}
              {hasStarted && (
                <button
                  id="timer-end-session-btn"
                  type="button"
                  onClick={handleSkipStop}
                  className="flex items-center gap-1.5 px-3 py-2.5 sm:px-5 sm:py-3 bg-red-600/15 hover:bg-red-600 border border-red-500/30 hover:border-red-500 text-red-400 hover:text-white rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg transform active:scale-95 shrink-0"
                  title="End active focus session and save progress"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>End Session</span>
                </button>
              )}
            </div>
          </div>

          {/* Context binder: Active task picker */}
          <div className="w-full max-w-sm mt-8 p-3 bg-gray-950 border border-gray-800 rounded-xl flex items-center gap-3">
            <Clipboard className="h-4 w-4 text-gray-500 shrink-0" />
            <select
              value={selectedTaskId || ""}
              onChange={(e) => setSelectedTaskId(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 bg-transparent text-xs text-gray-300 font-medium focus:outline-none"
            >
              <option value="">-- Bind to Active Task --</option>
              {tasks.filter(t => !t.isCompleted).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          {/* Session details details */}
          <div className="w-full max-w-sm mt-3 grid grid-cols-2 gap-2">
            <div className="bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800/60 flex items-center gap-2">
              <Tag className="h-3 w-3 text-gray-500" />
              <input
                type="text"
                placeholder="Study, Work..."
                value={activeTag}
                onChange={(e) => {
                  const val = e.target.value;
                  setActiveTag(val);
                  if (isRunning && currentUser) {
                    const res = sqliteHelper.switchSubject(val);
                    window.dispatchEvent(new Event("life_os_sqlite_changed"));
                    if (res.outbox) {
                      setTimeout(() => {
                        sqliteHelper.processOutboxRow(res.outbox!.id);
                        window.dispatchEvent(new Event("life_os_sqlite_changed"));
                      }, 1000);
                    }
                  }
                }}
                className="bg-transparent text-xs text-gray-200 focus:outline-none w-full font-medium"
              />
            </div>
            <div className="bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800/60 flex items-center gap-2">
              <List className="h-3 w-3 text-gray-500" />
              <input
                type="text"
                placeholder="Notes..."
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="bg-transparent text-xs text-gray-200 focus:outline-none w-full font-medium"
              />
            </div>
          </div>
        </div>

        {/* Pomodoro Configuration Card */}
        {isPomodoro && activeStatus === "RELAXING" && (
          <div className="bg-gray-900/40 border border-gray-800 p-5 rounded-2xl space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
              <Sliders className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Pomodoro Configurations
              </h3>
            </div>
            
            {/* Presets */}
            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Presets</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { fMins: 25, bMins: 5, label: "25/5 Sprint" },
                  { fMins: 50, bMins: 10, label: "50/10 Sprint" },
                  { fMins: 15, bMins: 3, label: "15/3 Lite" }
                ].map(({ fMins, bMins, label }) => {
                  const isSelected = pomodoroMinutes === fMins && breakMinutes === bMins;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={async () => {
                        setPomodoroMinutes(fMins);
                        setBreakMinutes(bMins);
                        localStorage.setItem("life_os_pomodoro_minutes", JSON.stringify(fMins));
                        localStorage.setItem("life_os_break_minutes", JSON.stringify(bMins));
                        if (currentUser) {
                          const myUsername = getUsernameFromEmail(currentUser.email);
                          await saveTimerSettings(myUsername, {
                            timerDurationMinutes: fMins,
                            stopwatchBreakDurationMinutes: bMins
                          });
                        }
                      }}
                      className={`h-9 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                        isSelected 
                          ? "bg-blue-600/15 border-blue-500 text-blue-400" 
                          : "bg-gray-950 border-gray-850 text-gray-400 hover:text-gray-250"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Durations */}
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1 text-left">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">
                  Focus Duration (mins)
                </label>
                <div className="flex items-center gap-1.5 bg-gray-950 border border-gray-850 p-1.5 rounded-xl font-sans">
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleUpdatePomodoroMinutes(pomodoroMinutes - 1)}
                    className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={pomodoroMinutes}
                    onChange={(e) => handleUpdatePomodoroMinutes(parseInt(e.target.value) || 25)}
                    disabled={isRunning}
                    className="w-full bg-transparent text-center text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleUpdatePomodoroMinutes(pomodoroMinutes + 1)}
                    className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="space-y-1 text-left">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">
                  Break Duration (mins)
                </label>
                <div className="flex items-center gap-1.5 bg-gray-950 border border-gray-850 p-1.5 rounded-xl font-sans">
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleUpdateBreakMinutes(breakMinutes - 1)}
                    className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={breakMinutes}
                    onChange={(e) => handleUpdateBreakMinutes(parseInt(e.target.value) || 5)}
                    disabled={isRunning}
                    className="w-full bg-transparent text-center text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleUpdateBreakMinutes(breakMinutes + 1)}
                    className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Auto-Start Toggles */}
            <div className="space-y-2.5 pt-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Auto-Start Options</label>
              <div className="space-y-2">
                {/* Auto Start Break */}
                <div className="flex items-center justify-between p-2.5 bg-gray-950/60 border border-gray-850 rounded-xl">
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-gray-300 font-medium">Auto-Start Break</span>
                    <span className="text-[9px] text-gray-500">Automatically transitions to break phase after focus ends.</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !autoStartBreak;
                      setAutoStartBreak(nextVal);
                      localStorage.setItem("life_os_auto_start_break", JSON.stringify(nextVal));
                      if (currentUser) {
                        const myUsername = getUsernameFromEmail(currentUser.email);
                        await saveTimerSettings(myUsername, { autoStartBreak: nextVal });
                      }
                    }}
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all ${
                      autoStartBreak ? "bg-blue-600 justify-end" : "bg-gray-800 justify-start"
                    }`}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>

                {/* Auto Start Focus */}
                <div className="flex items-center justify-between p-2.5 bg-gray-950/60 border border-gray-850 rounded-xl">
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-gray-300 font-medium">Auto-Start Focus</span>
                    <span className="text-[9px] text-gray-500">Automatically begins next focus session when break completes.</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !autoStartPomo;
                      setAutoStartPomo(nextVal);
                      localStorage.setItem("life_os_auto_start_pomo", JSON.stringify(nextVal));
                      if (currentUser) {
                        const myUsername = getUsernameFromEmail(currentUser.email);
                        await saveTimerSettings(myUsername, { autoStartPomo: nextVal });
                      }
                    }}
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all ${
                      autoStartPomo ? "bg-blue-600 justify-end" : "bg-gray-800 justify-start"
                    }`}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>

                {/* Public Presence Visibility */}
                <div className="flex items-center justify-between p-2.5 bg-gray-950/60 border border-gray-850 rounded-xl">
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-gray-300 font-medium">Public Leaderboard Presence</span>
                    <span className="text-[9px] text-gray-500">Share focus status and total study time on friends' leaderboards.</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !publicPresenceVisible;
                      setPublicPresenceVisible(nextVal);
                      localStorage.setItem("life_os_public_presence_visible", JSON.stringify(nextVal));
                      if (currentUser) {
                        const myUsername = getUsernameFromEmail(currentUser.email);
                        await saveTimerSettings(myUsername, { publicPresenceVisible: nextVal });
                      }
                    }}
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all ${
                      publicPresenceVisible ? "bg-blue-600 justify-end" : "bg-gray-800 justify-start"
                    }`}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stopwatch Configuration Card */}
        {!isPomodoro && activeStatus === "RELAXING" && (
          <div className="bg-gray-900/40 border border-gray-800 p-5 rounded-2xl space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
              <Sliders className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Stopwatch Configurations
              </h3>
            </div>

            {/* Custom Break Duration only */}
            <div className="space-y-1 text-left">
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">
                Break Duration (mins)
              </label>
              <div className="flex items-center gap-1.5 bg-gray-950 border border-gray-850 p-1.5 rounded-xl font-sans max-w-xs">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => handleUpdateBreakMinutes(breakMinutes - 1)}
                  className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={breakMinutes}
                  onChange={(e) => handleUpdateBreakMinutes(parseInt(e.target.value) || 5)}
                  disabled={isRunning}
                  className="w-full bg-transparent text-center text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => handleUpdateBreakMinutes(breakMinutes + 1)}
                  className="w-7 h-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white border border-gray-800 disabled:opacity-45 cursor-pointer font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>

            {/* Auto-Start Options */}
            <div className="space-y-2.5 pt-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Auto-Start Options</label>
              <div className="space-y-2">
                {/* Auto Start Break */}
                <div className="flex items-center justify-between p-2.5 bg-gray-950/60 border border-gray-850 rounded-xl">
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-gray-300 font-medium">Auto-Start Break</span>
                    <span className="text-[9px] text-gray-500">Automatically transitions to break phase after focus ends.</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !autoStartBreak;
                      setAutoStartBreak(nextVal);
                      localStorage.setItem("life_os_auto_start_break", JSON.stringify(nextVal));
                      if (currentUser) {
                        const myUsername = getUsernameFromEmail(currentUser.email);
                        await saveTimerSettings(myUsername, { autoStartBreak: nextVal });
                      }
                    }}
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all ${
                      autoStartBreak ? "bg-blue-600 justify-end" : "bg-gray-800 justify-start"
                    }`}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>

                {/* Auto Start Stopwatch After Break */}
                <div className="flex items-center justify-between p-2.5 bg-gray-950/60 border border-gray-850 rounded-xl">
                  <div className="flex flex-col text-left">
                    <span className="text-xs text-gray-300 font-medium">Auto-Start Stopwatch After Break</span>
                    <span className="text-[9px] text-gray-500">Automatically launches stopwatch mode when break ends.</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !autoStartStopwatchAfterBreak;
                      setAutoStartStopwatchAfterBreak(nextVal);
                      localStorage.setItem("life_os_auto_start_sw_after_break", JSON.stringify(nextVal));
                      if (currentUser) {
                        const myUsername = getUsernameFromEmail(currentUser.email);
                        await saveTimerSettings(myUsername, { autoStartStopwatchAfterBreak: nextVal });
                      }
                    }}
                    className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all ${
                      autoStartStopwatchAfterBreak ? "bg-blue-600 justify-end" : "bg-gray-800 justify-start"
                    }`}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Focus stats summary card */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-900/20 border border-gray-800/80 p-4 rounded-xl text-center">
            <Calendar className="h-5 w-5 text-blue-500 mx-auto mb-1" />
            <div className="text-xl font-bold text-white">{formatSecondsToDetailed(myTotalFocusSeconds)}</div>
            <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Focus Time</div>
          </div>
          <div className="bg-gray-900/20 border border-gray-800/80 p-4 rounded-xl text-center">
            <Users className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <div className="text-xl font-bold text-white">
              {mergedFriends.filter(f => f.status === "Focusing").length}
            </div>
            <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Active Peers</div>
          </div>
        </div>

        {/* Manual Time Entry Card */}
        {activeStatus === "RELAXING" && (
          <div className="bg-gray-900/40 border border-gray-800 p-5 rounded-2xl space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
              <Plus className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Manual Time Entry
              </h3>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Missed logging a focus session? Submit your focus duration and reason below. The request will be queued and processed asynchronously.
            </p>

            <form onSubmit={handleManualSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider font-bold block">
                    Focus Minutes
                  </label>
                  <div className="bg-gray-950 px-3 py-2 rounded-xl border border-gray-800 flex items-center">
                    <input
                      type="number"
                      min="1"
                      placeholder="e.g. 45"
                      value={manualMinutes}
                      onChange={(e) => setManualMinutes(e.target.value)}
                      disabled={isSubmittingManual}
                      className="bg-transparent text-xs text-white outline-none w-full font-medium"
                      required
                    />
                  </div>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider font-bold block">
                    Reason / Task Description
                  </label>
                  <div className="bg-gray-950 px-3 py-2 rounded-xl border border-gray-800 flex items-center">
                    <input
                      type="text"
                      placeholder="e.g. Offline study, textbook reading"
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      disabled={isSubmittingManual}
                      className="bg-transparent text-xs text-white outline-none w-full font-medium"
                      required
                    />
                  </div>
                </div>
              </div>

              {manualSubmitStatus && (
                <div className={`p-3 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
                  manualSubmitStatus.type === "success"
                    ? "bg-green-500/10 text-green-400 border-green-500/15"
                    : "bg-red-500/10 text-red-400 border-red-500/15"
                }`}>
                  <div className="space-y-0.5">
                    <p className="font-bold">{manualSubmitStatus.type === "success" ? "Request Queued" : "Submission Error"}</p>
                    <p className="text-[10px] font-medium leading-relaxed">{manualSubmitStatus.message}</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmittingManual}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-xl cursor-pointer transition-all flex items-center gap-1.5"
                >
                  {isSubmittingManual ? "Submitting..." : "Submit to Queue"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Sidebar: Friends Focus Panel & Focus Logs */}
      <div className="space-y-6">
        {/* Friends Focus panel */}
        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" /> Friends Focus
            </h3>
            <span className="text-[10px] text-gray-500 font-bold px-1.5 py-0.5 bg-gray-950 rounded border border-gray-800">
              Live
            </span>
          </div>

          {/* Premium Period Filter Tab switcher */}
          <div className="flex items-center gap-1 p-1 bg-gray-950 border border-gray-800/50 rounded-xl">
            {(["Today", "7 Days", "30 Days", "All Time"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedFilter(filter)}
                className={`flex-1 text-[9px] font-bold py-1 px-1.5 rounded-lg transition-all cursor-pointer ${
                  selectedFilter === filter
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {filter === "Today" ? "Today" : filter === "7 Days" ? "7D" : filter === "30 Days" ? "30D" : "All"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {mergedFriends.map((friend) => {
              const cooldown = cooldowns[friend.username] || 0;
              return (
                <div key={friend.username} className="flex items-center justify-between bg-gray-950 p-3 rounded-lg border border-gray-800/50">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {renderAvatar(friend.photoURL || friend.emoji, "w-8 h-8 text-xl")}
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-xs font-bold text-gray-200 truncate">{sanitizeName(friend.name)}</h4>
                        <span className={`text-[8px] px-1.5 py-0.2 rounded-full font-bold border shrink-0 ${
                          friend.status === "Focusing"
                            ? "text-blue-400 bg-blue-500/10 border-blue-500/25 shadow-[0_0_8px_rgba(59,130,246,0.1)] animate-pulse"
                            : friend.status === "Paused"
                            ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/25"
                            : friend.status === "On Break"
                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                            : "text-gray-500 bg-gray-900 border-gray-800"
                        }`}>
                          {friend.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 truncate max-w-[140px]" title={friend.task}>
                        {friend.task}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      friend.status === "Focusing"
                        ? "text-blue-400 bg-blue-500/10 border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.15)] animate-pulse"
                        : friend.status === "Paused"
                        ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
                        : friend.status === "On Break"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : "text-gray-500 bg-gray-900 border-gray-800"
                    }`}>
                      {friend.time || "0s"}
                    </span>
                    {!friend.isMe && (
                      <button
                        onClick={() => handleRingBell(friend)}
                        disabled={cooldown > 0}
                        className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                          cooldown > 0
                            ? "bg-gray-900 text-gray-600 border-gray-800"
                            : "bg-blue-600/10 text-blue-400 border-blue-500/20 hover:bg-blue-600/20"
                        }`}
                        title={cooldown > 0 ? `Ring again in ${cooldown}s` : "Ring focus notification bell"}
                      >
                        <BellRing className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Focus Records Session Logs */}
        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b border-gray-800 pb-2 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-400" /> Recent Focus Sessions
          </h3>

          <div className="space-y-2.5 max-h-[195px] overflow-y-auto pr-1">
            {focusRecords.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">No focus sessions tracked yet.</p>
            ) : (
              [...focusRecords]
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .map((record) => (
                <div key={record.id} className="bg-gray-950 p-2.5 rounded-lg border border-gray-800/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-200 truncate max-w-[130px]">{record.taskTitle}</span>
                    <span className="text-[9px] font-mono font-medium text-gray-500 bg-gray-900 px-1 py-0.5 rounded">
                      {record.startTime}-{record.endTime}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span className="bg-blue-500/10 text-blue-400/90 border border-blue-500/10 px-1.5 py-0.2 rounded font-mono text-[9px]">
                      {record.tag}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ml-1 border ${
                      (record.mode || "POMODORO").toUpperCase() === "STOPWATCH"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : (record.mode || "POMODORO").toUpperCase() === "MANUAL_LOG" || (record.mode || "POMODORO").toUpperCase() === "MANUAL"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    }`}>
                      {(record.mode || "POMODORO").replace("_", " ")}
                    </span>
                    <span className="font-semibold text-gray-400 font-mono">{record.durationMinutes}m</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Immersive Full Screen Overlay */}
      <AnimatePresence>
        {isImmersive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#030712] z-50 flex flex-col items-center justify-center p-8 text-center select-none"
          >
            {/* Active Focusing User Mini Boxes (Always Shown) */}
            <div className="absolute top-6 left-6 flex flex-wrap gap-3 max-w-[calc(100vw-180px)] select-none z-10">
              {activeFocusingMembers.map((member) => (
                <div 
                  key={member.name} 
                  className="flex items-center gap-2.5 bg-gray-900/60 backdrop-blur-md border border-gray-800/85 px-3.5 py-2 rounded-xl shadow-xl select-none text-left"
                >
                  {member.photoURL ? (
                    <div className="relative shrink-0">
                      <img
                        src={member.photoURL}
                        alt={member.name}
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 rounded-full border border-blue-500/30 object-cover"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                    </div>
                  ) : (
                    <div className="relative h-8 w-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-lg shrink-0">
                      {member.emoji && (member.emoji.startsWith("base64:") || member.emoji.startsWith("data:image/") || member.emoji.startsWith("http")) ? (
                        <img 
                          src={member.emoji.startsWith("base64:") ? `data:image/jpeg;base64,${member.emoji.substring(7)}` : member.emoji}
                          referrerPolicy="no-referrer"
                          className="h-full w-full rounded-full object-cover"
                          alt={member.name}
                        />
                      ) : (
                        <span className="flex items-center justify-center leading-none select-none">{member.emoji}</span>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[8px] text-blue-400 font-bold uppercase tracking-wider leading-none">
                      {member.isMe ? "You focusing" : "Active Focus"}
                    </div>
                    <div className="text-xs font-bold text-gray-200 truncate max-w-[110px] leading-tight">
                      {member.name}
                    </div>
                    <div className="text-[9px] text-gray-500 truncate max-w-[110px] leading-tight">
                      {member.task}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Back to standard view (Hides after 5s) */}
            <AnimatePresence>
              {showControls && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setIsImmersive(false)}
                  className="absolute top-6 right-6 flex items-center gap-1.5 px-3.5 py-2 bg-gray-900/80 backdrop-blur-sm hover:bg-gray-800 border border-gray-800 rounded-lg text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer z-20 shadow-lg"
                >
                  <Minimize2 className="h-3.5 w-3.5" /> Back to Workspace
                </motion.button>
              )}
            </AnimatePresence>

            {/* Immersive content */}
            <div className="space-y-6 max-w-md w-full">
              {/* Dynamic status statement (Hides after 5s) */}
              <div className="h-14 flex items-center justify-center">
                <AnimatePresence>
                  {showControls && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-1"
                    >
                      <span className="text-[10px] text-blue-400 font-mono uppercase tracking-widest font-bold">
                        {isPomodoro ? "POMODORO" : "STOPWATCH"}
                      </span>
                      <h1 className="text-2xl font-display font-bold tracking-tight text-white truncate max-w-sm">
                        {activeTask ? activeTask.title : "Deep focus session active..."}
                      </h1>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Massive ambient countdown timer (Always shown, completely stable and static, no blink) */}
              <div className="text-8xl md:text-9xl font-sans font-bold tracking-wider text-white py-4 select-none leading-none">
                {formatTime((isPomodoro || isBreakPhase) ? timeLeft : stopwatchSeconds)}
              </div>

              {/* Motivational Quote (Always shown under the timer) */}
              <div className="py-2">
                <p className="text-sm md:text-base text-gray-300 font-medium max-w-sm mx-auto leading-relaxed select-none px-4 py-2.5 bg-gray-900/20 backdrop-blur-sm border border-gray-800/40 rounded-xl">
                  "{currentQuote || "Deep work is the superpower of the 21st century."}"
                </p>
              </div>

              {/* Interactive breathing loops indicator (Always shown) */}
              <p className="text-xs text-gray-500 italic max-w-xs mx-auto leading-relaxed select-none">
                "Inhale through your nose, expand your lungs, hold momentarily, and slowly exhale..."
              </p>

              {/* Pause / Play controls (Hides after 5s) */}
              <div className="h-16 flex items-center justify-center">
                <AnimatePresence>
                  {showControls && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.2 }}
                      className="flex justify-center gap-4 flex-nowrap"
                    >
                      <button
                        onClick={handleStartPause}
                        className={`px-8 py-3 rounded-full font-bold text-sm tracking-wide shadow-lg cursor-pointer transition-all hover:scale-105 active:scale-95 shrink-0 ${
                          (isRunning && activeStatus !== "BREAK") 
                            ? "bg-yellow-600 hover:bg-yellow-500 text-white shadow-yellow-600/10" 
                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20"
                        }`}
                      >
                        {(isRunning && activeStatus !== "BREAK") ? "PAUSE INTERVAL" : "RESUME INTERVAL"}
                      </button>
                      <button
                        onClick={handleSkipStop}
                        className="px-6 py-3 bg-gray-900 border border-gray-800 hover:border-gray-700 text-red-400 hover:text-red-300 rounded-full text-sm font-bold tracking-wide cursor-pointer transition-all hover:scale-105 active:scale-95 shrink-0"
                      >
                        END SESSION
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Daily limit warning modal */}
      <AnimatePresence>
        {showLimitAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLimitAlert(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-gray-950 border border-red-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative z-10 text-center"
            >
              <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 animate-pulse" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-red-400">
                  Focus Limit Reached
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed font-medium">
                  {limitAlertMessage || "Daily focus limit of 20 hours (1200 minutes) has been reached. Timer has been paused."}
                </p>
              </div>
              <button
                onClick={() => setShowLimitAlert(false)}
                className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-red-600/10"
              >
                Understood
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
