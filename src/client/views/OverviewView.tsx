import React, { useState, useEffect } from 'react';
import { Card, MetricCard } from '../components/Card';
import { Badge } from '../components/Badge';
import {
  ShoppingBag,
  TrendingUp,
  Clock,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowUpRight,
} from 'lucide-react';
import { NavItemKey } from '../components/Sidebar';

export const OverviewView: React.FC<{ onNavigate: (tab: NavItemKey) => void }> = ({ onNavigate }) => {
  const [metrics, setMetrics] = useState<{
    customerReceivables: number;
    loaderPayables: number;
    totalRealizedProfit: number;
    pendingOrdersCount: number;
    totalOrdersCount: number;
    unallocatedPayments: number;
    activeLoadersCount: number;
  }>({
    customerReceivables: 0,
    loaderPayables: 0,
    totalRealizedProfit: 0,
    pendingOrdersCount: 0,
    totalOrdersCount: 0,
    unallocatedPayments: 0,
    activeLoadersCount: 0,
  });

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loaders, setLoaders] = useState<any[]>([]);

  useEffect(() => {
    // Fetch dashboard summary containing receivables, payables, and overview metrics
    fetch('/api/dashboard/summary')
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          setMetrics((prev) => ({
            ...prev,
            customerReceivables: data.customerReceivables ?? data.total_customer_unpaid ?? 0,
            loaderPayables: data.loaderPayables ?? data.total_loader_payables ?? 0,
            totalRealizedProfit: data.totalRealizedProfit !== undefined ? data.totalRealizedProfit : prev.totalRealizedProfit,
            pendingOrdersCount: data.pendingOrdersCount !== undefined ? data.pendingOrdersCount : prev.pendingOrdersCount,
            totalOrdersCount: data.totalOrdersCount !== undefined ? data.totalOrdersCount : prev.totalOrdersCount,
            activeLoadersCount: data.activeLoadersCount !== undefined ? data.activeLoadersCount : prev.activeLoadersCount,
          }));
        }
      })
      .catch(() => {});

    fetch('/api/profit')
      .then((r) => r.json())
      .then((data) => {
        if (data.summary) {
          setMetrics((prev) => ({ ...prev, totalRealizedProfit: data.summary.totalActiveProfit || 0 }));
        }
      })
      .catch(() => {});

    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setRecentOrders(data.slice(0, 6));
          const pending = data.filter((o) => o.status === 'PENDING' || o.status === 'SENT_TO_LOADER').length;
          setMetrics((prev) => ({
            ...prev,
            pendingOrdersCount: pending,
            totalOrdersCount: data.length,
          }));
        }
      })
      .catch(() => {});

    fetch('/api/loaders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setLoaders(data);
          const active = data.filter((l) => l.is_active && (l.availability_status === 'AVAILABLE' || l.availability_status == null)).length;
          setMetrics((prev) => ({ ...prev, activeLoadersCount: active }));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Welcome & System Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">Executive Command Center</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
              iTech Avengers
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic PostgreSQL order execution, dynamic pricing, receivables/payables, and realized P&L.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onNavigate('reconciliation')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 rounded-lg border border-slate-700/80 text-xs font-semibold shadow-sm transition-all"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            Reconciliation Health
          </button>
          <button
            onClick={() => onNavigate('reports')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 rounded-lg border border-cyan-700/60 text-xs font-semibold shadow-sm transition-all"
          >
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            Reports & Ledger
          </button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          title="Customer Receivables"
          value={`$${metrics.customerReceivables.toFixed(2)}`}
          subtext="Pending payment collection"
          icon={<CreditCard className="w-4 h-4 text-amber-400" />}
          className="border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-slate-900/40 hover:border-amber-500/50"
        />
        <MetricCard
          title="Loader Payables"
          value={`$${metrics.loaderPayables.toFixed(2)}`}
          subtext="Unsettled loader debt"
          icon={<Truck className="w-4 h-4 text-rose-400" />}
          className="border-rose-500/30 bg-gradient-to-b from-rose-950/20 to-slate-900/40 hover:border-rose-500/50"
        />
        <MetricCard
          title="Realized Profit"
          value={`$${metrics.totalRealizedProfit.toFixed(2)}`}
          subtext="DONE orders only"
          icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
          trend={{ value: 'Exact settlement', positive: true }}
          className="border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-slate-900/40 hover:border-emerald-500/50"
        />
        <MetricCard
          title="Pending Orders"
          value={metrics.pendingOrdersCount}
          subtext="Awaiting fulfillment"
          icon={<Clock className="w-4 h-4 text-cyan-400" />}
          className="border-cyan-500/30 bg-gradient-to-b from-cyan-950/20 to-slate-900/40 hover:border-cyan-500/50"
        />
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrdersCount}
          subtext="Monotonic ORD sequences"
          icon={<ShoppingBag className="w-4 h-4 text-blue-400" />}
          className="border-blue-500/30 bg-gradient-to-b from-blue-950/20 to-slate-900/40 hover:border-blue-500/50"
        />
        <MetricCard
          title="Active Loaders"
          value={metrics.activeLoadersCount}
          subtext="Available for routing"
          icon={<Truck className="w-4 h-4 text-purple-400" />}
          className="border-purple-500/30 bg-gradient-to-b from-purple-950/20 to-slate-900/40 hover:border-purple-500/50"
        />
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders Table */}
        <div className="lg:col-span-2">
          <Card
            title="Recent Orders"
            subtitle="Real-time order pipeline and financial state"
            action={
              <button
                onClick={() => onNavigate('orders')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
              >
                View All <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            }
          >
            {recentOrders.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No orders recorded yet. Place an order via Telegram mock or API to view live flow.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 -mb-5 mt-2">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="table-header">
                    <tr className="border-b border-slate-800/80">
                      <th className="py-3 px-4 font-semibold">ORDER ID</th>
                      <th className="py-3 px-4 font-semibold">GROUP / CUSTOMER</th>
                      <th className="py-3 px-4 font-semibold">PACKAGE</th>
                      <th className="py-3 px-4 font-semibold">PRICE / COST</th>
                      <th className="py-3 px-4 font-semibold">STATUS</th>
                      <th className="py-3 px-4 font-semibold">PAYMENT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-cyan-400 font-bold">{o.order_number}</td>
                        <td className="py-3 px-4">
                          <p className="text-slate-100 font-medium">{o.group_title}</p>
                          <p className="text-[11px] text-slate-400 font-normal">{o.customer_name}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-200 font-medium">{o.bundle_name || `${o.cp_quantity} CP`}</td>
                        <td className="py-3 px-4 font-mono">
                          <span className="text-emerald-400 font-semibold">${parseFloat(o.sale_price_snapshot).toFixed(2)}</span>
                          <span className="text-slate-500 text-[10px]"> / ${parseFloat(o.loader_cost_snapshot).toFixed(2)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              o.status === 'DONE'
                                ? 'success'
                                : o.status === 'SENT_TO_LOADER'
                                ? 'info'
                                : o.status === 'PENDING'
                                ? 'warning'
                                : 'default'
                            }
                            size="sm"
                          >
                            {o.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              o.payment_amount_state === 'PAID'
                                ? 'success'
                                : o.payment_amount_state === 'PARTIAL'
                                ? 'amber'
                                : 'danger'
                            }
                            size="sm"
                          >
                            {o.payment_amount_state}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Loaders Status Card */}
        <div>
          <Card
            title="Loaders & Availability"
            subtitle="Staff-configured loader fulfillment routes"
            action={
              <button
                onClick={() => onNavigate('loaders')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
              >
                Manage <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            }
          >
            <div className="space-y-2.5 mt-1">
              {loaders.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No loaders configured in system.
                </div>
              ) : (
                loaders.map((l) => (
                  <div
                    key={l.id}
                    className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between hover:border-slate-700/80 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700/60 flex items-center justify-center text-cyan-400 shrink-0">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-100 truncate">{l.display_name || l.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono truncate">
                          v{l.price_book_version || 1} • {l.assigned_groups_count || 0} groups
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        !l.is_active
                          ? 'danger'
                          : l.availability_status === 'AVAILABLE'
                          ? 'success'
                          : l.availability_status === 'BUSY'
                          ? 'warning'
                          : 'danger'
                      }
                      size="sm"
                    >
                      {!l.is_active ? 'INACTIVE' : l.availability_status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
