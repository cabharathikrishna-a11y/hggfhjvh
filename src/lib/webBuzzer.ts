import { ref, set, onValue } from "firebase/database";
import { database as rtdb } from "./firebase";
import { getActiveUsername } from "./webArchiver";

let audioContext: AudioContext | null = null;
let buzzerBuffer: AudioBuffer | null = null;

/**
 * 1. PRE-LOAD WEB AUDIO API (Call on user's first button click to bypass browser autoplay blocks)
 */
export async function initializeWebAudio(): Promise<void> {
  if (audioContext) return;
  
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("Web Audio API not supported in this browser.");
      return;
    }
    audioContext = new AudioContextClass();
    
    // Synthesize an alert buzzer buffer directly in memory (no external asset needed!)
    const sampleRate = audioContext.sampleRate;
    const duration = 0.5; // 500ms chime
    buzzerBuffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const channelData = buzzerBuffer.getChannelData(0);
    
    for (let i = 0; i < sampleRate * duration; i++) {
      // Generate a clean 880Hz Sine Wave (High A note) with exponential decay
      const t = i / sampleRate;
      channelData[i] = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-4 * t);
    }
    
    console.log("Web Audio API initialized and buzzer chime synthesized.");
  } catch (err) {
    console.warn("Failed to initialize Web Audio API:", err);
  }
}

/**
 * 2. SEND NUDGE BUZZER TO A FRIEND'S DEVICE
 */
export async function sendWebNudgeBuzzer(friendUsername: string): Promise<void> {
  const username = getActiveUsername();
  const triggerRef = ref(rtdb, `/bell_triggers/${friendUsername}`);
  
  await set(triggerRef, {
    sender: username,
    timestampMs: Date.now(),
    alertType: "STUDY_ACCOUNTABILITY_CHIME"
  });
  
  console.log(`Nudge buzzer fired from ${username} to ${friendUsername}!`);
}

/**
 * 3. LISTEN FOR INCOMING NUDGES, RING HARDWARE SPEAKER, & ATOMICALLY FLUSH
 */
export function listenForIncomingWebNudges(onNudgeReceived?: (sender: string) => void): () => void {
  const username = getActiveUsername();
  const myInboxRef = ref(rtdb, `/bell_triggers/${username}`);

  const unsubscribe = onValue(myInboxRef, async (snapshot) => {
    const nudgeData = snapshot.val();
    
    if (nudgeData && nudgeData.sender) {
      const sender = nudgeData.sender;
      console.log(`Incoming study nudge from peer: ${sender}!`);
      
      // Call UI callback if present
      if (onNudgeReceived) {
        onNudgeReceived(sender);
      }
      
      // A. Resume AudioContext if browser suspended it, then play synthesized chime
      if (audioContext && buzzerBuffer) {
        try {
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }
          const source = audioContext.createBufferSource();
          source.buffer = buzzerBuffer;
          source.connect(audioContext.destination);
          source.start(0);
        } catch (e) {
          console.warn("Failed to play audio chime:", e);
        }
      }
      
      // B. Trigger browser visual alert/toast
      try {
        if (typeof window !== "undefined" && window.Notification && Notification.permission === "granted") {
          new Notification("🔔 Study Accountability Alert", {
            body: `${sender} nudged you to get back to focusing!`,
            icon: "/favicon.ico"
          });
        }
      } catch (e) {
        console.warn("Notification trigger failed:", e);
      }

      // C. ATOMIC FLUSH: Delete trigger token from Firebase instantly
      await set(myInboxRef, null);
      console.log("Nudge token consumed and flushed from cloud inbox.");
    }
  });

  return unsubscribe;
}
