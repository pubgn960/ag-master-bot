import React, { useState } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Calculator as CalcIcon, RotateCcw, Trash2, Send, CornerDownLeft } from 'lucide-react';

export const CalculatorView: React.FC = () => {
  const [expression, setExpression] = useState('');
  const [runningTotal, setRunningTotal] = useState(0);
  const [history, setHistory] = useState<Array<{ expr: string; stepResult: number; totalAfter: number }>>([]);

  const handleCompute = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!expression.trim()) return;

    try {
      const res = await fetch('/api/calculator/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: 'dashboard_session',
          userId: 'staff_user',
          expression: expression.trim(),
        }),
      });
      const data = await res.json();
      setRunningTotal(data.runningTotal);
      setHistory((prev) => [
        { expr: expression.trim(), stepResult: data.stepResult, totalAfter: data.runningTotal },
        ...prev,
      ]);
      setExpression('');
    } catch {}
  };

  const handleUndo = async () => {
    try {
      const res = await fetch('/api/calculator/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: 'dashboard_session', userId: 'staff_user' }),
      });
      const data = await res.json();
      setRunningTotal(data.runningTotal);
      setHistory((prev) => prev.slice(1));
    } catch {}
  };

  const handleClear = () => {
    setRunningTotal(0);
    setHistory([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Interactive Telegram Calculator</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test and run the live arithmetic calculator engine supporting session running totals, arithmetic expressions, and /undo.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calculator Widget */}
        <div className="lg:col-span-3">
          <Card title="Session Running Total Calculator">
            <div className="space-y-4">
              {/* Display */}
              <div className="p-6 bg-slate-950 rounded-xl border border-slate-800 text-right">
                <p className="text-xs text-slate-500 uppercase font-mono tracking-wider">Current Running Total</p>
                <h1 className="text-4xl font-black text-cyan-400 font-mono mt-1">
                  ${runningTotal.toFixed(2)}
                </h1>
              </div>

              {/* Input Form */}
              <form onSubmit={handleCompute} className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 31 * 2 + 16 or 45 - 5"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold flex items-center gap-1.5 text-xs shadow-sm transition-colors"
                >
                  <CornerDownLeft className="w-3.5 h-3.5" />
                  Compute
                </button>
              </form>

              {/* Controls */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                <button
                  onClick={handleUndo}
                  disabled={history.length === 0}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  Undo Last (/undo)
                </button>
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Calc (/clearcalc)
                </button>
              </div>
            </div>
          </Card>
        </div>

        </div>
    </div>
  );
};