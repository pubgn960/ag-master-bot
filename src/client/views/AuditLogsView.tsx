import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { History, Search, Filter, Eye } from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const fetchAuditLogs = () => {
    setLoading(true);
    fetch('/api/audit')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : [];
        setLogs(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.actor?.toLowerCase().includes(q) ||
      l.action?.toLowerCase().includes(q) ||
      l.correlation_id?.toLowerCase().includes(q) ||
      l.target_type?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">System Audit & Compliance Log</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Immutable trace of all administrative actions, state changes, credential reveals, and financial movements.
          </p>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search actor, action, correlation ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading audit stream...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">No audit records found.</div>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">ACTOR</th>
                  <th className="pb-3 font-medium">ACTION</th>
                  <th className="pb-3 font-medium">TARGET</th>
                  <th className="pb-3 font-medium">CORRELATION ID</th>
                  <th className="pb-3 font-medium">TIMESTAMP</th>
                  <th className="pb-3 font-medium text-right">PAYLOAD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-bold text-slate-200">{l.actor}</td>
                    <td className="py-3">
                      <Badge variant="purple" size="sm">
                        {l.action}
                      </Badge>
                    </td>
                    <td className="py-3 text-slate-300 font-mono">
                      {l.target_type}: {l.target_id ? `${l.target_id.slice(0, 8)}...` : 'N/A'}
                    </td>
                    <td className="py-3 font-mono text-[11px] text-cyan-400">{l.correlation_id}</td>
                    <td className="py-3 font-mono text-[11px] text-slate-400">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => setSelectedLog(l)}
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Snapshot Modal */}
      {selectedLog && (
        <Modal
          isOpen={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title={`Audit Event: ${selectedLog.action}`}
        >
          <div className="space-y-3 text-xs font-mono">
            <div className="p-3 bg-slate-950 rounded-lg space-y-1">
              <p className="text-slate-400">Actor: <span className="text-slate-100 font-bold">{selectedLog.actor}</span></p>
              <p className="text-slate-400">Target: <span className="text-slate-100 font-bold">{selectedLog.target_type} ({selectedLog.target_id})</span></p>
              <p className="text-slate-400">Correlation ID: <span className="text-cyan-400 font-bold">{selectedLog.correlation_id}</span></p>
            </div>

            {selectedLog.previous_state && (
              <div>
                <p className="font-sans font-semibold text-slate-400 mb-1">Previous State Snapshot:</p>
                <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 overflow-x-auto">
                  {typeof selectedLog.previous_state === 'string'
                    ? selectedLog.previous_state
                    : JSON.stringify(selectedLog.previous_state, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog.new_state && (
              <div>
                <p className="font-sans font-semibold text-slate-400 mb-1">New State Snapshot:</p>
                <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-emerald-400 overflow-x-auto">
                  {typeof selectedLog.new_state === 'string'
                    ? selectedLog.new_state
                    : JSON.stringify(selectedLog.new_state, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
