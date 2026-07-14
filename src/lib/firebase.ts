/// <reference types="vite/client" />
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import { getAnalytics, logEvent } from "firebase/analytics";
import { 
  getMessaging, 
  onMessage, 
  isSupported, 
  register, 
  onRegistered, 
  getToken 
} from "firebase/messaging";
import { FocusRecord } from "../types.ts";
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser
} from "firebase/auth";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  onValue, 
  off, 
  update, 
  child,
  DataSnapshot,
  runTransaction,
  push,
  serverTimestamp
} from "firebase/database";
import { getFirestore, doc, setDoc, increment } from "firebase/firestore";
import { getWebDeviceId } from "./deviceIdProvider";
const getFirebaseConfig = () => {
  let dbUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://lifeosca-default-rtdb.asia-southeast1.firebasedatabase.app";
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("firebase_db_url_override");
    if (override) {
      dbUrl = override;
    }
  }
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCiyyZNqnelPBIyFCstHZ80hvgn1at1Gow",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "lifeosca.firebaseapp.com",
    databaseURL: dbUrl,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "lifeosca",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "lifeosca.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "432934819080",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:432934819080:web:4e951a330c742a5abcc8bd",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-V8W5Z3N2P9"
  };
};

const firebaseConfig = getFirebaseConfig();

import { getStorage, ref as storageRef, getDownloadURL } from "firebase/storage";

const app = initializeApp(firebaseConfig);

// Initialize Firebase Analytics
export let analytics: any = null;
if (typeof window !== "undefined") {
  try {
    analytics = getAnalytics(app);
    console.log("[Analytics] Firebase Analytics initialized successfully with measurementId:", firebaseConfig.measurementId);
  } catch (err) {
    console.warn("[Analytics] Firebase Analytics initialization failed/skipped:", err);
  }
}

/**
 * Utility to log standard and custom events to Firebase Analytics
 */
export const logFirebaseEvent = (eventName: string, eventParams?: Record<string, any>) => {
  if (analytics) {
    try {
      logEvent(analytics, eventName, eventParams);
      console.log(`[Analytics] Logged event: "${eventName}"`, eventParams);
    } catch (err) {
      console.warn(`[Analytics] Failed to log event "${eventName}":`, err);
    }
  }
};

// Initialize App Check for local debugging and reCAPTCHA Enterprise
if (typeof window !== "undefined") {
  (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = "C3E6F273-8953-4466-AA23-C274E4D6F598";
}

export let appCheck: any = null;
if (typeof window !== "undefined") {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider("6Lf61EwtAAAAAMvpiXdg6Kv-A4Ke3GPo4nuN3IIe"),
      isTokenAutoRefreshEnabled: true
    });
    console.log("[Firebase] App Check (reCAPTCHA Enterprise) initialized successfully.");
  } catch (err) {
    console.warn("[Firebase] App Check (reCAPTCHA Enterprise) initialization skipped/failed:", err);
  }
}

// Initialize the Firebase AI Logic backend service (Gemini Developer API)
export const aiService = getAI(app, { backend: new GoogleAIBackend() });
export const generativeModel = getGenerativeModel(aiService, { model: "gemini-3.5-flash" });

export const auth = getAuth(app);
export const database = getDatabase(app);
export const firestore = getFirestore(app);
export const storage = getStorage(app);

// Server time offset synchronization for timezone & clock alignment between devices
let serverTimeOffset = 0;
if (typeof window !== "undefined") {
  try {
    const offsetRef = ref(database, ".info/serverTimeOffset");
    onValue(offsetRef, (snapshot) => {
      const val = snapshot.val();
      if (typeof val === "number") {
        serverTimeOffset = val;
        console.log("[Firebase Server Time] Synchronized offset updated:", val, "ms");
      }
    });
  } catch (err) {
    console.error("[Firebase Server Time] Failed to register offset listener:", err);
  }
}

export const getServerTime = (): number => {
  return Date.now() + serverTimeOffset;
};

// -----------------------------------------------------------------------------
// PROFILE IMAGE CACHING PROTOCOL (IndexedDB + localStorage)
// -----------------------------------------------------------------------------

const openImageDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ProfileImageCacheDB", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getCachedBlob = async (username: string): Promise<Blob | null> => {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const transaction = db.transaction("images", "readonly");
      const store = transaction.objectStore("images");
      const req = store.get(username);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

const saveCachedBlob = async (username: string, blob: Blob): Promise<void> => {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const transaction = db.transaction("images", "readwrite");
      const store = transaction.objectStore("images");
      const req = store.put(blob, username);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {}
};

export const getProfileImageUrl = async (username: string, photoUpdatedAt: number): Promise<string> => {
  const cacheKey = `img_updated_${username}`;
  const storedTimestamp = localStorage.getItem(cacheKey);

  if (storedTimestamp && Number(storedTimestamp) === photoUpdatedAt) {
    const cachedBlob = await getCachedBlob(username);
    if (cachedBlob) {
      return URL.createObjectURL(cachedBlob);
    }
  }

  try {
    const imgPath = `profile_pictures/${username}.jpg`;
    const imageRef = storageRef(storage, imgPath);
    const downloadUrl = await getDownloadURL(imageRef);
    
    const response = await fetch(downloadUrl);
    const blob = await response.blob();
    
    await saveCachedBlob(username, blob);
    localStorage.setItem(cacheKey, String(photoUpdatedAt));
    
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn("Failed to fetch/cache profile image:", error);
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
  }
};

