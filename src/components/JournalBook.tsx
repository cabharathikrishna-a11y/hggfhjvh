import React, { useState, useEffect } from "react";
import { Plus, BookOpen, Sparkles, Search, Trash2, Calendar, AlertCircle } from "lucide-react";
import { JournalEntry } from "../types";

export default function JournalBook() {
  const [entries, setEntries] = useState<JournalEntry[]>(() => {
    const saved = localStorage.getItem("life_os_journal_entries");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        title: "Deep Focus Mastery achieved today!",
        text: "I managed to complete 4 Pomodoro cycles of pure execution on my research middleware. The esbuild CJS configuration was tricky, but now it bundles with blazing fast speed. Focus and patience pay off.",
        dateString: "2026-07-10",
        timestamp: Date.now() - 3600 * 24 * 1000,
        attachmentsJson: "[]"
      },
      {
        id: 2,
        title: "Embracing quiet productivity",
        text: "Sometimes, the most productive day is the quietest one. No distraction, no Slack notifications, just coding, listening to ambient lofi loops, and working steadily. Staying centered in Life OS feels like a superpower.",
        dateString: "2026-07-11",
        timestamp: Date.now(),
        attachmentsJson: "[]"
      }
    ];
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);

  useEffect(() => {
    localStorage.setItem("life_os_journal_entries", JSON.stringify(entries));
  }, [entries]);

  const addEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleInput.trim() || !textInput.trim()) return;

    const newEntry: JournalEntry = {
      id: Date.now(),
      title: titleInput.trim(),
      text: textInput.trim(),
      dateString: new Date().toISOString().split("T")[0],
      timestamp: Date.now(),
      attachmentsJson: "[]"
    };

    setEntries([newEntry, ...entries]);
    setTitleInput("");
    setTextInput("");
    setSelectedEntry(newEntry);
  };

  const deleteEntry = (id: number) => {
    if (window.confirm("Are you sure you want to delete this journal entry?")) {
      setEntries(entries.filter(e => e.id !== id));
      if (selectedEntry?.id === id) {
        setSelectedEntry(null);
      }
    }
  };

  const filteredEntries = entries.filter(e => 
    e.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    e.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeEntry = selectedEntry || filteredEntries[0] || null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* List / Search Column */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl h-[560px] flex flex-col">
        <div className="space-y-2 select-none">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-500" />
            Journal Shelf
          </h2>
          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries..."
              className="w-full bg-gray-900 border border-gray-850 text-xs pl-9 pr-4 py-2 rounded-xl outline-none text-white focus:border-blue-500/50 transition-all"
            />
          </div>
        </div>

        {/* Entries list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedEntry(entry)}
              className={`w-full p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer
                ${activeEntry?.id === entry.id
                  ? "bg-blue-600/10 border-blue-500/35"
                  : "bg-gray-900/35 border-gray-850 hover:border-gray-800"}`}
            >
              <div className="flex items-center justify-between gap-2 select-none">
                <span className="text-[9px] font-mono font-bold text-blue-400">{entry.dateString}</span>
                <span className="text-[8px] font-mono text-gray-600">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <h3 className={`text-xs font-bold line-clamp-1 ${activeEntry?.id === entry.id ? "text-blue-400" : "text-white"}`}>
                {entry.title}
              </h3>
              <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed">
                {entry.text}
              </p>
            </button>
          ))}
          {filteredEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center p-6 space-y-2 h-full">
              <AlertCircle className="h-8 w-8 text-gray-600 animate-bounce" />
              <p className="text-xs text-gray-500">No journal entries found.</p>
            </div>
          )}
        </div>
      </div>

      {/* Editor & Viewer Grid */}
      <div className="lg:col-span-2 space-y-6 h-full flex flex-col">
        {/* Editor Form */}
        <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 select-none">
            <Sparkles className="h-4 w-4 text-blue-500" />
            Pen down Thoughts
          </h2>
          <form onSubmit={addEntry} className="space-y-3">
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Title your entry..."
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
              required
            />
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="What is on your mind? Log tasks accomplished, focus levels, and mindful moments..."
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white h-24 resize-none transition-all"
              required
            />
            <div className="flex justify-end select-none">
              <button
                type="submit"
                className="px-5 h-9 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/15"
              >
                <Plus className="h-4 w-4" /> Save Entry
              </button>
            </div>
          </form>
        </div>

        {/* Entry Display Area */}
        {activeEntry ? (
          <div className="flex-1 bg-[#04060f] border border-gray-900 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-gray-900 pb-3">
              <div className="flex items-center gap-2.5 select-none">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-[10px] font-mono text-gray-500">ENTRY CHRONOLOGY</h3>
                  <p className="text-xs font-bold text-white">{activeEntry.dateString} at {new Date(activeEntry.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
              <button
                onClick={() => deleteEntry(activeEntry.id)}
                className="text-gray-500 hover:text-red-400 p-2 rounded-lg border border-transparent hover:border-gray-850 hover:bg-gray-900/40 transition-all cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <h1 className="text-base font-black text-white leading-snug">
                {activeEntry.title}
              </h1>
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                {activeEntry.text}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-[#04060f] border border-gray-900 rounded-2xl p-8 shadow-2xl flex flex-col items-center justify-center text-center text-gray-600">
            <BookOpen className="h-10 w-10 mb-2.5 text-gray-750 animate-pulse" />
            <p className="text-xs">Select or add a journal entry to begin reviewing.</p>
          </div>
        )}
      </div>
    </div>
  );
}
