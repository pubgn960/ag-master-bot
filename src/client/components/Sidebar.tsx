import React from 'react';
import {
  LayoutDashboard,
  Package,
  Clock,
  Wallet,
  CheckCircle2,
  BarChart3,
  DollarSign,
  Users,
  Truck,
  Megaphone,
  ShieldCheck,
  History,
  Settings,
} from 'lucide-react';

export type NavItemKey =
  | 'overview'
  | 'pending-orders'
  | 'orders'
  | 'partial-payments'
  | 'payments'
  | 'customers'
  | 'products'
  | 'loaders'
  | 'routing'
  | 'loader-prices'
  | 'price-profiles'
  | 'current-prices'
  | 'costs'
  | 'cp-bundles'
  | 'promotions'
  | 'pricing-health'
  | 'profit-loss'
  | 'reports'
  | 'payment-profiles'
  | 'broadcasts'
  | 'staff'
  | 'templates'
  | 'reconciliation'
  | 'audit'
  | 'settings'
  | 'bot-commands';

interface SidebarProps {
  activeTab: NavItemKey;
  onSelectTab: (key: NavItemKey) => void;
  pendingCount?: number;
  unreadNotifs?: number;
  activeUser?: { username: string; role: string };
}

interface SidebarItem {
  key: NavItemKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path?: string;
  badge?: number;
}

interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingCount = 0,
  activeUser = { username: 'owner', role: 'OWNER' },
}) => {
  const sections: SidebarSection[] = [
    {
      title: 'CORE',
      items: [
        { key: 'overview', label: 'Overview', icon: LayoutDashboard },
        { key: 'orders', label: 'All Orders', icon: Package },
        { key: 'pending-orders', label: 'Pending Queue', icon: Clock, badge: pendingCount },
      ],
    },
    {
      title: 'FINANCE & LEDGER',
      items: [
        { key: 'partial-payments', label: 'Customer Balances', icon: Wallet },
        { key: 'payments', label: 'Payment Verification', icon: CheckCircle2 },
        { key: 'reports', label: 'Reports & P&L', icon: BarChart3, path: '/reports' },
        { key: 'current-prices', label: 'Sale & Purchase Pricing', icon: DollarSign },
      ],
    },
    {
      title: 'FULFILLMENT',
      items: [
        { key: 'customers', label: 'Customer Groups', icon: Users },
        { key: 'loaders', label: 'Loaders & Routing', icon: Truck },
        { key: 'broadcasts', label: 'Promotions & Broadcasts', icon: Megaphone },
      ],
    },
    {
      title: 'SYSTEM',
      items: [
        { key: 'staff', label: 'Staff & Roles', icon: ShieldCheck },
        { key: 'audit', label: 'Audit Logs', icon: History },
        { key: 'settings', label: 'Settings & Webhook', icon: Settings },
      ],
    },
  ];

  const userInitials = activeUser?.username
    ? activeUser.username.slice(0, 2).toUpperCase()
    : 'OW';
  const userName =
    activeUser?.username === 'owner' || !activeUser?.username
      ? 'Owner Account'
      : activeUser.username;

  return (
    <aside className="w-64 bg-[#0B0F19] border-r border-slate-800/60 flex flex-col shrink-0 h-screen sticky top-0 overflow-y-auto select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/60 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0">
          iA
        </div>
        <div className="flex flex-col min-w-0">
          <h1 className="font-semibold text-slate-100 text-sm tracking-tight truncate">
            iTech Avengers
          </h1>
          <p className="text-[11px] text-slate-400 font-medium truncate">Operations Engine</p>
        </div>
        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 shrink-0">
          v1.0.0
        </span>
      </div>

      {/* Navigation Sections */}
      <div className="p-3 space-y-1 flex-1">
        {sections.map((sec, idx) => (
          <div key={sec.title} className={idx === 0 ? 'mt-2' : 'mt-5'}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-1.5">
              {sec.title}
            </p>
            <div className="space-y-1">
              {sec.items.map((itm) => {
                const Icon = itm.icon;
                const isActive = activeTab === itm.key;
                return (
                  <button
                    key={itm.key}
                    onClick={() => onSelectTab(itm.key as NavItemKey)}
                    className={`w-full ${
                      isActive
                        ? 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white bg-slate-800/90 font-medium shadow-sm border border-slate-700/50'
                        : 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-all font-normal'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span className="truncate">{itm.label}</span>
                    {typeof itm.badge === 'number' && itm.badge > 0 && (
                      <span className="ml-auto text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
                        {itm.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Pinned Bottom Profile & Environment Card */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 mt-auto">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-900 transition-colors">
          <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-semibold text-xs shadow-inner shrink-0">
            {userInitials}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-medium text-slate-200 truncate">{userName}</span>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Production Live
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
