import React from 'react';

export const Card: React.FC<{
  title?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, children, className = '' }) => {
  return (
    <div className={`glass-card rounded-xl p-5 shadow-xl border border-slate-800/80 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/60">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};

export const MetricCard: React.FC<{
  title: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}> = ({ title, value, subtext, icon, trend, className = '' }) => {
  return (
    <div className={`glass-card rounded-xl p-5 shadow-lg border border-slate-800/80 relative overflow-hidden transition-all duration-200 hover:border-slate-700/80 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider truncate">{title}</p>
          <h2 className="text-2xl font-extrabold text-slate-100 mt-1.5 font-mono tracking-tight">{value}</h2>
          {subtext && <p className="text-xs text-slate-400 mt-1 truncate">{subtext}</p>}
          {trend && (
            <div className="flex items-center gap-1 mt-2.5">
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${trend.positive ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/60' : 'bg-rose-950/70 text-rose-400 border border-rose-800/60'}`}>
                {trend.positive ? '↑' : '↓'} {trend.value}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className="p-2.5 bg-slate-900/80 border border-slate-700/60 rounded-xl text-cyan-400 shadow-inner shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};
