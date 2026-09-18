import React, { useState, useEffect } from 'react';
import { Card, MetricCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { TrendingUp, FileSpreadsheet, RotateCcw, DollarSign, ArrowLeft } from 'lucide-react';

interface ProfitLossViewProps {
  onBack?: () => void;
}

export const ProfitLossView: React.FC<ProfitLossViewProps> = ({ onBack }) => {
  const [data, setData] = useState<{
    summary: any;
    ledger: any[];
  }>({ summary: null, ledger: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/profit')
      .then((r) => r.json())
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Reports
            </button>
          )}
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">Profit & Loss (P&L) Ledger</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Exact decimal realized profit accounting on DONE orders (Sale Price − Loader Cost) and reversal offset auditing.
            </p>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Gross Realized Profit"
          value={`$${(data.summary?.totalRealizedProfit || 0).toFixed(2)}`}
          subtext="Completed orders total"
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          title="Reversal Offsets"
          value={`-$${(data.summary?.totalReversedOffsets || 0).toFixed(2)}`}
          subtext="Unwound order profit offsets"
          icon={<RotateCcw className="w-5 h-5 text-rose-400" />}
        />
        <MetricCard
          title="Net Active Profit"
          value={`$${(data.summary?.totalActiveProfit || 0).toFixed(2)}`}
          subtext="Deterministic DB ledger balance"
          icon={<DollarSign className="w-5 h-5 text-cyan-400" />}
        />
      </div>

      {/* Realized Profit Ledger Table */}
      <Card title="Realized Profit Transaction Ledger">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading profit ledger entries...</div>
        ) : data.ledger?.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No profit ledger entries recorded yet. Fulfill and mark an order DONE to realize profit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">ORDER NUMBER</th>
                  <th className="pb-3 font-medium">CUSTOMER / GROUP</th>
                  <th className="pb-3 font-medium">SALE PRICE</th>
                  <th className="pb-3 font-medium">LOADER COST</th>
                  <th className="pb-3 font-medium">REALIZED PROFIT</th>
                  <th className="pb-3 font-medium">REALIZED AT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {data.ledger.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-bold text-cyan-400">{row.order_number}</td>
                    <td className="py-3 font-sans">
                      <p className="text-slate-100 font-semibold">{row.customer_name}</p>
                      <p className="text-[10px] text-slate-400">{row.group_title}</p>
                    </td>
                    <td className="py-3 text-slate-300 font-bold">${parseFloat(row.sale_price).toFixed(2)}</td>
                    <td className="py-3 text-slate-400 font-bold">${parseFloat(row.loader_cost).toFixed(2)}</td>
                    <td className="py-3 text-emerald-400 font-bold text-sm">
                      +${parseFloat(row.realized_profit).toFixed(2)}
                    </td>
                    <td className="py-3 text-[11px] text-slate-400">
                      {new Date(row.realized_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
