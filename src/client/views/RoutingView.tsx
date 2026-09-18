import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { GitFork, Check, AlertCircle } from 'lucide-react';

export const RoutingView: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [loaders, setLoaders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [gRes, lRes] = await Promise.all([
        fetch('/api/groups').then((r) => r.json()),
        fetch('/api/loaders').then((r) => r.json()),
      ]);
      if (Array.isArray(gRes)) setGroups(gRes);
      if (Array.isArray(lRes)) setLoaders(lRes);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateRoute = async (groupId: string, loaderId: string, rule: string) => {
    try {
      const res = await fetch('/api/loaders/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          loaderId,
          fulfillmentRule: rule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback(`Route updated successfully!`);
      fetchData();
    } catch (err: any) {
      setFeedback(`Route update failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Group → Loader Routing Matrix</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure assigned fulfillment loader and strict policy: PAYMENT_REQUIRED vs FULFILL_REGARDLESS_OF_PAYMENT.
          </p>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex justify-between items-center">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading routing matrix...</div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center">
            <GitFork className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No routes configured</p>
            <p className="text-xs text-slate-500 font-mono">Routes will appear here once Customer Groups are created.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">TELEGRAM GROUP</th>
                  <th className="pb-3 font-medium">ASSIGNED LOADER</th>
                  <th className="pb-3 font-medium">FULFILLMENT RULE</th>
                  <th className="pb-3 font-medium text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {groups.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3">
                      <p className="text-slate-100 font-semibold">{g.title}</p>
                      <p className="text-[10px] text-slate-400 font-mono">Chat ID: {g.telegram_chat_id || 'Unbound'}</p>
                    </td>
                    <td className="py-3">
                      <select
                        value={g.assigned_loader_id || ''}
                        onChange={(e) =>
                          handleUpdateRoute(
                            g.id,
                            e.target.value,
                            g.fulfillment_rule || 'FULFILL_REGARDLESS_OF_PAYMENT'
                          )
                        }
                        className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="">Unassigned</option>
                        {loaders
                          .filter((l) => l.is_active !== false)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.display_name || l.name || l.code}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="py-3">
                      {g.assigned_loader_id ? (
                        <select
                          value={g.fulfillment_rule || 'FULFILL_REGARDLESS_OF_PAYMENT'}
                          onChange={(e) =>
                            handleUpdateRoute(
                              g.id,
                              g.assigned_loader_id,
                              e.target.value
                            )
                          }
                          className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                        >
                          <option value="FULFILL_REGARDLESS_OF_PAYMENT">
                            FULFILL_REGARDLESS_OF_PAYMENT (Trusted VIP)
                          </option>
                          <option value="PAYMENT_REQUIRED">PAYMENT_REQUIRED (Blocks unpaid)</option>
                        </select>
                      ) : (
                        <span className="text-slate-500 font-mono text-[10px]">Unassigned (No Rule)</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Badge
                        variant={!g.assigned_loader_id ? 'default' : g.fulfillment_rule === 'PAYMENT_REQUIRED' ? 'warning' : 'info'}
                        size="sm"
                      >
                        {!g.assigned_loader_id ? 'Unassigned' : 'Active Route'}
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
  );
};