export const getGoogleProvider = (withWorkspaceScopes: boolean = true): GoogleAuthProvider => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({
    prompt: "select_account"
  });
  
  if (withWorkspaceScopes) {
    p.addScope("https://www.googleapis.com/auth/calendar");
    p.addScope("https://www.googleapis.com/auth/calendar.events");
    p.addScope("https://www.googleapis.com/auth/drive.file");
    p.addScope("https://www.googleapis.com/auth/drive.readonly");
    p.addScope("https://www.googleapis.com/auth/spreadsheets");
    p.addScope("https://www.googleapis.com/auth/documents");
    p.addScope("https://www.googleapis.com/auth/tasks");
    p.addScope("https://www.googleapis.com/auth/contacts");
    p.addScope("https://www.googleapis.com/auth/contacts.readonly");
    p.addScope("https://www.googleapis.com/auth/drive.metadata.readonly");
  }
  
  p.addScope("https://www.googleapis.com/auth/userinfo.profile");
  p.addScope("https://www.googleapis.com/auth/userinfo.email");
  
  return p;
};

export interface AuthLogEntry {
  timestamp: string;
  type: "info" | "warn" | "error" | "success";
  message: string;
  details?: any;
}

class AuthDebugLogger {
  private logs: AuthLogEntry[] = [];
  private listeners: ((logs: AuthLogEntry[]) => void)[] = [];

  constructor() {
    // Add logger to window for quick console diagnostics
    if (typeof window !== "undefined") {
      (window as any).authLogger = this;
    }
  }

  log(type: "info" | "warn" | "error" | "success", message: string, details?: any) {
    const entry: AuthLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      details: details ? this.sanitize(details) : undefined
    };
    this.logs.push(entry);
    console.log(`[AuthDebugLogger] [${type.toUpperCase()}] ${message}`, details || "");
    this.listeners.forEach(listener => listener([...this.logs]));
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.listeners.forEach(listener => listener([]));
    this.log("info", "Auth log cleared");
  }

  subscribe(listener: (logs: AuthLogEntry[]) => void) {
    this.listeners.push(listener);
    listener([...this.logs]);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private sanitize(val: any): any {
    try {
      // Prevent cyclic reference crashes and format errors nicely
      const seen = new WeakSet();
      return JSON.parse(JSON.stringify(val, (key, value) => {
        if (value instanceof Error) {
          const error: any = {};
          Object.getOwnPropertyNames(value).forEach((k) => {
            error[k] = (value as any)[k];
          });
          return error;
        }
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      }));
    } catch (e) {
      return String(val);
    }
  }
}

export const authLogger = new AuthDebugLogger();

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Real-time listener unsubscribers
let friendsListenerUnsubscribe: (() => void) | null = null;
let bellListenerUnsubscribe: (() => void) | null = null;

