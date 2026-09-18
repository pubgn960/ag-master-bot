import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { Badge } from './Badge';

interface HeaderProps {
  systemMode?: 'NORMAL' | 'SAFE_MODE' | 'READ_ONLY';
  unreadNotifications?: number;
  activeUser?: { username: string; role: string };
  onOpenNotifications?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  systemMode = 'NORMAL',
  unreadNotifications = 0,
  activeUser = { username: 'owner', role: 'OWNER' },
  onOpenNotifications,
}) => {
  const modeBadge = {
    NORMAL: { label: 'NORMAL OPERATIONS', variant: 'success' as const, icon: CheckCircle2 },
    SAFE_MODE: { label: 'SAFE MODE (MANUAL REVIEW)', variant: 'warning' as const, icon: AlertTriangle },
    READ_ONLY: { label: 'READ ONLY', variant: 'danger' as const, icon: Lock },
  }[systemMode];

  const ModeIcon = modeBadge.icon;
  
  const [envBadge, setEnvBadge] = useState('LOADING...');
  const [envColor, setEnvColor] = useState('text-slate-300');

  useEffect(() => {
    fetch('/api/config/env')
      .then(res => res.json())
      .then(data => {
        setEnvBadge(data.environment);
        if (data.environment === 'PRODUCTION') setEnvColor('text-red-400 border-red-800/60 bg-red-950');
        else if (data.environment === 'STAGING') setEnvColor('text-amber-400 border-amber-800/60 bg-amber-950');
        else setEnvColor('text-slate-300 border-slate-800 bg-slate-900');
      })
      .catch(() => setEnvBadge('UNKNOWN'));
  }, []);


  return (
    <header className="h-16 bg-slate-950/70 border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-30 backdrop-blur-xl">
      <div className="flex items-center gap-3 md:gap-4 flex-wrap">
        <Badge variant={modeBadge.variant}>
          <ModeIcon className="w-3.5 h-3.5 mr-1.5" />
          {modeBadge.label}
        </Badge>
        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md border ${envColor}`}>
          {envBadge}
        </span>
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900/60 border border-slate-800/80">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] text-slate-400 font-mono tracking-tight">
            PostgreSQL Realized Engine Active
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* User Account */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-800/80">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-800 to-slate-700 border border-slate-600/60 flex items-center justify-center text-xs font-bold text-slate-200 shadow-sm">
            {activeUser.username[0]?.toUpperCase() || 'U'}
          </div>
          <div className="text-left hidden xs:block">
            <p className="text-xs font-medium text-slate-200 leading-tight">{activeUser.username}</p>
            <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">{activeUser.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
