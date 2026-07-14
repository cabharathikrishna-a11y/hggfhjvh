import React, { useState, useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import TimerView from "./components/TimerView";
import DeepaAICore from "./components/DeepaAICore";
import TaskEngine from "./components/TaskEngine";
import HabitsTracker from "./components/HabitsTracker";
import JournalBook from "./components/JournalBook";
import FinanceLedger from "./components/FinanceLedger";
import KeepNotes from "./components/KeepNotes";
import FileExplorerView from "./components/FileExplorerView";
import ContactsView from "./components/ContactsView";
import AnalyticsView from "./components/AnalyticsView";
import SystemSettingsView from "./components/SystemSettingsView";
import { startAutoSyncManager } from "./lib/sync_manager";
import { enforceFirebaseSchemaConsensus } from "./lib/authMigrationGate";

import { 
  auth, 
  initAuth, 
  googleSignIn, 
  googleSignInRedirect,
  handleRedirectResult,
  googleSignOut,
  getUsernameFromEmail, 
  listenToAllUsers,
  fetchUserProfile,
  updateMyProfile,
  addFocusRecordToDb,
  listenToMyBell,
  clearMyBell,
  database,
  executeLegacyCloudSanitization
} from "./lib/firebase";
import { db } from "./lib/dexie_db";
import { User } from "firebase/auth";
import { Task, FocusRecord, Screen } from "./types";
import { 
  LogIn, Shield, Sparkles, ListTodo, Timer, Flame, BookOpen, DollarSign, 
  StickyNote, HardDrive, Users, BarChart3, Sliders, ChevronRight 
} from "lucide-react";
import "./index.css";

// Mock tasks for offline fallback testing
const INITIAL_DEMO_TASKS: Task[] = [
  {
    id: 1,
    title: "Review Design Specifications",
    description: "Go over the latest visual design system and type pairings.",
    estimatedMinutes: 45,
    actualMinutes: 0,
    isCompleted: false,
    parentTaskId: null,
    listCategory: "Work",
    timeBlockTimestamp: null,
    nagModeEnabled: false,
    nagIntervalMinutes: 15,
    priority: "HIGH",
    dueDateString: new Date().toISOString().split("T")[0],
    orderIndex: 1
  },
  {
    id: 2,
    title: "Implement Core Timer Module",
    description: "Write clean React code for Pomodoro and Stopwatch states.",
    estimatedMinutes: 60,
    actualMinutes: 0,
    isCompleted: false,
    parentTaskId: null,
    listCategory: "Work",
    timeBlockTimestamp: null,
    nagModeEnabled: true,
    nagIntervalMinutes: 10,
    priority: "HIGH",
    dueDateString: new Date().toISOString().split("T")[0],
    orderIndex: 2
  },
  {
    id: 3,
    title: "Read Chapter 4 of Deep Work",
    description: "Read Cal Newport's book on concentrated focus strategies.",
    estimatedMinutes: 30,
    actualMinutes: 0,
    isCompleted: false,
    parentTaskId: null,
    listCategory: "Personal",
    timeBlockTimestamp: null,
    nagModeEnabled: false,
    nagIntervalMinutes: 30,
    priority: "MEDIUM",
    dueDateString: new Date().toISOString().split("T")[0],
    orderIndex: 3
  }
];

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => {
    return localStorage.getItem("life_os_offline_mode_active") === "true";
  });

  const [activeScreen, setActiveScreen] = useState<Screen>(Screen.TIMER);

  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem("life_os_sandbox_tasks");
    return saved ? JSON.parse(saved) : INITIAL_DEMO_TASKS;
  });

  const [focusRecords, setFocusRecords] = useState<FocusRecord[]>(() => {
    const saved = localStorage.getItem("life_os_sandbox_focus_records");
    return saved ? JSON.parse(saved) : [];
  });

  const [friendsStatuses, setFriendsStatuses] = useState<Record<string, any>>({});
  const [myProfile, setMyProfile] = useState<{ nickname: string; emoji: string; photoURL?: string } | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== "undefined" ? navigator.onLine : true);

  // Network listener
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Prevent browser storage eviction on boot
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist()
        .then((persisted) => {
          console.log(`[Storage] Persistent storage granted: ${persisted}`);
        })
        .catch((err) => {
          console.warn("[Storage] Failed to request storage persistence:", err);
        });
    }
  }, []);

  // Sync tasks to local storage
  useEffect(() => {
    localStorage.setItem("life_os_sandbox_tasks", JSON.stringify(tasks));
  }, [tasks]);

  // Sync focus records to local storage (for offline fallback)
  useEffect(() => {
    localStorage.setItem("life_os_sandbox_focus_records", JSON.stringify(focusRecords));
  }, [focusRecords]);

  // Subscribe to auth state on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setIsOfflineMode(false);
        setAuthChecking(false);
        setErrorMessage(null);

        // Run background legacy RTDB cloud sanitization on connect, then chain consensus migration
        const username = getUsernameFromEmail(user.email);
        if (username) {
          executeLegacyCloudSanitization(username)
            .then((res) => {
              if (res.executed) {
                console.log("[Sanitizer] Legacy cloud nodes sanitized successfully:", res.message);
              } else {
                console.log("[Sanitizer] Cloud sanitization check completed:", res.message);
              }
              // Chain the schema version consensus
              return enforceFirebaseSchemaConsensus(username);
            })
            .then((consensusRes) => {
              console.log("[Consensus] Schema consensus check completed:", consensusRes.message);
            })
            .catch((err) => {
              console.error("[Sanitizer/Consensus] Cloud setup operations failed:", err);
            });
        }
      },
      (reason) => {
        if (reason === "ACCOUNT_NOT_FOUND") {
          setErrorMessage("We couldn't locate your Life OS account profile. Please check with your administrator or register.");
        }
        setCurrentUser(null);
        setAuthChecking(false);
      }
    );

    // Resolve any pending Google redirect credentials on mount
    const checkRedirect = async () => {
      try {
        const result = await handleRedirectResult();
        if (result) {
          setCurrentUser(result.user);
          setIsOfflineMode(false);
          setErrorMessage(null);
        }
      } catch (err: any) {
        console.error("Error processing redirect result:", err);
        setErrorMessage(err.message || "Failed to resolve redirect login.");
      }
    };
    checkRedirect();

    return () => {
      unsubscribe();
    };
  }, []);

  // Set up background auto-sync manager
  useEffect(() => {
    const cleanupSync = startAutoSyncManager();
    return () => {
      if (cleanupSync) cleanupSync();
    };
  }, []);

  // Set up real-time listeners when logged in
  useEffect(() => {
    if (!currentUser || isOfflineMode) return;

    const myUsername = getUsernameFromEmail(currentUser.email);
    if (!myUsername) return;

    // 1. Load completed focus records from Dexie local history vault
    const loadLocalRecords = async () => {
      try {
        const localHistory = await db.localHistoryVault.toArray();
        const mappedRecords: FocusRecord[] = localHistory.map(rec => ({
          id: rec.recordId,
          taskTitle: rec.taskTitle,
          tag: rec.subject,
          notes: "",
          durationSeconds: Math.floor(rec.totalFocusMs / 1000),
          durationMinutes: Math.floor(rec.totalFocusMs / 60000),
          dateString: rec.dateString,
          startTime: rec.startTimeFormatted || "00:00",
          endTime: rec.endTimeFormatted || "00:00",
          timestamp: rec.startTimeMs,
          isManual: rec.mode === "MANUAL_LOG" || rec.recordId.startsWith("manual_"),
          mode: rec.mode
        }));
        // Sort descending by timestamp
        mappedRecords.sort((a, b) => b.timestamp - a.timestamp);
        setFocusRecords(mappedRecords);
      } catch (err) {
        console.error("Failed to load local history records:", err);
      }
    };

    loadLocalRecords();
    window.addEventListener("life_os_sqlite_changed", loadLocalRecords);

    // 2. Listen to all friends' statuses (Leaderboard / Peers focus)
    const unsubFriends = listenToAllUsers((usersMap) => {
      setFriendsStatuses(usersMap);

      // Extract my custom profile metadata
      const myNode = usersMap[myUsername];
      if (myNode) {
        setMyProfile({
          nickname: myNode.nickname || currentUser.displayName?.split(" ")[0] || "User",
          emoji: myNode.emoji || "👨‍💻",
          photoURL: myNode.photoURL || currentUser.photoURL || ""
        });
      }
    });

    // 3. Listen to incoming bell rings
    const unsubBell = listenToMyBell(myUsername, (bellSignal) => {
      if (bellSignal && !bellSignal.isProcessed) {
        // Show an alert or play a sound for the bell
        alert(`🔔 You got a bell ring from ${bellSignal.senderDisplayName}!`);
        // Clear it so it doesn't ring again
        clearMyBell(myUsername);
      }
    });

    return () => {
      window.removeEventListener("life_os_sqlite_changed", loadLocalRecords);
      unsubFriends();
      unsubBell();
    };
  }, [currentUser, isOfflineMode]);

  // Handle local focus record addition (used by TimerView)
  const handleAddFocusRecord = (record: FocusRecord) => {
    if (currentUser && !isOfflineMode) {
      const myUsername = getUsernameFromEmail(currentUser.email);
      addFocusRecordToDb(myUsername, record);
    } else {
      setFocusRecords(prev => [record, ...prev]);
    }
  };

  const handleGoogleSignInPopup = async () => {
    setAuthChecking(true);
    setErrorMessage(null);
    try {
      await googleSignIn(false);
    } catch (err: any) {
      setErrorMessage(err.message || "Sign-in failed. Please try again.");
      setAuthChecking(false);
    }
  };

  const handleGoogleSignInRedirect = async () => {
    setAuthChecking(true);
    setErrorMessage(null);
    try {
      await googleSignInRedirect(false);
    } catch (err: any) {
      setErrorMessage(err.message || "Redirect sign-in failed.");
      setAuthChecking(false);
    }
  };

  const handleContinueOffline = () => {
    setIsOfflineMode(true);
    localStorage.setItem("life_os_offline_mode_active", "true");
    setErrorMessage(null);
    setAuthChecking(false);
  };

  const handleSignOut = async () => {
    if (currentUser) {
      await googleSignOut();
    }
    setIsOfflineMode(false);
    localStorage.removeItem("life_os_offline_mode_active");
    setCurrentUser(null);
    setFriendsStatuses({});
    setMyProfile(undefined);
  };

  const myStatusNode = useMemo(() => {
    if (!currentUser || isOfflineMode) return null;
    const myUsername = getUsernameFromEmail(currentUser.email);
    return friendsStatuses[myUsername] || null;
  }, [currentUser, friendsStatuses, isOfflineMode]);

  const sidebarItems = [
    { name: "Deepa AI Core", screen: Screen.DEEPA_AI, icon: Sparkles },
    { name: "Task Engine", screen: Screen.TASKS, icon: ListTodo },
    { name: "Focus Timer", screen: Screen.TIMER, icon: Timer },
    { name: "Habits Tracker", screen: Screen.HABITS, icon: Flame },
    { name: "Journal Book", screen: Screen.JOURNAL, icon: BookOpen },
    { name: "Finance Ledger", screen: Screen.FINANCES, icon: DollarSign },
    { name: "Keep Notes", screen: Screen.KEEP_NOTES, icon: StickyNote },
    { name: "File Explorer", screen: Screen.FILE_EXPLORER, icon: HardDrive },
    { name: "Contacts & Orgs", screen: Screen.CONTACTS, icon: Users },
    { name: "Analytics Stats", screen: Screen.ANALYTICS, icon: BarChart3 },
    { name: "System Settings", screen: Screen.SETTINGS, icon: Sliders }
  ];

  const renderActiveScreen = () => {
    switch (activeScreen) {
      case Screen.DEEPA_AI:
        return <DeepaAICore />;
      case Screen.TASKS:
        return (
          <TaskEngine
            tasks={tasks}
            onAddTask={(task) => setTasks(prev => [task, ...prev])}
            onToggleComplete={(id) => setTasks(prev => prev.map(t => t.id === id ? { ...t, isCompleted: !t.isCompleted } : t))}
            onDeleteTask={(id) => setTasks(prev => prev.filter(t => t.id !== id))}
          />
        );
      case Screen.TIMER:
        return (
          <TimerView
            tasks={tasks}
            focusRecords={focusRecords}
            onAddFocusRecord={handleAddFocusRecord}
            currentUser={currentUser}
            friendsStatuses={friendsStatuses}
            myStatusNode={myStatusNode}
            myProfile={myProfile}
          />
        );
      case Screen.HABITS:
        return <HabitsTracker />;
      case Screen.JOURNAL:
        return <JournalBook />;
      case Screen.FINANCES:
        return <FinanceLedger />;
      case Screen.KEEP_NOTES:
        return <KeepNotes />;
      case Screen.FILE_EXPLORER:
        return <FileExplorerView />;
      case Screen.CONTACTS:
        return <ContactsView />;
      case Screen.ANALYTICS:
        return <AnalyticsView focusRecords={focusRecords} tasks={tasks} />;
      case Screen.SETTINGS:
        return (
          <SystemSettingsView
            myProfile={myProfile || { nickname: currentUser?.displayName?.split(" ")[0] || "User", emoji: "👤", photoURL: currentUser?.photoURL || "" }}
            onUpdateProfile={(profile) => {
              setMyProfile(profile);
              if (currentUser && !isOfflineMode) {
                const myUsername = getUsernameFromEmail(currentUser.email);
                updateMyProfile(myUsername, profile.nickname, profile.emoji, profile.photoURL);
              }
            }}
          />
        );
      default:
        return <div className="p-6 text-xs text-gray-500">Screen not implemented yet.</div>;
    }
  };

  if (authChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#02040a] text-gray-100 select-none">
        <div className="space-y-4 text-center animate-pulse">
          <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mx-auto">
            <div className="text-[8px] font-black leading-none uppercase">Life<br/>Os</div>
          </div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Synchronizing Life OS
          </h2>
          <p className="text-[9px] text-gray-600 font-mono">Connecting to high-precision secure clusters...</p>
        </div>
      </div>
    );
  }

  // Render Login page if not authenticated and not in offline test mode
  if (!currentUser && !isOfflineMode) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#02040a] text-gray-100 p-6 md:p-8 font-sans relative overflow-hidden">
        
        {/* Top Header Bar */}
        <header className="w-full max-w-7xl mx-auto flex items-center justify-between select-none shrink-0 z-10">
          {/* Logo Brand left */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg border-2 border-blue-500/50 bg-[#070e24]/70 flex flex-col items-center justify-center select-none">
              <span className="text-[7px] font-black leading-none text-blue-400 tracking-tight">LIFE</span>
              <span className="text-[7px] font-black leading-none text-blue-400 tracking-tight mt-0.5">OS</span>
            </div>
            <span className="text-sm font-extrabold tracking-widest text-white uppercase">
              LIFE OS
            </span>
          </div>

          {/* Core Version Pill right */}
          <div className="px-3.5 py-1.5 rounded-full border border-gray-900 bg-[#04060f]/65 text-[9px] font-mono tracking-widest text-gray-500 uppercase select-none">
            V2.1.0 CLOUD CORE
          </div>
        </header>

        {/* Central Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto w-full z-10 py-12">
          
          {/* Central Stacked Logo Icon with soft circular glow behind */}
          <div className="relative mb-8">
            {/* Absolute blur background layer */}
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[2rem] blur-xl opacity-30 animate-pulse" />
            
            {/* Rounded border box */}
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-[1.75rem] border-[3px] border-blue-500 bg-[#040817] flex flex-col items-center justify-center select-none shadow-[0_0_40px_rgba(37,99,235,0.25)]">
              <span className="text-xl sm:text-2xl font-black text-blue-500 tracking-wider leading-none">LIFE</span>
              <span className="text-xl sm:text-2xl font-black text-blue-500 tracking-wider leading-none mt-1">OS</span>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-wider text-white text-center uppercase leading-none px-4">
            WELCOME TO LIFE OS
          </h1>

          {/* Description */}
          <p className="text-[13px] sm:text-[14px] text-gray-400 max-w-md text-center mt-4 leading-relaxed font-normal px-4">
            Your comprehensive real-time desktop for task planning, pomodoro study sessions, journal writing, and ledger bookkeeping.
          </p>

          {/* Error message block */}
          {errorMessage && (
            <div className="mt-6 w-full max-w-sm p-3.5 bg-red-500/10 border border-red-500/15 text-red-400 rounded-xl text-xs flex items-start gap-2.5 leading-relaxed font-medium">
              <Shield className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Google Sign In Call to action button */}
          <button
            id="google_signin_btn"
            onClick={handleGoogleSignInPopup}
            className="w-full max-w-sm h-12 mt-8 flex items-center justify-center gap-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider transition-all duration-200 shadow-[0_4px_25px_rgba(37,99,235,0.4)] hover:shadow-[0_4px_30px_rgba(37,99,235,0.55)] cursor-pointer"
          >
            <LogIn className="h-4 w-4 shrink-0" />
            <span>Connect via Google Account</span>
          </button>

          {/* Security details bottom text */}
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-gray-500 uppercase tracking-widest mt-6 select-none">
            <Shield className="h-3.5 w-3.5 text-gray-500" />
            <span>Secured by Google OAuth & Firebase</span>
          </div>

          {/* Alternative utilities links */}
          <div className="flex items-center gap-3.5 mt-4 text-[10px] font-mono text-gray-600 select-none">
            <button 
              onClick={handleGoogleSignInRedirect} 
              className="hover:text-gray-400 hover:underline transition-colors cursor-pointer"
            >
              Redirect Fallback
            </button>
            <span className="text-gray-800">•</span>
            <button 
              onClick={handleContinueOffline} 
              className="hover:text-gray-400 hover:underline transition-colors cursor-pointer"
            >
              Local Sandbox Mode
            </button>
          </div>

        </div>

        {/* Global Footer */}
        <footer className="w-full text-[8px] sm:text-[9px] font-mono text-gray-600/80 uppercase tracking-[0.25em] text-center pb-4 pt-4 select-none z-10">
          POWERED BY GOOGLE CLOUD RUN CONTAINER SANDBOX & FIRESTORE
        </footer>

      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#02040a] text-gray-100 flex overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-64 border-r border-gray-900 bg-[#030712] flex flex-col shrink-0 select-none">
        {/* Brand header */}
        <div className="px-6 h-16 border-b border-gray-900 flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg border-2 border-blue-500/50 bg-[#070e24]/70 flex flex-col items-center justify-center">
            <span className="text-[7px] font-black leading-none text-blue-400 tracking-tight">LIFE</span>
            <span className="text-[7px] font-black leading-none text-blue-400 tracking-tight mt-0.5">OS</span>
          </div>
          <span className="text-sm font-extrabold tracking-widest text-white uppercase">
            LIFE OS
          </span>
        </div>

        {/* Sidebar Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = activeScreen === item.screen;
            return (
              <button
                key={item.screen}
                onClick={() => setActiveScreen(item.screen)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all cursor-pointer text-left
                  ${active 
                    ? "bg-blue-600 text-white font-bold shadow-[0_4px_15px_rgba(37,99,235,0.3)]" 
                    : "text-gray-400 hover:bg-gray-900/40 hover:text-gray-200"}`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Icon className={`h-4.5 w-4.5 shrink-0 ${active ? "text-white" : "text-gray-500"}`} />
                  <span className="text-xs truncate">{item.name}</span>
                </div>
                {active && <ChevronRight className="h-3.5 w-3.5 text-white/75" />}
              </button>
            );
          })}
        </nav>

        {/* Bottom Profile info */}
        <div className="p-3.5 border-t border-gray-900 shrink-0">
          <div className="bg-[#090d1a]/80 border border-gray-900 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-full bg-blue-600/15 border border-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold shrink-0 relative overflow-hidden">
                {myProfile?.photoURL ? (
                  <img 
                    src={myProfile.photoURL} 
                    alt="profile" 
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  myProfile?.emoji || "👤"
                )}
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[#090d1a]" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-gray-200 line-clamp-1">
                  {myProfile?.nickname || currentUser?.displayName || "Life OS User"}
                </div>
                <div className="text-[9px] font-mono text-gray-500 line-clamp-1">
                  {currentUser?.email || "sandbox@lifeos.local"}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 text-[8px] font-mono font-bold border-t border-gray-900/60 mt-1 select-none">
              <span className="text-green-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {isOfflineMode ? "SANDBOX MODE" : "RTDB-SYNC ACTIVE"}
              </span>
              <span className="text-gray-500">V2.1.0</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Right Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="bg-gray-950/40 border-b border-gray-900 px-6 h-16 flex items-center justify-between select-none shrink-0">
          <div className="flex items-center gap-3.5">
            <h1 className="text-sm font-extrabold uppercase tracking-widest text-white">
              {sidebarItems.find(item => item.screen === activeScreen)?.name || "FOCUS TIMER"}
            </h1>
            {isOfflineMode && (
              <span className="text-[8px] font-mono font-bold bg-yellow-500/10 border border-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded uppercase">
                Local Sandbox
              </span>
            )}
            {isOnline ? (
              <span className="text-[8px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-1 shrink-0 select-none">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> Online
              </span>
            ) : (
              <span className="text-[8px] font-mono font-bold bg-amber-500/10 border border-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-1 shrink-0 select-none">
                <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" /> Offline (Auto-Sync Queue Active)
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-mono font-bold rounded-full">
              Connected: {isOfflineMode ? "Local Session" : "Google Account"}
            </div>
            <span className="text-[10px] font-mono text-gray-500 hidden lg:inline">
              UTC: {new Date().toISOString().split("T")[0]}
            </span>
            <button
              onClick={handleSignOut}
              className="px-3.5 py-1.5 bg-gray-900 border border-gray-850 hover:border-gray-800 text-gray-400 hover:text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all"
            >
              {isOfflineMode ? "Return to Sign In" : "Sign Out"}
            </button>
          </div>
        </header>

        {/* Render Active View */}
        <div className="flex-1 overflow-auto p-6">
          {renderActiveScreen()}
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register Service Worker for offline capability
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[Service Worker] Registered successfully with scope:", reg.scope);
      })
      .catch((err) => {
        console.error("[Service Worker] Registration failed:", err);
      });
  });
}

