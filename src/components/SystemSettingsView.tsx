import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  Save, 
  Database, 
  RefreshCw, 
  User, 
  AlertTriangle, 
  ShieldCheck, 
  Settings, 
  ChevronRight, 
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Mail,
  Fingerprint,
  KeyRound,
  Copy,
  Info,
  Globe
} from "lucide-react";
import { auth, deleteUserAccount, executeLegacyCloudSanitization, getUsernameFromEmail } from "../lib/firebase";
import { sqliteHelper, SQLiteOperationLog } from "../lib/sqlite_helper";
import { 
  updateProfile, 
  updateEmail, 
  sendEmailVerification, 
  EmailAuthProvider, 
  GoogleAuthProvider, 
  reauthenticateWithCredential, 
  reauthenticateWithPopup 
} from "firebase/auth";

interface SystemSettingsViewProps {
  myProfile: { nickname: string; emoji: string; photoURL?: string };
  onUpdateProfile: (profile: { nickname: string; emoji: string; photoURL?: string }) => void;
}

export default function SystemSettingsView({ myProfile, onUpdateProfile }: SystemSettingsViewProps) {
  const [activePage, setActivePage] = useState<string | null>(null);
  const [nickname, setNickname] = useState(myProfile.nickname || "User");
  const [emoji, setEmoji] = useState(myProfile.emoji || "👤");
  const [photoURL, setPhotoURL] = useState(myProfile.photoURL || "");
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  // Tester Mode & DB URL Override states
  const [isTesterMode, setIsTesterMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("is_tester_mode") === "true";
    }
    return false;
  });

  const handleTesterModeToggle = (val: boolean) => {
    setIsTesterMode(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("is_tester_mode", String(val));
    }
  };

  const [dbUrlOverride, setDbUrlOverride] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("firebase_db_url_override") || "";
    }
    return "";
  });

  const [dbUrlSaveMsg, setDbUrlSaveMsg] = useState<string | null>(null);

  const handleSaveDbUrlOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      const trimmed = dbUrlOverride.trim();
      if (trimmed) {
        localStorage.setItem("firebase_db_url_override", trimmed);
      } else {
        localStorage.removeItem("firebase_db_url_override");
      }
      setDbUrlSaveMsg("Database URL override saved successfully! Please reload the page to apply changes.");
      setTimeout(() => setDbUrlSaveMsg(null), 5000);
    }
  };

  // SQLite Database states
  const [dbVersion, setDbVersion] = useState(() => sqliteHelper.getVersion());
  const [dbLogs, setDbLogs] = useState<SQLiteOperationLog[]>(() => sqliteHelper.getLogs());
  const [dbTables, setDbTables] = useState(() => sqliteHelper.getTables());

  const triggerClearDbLogs = () => {
    sqliteHelper.clearLogs();
    setDbLogs([]);
  };

  const triggerAddSampleRow = () => {
    sqliteHelper.insertActiveSession({
      session_id: "test_" + Math.random().toString(36).substring(2, 7),
      status: "FOCUSING",
      tag: ["Work", "Study", "Coding", "Review"][Math.floor(Math.random() * 4)],
      task_title: "Active Pomodoro Test " + Math.floor(Math.random() * 10),
      base_focus_time_ms: 1500000,
      last_event_ts_ms: Date.now(),
      base_focus_formatted: "00:25:00",
      last_event_formatted: new Date().toLocaleTimeString() + ":000",
      timeline_json: "[]",
      is_current_leader: 1
    });
    setDbLogs(sqliteHelper.getLogs());
    setDbTables(sqliteHelper.getTables());
  };

  // Sync state from myProfile prop changes
  useEffect(() => {
    if (myProfile) {
      setNickname(myProfile.nickname || "User");
      setEmoji(myProfile.emoji || "👤");
      setPhotoURL(myProfile.photoURL || "");
    }
  }, [myProfile]);

  // Firebase Auth detailed status/update states
  const currentUser = auth.currentUser;
  const [firebaseDisplayName, setFirebaseDisplayName] = useState(currentUser?.displayName || "");
  const [firebaseEmail, setFirebaseEmail] = useState(currentUser?.email || "");
  const [firebasePhotoURL, setFirebasePhotoURL] = useState(currentUser?.photoURL || "");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  // Re-authentication states
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<'email' | 'delete' | null>(null);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthLoading, setReauthLoading] = useState(false);

  useEffect(() => {
    if (activePage === 'profile' && auth.currentUser) {
      setFirebaseDisplayName(auth.currentUser.displayName || "");
      setFirebaseEmail(auth.currentUser.email || "");
      setFirebasePhotoURL(auth.currentUser.photoURL || "");
      setAuthMsg(null);
      setAuthErrorMsg(null);
    }
  }, [activePage, currentUser]);

  const copyUidToClipboard = () => {
    if (!auth.currentUser) return;
    navigator.clipboard.writeText(auth.currentUser.uid);
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const handleUpdateFirebaseProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    setAuthActionLoading(true);
    setAuthMsg(null);
    setAuthErrorMsg(null);
    try {
      await updateProfile(auth.currentUser, {
        displayName: firebaseDisplayName.trim(),
        photoURL: firebasePhotoURL.trim()
      });
      setAuthMsg("Firebase Authentication profile updated successfully!");
    } catch (err: any) {
      setAuthErrorMsg("Error updating profile: " + (err.message || err));
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleUpdateFirebaseEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    setAuthActionLoading(true);
    setAuthMsg(null);
    setAuthErrorMsg(null);
    try {
      await updateEmail(auth.currentUser, firebaseEmail.trim());
      setAuthMsg("Email address updated successfully in Firebase Authentication!");
    } catch (err: any) {
      if (err.code === "auth/requires-recent-login") {
        setPendingAction('email');
        setShowReauthModal(true);
        setReauthError(null);
        setAuthErrorMsg("Security authorization required to update email.");
      } else {
        setAuthErrorMsg("Error updating email: " + (err.message || err));
      }
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleDeleteFirebaseAccount = async () => {
    if (!auth.currentUser) return;
    const confirmDelete = window.confirm("WARNING: Are you absolutely sure you want to delete your cloud account permanently? This will remove your user credentials and database profile record.");
    if (!confirmDelete) return;

    setAuthActionLoading(true);
    setAuthMsg(null);
    setAuthErrorMsg(null);
    try {
      await deleteUserAccount(auth.currentUser);
      setAuthMsg("Your user account has been deleted successfully.");
    } catch (err: any) {
      if (err.code === "auth/requires-recent-login") {
        setPendingAction('delete');
        setShowReauthModal(true);
        setReauthError(null);
        setAuthErrorMsg("Security authorization required to delete account.");
      } else {
        setAuthErrorMsg("Error deleting account: " + (err.message || err));
      }
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleReauthenticateAndRetry = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!auth.currentUser) return;

    setReauthLoading(true);
    setReauthError(null);

    try {
      const isGoogleUser = auth.currentUser.providerData.some(p => p.providerId === "google.com");
      
      if (isGoogleUser) {
        const provider = new GoogleAuthProvider();
        await reauthenticateWithPopup(auth.currentUser, provider);
      } else {
        if (!reauthPassword) {
          throw new Error("Please enter your account password.");
        }
        const credential = EmailAuthProvider.credential(auth.currentUser.email || "", reauthPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
      }

      // Successful reauth! Retry pending action
      setShowReauthModal(false);
      setReauthPassword("");
      
      if (pendingAction === "email") {
        setAuthActionLoading(true);
        await updateEmail(auth.currentUser, firebaseEmail.trim());
        setAuthMsg("Email address updated successfully in Firebase Authentication!");
      } else if (pendingAction === "delete") {
        setAuthActionLoading(true);
        await deleteUserAccount(auth.currentUser);
        setAuthMsg("Your user account has been deleted successfully.");
      }
      
      setPendingAction(null);
    } catch (err: any) {
      console.error("Re-authentication failure:", err);
      let msg = err.message || "Re-authentication failed.";
      if (err.code === "auth/wrong-password") {
        msg = "Incorrect password. Please verify and try again.";
      } else if (err.code === "auth/invalid-credential") {
        msg = "Invalid password or credential configuration. Please try again.";
      }
      setReauthError(msg);
    } finally {
      setReauthLoading(false);
      setAuthActionLoading(false);
    }
  };

  const handleSendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    setAuthActionLoading(true);
    setAuthMsg(null);
    setAuthErrorMsg(null);
    try {
      await sendEmailVerification(auth.currentUser);
      setAuthMsg("Verification email sent successfully! Please check your inbox.");
    } catch (err: any) {
      setAuthErrorMsg("Error sending verification email: " + (err.message || err));
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile({ nickname: nickname.trim(), emoji, photoURL: photoURL.trim() });
    setBackupMsg("Display profile saved successfully.");
    setTimeout(() => setBackupMsg(null), 3000);
  };

  const triggerFullBackup = async () => {
    try {
      const dataToBackup = {
        tasks: JSON.parse(localStorage.getItem("life_os_tasks") || "[]"),
        habits: JSON.parse(localStorage.getItem("life_os_habits") || "[]"),
        journal_entries: JSON.parse(localStorage.getItem("life_os_journal_entries") || "[]"),
        finance_ledger: JSON.parse(localStorage.getItem("life_os_finance_ledger") || "[]"),
        keep_notes: JSON.parse(localStorage.getItem("life_os_keep_notes") || "[]"),
        files: JSON.parse(localStorage.getItem("life_os_files") || "[]"),
        contacts: JSON.parse(localStorage.getItem("life_os_contacts") || "[]")
      };

      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToBackup)
      });

      const result = await res.json();
      if (result.success) {
        setBackupMsg("System database backup saved securely to cloud server.");
      } else {
        setBackupMsg("Backup failed: " + result.error);
      }
      setTimeout(() => setBackupMsg(null), 4000);
    } catch (e: any) {
      setBackupMsg("Error executing backup: " + e.message);
      setTimeout(() => setBackupMsg(null), 4000);
    }
  };

  const triggerFullRestore = async () => {
    if (!window.confirm("Warning: Restoring backup will overwrite all current local data. Continue?")) return;
    try {
      const res = await fetch("/api/restore");
      const result = await res.json();
      if (result.success && result.data) {
        const d = result.data;
        if (d.tasks) localStorage.setItem("life_os_tasks", JSON.stringify(d.tasks));
        if (d.habits) localStorage.setItem("life_os_habits", JSON.stringify(d.habits));
        if (d.journal_entries) localStorage.setItem("life_os_journal_entries", JSON.stringify(d.journal_entries));
        if (d.finance_ledger) localStorage.setItem("life_os_finance_ledger", JSON.stringify(d.finance_ledger));
        if (d.keep_notes) localStorage.setItem("life_os_keep_notes", JSON.stringify(d.keep_notes));
        if (d.files) localStorage.setItem("life_os_files", JSON.stringify(d.files));
        if (d.contacts) localStorage.setItem("life_os_contacts", JSON.stringify(d.contacts));

        setBackupMsg("System database restored from backup successfully! Reloading page...");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setBackupMsg("No backup file found on server: " + (result.message || ""));
      }
      setTimeout(() => setBackupMsg(null), 4000);
    } catch (e: any) {
      setBackupMsg("Error executing restore: " + e.message);
      setTimeout(() => setBackupMsg(null), 4000);
    }
  };

  const purgeCache = () => {
    if (window.confirm("Warning: This will delete ALL local storage data for all modules. This is irreversible. Continue?")) {
      localStorage.clear();
      setBackupMsg("Local cache purged. Resetting database...");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };

  if (activePage === 'profile') {
    return (
      <div className="max-w-4xl mx-auto h-full space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
        <button onClick={() => setActivePage(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-bold tracking-wider cursor-pointer">
          <ArrowLeft size={16} /> BACK TO SETTINGS
        </button>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT PANEL: Ecosystem Profile (RTDB) */}
          <div className="bg-[#09090C] border border-gray-900 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden h-fit">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0" />
            
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">Ecosystem Persona</h2>
              <p className="text-xs text-gray-500 mt-1">Configure your local client-side and real-time nickname and visual avatar</p>
            </div>

            <form onSubmit={handleProfileSave} className="space-y-5">
              {/* Profile Avatar/Photo Preview */}
              <div className="flex items-center justify-center py-4">
                <div className="w-20 h-20 rounded-full bg-cyan-500/10 border-2 border-cyan-500/30 flex items-center justify-center text-3xl font-bold text-cyan-400 relative overflow-hidden">
                  {photoURL ? (
                    <img 
                      src={photoURL} 
                      alt="avatar preview" 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    emoji || "👤"
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 items-end">
                <div className="col-span-1">
                  <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Avatar</label>
                  <select
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="w-full bg-[#121216] border border-gray-800 text-base p-2 rounded-xl outline-none text-white h-12 text-center focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="👤">👤</option>
                    <option value="🧘">🧘</option>
                    <option value="💻">💻</option>
                    <option value="🚀">🚀</option>
                    <option value="🔥">🔥</option>
                    <option value="🤖">🤖</option>
                    <option value="⭐">⭐</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Display Nickname</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-[#121216] border border-gray-800 focus:border-cyan-500/50 text-sm px-4 h-12 rounded-xl outline-none text-white transition-all font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Profile Photo URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  value={photoURL}
                  onChange={(e) => setPhotoURL(e.target.value)}
                  className="w-full bg-[#121216] border border-gray-800 focus:border-cyan-500/50 text-xs px-4 h-11 rounded-xl outline-none text-white transition-all"
                />
                <p className="text-[9px] text-gray-500 mt-1.5 font-mono">
                  Link an external image or use your Google profile photo.
                </p>
              </div>

              {backupMsg && (
                <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs rounded-xl flex items-center gap-2 font-mono">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>{backupMsg}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full h-12 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-cyan-600/20"
              >
                <Save className="h-4 w-4" /> SAVE PERSONA PREFERENCES
              </button>
            </form>
          </div>

          {/* RIGHT PANEL: Firebase Authentication Account Center */}
          <div className="bg-[#09090C] border border-gray-900 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0" />
            
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-white">Firebase Authentication Account</h2>
                <p className="text-xs text-gray-500 mt-1">Manage cloud credentials, email validation, and provider channels</p>
              </div>
              <div className="px-2.5 py-1 text-[9px] font-mono rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 uppercase tracking-widest">
                Active Cloud Session
              </div>
            </div>

            {currentUser ? (
              <div className="space-y-6">
                {/* Auth Success / Error Alerts */}
                {authMsg && (
                  <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-start gap-2.5 font-mono animate-in fade-in duration-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{authMsg}</span>
                  </div>
                )}
                {authErrorMsg && (
                  <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-start gap-2.5 font-mono animate-in fade-in duration-200">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{authErrorMsg}</span>
                  </div>
                )}

                {/* Core Account Info */}
                <div className="bg-[#121216] border border-gray-800/80 rounded-xl p-4 space-y-3.5">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Account UID</span>
                    <button 
                      onClick={copyUidToClipboard}
                      className="flex items-center gap-1.5 hover:text-blue-400 text-[10px] text-gray-400 font-mono transition-colors bg-[#09090C] border border-gray-800 px-2.5 py-1 rounded cursor-pointer"
                    >
                      <Fingerprint size={12} className="text-blue-500" />
                      <span>{currentUser.uid.substring(0, 10)}...</span>
                      <Copy size={11} />
                      {copiedUid && <span className="text-[9px] text-emerald-400 ml-1">Copied!</span>}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Verification Status</span>
                    {currentUser.emailVerified ? (
                      <div className="flex items-center gap-1 text-emerald-400 font-bold text-xs bg-emerald-500/5 px-2.5 py-1 rounded border border-emerald-500/15">
                        <CheckCircle2 size={13} />
                        <span>Email Verified</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-amber-500 font-bold text-xs bg-amber-500/5 px-2.5 py-1 rounded border border-amber-500/15">
                          <XCircle size={13} />
                          <span>Unverified</span>
                        </div>
                        <button
                          onClick={handleSendVerificationEmail}
                          disabled={authActionLoading}
                          className="h-7 text-[10px] px-3 font-mono font-bold bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/25 hover:border-blue-500/40 text-blue-400 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                        >
                          Send Verification Mail
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Edit Basic Profile Form */}
                <form onSubmit={handleUpdateFirebaseProfile} className="space-y-4">
                  <div className="border-t border-gray-800/80 pt-4">
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <User size={13} className="text-cyan-400" /> Update User Profile
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Firebase Display Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Jane Doe"
                          value={firebaseDisplayName}
                          onChange={(e) => setFirebaseDisplayName(e.target.value)}
                          className="w-full bg-[#121216] border border-gray-800 focus:border-blue-500/50 text-xs px-3.5 h-10 rounded-xl outline-none text-white transition-all font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Firebase Photo URL</label>
                        <input
                          type="url"
                          placeholder="https://example.com/photo.jpg"
                          value={firebasePhotoURL}
                          onChange={(e) => setFirebasePhotoURL(e.target.value)}
                          className="w-full bg-[#121216] border border-gray-800 focus:border-blue-500/50 text-xs px-3.5 h-10 rounded-xl outline-none text-white transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={authActionLoading}
                    className="w-full h-10 bg-blue-600/10 hover:bg-blue-600/15 active:bg-blue-600/25 border border-blue-500/25 hover:border-blue-500/40 text-blue-400 font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Save size={13} /> SAVE FIREBASE PROFILE METADATA
                  </button>
                </form>

                {/* Edit Email Address Form */}
                <form onSubmit={handleUpdateFirebaseEmail} className="space-y-4 border-t border-gray-800/80 pt-4">
                  <div>
                    <h3 className="text-[11px] font-bold text-white uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <Mail size={13} className="text-amber-500" /> Set Email Address
                    </h3>
                    <p className="text-[10px] text-gray-500 mb-3 font-sans leading-relaxed">
                      Note: Changing your cloud email address might require re-authentication (signing out and back in) for safety validation.
                    </p>
                    <div className="relative">
                      <input
                        type="email"
                        required
                        placeholder="user@example.com"
                        value={firebaseEmail}
                        onChange={(e) => setFirebaseEmail(e.target.value)}
                        className="w-full bg-[#121216] border border-gray-800 focus:border-blue-500/50 text-xs pl-3.5 pr-32 h-10 rounded-xl outline-none text-white transition-all font-mono"
                      />
                      <button
                        type="submit"
                        disabled={authActionLoading || firebaseEmail.trim() === currentUser.email}
                        className="absolute right-1.5 top-1.5 bottom-1.5 text-[9px] px-3 font-mono font-bold bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/25 hover:border-amber-500/45 text-amber-400 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        UPDATE EMAIL
                      </button>
                    </div>
                  </div>
                </form>

                {/* Linked Provider Profiles Loop */}
                <div className="border-t border-gray-800/80 pt-5 space-y-3">
                  <h3 className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Globe size={13} className="text-purple-400" /> Linked Sign-in Providers
                  </h3>
                  <p className="text-[10px] text-gray-500 leading-normal">
                    This user account is bound through the following Identity Provider (IdP) credentials from your `providerData` array:
                  </p>
                  
                  <div className="space-y-3">
                    {currentUser.providerData.map((profile, i) => (
                      <div key={i} className="bg-[#121216] border border-gray-800/60 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between border-b border-gray-800/50 pb-1.5">
                          <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest font-black">
                            {profile.providerId === "password" ? "📧 EMAIL & PASSWORD" : `🔗 ${profile.providerId.toUpperCase()}`}
                          </span>
                          <span className="text-[9px] font-mono text-gray-600">IDP #{i + 1}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
                          <div className="flex flex-col">
                            <span className="text-gray-600 uppercase text-[8px] tracking-wider">Provider UID</span>
                            <span className="text-gray-400 truncate">{profile.uid}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-gray-600 uppercase text-[8px] tracking-wider">Display Name</span>
                            <span className="text-gray-400 truncate">{profile.displayName || "N/A"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-gray-600 uppercase text-[8px] tracking-wider">Email Address</span>
                            <span className="text-gray-400 truncate">{profile.email || "N/A"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-gray-600 uppercase text-[8px] tracking-wider">Photo URL</span>
                            <span className="text-gray-400 truncate">{profile.photoURL || "N/A"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cloud Danger Zone - Delete User Account */}
                <div className="border-t border-red-900/40 pt-5 space-y-3">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-red-500 uppercase tracking-wider">
                    <AlertTriangle size={14} className="text-red-500" /> Account Danger Zone
                  </div>
                  <p className="text-[10px] text-gray-500 leading-normal font-sans">
                    Once deleted, your cloud login credentials and real-time database profile will be removed instantly.
                  </p>
                  <button
                    type="button"
                    onClick={handleDeleteFirebaseAccount}
                    disabled={authActionLoading}
                    className="w-full h-11 bg-red-950/20 border border-red-900/40 hover:bg-red-900/30 hover:border-red-500/50 text-red-400 font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <XCircle size={14} /> DELETE CLOUD ACCOUNT PERMANENTLY
                  </button>
                </div>

              </div>
            ) : (
              <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl text-center space-y-2">
                <Info size={20} className="text-amber-500 mx-auto" />
                <p className="text-xs text-gray-400">
                  Firebase Authentication is in Sandbox/Offline simulation mode. Connect to a Cloud Account to view and update credentials.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Re-authentication Dialog Modal */}
        {showReauthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-[#09090C] border border-gray-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-500" />
              
              <div className="flex items-start gap-3">
                <div className="bg-amber-500/10 p-2.5 rounded-xl text-amber-500 border border-amber-500/20">
                  <KeyRound size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">Security Validation Required</h3>
                  <p className="text-xs text-gray-400 mt-1 leading-normal font-sans">
                    The action you are performing is sensitive and requires high-security verification. Please re-authenticate your session to continue.
                  </p>
                </div>
              </div>

              {reauthError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center gap-2 font-mono">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>{reauthError}</span>
                </div>
              )}

              <form onSubmit={handleReauthenticateAndRetry} className="space-y-4">
                {currentUser && currentUser.providerData.some(p => p.providerId === "google.com") ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-gray-500 leading-normal font-sans">
                      You logged in via Google. Click the button below to secure re-authorization through Google Auth.
                    </p>
                    <button
                      type="submit"
                      disabled={reauthLoading}
                      className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {reauthLoading ? "Authorizing..." : "RE-AUTHENTICATE WITH GOOGLE"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">
                        Confirm Account Password
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={reauthPassword}
                        onChange={(e) => setReauthPassword(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-800 bg-[#02040a] text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={reauthLoading}
                      className="w-full h-11 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {reauthLoading ? "Verifying..." : "VERIFY PASSWORD & CONTINUE"}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowReauthModal(false);
                    setPendingAction(null);
                    setReauthPassword("");
                    setReauthError(null);
                  }}
                  className="w-full h-10 bg-transparent border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-white font-bold rounded-xl text-xs tracking-wider transition-all cursor-pointer"
                >
                  CANCEL ACTION
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activePage === 'system') {
    return (
      <div className="max-w-2xl mx-auto h-full space-y-6 pb-12 animate-in fade-in slide-in-from-right-4 duration-300">
        <button onClick={() => setActivePage(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-bold tracking-wider cursor-pointer">
          <ArrowLeft size={16} /> BACK TO SETTINGS
        </button>

        <div className="bg-[#09090C] border border-gray-900 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0" />
          
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-white">System & Diagnostics</h2>
            <p className="text-xs text-gray-500 mt-1">Configure development tools, tester interception, and custom connection properties.</p>
          </div>

          {/* Tester Mode Section */}
          <div className="bg-[#121216] border border-gray-800/80 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-white font-bold text-sm tracking-wide">Developer Tester Mode</div>
                <div className="text-gray-500 text-xs leading-normal">
                  Activating Tester Mode intercepts all network writes and prevents outbound auto-sync operations from leaking test data to production.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={isTesterMode} 
                  onChange={(e) => handleTesterModeToggle(e.target.checked)} 
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
              </label>
            </div>
            {isTesterMode && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs rounded-xl flex items-center gap-2 font-mono">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Tester Mode is Active. Network writes will be intercepted.</span>
              </div>
            )}
          </div>

          {/* Firebase Database URL Override Section */}
          <div className="bg-[#121216] border border-gray-800/80 rounded-xl p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-white font-bold text-sm tracking-wide">Realtime Database URL Override</div>
              <div className="text-gray-500 text-xs leading-normal">
                Override the default Firebase Realtime Database URL to target an alternative sandboxed instance or local emulator. Leave empty to restore defaults.
              </div>
            </div>

            <form onSubmit={handleSaveDbUrlOverride} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="https://your-custom-db.firebaseio.com"
                  value={dbUrlOverride}
                  onChange={(e) => setDbUrlOverride(e.target.value)}
                  className="w-full bg-[#09090C] border border-gray-800 focus:border-blue-500/50 text-xs px-3.5 h-10 rounded-xl outline-none text-white transition-all font-mono"
                />
              </div>

              {dbUrlSaveMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-2 font-mono">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{dbUrlSaveMsg}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/20"
              >
                <Save className="h-4 w-4" /> SAVE CONNECTION OVERRIDE
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (activePage === 'data') {
    return (
      <div className="max-w-2xl mx-auto h-full space-y-6 pb-12 animate-in fade-in slide-in-from-right-4 duration-300">
        <button onClick={() => setActivePage(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-bold tracking-wider">
          <ArrowLeft size={16} /> BACK TO SETTINGS
        </button>

        {/* Regular Data Management */}
        <div className="bg-[#09090C] border border-gray-900 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500/0 via-amber-500/50 to-amber-500/0" />
          
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-white">Data & Connections</h2>
            <p className="text-xs text-gray-500 mt-1">JSON backup/restore, Drive sync, permissions, database tools</p>
          </div>

          {backupMsg && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs rounded-xl flex items-center gap-2 font-mono">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>{backupMsg}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={triggerFullBackup}
                className="flex-1 h-12 bg-[#121216] border border-gray-800 hover:border-amber-500/50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Database className="h-4 w-4 text-amber-500" /> BACKUP DATABASE
              </button>
              <button
                onClick={triggerFullRestore}
                className="flex-1 h-12 bg-[#121216] border border-gray-800 hover:border-amber-500/50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RefreshCw className="h-4 w-4 text-emerald-400" /> RESTORE DATABASE
              </button>
            </div>

            <div className="border-t border-gray-800 pt-5 space-y-3 mt-4">
              <div className="flex items-center gap-2 text-[10px] font-mono text-red-400 uppercase font-bold">
                <AlertTriangle className="h-4 w-4" /> Danger Zone
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Purging local data will clear all stored checklists, custom financial logs, and sticky notes completely. This action cannot be reversed.
              </p>
              <button
                onClick={purgeCache}
                className="w-full h-12 bg-red-950/30 border border-red-900/50 hover:bg-red-900/50 hover:border-red-500/50 text-red-400 text-xs font-bold rounded-xl flex items-center justify-center transition-all cursor-pointer"
              >
                PURGE LOCAL CACHE & DATABASE
              </button>
            </div>
          </div>
        </div>

        {/* SQLite Local Schema Manager */}
        <div className="bg-[#09090C] border border-gray-900 rounded-2xl p-6 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0" />
          
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">SQLite (Room) Database Console</h2>
              <p className="text-xs text-gray-500 mt-1">Local Android/Web database schema visualizer and event logging console</p>
            </div>
            <div className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider">
              ACID Engine Active
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-mono text-gray-400 uppercase tracking-widest block">Simulation Tools</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={triggerAddSampleRow}
                className="flex-1 h-11 border border-gray-800 hover:border-gray-700 bg-[#121216] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                INSERT ACTIVE SESSION ROW
              </button>
              <button
                onClick={triggerClearDbLogs}
                className="flex-1 h-11 bg-[#121216] border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5 text-gray-500" />
                CLEAR SQL CONSOLE LOGS
              </button>
            </div>
          </div>

          {/* Table Visualizer */}
          <div className="bg-[#050507] border border-gray-900 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-blue-500" />
              Active Database Tables
            </h3>
            
            <div className="space-y-3 font-mono text-[11px] text-gray-400">
              {Object.keys(dbTables).length === 0 ? (
                <div className="text-gray-600 py-2">No tables found.</div>
              ) : (
                Object.keys(dbTables).map((tableName) => (
                  <div key={tableName} className="border border-gray-900 rounded-lg p-3 bg-black/40">
                    <div className="flex justify-between border-b border-gray-900 pb-2 mb-2">
                      <span className="text-emerald-400 font-bold">TABLE {tableName}</span>
                      <span className="text-gray-600">{dbTables[tableName].length} rows</span>
                    </div>
                    {dbTables[tableName].length === 0 ? (
                      <div className="text-gray-700 py-1">Empty set (0.00 sec)</div>
                    ) : (
                      <div className="overflow-x-auto max-h-40 overflow-y-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-gray-900 text-gray-500">
                              {Object.keys(dbTables[tableName][0]).map((k) => (
                                <th key={k} className="pb-1 pr-4 font-bold">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dbTables[tableName].map((row, idx) => (
                              <tr key={idx} className="border-b border-gray-950 hover:bg-white/5">
                                {Object.keys(row).map((k) => (
                                  <td key={k} className="py-1 pr-4 text-gray-300 truncate max-w-[120px]">
                                    {typeof row[k] === "object" ? JSON.stringify(row[k]) : String(row[k])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Console */}
          <div className="bg-black border border-gray-900 rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center border-b border-gray-900 pb-2">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">SQLite Console Logs</span>
              <span className="text-[9px] text-gray-600 font-mono">Ready</span>
            </div>
            <div className="h-32 overflow-y-auto font-mono text-[10px] space-y-1.5 pr-2 custom-scrollbar">
              {dbLogs.length === 0 ? (
                <div className="text-gray-700 font-mono text-[10px]">No events logged. Database is idle.</div>
              ) : (
                dbLogs.slice().reverse().map((log, index) => (
                  <div key={index} className="flex gap-2 font-mono text-[10px]">
                    <span className="text-gray-600 shrink-0">{log.timestamp}</span>
                    <span className={`shrink-0 ${
                      log.type === "success" ? "text-emerald-500" :
                      log.type === "sql" ? "text-blue-400 font-bold" :
                      log.type === "warn" ? "text-amber-500" : "text-gray-500"
                    }`}>
                      [{log.type.toUpperCase()}]
                    </span>
                    <span className="text-gray-300 break-all">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto h-full space-y-6 select-none animate-in fade-in duration-300">
      
      {/* Header matching Android */}
      <div className="bg-[#09090C] rounded-2xl p-5 border border-blue-500/20 shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="bg-blue-500/15 p-3 rounded-full text-blue-500 border border-blue-500/30">
            <Settings size={22} />
          </div>
          <div>
            <h1 className="text-white font-black text-base tracking-wide uppercase">Settings Center</h1>
            <p className="text-gray-400 text-xs mt-1">Configure and personalize your localized Life OS experience.</p>
          </div>
        </div>
      </div>

      {/* Group 1: Core Settings */}
      <div className="bg-[#09090C] rounded-2xl border border-gray-900 shadow-xl overflow-hidden">
        <div className="bg-[#121216] px-5 py-3 border-b border-gray-900">
          <h2 className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Core Settings</h2>
        </div>
        
        <div className="p-2">
          {/* SYSTEM & DIAGNOSTICS */}
          <button onClick={() => setActivePage('system')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 rounded-xl text-left transition-colors group cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="bg-blue-500 p-2.5 rounded-full text-black"><Settings size={20} /></div>
              <div>
                <div className="text-white font-bold text-sm tracking-wide group-hover:text-blue-500 transition-colors">SYSTEM & DIAGNOSTICS</div>
                <div className="text-gray-500 text-xs mt-0.5">General options, background diagnostics, updates</div>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-600 group-hover:text-blue-500 transition-colors" />
          </button>
          
          <div className="h-px bg-gray-900 ml-16 mr-4 my-1" />

          {/* AI & USER PROFILE */}
          <button onClick={() => setActivePage('profile')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 rounded-xl text-left transition-colors group">
            <div className="flex items-center gap-4">
              <div className="bg-cyan-400 p-2.5 rounded-full text-black"><User size={20} /></div>
              <div>
                <div className="text-white font-bold text-sm tracking-wide group-hover:text-cyan-400 transition-colors">AI & USER PROFILE</div>
                <div className="text-gray-500 text-xs mt-0.5">Personalize profile, edit nickname, identity</div>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
          </button>

          <div className="h-px bg-gray-900 ml-16 mr-4 my-1" />

          {/* DATA & CONNECTIONS */}
          <button onClick={() => setActivePage('data')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 rounded-xl text-left transition-colors group">
            <div className="flex items-center gap-4">
              <div className="bg-amber-500 p-2.5 rounded-full text-black"><Database size={20} /></div>
              <div>
                <div className="text-white font-bold text-sm tracking-wide group-hover:text-amber-500 transition-colors">DATA & CONNECTIONS</div>
                <div className="text-gray-500 text-xs mt-0.5">JSON backup/restore, cache, database tools</div>
              </div>
            </div>
            <ChevronRight size={18} className="text-gray-600 group-hover:text-amber-500 transition-colors" />
          </button>
        </div>
      </div>
    </div>
  );
}