// Initialize auth state listener.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (reason?: string) => void
) => {
  authLogger.log("info", "Initializing Firebase Auth State subscription");
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      authLogger.log("info", "Firebase Auth state changed: Logged In", {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        hasCachedToken: !!cachedAccessToken
      });

      const username = getUsernameFromEmail(user.email || "");
      if (username) {
        try {
          const userRef = ref(database, `users/${username}`);
          const snapshot = await get(userRef);
          if (!snapshot.exists()) {
            authLogger.log("info", "User authenticated but no profile found in RTDB. Auto-registering...");
            await registerUserInDb(user);
          }
        } catch (err) {
          console.error("Failed to verify or register user registration in RTDB:", err);
          await signOut(auth).catch(() => {});
          cachedAccessToken = null;
          if (onAuthFailure) onAuthFailure();
          return;
        }
      }

      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        authLogger.log("warn", "User is logged in, but cachedAccessToken was missing from flow. Triggering callback with empty token.");
        if (onAuthSuccess) onAuthSuccess(user, "");
      }
    } else {
      authLogger.log("info", "Firebase Auth state changed: Logged Out");
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Help diagnose browser sandbox environment constraints
const getDiagnosticReport = (withWorkspaceScopes: boolean = true) => {
  const report: any = {
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    isIframe: typeof window !== "undefined" && window.self !== window.top,
    location: typeof window !== "undefined" ? window.location.href : "unknown",
    cookiesEnabled: typeof navigator !== "undefined" ? navigator.cookieEnabled : "unknown",
  };

  // Test local/session storage support
  try {
    localStorage.setItem("__auth_diag_test__", "1");
    localStorage.removeItem("__auth_diag_test__");
    report.localStorageAccess = "granted";
  } catch (e: any) {
    report.localStorageAccess = "blocked";
    report.localStorageAccessError = e?.message || String(e);
  }

  // Auth provider settings
  try {
    const prov = getGoogleProvider(withWorkspaceScopes);
    report.providerId = prov.providerId;
    report.withWorkspaceScopes = withWorkspaceScopes;
  } catch (e) {}

  return report;
};

// Sign in with Google (Popup)
export const googleSignIn = async (withWorkspaceScopes: boolean = true): Promise<{ user: User; accessToken: string } | null> => {
  authLogger.log("info", "Initiating googleSignIn (Popup method)", getDiagnosticReport(withWorkspaceScopes));
  try {
    isSigningIn = true;
    authLogger.log("info", "Calling Firebase signInWithPopup...");
    const prov = getGoogleProvider(withWorkspaceScopes);
    const result = await signInWithPopup(auth, prov);
    
    authLogger.log("success", "Successfully finished signInWithPopup", {
      uid: result.user.uid,
      displayName: result.user.displayName,
      email: result.user.email
    });

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      const tokenError = new Error("Failed to retrieve access token from Google Auth Provider");
      authLogger.log("error", "Google credential missing access token", { result });
      throw tokenError;
    }
    
    cachedAccessToken = credential.accessToken;
    authLogger.log("info", "Retrieved Google API access token securely");

    // Auto-save user to RTDB "/users" structure
    authLogger.log("info", "Registering user in Realtime Database...", { email: result.user.email });
    await registerUserInDb(result.user);
    authLogger.log("success", "User profile successfully registered in RTDB database");
    
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    authLogger.log("error", "Exception in googleSignIn (Popup)", {
      code: error.code,
      message: error.message,
      customData: error.customData,
      email: error.email,
      credential: error.credential,
      stack: error.stack
    });
    console.error("Firebase Sign-in Error:", error);
    await signOut(auth).catch(() => {});
    cachedAccessToken = null;
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Sign in with Google (Redirect)
export const googleSignInRedirect = async (withWorkspaceScopes: boolean = true): Promise<void> => {
  authLogger.log("info", "Initiating googleSignInRedirect (Redirect method)", getDiagnosticReport(withWorkspaceScopes));
  try {
    isSigningIn = true;
    authLogger.log("info", "Calling Firebase signInWithRedirect...");
    const prov = getGoogleProvider(withWorkspaceScopes);
    await signInWithRedirect(auth, prov);
  } catch (error: any) {
    authLogger.log("error", "Exception in googleSignInRedirect", {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    console.error("Firebase Redirect Sign-in Error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Handle redirect result on load
export const handleRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  authLogger.log("info", "Checking handleRedirectResult on app load", getDiagnosticReport());
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      authLogger.log("success", "Successfully resolved redirect sign-in result", {
        uid: result.user.uid,
        displayName: result.user.displayName,
        email: result.user.email
      });

      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
        authLogger.log("info", "Retrieved Google API access token via redirect credential");
        
        await registerUserInDb(result.user);
        authLogger.log("success", "User profile registered in RTDB via redirect flow");
        return { user: result.user, accessToken: cachedAccessToken };
      } else {
        authLogger.log("warn", "Redirect sign-in completed but did not yield an access token.");
      }
    } else {
      authLogger.log("info", "No redirect sign-in result detected (standard page load)");
    }
    return null;
  } catch (error: any) {
    authLogger.log("error", "Exception in handleRedirectResult", {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    console.error("Redirect auth retrieval failed:", error);
    await signOut(auth).catch(() => {});
    cachedAccessToken = null;
    throw error;
  }
};

// Helper: Register/Update user metadata in RTDB
export const registerUserInDb = async (user: User) => {
  const username = getUsernameFromEmail(user.email || "");
  if (!username) return;

  const userRef = ref(database, `users/${username}`);
  const snapshot = await get(userRef);
  const existingData = snapshot.exists() ? snapshot.val() : {};
  
  const isPasswordUser = user.providerData.some(p => p.providerId === "password");

  const updatePayload = {
    name: user.displayName || user.email?.split("@")[0] || "Email User",
    nickname: existingData.nickname || user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "User",
    emoji: existingData.emoji || "👨‍💻",
    email: user.email,
    photoURL: user.photoURL || existingData.photoURL || "",
    isGoogleUser: !isPasswordUser,
    status: "active",
    lastUpdatedTimestamp: Date.now()
  };

  await update(userRef, updatePayload);
};

// Sign in with Email and Password
export const emailPasswordSignIn = async (email: string, password: string): Promise<User> => {
  authLogger.log("info", "Initiating emailPasswordSignIn", { email });
  try {
    isSigningIn = true;
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    authLogger.log("success", "Successfully signed in with email/password", {
      uid: userCredential.user.uid,
      email: userCredential.user.email
    });
    // Ensure RTDB user profile exists
    await registerUserInDb(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    authLogger.log("error", "Exception in emailPasswordSignIn", {
      code: error.code,
      message: error.message
    });
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Sign up / Create User with Email and Password
export const emailPasswordSignUp = async (email: string, password: string, displayName: string): Promise<User> => {
  authLogger.log("info", "Initiating emailPasswordSignUp", { email, displayName });
  try {
    isSigningIn = true;
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Update auth profile displayName
    await updateProfile(userCredential.user, { displayName });
    
    authLogger.log("success", "Successfully created user with email/password", {
      uid: userCredential.user.uid,
      email: userCredential.user.email,
      displayName
    });
    
    // Explicitly write profile to RTDB users ref
    await registerUserInDb(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    authLogger.log("error", "Exception in emailPasswordSignUp", {
      code: error.code,
      message: error.message
    });
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Delete user profile from RTDB
export const deleteUserFromDb = async (email: string) => {
  const username = getUsernameFromEmail(email);
  if (!username) return;
  const userRef = ref(database, `users/${username}`);
  await set(userRef, null);
};

// Delete user account from Firebase Auth
export const deleteUserAccount = async (user: User) => {
  authLogger.log("info", "Initiating deleteUserAccount", { uid: user.uid, email: user.email });
  try {
    const email = user.email;
    // First remove profile from RTDB
    if (email) {
      await deleteUserFromDb(email).catch((e) => {
        authLogger.log("warn", "Failed to clean up user profile from database during deletion", { error: e.message });
      });
    }
    // Delete authentication user
    await deleteUser(user);
    authLogger.log("success", "Successfully deleted user account from Firebase Auth");
  } catch (error: any) {
    authLogger.log("error", "Exception in deleteUserAccount", {
      code: error.code,
      message: error.message
    });
    throw error;
  }
};

// Log Out
export const googleSignOut = async () => {
  const user = auth.currentUser;
  if (user) {
    const username = getUsernameFromEmail(user.email || "");
    if (username) {
      // Set status to idle/logged_out in RTDB
      await update(ref(database, `users/${username}`), {
        status: "logged_out",
        isFocusing: false,
        focusStatus: "idle"
      });
      // Delete any active focus session record
      await removeFocusRecordFromDb(username, `active_${username}`).catch(() => {});
    }
  }
  
  if (friendsListenerUnsubscribe) {
    friendsListenerUnsubscribe();
    friendsListenerUnsubscribe = null;
  }
  if (bellListenerUnsubscribe) {
    bellListenerUnsubscribe();
    bellListenerUnsubscribe = null;
  }

  await signOut(auth);
  cachedAccessToken = null;
};

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

// Utility: parse username from email
export const getUsernameFromEmail = (email: string | null): string => {
  if (!email) return "";
  return email.toLowerCase().trim().split("@")[0].replace(/[.\#$\[\]]/g, "_"); // sanitize for firebase path
};

/**
 * One-Time RTDB Legacy Sanitizer to prune legacy root nodes
 */
export const executeLegacyCloudSanitization = async (username: string): Promise<{ success: boolean; executed: boolean; message: string }> => {
  const MIGRATION_FLAG_KEY = "is_migrated_to_v2";
  const migrationRef = ref(database, `users/${username}/${MIGRATION_FLAG_KEY}`);
  
  try {
    const snapshot = await get(migrationRef);
    if (!snapshot.exists() || snapshot.val() !== true) {
      console.log("Legacy configuration detected! Initiating cloud sanitization for:", username);
      
      // 1. Wipe old legacy folders that bloat RTDB bandwidth
      await set(ref(database, `users/${username}/focus_records`), null);
      await set(ref(database, `users/${username}/history_logs`), null);
      await set(ref(database, `users/${username}/old_timer_settings`), null);
      
      // 2. Reset the active session scratchpad to a clean IDLE state
      const cleanIdleState = {
        status: "IDLE",
        baseFocusTimeMs: 0,
        lastEventTimestampMs: Date.now(),
        timeline: null
      };
      await set(ref(database, `users/${username}/active_session`), cleanIdleState);
      
      // 3. Stamp migration flag so this cleanup never runs again
      await set(migrationRef, true);
      
      console.log("Cloud sanitization complete! RTDB Hot Node is now 100% clean.");
      return { success: true, executed: true, message: "Cloud sanitization completed successfully. Legacy data pruned." };
    } else {
      console.log("Cloud sanitization skipped: already migrated to V2 for:", username);
      return { success: true, executed: false, message: "Cloud sanitization skipped. Node is already on V2." };
    }
  } catch (err: any) {
    console.error("Cloud sanitization failed:", err);
    return { success: false, executed: false, message: `Sanitization failed: ${err.message || err}` };
  }
};

// Update custom profile metadata (nickname, emoji, photoURL)
export const updateMyProfile = async (email: string | null, nickname: string, emoji: string, photoURL?: string) => {
  const username = getUsernameFromEmail(email);
  if (!username) return;
  const userRef = ref(database, `users/${username}`);
  await update(userRef, {
    nickname,
    emoji,
    photoURL: photoURL || "",
    lastUpdatedTimestamp: Date.now()
  });
};

// -----------------------------------------------------------------------------
// REALTIME DATABASE SYNC ACTIONS (THIN CLIENT TRANSACTIONS & LISTENERS)
// -----------------------------------------------------------------------------

// Isolated Realtime Listeners
export const listenToActiveTimer = (username: string, callback: (data: any) => void): (() => void) => {
  if (!username) return () => {};
  const timerRef = ref(database, `users/${username}/active_session`);
  const onValueCallback = (snapshot: DataSnapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  };
  onValue(timerRef, onValueCallback);
  return () => {
    off(timerRef, "value", onValueCallback);
  };
};

/**
 * Lamport Monotonic Guard on /active_session:
 * Protects the hot active_session node with a transaction.
 * If incomingPayload.lastEventTimestampMs <= cloudServer.lastEventTimestampMs, the write is rejected
 * and the winning cloud state is returned so the client can rollback.
 */
export const syncActiveSessionToRtdb = async (
  username: string,
  payload: any
): Promise<{ success: boolean; rollbackState?: any }> => {
  if (!username) return { success: false };
  const sessionRef = ref(database, `users/${username}/active_session`);

  let rollbackState: any = null;
  let success = false;

  try {
    const txResult = await runTransaction(sessionRef, (currentCloudState) => {
      const incomingTs = payload.lastEventTsMs ?? payload.lastEventTimestampMs ?? Date.now();

      if (currentCloudState) {
        const cloudTs = currentCloudState.lastEventTsMs ?? currentCloudState.lastEventTimestampMs ?? 0;
        if (incomingTs <= cloudTs) {
          // Reject incoming write! Abort transaction by returning undefined
          rollbackState = currentCloudState;
          return; 
        }
      }

      // Accept incoming payload
      success = true;
      return {
        ...currentCloudState,
        ...payload,
        // Enforce both timestamp formats for safety across platforms
        lastEventTsMs: incomingTs,
        lastEventTimestampMs: incomingTs
      };
    });

    if (txResult.committed && success) {
      await syncUserRootFromTimer(username, txResult.snapshot.val());
      return { success: true };
    } else {
      return { success: false, rollbackState };
    }
  } catch (err) {
    console.error("[Lamport Guard] Transaction error for user", username, err);
    return { success: false };
  }
};

export const listenToTimerSettings = (username: string, callback: (data: any) => void): (() => void) => {
  if (!username) return () => {};
  const settingsRef = ref(database, `users/${username}/timer_settings`);
  const onValueCallback = (snapshot: DataSnapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  };
  onValue(settingsRef, onValueCallback);
  return () => {
    off(settingsRef, "value", onValueCallback);
  };
};

export const saveTimerSettings = async (username: string, settings: {
  timerDurationMinutes?: number;
  stopwatchBreakDurationMinutes?: number;
  autoStartBreak?: boolean;
  autoStartPomo?: boolean;
  autoStartStopwatchAfterBreak?: boolean;
  publicPresenceVisible?: boolean;
}) => {
  if (!username) return;

  // Step 1: Save Payload Into Cloud Firestore Vault first
  const configDocRef = doc(firestore, "users", username, "timer", "config");
  await setDoc(configDocRef, settings, { merge: true }).catch(err => {
    console.error("Error saving config to Firestore:", err);
  });

  // Legacy fallback: update RTDB timer_settings for instant local/peer updates
  const settingsRef = ref(database, `users/${username}/timer_settings`);
  await update(settingsRef, settings).catch(err => {
    console.error("Error saving timer settings to RTDB:", err);
  });

  // Step 2: Signal Emitted — Write universal atomic timestamp to RTDB profileLastUpdatedTs
  const signalRef = ref(database, `users/${username}/timer/profileLastUpdatedTs`);
  await set(signalRef, serverTimestamp()).catch(err => {
    console.error("Error pinging signal node profileLastUpdatedTs:", err);
  });
};


// One-time profile fetcher
export const toggleWebSessionMode = async (username: string, toPomodoro: boolean) => {
  if (!username) return;
  const timerRef = ref(database, `users/${username}/active_timer`);
  await update(timerRef, {
    isStopwatchMode: !toPomodoro,
    mode: toPomodoro ? "POMODORO" : "STOPWATCH",
    lastUpdatedTimestamp: Date.now()
  });
};

export const fetchUserProfile = async (username: string): Promise<any> => {
  if (!username) return null;
  const userRef = ref(database, `users/${username}`);
  const snapshot = await get(userRef);
  return snapshot.exists() ? snapshot.val() : null;
};

// Thin-Client Transactions
const syncUserRootFromTimer = async (username: string, timerData: any) => {
  if (!username || !timerData) return;
  const userRootRef = ref(database, `users/${username}`);
  await update(userRootRef, {
    isFocusing: timerData.status === "FOCUSING",
    focusStatus: timerData.status,
    lastResumeTimeMs: timerData.status === "FOCUSING" ? timerData.startTimeMs : null,
    accumulatedTimeMs: timerData.accumulatedFocusMs || 0,
    isStopwatchMode: !!timerData.isStopwatchMode,
    mode: timerData.mode || (timerData.isStopwatchMode ? "STOPWATCH" : "POMODORO"),
    currentTaskTitle: timerData.taskTitle || null,
    lastUpdatedTimestamp: getServerTime()
  }).catch((err) => { console.error("syncUserRootFromTimer error:", err); });
};

/**
 * @deprecated Use local sqliteHelper / Dexie outbox queue routing instead.
 * Directly starting a thin-client web session.
 */
export const startWebSession = async (username: string, taskTitle: string, tag: string, isStopwatchMode?: boolean, durationMinutes?: number) => {
  if (!username) return;
  const timerRef = ref(database, `users/${username}/active_timer`);
  const txResult = await runTransaction(timerRef, (currentData) => {
    const now = getServerTime();
    
    // Check if we are resuming a paused session
    if (currentData && (currentData.status === "PAUSED" || currentData.status === "BREAK")) {
      const existingIsStopwatchMode = currentData.isStopwatchMode ?? !!isStopwatchMode;
      const existingMode = currentData.mode || (existingIsStopwatchMode ? "STOPWATCH" : "POMODORO");
      if (currentData.status === "BREAK") {
        const focusMs = currentData.accumulatedFocusMs || 0;
        return {
          ...currentData,
          status: "FOCUSING",
          mode: existingMode,
          isStopwatchMode: existingIsStopwatchMode,
          startTimeMs: now,
          targetEndTimeMs: (!existingIsStopwatchMode && durationMinutes) ? (now + Math.max(0, (durationMinutes * 60 * 1000) - focusMs)) : 0,
          focusDurationMinutes: durationMinutes || null,
          lastUpdatedTimestamp: now
        };
      }

      const isBreak = currentData.pausedFromStatus === "BREAK";
      const focusMs = currentData.accumulatedFocusMs || 0;
      const breakMs = currentData.accumulatedBreakMs || 0;
      
      if (isBreak) {
        // Resume break phase
        const bMins = currentData.breakDurationMinutes || 5;
        const breakDurationMs = bMins * 60 * 1000;
        return {
          ...currentData,
          status: "BREAK",
          mode: existingMode,
          isStopwatchMode: existingIsStopwatchMode,
          startTimeMs: now,
          targetEndTimeMs: now + Math.max(0, breakDurationMs - breakMs),
          lastUpdatedTimestamp: now
        };
      } else {
        // Resume focus phase
        const fMins = durationMinutes || 25;
        const focusDurationMs = fMins * 60 * 1000;
        return {
          ...currentData,
          status: "FOCUSING",
          mode: existingMode,
          isStopwatchMode: existingIsStopwatchMode,
          startTimeMs: now,
          targetEndTimeMs: (!existingIsStopwatchMode && durationMinutes) ? (now + Math.max(0, focusDurationMs - focusMs)) : 0,
          focusDurationMinutes: durationMinutes || null,
          lastUpdatedTimestamp: now
        };
      }
    }
    
    // Otherwise, starting a completely brand-new session (reset focus accumulation to 0)
    return {
      status: "FOCUSING",
      mode: isStopwatchMode ? "STOPWATCH" : "POMODORO",
      isStopwatchMode: !!isStopwatchMode,
      startTimeMs: now,
      accumulatedFocusMs: 0,
      accumulatedBreakMs: 0,
      taskTitle: taskTitle || "General Focus",
      tag: tag || "Study",
      targetEndTimeMs: (!isStopwatchMode && durationMinutes) ? (now + durationMinutes * 60 * 1000) : 0,
      focusDurationMinutes: durationMinutes || null,
      lastUpdatedTimestamp: now
    };
  });
  if (txResult.committed && txResult.snapshot.exists()) {
    await syncUserRootFromTimer(username, txResult.snapshot.val());
  }
};

export const startWebBreak = async (username: string, durationMinutes: number, isStopwatchMode?: boolean) => {
  if (!username) return;
  const timerRef = ref(database, `users/${username}/active_timer`);
  const txResult = await runTransaction(timerRef, (currentData) => {
    const now = getServerTime();
    let focusMs = currentData?.accumulatedFocusMs || 0;
    if (currentData?.status === "FOCUSING" && currentData?.startTimeMs) {
      focusMs += (now - currentData.startTimeMs);
    }
    const finalIsStopwatch = currentData?.isStopwatchMode !== undefined ? currentData.isStopwatchMode : (isStopwatchMode ?? false);
    return {
      status: "BREAK",
      mode: finalIsStopwatch ? "STOPWATCH" : "POMODORO",
      isStopwatchMode: finalIsStopwatch,
      startTimeMs: now,
      accumulatedFocusMs: focusMs,
      accumulatedBreakMs: 0,
      taskTitle: "Taking a Break",
      tag: "Break",
      breakDurationMinutes: durationMinutes,
      targetEndTimeMs: now + (durationMinutes * 60 * 1000),
      lastUpdatedTimestamp: now
    };
  });
  if (txResult.committed && txResult.snapshot.exists()) {
    await syncUserRootFromTimer(username, txResult.snapshot.val());
  }
};

export const updateTimerTaskAndTag = async (username: string, taskTitle: string, tag: string) => {
  if (!username) return;
  const timerRef = ref(database, `users/${username}/active_timer`);
  await update(timerRef, {
    taskTitle: taskTitle || "General Focus",
    tag: tag || "Study"
  });
  const userRootRef = ref(database, `users/${username}`);
  await update(userRootRef, {
    currentTaskTitle: taskTitle || "General Focus"
  }).catch((err) => { console.error("updateTimerTaskAndTag error:", err); });
};

export const pauseWebSession = async (username: string, isStopwatchMode?: boolean) => {
  if (!username) return;
  const timerRef = ref(database, `users/${username}/active_timer`);
  const txResult = await runTransaction(timerRef, (currentData) => {
    const now = getServerTime();
    if (!currentData) {
      return {
        status: "PAUSED",
        mode: isStopwatchMode ? "STOPWATCH" : "POMODORO",
        isStopwatchMode: !!isStopwatchMode,
        startTimeMs: 0,
        accumulatedFocusMs: 0,
        taskTitle: "",
        tag: "",
        lastUpdatedTimestamp: now
      };
    }
    let additional = 0;
    if (currentData.status === "FOCUSING" && currentData.startTimeMs) {
      additional = now - currentData.startTimeMs;
    }
    return {
      ...currentData,
      status: "PAUSED",
      mode: currentData.mode || (isStopwatchMode ? "STOPWATCH" : "POMODORO"),
      isStopwatchMode: currentData.isStopwatchMode !== undefined ? currentData.isStopwatchMode : !!isStopwatchMode,
      startTimeMs: 0,
      accumulatedFocusMs: (currentData.accumulatedFocusMs || 0) + additional,
      lastUpdatedTimestamp: now
    };
  });
  if (txResult.committed && txResult.snapshot.exists()) {
    await syncUserRootFromTimer(username, txResult.snapshot.val());
  }
};

/**
 * @deprecated Use local sqliteHelper / Dexie outbox queue routing instead.
 * Directly ending a thin-client web session.
 */
export const endWebSession = async (username: string, isStopwatchMode?: boolean) => {
  if (!username) return { status: "RELAXING" };
  const timerRef = ref(database, `users/${username}/active_timer`);
  const txResult = await runTransaction(timerRef, (currentData) => {
    const now = getServerTime();
    const tzOffset = -new Date().getTimezoneOffset();
    
    let focusMs = 0;
    let breakMs = 0;
    
    if (currentData) {
      focusMs = currentData.accumulatedFocusMs || 0;
      if (currentData.status === "FOCUSING" && currentData.startTimeMs) {
        focusMs += (now - currentData.startTimeMs);
      }
      
      breakMs = currentData.accumulatedBreakMs || 0;
      if (currentData.status === "BREAK" && currentData.startTimeMs) {
        breakMs += (now - currentData.startTimeMs);
      }
    }
    
    const finalIsStopwatch = currentData ? !!currentData.isStopwatchMode : !!isStopwatchMode;
    return {
      status: "RELAXING",
      mode: finalIsStopwatch ? "STOPWATCH" : "POMODORO",
      isStopwatchMode: finalIsStopwatch,
      startTimeMs: 0,
      accumulatedFocusMs: focusMs,
      accumulatedBreakMs: breakMs,
      timezoneOffsetMinutes: tzOffset,
      taskTitle: currentData?.taskTitle || "General Focus",
      tag: currentData?.tag || "Study",
      lastUpdatedTimestamp: now
    };
  });
  if (txResult.committed && txResult.snapshot.exists()) {
    await syncUserRootFromTimer(username, txResult.snapshot.val());
  }
  return { status: "RELAXING" };
};

// Ring focus bell / reminder for a friend
export const ringFriendBell = async (targetUsername: string, senderName: string, senderUsername: string) => {
  if (!targetUsername) return;
  const bellRef = ref(database, `bells/${targetUsername}`);
  await set(bellRef, {
    senderUsername,
    senderDisplayName: senderName,
    timestamp: Date.now(),
    isProcessed: false
  });
};

// Clear active bell
export const clearMyBell = async (myUsername: string) => {
  if (!myUsername) return;
  const bellRef = ref(database, `bells/${myUsername}`);
  await set(bellRef, null);
};

// Listen to all users' real-time statuses
export const listenToAllUsers = (onUpdate: (usersMap: Record<string, any>) => void): (() => void) => {
  const usersRef = ref(database, "users");
  const callback = (snapshot: DataSnapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.val());
    } else {
      onUpdate({});
    }
  };
  onValue(usersRef, callback);
  
  friendsListenerUnsubscribe = () => {
    off(usersRef, "value", callback);
  };
  return friendsListenerUnsubscribe;
};

// Listen to my reminder bell in real-time
export const listenToMyBell = (myUsername: string, onUpdate: (bellSignal: any) => void): (() => void) => {
  if (!myUsername) return () => {};
  const bellRef = ref(database, `bells/${myUsername}`);
  const callback = (snapshot: DataSnapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.val());
    } else {
      onUpdate(null);
    }
  };
  onValue(bellRef, callback);
  
  bellListenerUnsubscribe = () => {
    off(bellRef, "value", callback);
  };
  return bellListenerUnsubscribe;
};

// Add a focus record directly to Cloud Firestore (Bypassing RTDB!)
export const addFocusRecordToDb = async (username: string, record: FocusRecord) => {
  if (!username) return;
  const tzOffset = -new Date().getTimezoneOffset();
  const dbRecord = {
    id: record.id,
    taskTitle: record.taskTitle || "General Focus",
    tag: record.tag || "Study",
    notes: record.notes || "",
    durationSeconds: Number(record.durationSeconds) || 0,
    durationMinutes: Number(record.durationMinutes) || 0,
    dateString: record.dateString || new Date(record.timestamp).toISOString().split("T")[0],
    startTime: record.startTime || "00:00",
    endTime: record.endTime || "00:00",
    timestamp: Number(record.timestamp) || Date.now(),
    totalFocusTimeMs: (Number(record.durationSeconds) || 0) * 1000,
    totalBreakTimeMs: 0,
    timezoneOffsetMinutes: tzOffset,
    mode: record.mode || "POMODORO",
    lastModifiedMs: Number((record as any).lastModifiedMs) || Date.now(),
    sourceDeviceId: getWebDeviceId()
  };

  try {
    // 1. Save focus record document in daily_records subcollection under timer in Cloud Firestore
    const recordRef = doc(firestore, `users/${username}/timer/daily_records`, record.id);
    await setDoc(recordRef, dbRecord);

    // 2. Update daily folder stats with atomic increments under timer
    const folderSummaryRef = doc(firestore, `users/${username}/timer/daily_folders`, dbRecord.dateString);
    await setDoc(folderSummaryRef, {
      totalDurationSeconds: increment(dbRecord.durationSeconds),
      totalSessions: increment(1),
      dateString: dbRecord.dateString,
      lastUpdated: Date.now()
    }, { merge: true });

    console.log(`[Firestore Direct Vault] Saved record '${dbRecord.taskTitle}' (${dbRecord.tag}) and updated summary for ${dbRecord.dateString}.`);
  } catch (err) {
    console.error("[Firestore Direct Vault] Error writing focus record to Cloud Firestore:", err);
    throw err;
  }
};

// Remove a focus record from history_logs
export const removeFocusRecordFromDb = async (username: string, recordId: string) => {
  if (!username) return;
  const path = `users/${username}/history_logs/${recordId}`;
  await set(ref(database, path), null).catch(err => {
    console.error("Error deleting focus record:", err);
  });
};

/**
 * @deprecated Use local manualLogEngine or sqliteHelper instead.
 * Submits a manual focus entry request to the user's thin-client queue.
 * Strictly uses Firebase push() to add an object:
 * { focusMinutes, reason, timestamp: serverTimestamp(), timezoneOffsetMinutes }
 * to /users/{username}/manual_entry_requests
 */
export const submitManualEntry = async (
  username: string,
  focusMinutes: number,
  reason: string
): Promise<void> => {
  if (!username) {
    throw new Error("Username is required to submit manual entry.");
  }
  const queueRef = ref(database, `users/${username}/manual_entry_requests`);
  const newEntryRef = push(queueRef);
  await set(newEntryRef, {
    focusMinutes,
    reason,
    timestamp: serverTimestamp(),
    timezoneOffsetMinutes: -new Date().getTimezoneOffset()
  });
};

// -----------------------------------------------------------------------------
// FIREBASE CLOUD MESSAGING (FCM) SERVICES
// -----------------------------------------------------------------------------

export let messaging: any = null;
let fcmSupported = false;

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    fcmSupported = supported;
    if (supported) {
      try {
        messaging = getMessaging(app);
        console.log("[FCM] Firebase Cloud Messaging initialized successfully.");
      } catch (err) {
        console.warn("[FCM] Failed to initialize Messaging instance:", err);
      }
    } else {
      console.log("[FCM] Messaging is not supported in this browser context.");
    }
  }).catch((err) => {
    console.warn("[FCM] Support check error:", err);
  });
}

/**
 * Checks if FCM is supported in the current environment
 */
export const checkFCMSupport = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
};

/**
 * Request notification permission from the user
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    throw new Error("Notifications are not supported in this environment.");
  }
  return await Notification.requestPermission();
};

/**
 * Registers callback for receiving the Firebase Installation ID (FID)
 */
export const onFCMRegistered = (callback: (installationId: string) => void) => {
  if (!messaging) return () => {};
  try {
    return onRegistered(messaging, callback);
  } catch (err) {
    console.error("[FCM] Error setting onRegistered listener:", err);
    return () => {};
  }
};

/**
 * Registers the service worker & subscribes to push notifications
 */
export const registerFCMServiceWorker = async (vapidKey: string): Promise<void> => {
  if (!messaging) {
    throw new Error("FCM is not initialized or not supported on this browser.");
  }
  
  console.log("[FCM] Registering service worker with VAPID key:", vapidKey);
  await register(messaging, { vapidKey });
};

/**
 * Retrieves the standard registration token (traditional style)
 */
export const getFCMToken = async (vapidKey: string): Promise<string | null> => {
  if (!messaging) return null;
  try {
    return await getToken(messaging, { vapidKey });
  } catch (err) {
    console.error("[FCM] Error getting registration token:", err);
    throw err;
  }
};

/**
 * Registers callback for foreground messages
 */
export const onFCMForegroundMessage = (callback: (payload: any) => void) => {
  if (!messaging) return () => {};
  try {
    return onMessage(messaging, callback);
  } catch (err) {
    console.error("[FCM] Error setting onMessage listener:", err);
    return () => {};
  }
};



