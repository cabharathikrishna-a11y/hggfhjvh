import React, { useState, useEffect } from "react";
import { Plus, Flame, Sparkles, CheckCircle2, Circle, AlertCircle, Trash2, Trophy } from "lucide-react";
import { Habit } from "../types";

export default function HabitsTracker() {
  const [habits, setHabits] = useState<Habit[]>(() => {
    const saved = localStorage.getItem("life_os_habits");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        name: "Morning Meditation 🧘",
        streakCount: 5,
        lastCompletedTimestamp: Date.now() - 3600 * 24 * 1000, // yesterday
        listCategory: "Mindfulness",
        timeOfDay: "Morning",
        targetCount: 1,
        frequency: "DAILY",
        weeklyDay: 1,
        monthlyStartDate: 1,
        monthlyEndDate: 30,
        orderIndex: 1,
        scheduledTime: "07:00",
        isReminderEnabled: true
      },
      {
        id: 2,
        name: "Write Code for 2 Hours 💻",
        streakCount: 12,
        lastCompletedTimestamp: Date.now(), // today
        listCategory: "Work",
        timeOfDay: "Afternoon",
        targetCount: 1,
        frequency: "DAILY",
        weeklyDay: 1,
        monthlyStartDate: 1,
        monthlyEndDate: 30,
        orderIndex: 2,
        scheduledTime: "14:00",
        isReminderEnabled: true
      },
      {
        id: 3,
        name: "Read Deep Work Book 📚",
        streakCount: 3,
        lastCompletedTimestamp: null,
        listCategory: "Growth",
        timeOfDay: "Night",
        targetCount: 1,
        frequency: "DAILY",
        weeklyDay: 1,
        monthlyStartDate: 1,
        monthlyEndDate: 30,
        orderIndex: 3,
        scheduledTime: "21:30",
        isReminderEnabled: false
      }
    ];
  });

  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Mindfulness");
  const [newTime, setNewTime] = useState("Morning");

  useEffect(() => {
    localStorage.setItem("life_os_habits", JSON.stringify(habits));
  }, [habits]);

  const addHabit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newHabit: Habit = {
      id: Date.now(),
      name: newName.trim(),
      streakCount: 0,
      lastCompletedTimestamp: null,
      listCategory: newCategory,
      timeOfDay: newTime,
      targetCount: 1,
      frequency: "DAILY",
      weeklyDay: 1,
      monthlyStartDate: 1,
      monthlyEndDate: 30,
      orderIndex: habits.length + 1,
      scheduledTime: "08:00",
      isReminderEnabled: true
    };

    setHabits([...habits, newHabit]);
    setNewName("");
  };

  const toggleComplete = (id: number) => {
    setHabits(habits.map(h => {
      if (h.id === id) {
        const isAlreadyDoneToday = h.lastCompletedTimestamp && 
          new Date(h.lastCompletedTimestamp).toDateString() === new Date().toDateString();
        
        if (isAlreadyDoneToday) {
          // Uncheck and decrement streak
          return {
            ...h,
            lastCompletedTimestamp: null,
            streakCount: Math.max(0, h.streakCount - 1)
          };
        } else {
          // Check and increment streak
          return {
            ...h,
            lastCompletedTimestamp: Date.now(),
            streakCount: h.streakCount + 1
          };
        }
      }
      return h;
    }));
  };

  const deleteHabit = (id: number) => {
    setHabits(habits.filter(h => h.id !== id));
  };

  const isCompletedToday = (h: Habit) => {
    if (!h.lastCompletedTimestamp) return false;
    return new Date(h.lastCompletedTimestamp).toDateString() === new Date().toDateString();
  };

  const totalStreak = habits.reduce((acc, h) => acc + h.streakCount, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Creation Form */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-500" />
          Initialize Habit
        </h2>
        <form onSubmit={addHabit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Habit Name *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Do 20 pushups 🧘"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Category</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
            >
              <option value="Mindfulness">🧘 Mindfulness</option>
              <option value="Work">💻 Work</option>
              <option value="Health">💪 Health</option>
              <option value="Growth">📚 Growth</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Time of Day</label>
            <select
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
            >
              <option value="Morning">🌅 Morning</option>
              <option value="Afternoon">☀️ Afternoon</option>
              <option value="Night">🌙 Night</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/10 hover:shadow-blue-600/15"
          >
            <Plus className="h-4 w-4" /> Add Habit
          </button>
        </form>

        {/* Trophy section */}
        <div className="bg-blue-600/5 border border-blue-500/10 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center text-blue-400">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Total Streaks</h3>
            <p className="text-lg font-black text-blue-400 font-mono mt-0.5">{totalStreak} Days</p>
          </div>
        </div>
      </div>

      {/* Habits List */}
      <div className="lg:col-span-2 bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col h-full">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 border-b border-gray-900 pb-3">
          <Flame className="h-4 w-4 text-blue-500" />
          Habit Trackers ({habits.length})
        </h2>

        {habits.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10 space-y-2">
            <AlertCircle className="h-10 w-10 text-gray-600 animate-bounce" />
            <p className="text-xs text-gray-400">No habits logged yet. Create a daily goal on the left panel!</p>
          </div>
        ) : (
          <div className="space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
            {habits.map((habit) => {
              const done = isCompletedToday(habit);
              return (
                <div
                  key={habit.id}
                  className={`p-3.5 rounded-xl border flex items-center gap-3.5 transition-all
                    ${done 
                      ? "bg-blue-950/10 border-blue-950/40 opacity-75" 
                      : "bg-gray-900/35 border-gray-850 hover:border-gray-800"}`}
                >
                  <button
                    onClick={() => toggleComplete(habit.id)}
                    className="text-gray-500 hover:text-blue-500 transition-colors cursor-pointer"
                  >
                    {done ? (
                      <CheckCircle2 className="h-6 w-6 text-blue-500" />
                    ) : (
                      <Circle className="h-6 w-6" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold truncate ${done ? "text-gray-400 line-through" : "text-white"}`}>
                        {habit.name}
                      </span>
                      <span className="text-[8px] font-mono font-bold bg-blue-500/10 border border-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded uppercase">
                        {habit.listCategory}
                      </span>
                      <span className="text-[8px] font-mono text-gray-500 lowercase">
                        {habit.timeOfDay}
                      </span>
                    </div>
                  </div>

                  {/* Streak tag */}
                  <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono font-bold px-2 py-1 rounded-lg">
                    <Flame className="h-3.5 w-3.5 shrink-0" />
                    <span>{habit.streakCount}</span>
                  </div>

                  <button
                    onClick={() => deleteHabit(habit.id)}
                    className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900/30 transition-all cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
