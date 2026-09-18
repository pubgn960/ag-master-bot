import React from 'react';
import { Sidebar, NavItemKey } from './Sidebar';
import { Header } from './Header';

interface LayoutProps {
  activeTab: NavItemKey;
  onSelectTab: (tab: NavItemKey) => void;
  pendingCount?: number;
  systemMode?: 'NORMAL' | 'SAFE_MODE' | 'READ_ONLY';
  activeUser?: { username: string; role: string };
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  onSelectTab,
  pendingCount = 0,
  systemMode = 'NORMAL',
  activeUser,
  children,
}) => {
  return (
    <div className="flex min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Institutional Enterprise Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        pendingCount={pendingCount}
        activeUser={activeUser}
      />

      {/* Main Execution Shell */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <Header
          systemMode={systemMode}
          activeUser={activeUser}
        />

        <main className="p-6 md:p-8 flex-1 max-w-7xl w-full mx-auto animate-in fade-in duration-150">
          {children}
        </main>
      </div>
    </div>
  );
};
