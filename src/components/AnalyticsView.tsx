import React, { useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Legend, Cell } from "recharts";
import { BarChart3, Clock, CheckCircle2, DollarSign, Target, Award, Sparkles, Activity } from "lucide-react";
import { FocusRecord, Task } from "../types";

interface AnalyticsViewProps {
  focusRecords: FocusRecord[];
  tasks: Task[];
}

export default function AnalyticsView({ focusRecords = [], tasks = [] }: AnalyticsViewProps) {
  // 1. Total Focused Hours
  const totalFocusedSeconds = useMemo(() => {
    return focusRecords.reduce((acc, r) => acc + (r.durationSeconds || 0), 0);
  }, [focusRecords]);

  const totalFocusedHours = (totalFocusedSeconds / 3600).toFixed(1);

  // 2. Task completion rate
  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.isCompleted).length;
    return Math.round((completed / tasks.length) * 100);
  }, [tasks]);

  // 3. Focus trends for the chart
  const focusTrendData = useMemo(() => {
    const dates: Record<string, number> = {};
    // Seed last 5 days
    for (let i = 4; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      dates[dateStr] = 0;
    }

    // Populate actuals
    focusRecords.forEach(r => {
      if (r.dateString && dates[r.dateString] !== undefined) {
        dates[r.dateString] += Math.round((r.durationSeconds || 0) / 60);
      }
    });

    return Object.entries(dates).map(([date, minutes]) => {
      const parts = date.split("-");
      const shortDate = `${parts[1]}/${parts[2]}`;
      return {
        name: shortDate,
        "Focus Minutes": minutes
      };
    });
  }, [focusRecords]);

  // 4. Task priority breakdown
  const priorityData = useMemo(() => {
    const high = tasks.filter(t => t.priority === "HIGH").length;
    const medium = tasks.filter(t => t.priority === "MEDIUM").length;
    const low = tasks.filter(t => t.priority === "LOW").length;

    return [
      { name: "High Priority", count: high, fill: "#be123c" },
      { name: "Medium Priority", count: medium, fill: "#b45309" },
      { name: "Low Priority", count: low, fill: "#047857" }
    ];
  }, [tasks]);

  return (
    <div className="space-y-6 select-none">
      {/* Upper overview widgets */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#04060f] border border-gray-900 p-4.5 rounded-2xl flex items-center gap-3.5 shadow-xl">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Focus Injected</p>
            <p className="text-lg font-black font-mono mt-0.5 text-white">{totalFocusedHours} hrs</p>
          </div>
        </div>

        <div className="bg-[#04060f] border border-gray-900 p-4.5 rounded-2xl flex items-center gap-3.5 shadow-xl">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Task Clearance</p>
            <p className="text-lg font-black font-mono mt-0.5 text-white">{completionRate}%</p>
          </div>
        </div>

        <div className="bg-[#04060f] border border-gray-900 p-4.5 rounded-2xl flex items-center gap-3.5 shadow-xl">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Sessions Logged</p>
            <p className="text-lg font-black font-mono mt-0.5 text-white">{focusRecords.length}</p>
          </div>
        </div>

        <div className="bg-[#04060f] border border-gray-900 p-4.5 rounded-2xl flex items-center gap-3.5 shadow-xl">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Award className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Accomplished Tasks</p>
            <p className="text-lg font-black font-mono mt-0.5 text-white">{tasks.filter(t => t.isCompleted).length}</p>
          </div>
        </div>
      </div>

      {/* Graphs Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Area Chart */}
        <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 shadow-2xl space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            Focus Velocity Timeline
          </h2>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={focusTrendData}>
                <defs>
                  <linearGradient id="focusColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" stroke="#4b5563" fontSize={10} />
                <YAxis stroke="#4b5563" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: "#090d16", borderColor: "#1f2937" }} />
                <Area type="monotone" dataKey="Focus Minutes" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#focusColor)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Breakdown Chart */}
        <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 shadow-2xl space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Task Priority Allocation
          </h2>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData}>
                <XAxis dataKey="name" stroke="#4b5563" fontSize={10} />
                <YAxis stroke="#4b5563" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: "#090d16", borderColor: "#1f2937" }} />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
