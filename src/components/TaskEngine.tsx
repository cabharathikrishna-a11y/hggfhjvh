import React, { useState } from "react";
import { Plus, Trash, CheckSquare, Square, Clipboard, Tag, Calendar, AlertCircle, Sparkles } from "lucide-react";
import { Task } from "../types";

interface TaskEngineProps {
  tasks: Task[];
  onAddTask: (task: Task) => void;
  onToggleComplete: (id: number) => void;
  onDeleteTask: (id: number) => void;
}

export default function TaskEngine({ tasks, onAddTask, onToggleComplete, onDeleteTask }: TaskEngineProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState("Work");
  const [newPriority, setNewPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [newMinutes, setNewMinutes] = useState(30);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newTask: Task = {
      id: Date.now(),
      title: newTitle.trim(),
      description: newDesc.trim(),
      estimatedMinutes: Number(newMinutes) || 30,
      actualMinutes: 0,
      isCompleted: false,
      parentTaskId: null,
      listCategory: newCategory,
      timeBlockTimestamp: null,
      nagModeEnabled: false,
      nagIntervalMinutes: 15,
      priority: newPriority,
      dueDateString: new Date().toISOString().split("T")[0],
      orderIndex: tasks.length + 1
    };

    onAddTask(newTask);
    setNewTitle("");
    setNewDesc("");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Creation Pane */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-500" />
          Create New Task
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Task Title *</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Code Backend Middleware"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Description</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="e.g., Use esbuild CJS module bundling..."
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white h-20 resize-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
              >
                <option value="Work">💼 Work</option>
                <option value="Personal">🏡 Personal</option>
                <option value="Health">🧘 Health</option>
                <option value="Finance">💰 Finance</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Priority</label>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as any)}
                className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
              >
                <option value="HIGH">🔴 High</option>
                <option value="MEDIUM">🟡 Medium</option>
                <option value="LOW">🔵 Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Estimated Minutes</label>
            <input
              type="number"
              value={newMinutes}
              onChange={(e) => setNewMinutes(Number(e.target.value))}
              min="1"
              max="480"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
            />
          </div>

          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/10 hover:shadow-blue-600/15"
          >
            <Plus className="h-4 w-4" /> Add Task
          </button>
        </form>
      </div>

      {/* Task List Grid */}
      <div className="lg:col-span-2 bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl h-full flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-900 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <Clipboard className="h-4 w-4 text-blue-500" />
            Your Task Database ({tasks.length})
          </h2>
          <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
            <span>COMPLETED: {tasks.filter(t => t.isCompleted).length}</span>
            <span>•</span>
            <span>PENDING: {tasks.filter(t => !t.isCompleted).length}</span>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10 space-y-2">
            <AlertCircle className="h-10 w-10 text-gray-600 animate-bounce" />
            <p className="text-xs text-gray-400">No tasks created yet. Formulate a plan on the left panel!</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[480px] pr-1">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`p-3.5 rounded-xl border flex items-start gap-3.5 transition-all
                  ${task.isCompleted 
                    ? "bg-gray-950/20 border-gray-900/60 opacity-60" 
                    : "bg-gray-900/35 border-gray-850 hover:border-gray-800"}`}
              >
                {/* Complete checkbox */}
                <button
                  onClick={() => onToggleComplete(task.id)}
                  className="mt-0.5 text-gray-500 hover:text-blue-500 transition-colors cursor-pointer"
                >
                  {task.isCompleted ? (
                    <CheckSquare className="h-5 w-5 text-blue-500" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold truncate ${task.isCompleted ? "line-through text-gray-500" : "text-white"}`}>
                      {task.title}
                    </span>
                    <span className="text-[8px] font-mono font-bold bg-blue-500/10 border border-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded uppercase">
                      {task.listCategory}
                    </span>
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase
                      ${task.priority === "HIGH" 
                        ? "bg-red-500/10 border-red-500/15 text-red-400" 
                        : task.priority === "MEDIUM"
                        ? "bg-yellow-500/10 border-yellow-500/15 text-yellow-400"
                        : "bg-green-500/10 border-green-500/15 text-green-400"}`}
                    >
                      {task.priority}
                    </span>
                  </div>
                  {task.description && (
                    <p className={`text-[10px] leading-relaxed line-clamp-2 ${task.isCompleted ? "text-gray-600" : "text-gray-400"}`}>
                      {task.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3.5 text-[9px] font-mono text-gray-500 select-none pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Due: {task.dueDateString}
                    </span>
                    <span>•</span>
                    <span>EST: {task.estimatedMinutes}m</span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  onClick={() => onDeleteTask(task.id)}
                  className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900/30 transition-all cursor-pointer"
                >
                  <Trash className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
