import React, { useState, useEffect, useCallback } from 'react';
import { Card, MetricCard } from '../components/Card';
import { Badge } from '../components/Badge';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Truck,
  Tag,
  CreditCard,
  FileSpreadsheet,
  ArrowRight,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShoppingBag,
  Percent,
  Calendar,
} from 'lucide-react';
import { NavItemKey } from '../components/Sidebar';

interface ReportsViewProps {
  onOpenProfitLedger?: () => void;
  onNavigate?: (tab: NavItemKey) => void;
}

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

export const ReportsView: React.FC<ReportsViewProps> = ({ onOpenProfitLedger, onNavigate }) => {
  const [activePillar, setActivePillar] = useState<'all' | 'sales' | 'profit' | 'loaders' | 'customers' | 'promotions' | 'payments'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Data states for the 6 pillars
  const [salesData, setSalesData] = useState<any>(null);
  const [loadersData, setLoadersData] = useState<any[]>([]);
  const [customersData, setCustomersData] = useState<any[]>([]);
  const [profitData, setProfitData] = useState<any>(null);
  const [promotionsData, setPromotionsData] = useState<any[]>([]);
  const [paymentsData, setPaymentsData] = useState<any>(null);

  const getQueryParams = useCallback(() => {
    let start = startDate;
    let end = endDate;

    if (datePreset === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      start = today.toISOString();
      end = new Date().toISOString();
    } else if (datePreset === '7d') {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      start = past.toISOString();
      end = new Date().toISOString();
    } else if (datePreset === '30d') {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      start = past.toISOString();
      end = new Date().toISOString();
    }

    if (start && end) {
      return `?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
    }
    return '';
  }, [datePreset, startDate, endDate]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const q = getQueryParams();

    try {
      const [salesRes, loadersRes, customersRes, profitRes, promoRes, paymentsRes] = await Promise.all([
        fetch(`/api/reports/sales${q}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/reports/loaders${q}`).then((r) => r.json()).catch(() => ({ loaders: [] })),
        fetch(`/api/reports/customers${q}`).then((r) => r.json()).catch(() => ({ customers: [] })),
        fetch(`/api/reports/profit${q}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/reports/promotions${q}`).then((r) => r.json()).catch(() => ({ promotions: [] })),
        fetch(`/api/reports/payments${q}`).then((r) => r.json()).catch(() => null),
      ]);

      if (salesRes) setSalesData(salesRes);
      if (loadersRes?.loaders) setLoadersData(loadersRes.loaders);
      if (customersRes?.customers) setCustomersData(customersRes.customers);
      if (profitRes?.profit) setProfitData(profitRes.profit);
      if (promoRes?.promotions) setPromotionsData(promoRes.promotions);
      if (paymentsRes) setPaymentsData(paymentsRes);
    } catch (err) {
      console.error('[ReportsView] Error loading analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [getQueryParams]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Derived high-level numbers
  const grossSales = Number(salesData?.summary?.gross_sales || profitData?.total_revenue || 0);
  const netProfit = Number(profitData?.total_realized_profit || 0);
  const cogs = Number(profitData?.total_cogs || 0);
  const marginPct = grossSales > 0 ? ((netProfit / grossSales) * 100).toFixed(1) : '0.0';
  const totalOrders = Number(salesData?.summary?.total_orders || 0);
  const completedOrders = Number(salesData?.summary?.completed_orders || 0);

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 tracking-tight">Reports & Analytics Hub</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Consolidated operational intelligence, sales metrics, and P&L financial analytics.
              </p>
            </div>
          </div>
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Buttons */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            {(['all', 'today', '7d', '30d'] as DatePreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setDatePreset(preset);
                  setStartDate('');
                  setEndDate('');
                }}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  datePreset === preset
                    ? 'bg-cyan-500 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {preset === 'all' && 'All Time'}
                {preset === 'today' && 'Today'}
                {preset === '7d' && 'Last 7 Days'}
                {preset === '30d' && 'Last 30 Days'}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchReports}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Top 4 KPI Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Gross Sales Volume"
          value={`$${grossSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext={`${totalOrders} total orders processed`}
          icon={<DollarSign className="w-5 h-5 text-cyan-400" />}
        />
        <MetricCard
          title="Net Realized Profit"
          value={`$${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtext={`COGS: $${cogs.toFixed(2)}`}
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          title="Gross Profit Margin"
          value={`${marginPct}%`}
          subtext="Net profit / revenue"
          icon={<Percent className="w-5 h-5 text-amber-400" />}
        />
        <MetricCard
          title="Orders Completed"
          value={completedOrders}
          subtext={`${salesData?.summary?.cancelled_orders || 0} cancelled`}
          icon={<CheckCircle2 className="w-5 h-5 text-purple-400" />}
        />
      </div>

      {/* Navigation Pills for 6 Pillars */}
      <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 overflow-x-auto text-xs font-medium">
        {[
          { key: 'all', label: 'All Reports Overview' },
          { key: 'profit', label: 'Profit & Loss (P&L)' },
          { key: 'sales', label: 'Sales & Products' },
          { key: 'loaders', label: 'Loader Performance' },
          { key: 'customers', label: 'Customer Groups' },
          { key: 'promotions', label: 'Promotions' },
          { key: 'payments', label: 'Payments & Settlement' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActivePillar(tab.key as any)}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              activePillar === tab.key
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── PILLAR 1: PROFIT REPORT & CONSOLIDATED P&L ─── */}
      {(activePillar === 'all' || activePillar === 'profit') && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Profit & Loss (P&L) Report</span>
            </div>
          }
          subtitle="Realized financial gain, loader acquisition costs (COGS), and net realized margin."
          action={
            <button
              onClick={onOpenProfitLedger}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors"
            >
              Open Full P&L Ledger
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          }
          className="border-emerald-500/20 hover:border-emerald-500/40 transition-colors"
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 py-2">
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <p className="text-[11px] font-mono text-slate-400 uppercase">Gross Revenue</p>
              <p className="text-xl font-bold text-slate-100 font-mono mt-1">
                ${Number(profitData?.total_revenue || grossSales).toFixed(2)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Total customer receipts snapshot</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <p className="text-[11px] font-mono text-slate-400 uppercase">Loader Costs (COGS)</p>
              <p className="text-xl font-bold text-slate-300 font-mono mt-1">
                ${cogs.toFixed(2)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Total loader fulfillment expense</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/20 bg-emerald-950/10">
              <p className="text-[11px] font-mono text-emerald-400 uppercase">Realized Profit</p>
              <p className="text-xl font-bold text-emerald-400 font-mono mt-1">
                +${netProfit.toFixed(2)}
              </p>
              <p className="text-[10px] text-emerald-500/80 mt-1">Realized upon DONE order status</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <p className="text-[11px] font-mono text-slate-400 uppercase">Audit & Traceability</p>
                <p className="text-sm font-semibold text-slate-200 mt-1">
                  {profitData?.total_profit_events || 0} Profit Events
                </p>
              </div>
              <button
                onClick={onOpenProfitLedger}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 mt-2 text-left"
              >
                View line-by-line audit ledger →
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ─── PILLAR 2: SALES & PRODUCT BREAKDOWN ─── */}
      {(activePillar === 'all' || activePillar === 'sales') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card
            title={
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-cyan-400" />
                <span>Product Platform Distribution</span>
              </div>
            }
            subtitle="Order volume breakdown by login platform (Activision vs Facebook)."
          >
            <div className="space-y-3">
              {salesData?.platforms && salesData.platforms.length > 0 ? (
                salesData.platforms.map((p: any) => {
                  const vol = Number(p.total_volume || 0);
                  const count = Number(p.order_count || 0);
                  const pct = grossSales > 0 ? ((vol / grossSales) * 100).toFixed(1) : '0';
                  return (
                    <div key={p.platform} className="p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                        <span className="text-slate-200">{p.platform}</span>
                        <span className="text-cyan-400 font-mono">${vol.toFixed(2)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full"
                          style={{ width: `${Math.min(100, Math.max(5, Number(pct)))}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{count} orders placed</p>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center text-xs text-slate-500">No product platform data in this period.</div>
              )}
            </div>
          </Card>

          <Card
            title={
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-400" />
                <span>Top CP Bundles by Volume</span>
              </div>
            }
            subtitle="Top performing CP denominations by volume and count."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono">
                    <th className="pb-2 font-medium">BUNDLE</th>
                    <th className="pb-2 font-medium text-right">ORDERS</th>
                    <th className="pb-2 font-medium text-right">VOLUME</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {salesData?.bundles && salesData.bundles.length > 0 ? (
                    salesData.bundles.map((b: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-800/30">
                        <td className="py-2.5 font-bold text-slate-200">{b.bundle_name}</td>
                        <td className="py-2.5 text-right text-slate-400">{b.order_count}</td>
                        <td className="py-2.5 text-right text-emerald-400 font-bold">${Number(b.total_volume).toFixed(2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-500 font-sans">
                        No bundle sales recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ─── PILLAR 3: LOADER PERFORMANCE REPORT ─── */}
      {(activePillar === 'all' || activePillar === 'loaders') && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-400" />
              <span>Loader Fulfillment & Performance</span>
            </div>
          }
          subtitle="Loader delivery speed, completion ratios, and payout obligations."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">LOADER</th>
                  <th className="pb-3 font-medium text-center">ASSIGNED</th>
                  <th className="pb-3 font-medium text-center">COMPLETED</th>
                  <th className="pb-3 font-medium text-center">CANCELLED</th>
                  <th className="pb-3 font-medium text-center">SUCCESS RATE</th>
                  <th className="pb-3 font-medium text-right">AVG SPEED</th>
                  <th className="pb-3 font-medium text-right">TOTAL PAYOUT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loadersData.length > 0 ? (
                  loadersData.map((l: any) => {
                    const assigned = Number(l.total_assigned || 0);
                    const completed = Number(l.completed_count || 0);
                    const cancelled = Number(l.cancelled_count || 0);
                    const rate = assigned > 0 ? ((completed / assigned) * 100).toFixed(0) : '0';
                    const avgMins = Number(l.avg_completion_minutes || 0).toFixed(1);
                    const payout = Number(l.total_payout || 0).toFixed(2);
                    return (
                      <tr key={l.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3">
                          <p className="font-bold text-slate-200">{l.display_name}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{l.code}</p>
                        </td>
                        <td className="py-3 text-center font-mono text-slate-300">{assigned}</td>
                        <td className="py-3 text-center font-mono text-emerald-400 font-semibold">{completed}</td>
                        <td className="py-3 text-center font-mono text-rose-400">{cancelled}</td>
                        <td className="py-3 text-center font-mono">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            Number(rate) >= 90
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                              : 'bg-amber-950 text-amber-300 border border-amber-800/50'
                          }`}>
                            {rate}%
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono text-slate-400">
                          {Number(avgMins) > 0 ? `${avgMins} min` : 'N/A'}
                        </td>
                        <td className="py-3 text-right font-mono font-bold text-cyan-400">${payout}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No loader activity found for the selected time range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── PILLAR 4: CUSTOMER & GROUP REPORT ─── */}
      {(activePillar === 'all' || activePillar === 'customers') && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              <span>Customer Groups & Tab Balances</span>
            </div>
          }
          subtitle="Top Telegram customer groups, cumulative volume, and outstanding balances."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">GROUP TITLE</th>
                  <th className="pb-3 font-medium text-center">TOTAL ORDERS</th>
                  <th className="pb-3 font-medium text-right">TOTAL SPENT</th>
                  <th className="pb-3 font-medium text-right">PREPAID BALANCE</th>
                  <th className="pb-3 font-medium text-right">OUTSTANDING DEBT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {customersData.length > 0 ? (
                  customersData.map((g: any) => {
                    const balance = Number(g.credit_balance || 0);
                    const debt = Number(g.outstanding_debt || 0);
                    return (
                      <tr key={g.group_id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 font-sans font-semibold text-slate-200">{g.group_name}</td>
                        <td className="py-3 text-center text-slate-300">{g.total_orders}</td>
                        <td className="py-3 text-right font-bold text-slate-200">${Number(g.total_spent || 0).toFixed(2)}</td>
                        <td className="py-3 text-right text-emerald-400 font-semibold">
                          ${balance.toFixed(2)}
                        </td>
                        <td className="py-3 text-right font-semibold">
                          {debt > 0 ? (
                            <span className="text-rose-400 font-bold">${debt.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-500">$0.00</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                      No customer groups registered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── PILLAR 5 & 6: PROMOTIONS & PAYMENTS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(activePillar === 'all' || activePillar === 'promotions') && (
          <Card
            title={
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-pink-400" />
                <span>Promotions & Campaigns</span>
              </div>
            }
            subtitle="Promo campaign performance and redemption volume."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono">
                    <th className="pb-2 font-medium">PROMOTION</th>
                    <th className="pb-2 font-medium text-center">STATUS</th>
                    <th className="pb-2 font-medium text-right">REDEMPTIONS</th>
                    <th className="pb-2 font-medium text-right">VOLUME</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {promotionsData.length > 0 ? (
                    promotionsData.map((p: any) => (
                      <tr key={p.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 font-sans font-medium text-slate-200">{p.name}</td>
                        <td className="py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold ${
                            p.is_active && !p.is_paused
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {p.is_active && !p.is_paused ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-slate-300">{p.total_redemptions}</td>
                        <td className="py-2.5 text-right font-bold text-emerald-400">${Number(p.total_volume || 0).toFixed(2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500 font-sans">
                        No promotions data available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {(activePillar === 'all' || activePillar === 'payments') && (
          <Card
            title={
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-cyan-400" />
                <span>Payment Verification & Inflow</span>
              </div>
            }
            subtitle="Inbound payment verification audit and settlement summary."
          >
            {paymentsData?.summary ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-center">
                    <p className="text-[10px] font-mono text-slate-500 uppercase">Verified</p>
                    <p className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                      {paymentsData.summary.verified_count || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-center">
                    <p className="text-[10px] font-mono text-slate-500 uppercase">Pending</p>
                    <p className="text-base font-bold text-amber-400 font-mono mt-0.5">
                      {paymentsData.summary.pending_count || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-center">
                    <p className="text-[10px] font-mono text-slate-500 uppercase">Rejected</p>
                    <p className="text-base font-bold text-rose-400 font-mono mt-0.5">
                      {paymentsData.summary.rejected_count || 0}
                    </p>
                  </div>
                  <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-center">
                    <p className="text-[10px] font-mono text-slate-500 uppercase">Duplicate</p>
                    <p className="text-base font-bold text-slate-400 font-mono mt-0.5">
                      {paymentsData.summary.duplicate_count || 0}
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Total Inflow Volume</span>
                    <span className="text-emerald-400 font-bold font-mono text-sm">
                      ${Number(paymentsData.summary.total_amount || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-slate-400">Total Payment Transactions</span>
                    <span className="text-slate-200 font-mono">
                      {paymentsData.summary.total_payments || 0}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">No payment records found.</div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
};
