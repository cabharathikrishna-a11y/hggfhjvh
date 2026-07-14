import React, { useState, useEffect } from "react";
import { Plus, StickyNote, Sparkles, Pin, PinOff, Trash2, Search, AlertCircle } from "lucide-react";
import { KeepNote } from "../types";

export default function KeepNotes() {
  const [notes, setNotes] = useState<KeepNote[]>(() => {
    const saved = localStorage.getItem("life_os_keep_notes");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        title: "Product Launch Requirements 🚀",
        content: "1. Update metadata.json with correct capabilities.\n2. Ensure dev server runs on port 3000.\n3. Make sure to bundle server.ts CJS cleanly via esbuild.",
        timestamp: Date.now() - 3600 * 24 * 1000,
        isPinned: true,
        colorHex: "#1d4ed8" // Blue
      },
      {
        id: 2,
        title: "Ideas for Future Projects 💡",
        content: "- Smart calendar scheduling assistant.\n- Collaborative markdown whiteboards with Real-time DB sync.\n- Interactive habit gamification widgets.",
        timestamp: Date.now(),
        isPinned: false,
        colorHex: "#b45309" // Amber
      }
    ];
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState("#1d4ed8");

  useEffect(() => {
    localStorage.setItem("life_os_keep_notes", JSON.stringify(notes));
  }, [notes]);

  const addNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;

    const newNote: KeepNote = {
      id: Date.now(),
      title: title.trim() || "Untitled Note",
      content: content.trim(),
      timestamp: Date.now(),
      isPinned: false,
      colorHex: color
    };

    setNotes([newNote, ...notes]);
    setTitle("");
    setContent("");
  };

  const deleteNote = (id: number) => {
    setNotes(notes.filter(n => n.id !== id));
  };

  const togglePin = (id: number) => {
    setNotes(notes.map(n => n.id === id ? { ...n, isPinned: !n.isPinned } : n));
  };

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedNotes = filteredNotes.filter(n => n.isPinned);
  const unpinnedNotes = filteredNotes.filter(n => !n.isPinned);

  const colors = [
    { label: "Blue", value: "#1d4ed8" },
    { label: "Amber", value: "#b45309" },
    { label: "Emerald", value: "#047857" },
    { label: "Rose", value: "#be123c" },
    { label: "Purple", value: "#6b21a8" }
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Creation Block */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 select-none">
          <Sparkles className="h-4 w-4 text-blue-500" />
          Capture Sticky Note
        </h2>
        <form onSubmit={addNote} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Grocery Checklist"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Scribble down reminders, ideas, or temporary scratchpads..."
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white h-24 resize-none transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Color Accent</label>
            <div className="flex gap-2 pt-1 select-none">
              {colors.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-7 h-7 rounded-lg transition-transform cursor-pointer
                    ${color === c.value ? "scale-110 ring-2 ring-white border border-black" : "opacity-75 hover:opacity-100"}`}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/10"
          >
            <Plus className="h-4 w-4" /> Save Sticky Note
          </button>
        </form>
      </div>

      {/* Grid listing */}
      <div className="lg:col-span-2 space-y-5 flex flex-col h-full">
        {/* Search */}
        <div className="relative select-none">
          <Search className="absolute left-3.5 top-3 h-3.5 w-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sticky notes board..."
            className="w-full bg-gray-950 border border-gray-900 text-xs pl-9 pr-4 h-10 rounded-xl outline-none text-white focus:border-blue-500/50 transition-all shadow-xl"
          />
        </div>

        {/* Pinned section if any */}
        {pinnedNotes.length > 0 && (
          <div className="space-y-2.5">
            <h3 className="text-[10px] font-mono font-bold text-blue-400 tracking-wider uppercase select-none flex items-center gap-1">
              <Pin className="h-3 w-3" /> PINNED NOTES ({pinnedNotes.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pinnedNotes.map((note) => (
                <NoteCard key={note.id} note={note} onDelete={deleteNote} onTogglePin={togglePin} />
              ))}
            </div>
          </div>
        )}

        {/* Board grid */}
        <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[480px]">
          <h3 className="text-[10px] font-mono font-bold text-gray-500 tracking-wider uppercase select-none">
            NOTES ({unpinnedNotes.length})
          </h3>
          {unpinnedNotes.length === 0 && pinnedNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center p-12 space-y-2 h-[200px]">
              <AlertCircle className="h-8 w-8 text-gray-600 animate-bounce" />
              <p className="text-xs text-gray-500">No notes captured on your wall. Capture a quick idea!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {unpinnedNotes.map((note) => (
                <NoteCard key={note.id} note={note} onDelete={deleteNote} onTogglePin={togglePin} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface NoteCardProps {
  note: KeepNote;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
}

function NoteCard({ note, onDelete, onTogglePin }: NoteCardProps) {
  return (
    <div 
      style={{ borderLeftColor: note.colorHex }}
      className="bg-[#04060f]/60 border border-gray-900 border-l-4 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-lg hover:border-gray-800 transition-all"
    >
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3 select-none">
          <h4 className="text-xs font-bold text-white leading-tight">{note.title}</h4>
          <button
            onClick={() => onTogglePin(note.id)}
            className="text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            {note.isPinned ? <Pin className="h-3.5 w-3.5 text-blue-400" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">
          {note.content}
        </p>
      </div>

      <div className="flex items-center justify-between pt-1 select-none">
        <span className="text-[8px] font-mono text-gray-600">
          {new Date(note.timestamp).toLocaleDateString()}
        </span>
        <button
          onClick={() => onDelete(note.id)}
          className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-gray-900/40 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
