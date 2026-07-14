import React, { useState, useEffect } from "react";
import { Plus, DollarSign, ArrowUpRight, ArrowDownRight, Trash2, Sliders, Sparkles, AlertCircle } from "lucide-react";
import { LedgerEntry } from "../types";

export default function FinanceLedger() {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => {
    const saved = localStorage.getItem("life_os_finance_ledger");
    return saved ? JSON.parse(saved) : [
      {
        id: 1,
        type: "INCOME",
        amount: 2500,
        categoryTag: "Salary",
        note: "Stripe development contract payout",
        timestamp: Date.now() - 3600 * 24 * 3 * 1000
      },
      {
        id: 2,
        type: "EXPENSE",
        amount: 85,
        categoryTag: "Utilities",
        note: "AI Cloud Run hosting subscription",
        timestamp: Date.now() - 3600 * 24 * 1000
      }
    ];
  });

  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [category, setCategory] = useState("Food");
  const [note, setNote] = useState("");

  useEffect(() => {
    localStorage.setItem("life_os_finance_ledger", JSON.stringify(entries));
  }, [entries]);

  const addEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    const newEntry: LedgerEntry = {
      id: Date.now(),
      type,
      amount: parsedAmount,
      categoryTag: category,
      note: note.trim(),
      timestamp: Date.now()
    };

    setEntries([newEntry, ...entries]);
    setAmount("");
    setNote("");
  };

  const deleteEntry = (id: number) => {
    setEntries(entries.filter(e => e.id !== id));
  };

  const totalIncome = entries.filter(e => e.type === "INCOME").reduce((acc, e) => acc + e.amount, 0);
  const totalExpense = entries.filter(e => e.type === "EXPENSE").reduce((acc, e) => acc + e.amount, 0);
  const netBalance = totalIncome - totalExpense;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full items-start">
      {/* Input Side */}
      <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 select-none">
          <Sparkles className="h-4 w-4 text-blue-500" />
          Log Transaction
        </h2>
        <form onSubmit={addEntry} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2 select-none">
              <button
                type="button"
                onClick={() => setType("INCOME")}
                className={`h-10 rounded-xl text-xs font-bold transition-all border cursor-pointer
                  ${type === "INCOME"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-gray-900/40 border-gray-850 text-gray-400 hover:border-gray-850"}`}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => setType("EXPENSE")}
                className={`h-10 rounded-xl text-xs font-bold transition-all border cursor-pointer
                  ${type === "EXPENSE"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-gray-900/40 border-gray-850 text-gray-400 hover:border-gray-850"}`}
              >
                Expense
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Amount ($) *</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all font-mono"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-2.5 py-2.5 rounded-xl outline-none text-white transition-all"
            >
              <option value="Salary">💼 Contract / Salary</option>
              <option value="Food">🍔 Food & Dining</option>
              <option value="Utilities">💡 Utilities & Cloud</option>
              <option value="Transport">🚗 Travel & Cab</option>
              <option value="Entertainment">🎮 Entertainment</option>
              <option value="Miscellaneous">📦 Misc Purchases</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-gray-500 uppercase mb-1">Memo / Notes</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional brief description..."
              className="w-full bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-3 py-2.5 rounded-xl outline-none text-white transition-all"
            />
          </div>

          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/10"
          >
            <Plus className="h-4 w-4" /> Log Transaction
          </button>
        </form>
      </div>

      {/* Stats and list side */}
      <div className="lg:col-span-2 space-y-6">
        {/* Stats dashboard cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 select-none">
          <div className="bg-[#04060f] border border-gray-900 p-4 rounded-2xl flex items-center gap-3.5 shadow-xl">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Net Balance</p>
              <p className={`text-base font-black font-mono mt-0.5 ${netBalance >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                ${netBalance.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="bg-[#04060f] border border-gray-900 p-4 rounded-2xl flex items-center gap-3.5 shadow-xl">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Inflow</p>
              <p className="text-base font-black font-mono mt-0.5 text-emerald-400">
                +${totalIncome.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="bg-[#04060f] border border-gray-900 p-4 rounded-2xl flex items-center gap-3.5 shadow-xl">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <ArrowDownRight className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[9px] font-mono font-bold text-gray-500 uppercase">Outflow</p>
              <p className="text-base font-black font-mono mt-0.5 text-red-400">
                -${totalExpense.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* List ledger entries */}
        <div className="bg-[#04060f] border border-gray-900 rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col h-[400px]">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2 border-b border-gray-900 pb-3 select-none">
            <Sliders className="h-4 w-4 text-blue-500" />
            Ledger Audit Trail ({entries.length})
          </h2>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 bg-gray-900/35 border border-gray-850 hover:border-gray-800 rounded-xl flex items-center justify-between gap-4 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border
                    ${entry.type === "INCOME" 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                      : "bg-red-500/10 border-red-500/20 text-red-400"}`}
                  >
                    {entry.type === "INCOME" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-white uppercase font-mono bg-gray-950 px-1.5 py-0.5 rounded border border-gray-850">
                        {entry.categoryTag}
                      </span>
                      {entry.note && (
                        <span className="text-[10px] text-gray-400 truncate max-w-[180px]">
                          {entry.note}
                        </span>
                      )}
                    </div>
                    <span className="text-[8px] font-mono text-gray-500 block mt-0.5 select-none">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold font-mono ${entry.type === "INCOME" ? "text-emerald-400" : "text-red-400"}`}>
                    {entry.type === "INCOME" ? "+" : "-"}${entry.amount.toFixed(2)}
                  </span>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg border border-transparent hover:border-gray-800 hover:bg-gray-900/30 transition-all cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {entries.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center p-10 space-y-2 h-full">
                <AlertCircle className="h-8 w-8 text-gray-600 animate-bounce" />
                <p className="text-xs text-gray-500">No ledger statements found. Log earnings or hosting costs!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
