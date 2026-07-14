export interface Task {
  id: number;
  title: string;
  description: string;
  estimatedMinutes: number;
  actualMinutes: number;
  isCompleted: boolean;
  parentTaskId: number | null;
  listCategory: string;
  timeBlockTimestamp: number | null;
  nagModeEnabled: boolean;
  nagIntervalMinutes: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  dueDateString: string; // YYYY-MM-DD
  orderIndex: number;
}

export interface Habit {
  id: number;
  name: string;
  streakCount: number;
  lastCompletedTimestamp: number | null;
  listCategory: string;
  timeOfDay: string;
  targetCount: number;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "MONTHLY_ONCE";
  weeklyDay: number; // 1-7
  monthlyStartDate: number;
  monthlyEndDate: number;
  orderIndex: number;
  scheduledTime: string;
  isReminderEnabled: boolean;
}

export interface HabitCompletion {
  id: number;
  habitId: number;
  dateString: string; // YYYY-MM-DD
}

export interface JournalEntry {
  id: number;
  title: string;
  text: string;
  dateString: string; // YYYY-MM-DD
  timestamp: number;
  attachmentsJson: string; // Stringified JSON array of attachment URLs or base64
}

export interface LedgerEntry {
  id: number;
  type: "INCOME" | "EXPENSE";
  amount: number;
  categoryTag: string;
  note: string;
  timestamp: number;
}

export interface Deadline {
  id: number;
  name: string;
  targetTimestamp: number;
  isCompleted: boolean;
}

export interface FinancialGoal {
  id: number;
  name: string;
  targetAmount: number;
  type: "SAVINGS" | "BUDGET";
  categoryTag: string;
}

export interface Contact {
  id: number;
  firstName: string;
  middleName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  address: string;
  phone: string;
  dobString: string;
  anniversaryString: string;
  folder: string; // Folder organization (e.g. "Work", "Friends", "All")
  attachedFilesJson: string;
}

export interface AppFile {
  id: number;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  uriString: string;
  timestamp: number;
}

export interface FocusRecord {
  id: string;
  taskTitle: string;
  tag: string;
  notes: string;
  durationSeconds: number;
  durationMinutes: number;
  dateString: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  timestamp: number;
  isManual?: boolean;
  mode?: "POMODORO" | "STOPWATCH" | string;
}

export interface KeepNote {
  id: number;
  title: string;
  content: string;
  timestamp: number;
  isPinned: boolean;
  colorHex: string;
  isSynced?: boolean;
  websiteUrl?: string | null;
  customLogoUrl?: string | null;
}

export interface CustomList {
  id: number;
  name: string;
  colorHex: string;
  viewType: "List" | "Kanban" | "Timeline";
  parentListName: string | null;
}

export enum Screen {
  DEEPA_AI = "DEEPA_AI",
  TASKS = "TASKS",
  TIMER = "TIMER",
  HABITS = "HABITS",
  JOURNAL = "JOURNAL",
  CONTACTS = "CONTACTS",
  FINANCES = "FINANCES",
  KEEP_NOTES = "KEEP_NOTES",
  FILE_EXPLORER = "FILE_EXPLORER",
  ANALYTICS = "ANALYTICS",
  SETTINGS = "SETTINGS"
}

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  base64Image?: string | null;
  modelUsed?: string | null;
  timestamp: number;
}

export interface UserRemote {
  password?: string;
  name?: string | null;
  nickname?: string | null;
  emoji?: string | null;
  isFocusing?: boolean | null;
  accumulatedTimeMs?: number;
  lastResumeTimeMs?: number | null;
  currentTaskTitle?: string | null;
  isStopwatchMode?: boolean | null;
  lastUpdatedTimestamp?: number | null;
  focusStatus?: string | null;
  currentTag?: string | null;
  email?: string | null;
  status?: string | null;
  photoURL?: string | null;
}
