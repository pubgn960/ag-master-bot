import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Bell, Check, CheckCircle2, AlertTriangle, Info, AlertOctagon } from 'lucide-react';

export const NotificationsView: React.FC = () => {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = () => {
    setLoading(true);
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNotifs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifs();
  }, []);

  const handleMarkRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    fetchNotifs();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">System Alerts & Notifications</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational alerts, loader price book proposals, and financial event broadcasts.
          </p>
        </div>
        <button
          onClick={fetchNotifs}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700"
        >
          Refresh Notifications
        </button>
      </div>

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading notifications...</div>
        ) : notifs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">No active system alerts.</div>
        ) : (
          <div className="space-y-2 text-xs">
            {notifs.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 transition-colors ${
                  n.is_read
                    ? 'bg-slate-950/40 border-slate-800/60 opacity-60'
                    : 'bg-slate-900 border-slate-700/80 shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-slate-800 rounded-lg shrink-0 mt-0.5">
                    {n.severity === 'CRITICAL' ? (
                      <AlertOctagon className="w-4 h-4 text-rose-400" />
                    ) : n.severity === 'WARNING' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Info className="w-4 h-4 text-cyan-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-100">{n.title}</h4>
                      <Badge
                        variant={
                          n.severity === 'CRITICAL'
                            ? 'danger'
                            : n.severity === 'WARNING'
                            ? 'warning'
                            : 'info'
                        }
                        size="sm"
                      >
                        {n.severity}
                      </Badge>
                    </div>
                    <p className="text-slate-300 mt-1 leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-1.5">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {!n.is_read && (
                  <button
                    onClick={() => handleMarkRead(n.id)}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg shrink-0 transition-colors"
                    title="Mark as Read"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
