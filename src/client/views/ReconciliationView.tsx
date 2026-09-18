import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, Play } from 'lucide-react';

export const ReconciliationView: React.FC = () => {
  const [data, setData] = useState<{
    runs: any[];
    activeIssues: any[];
  }>({ runs: [], activeIssues: [] });
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchRecon = () => {
    fetch('/api/reconciliation')
      .then((r) => r.json())
      .then((res) => {
        setData(res);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchRecon();
  }, []);

  const handleRunScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/reconciliation/run', { method: 'POST' });
      const scan = await res.json();
      if (!res.ok || scan.error) {
        throw new Error(scan.error || 'Scan failed to complete');
      }
      if (scan.status === 'SUCCESS' || scan.issuesFound === 0) {
        setFeedback('Scan completed: All database records, balance ledgers, and profit accounts are 100% synchronized and healthy!');
      } else {
        setFeedback(`Scan finished: Found ${scan.issuesFound || 0} discrepancy issue(s). Listed below.`);
      }
      fetchRecon();
    } catch (err: any) {
      setFeedback(`Scan error: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Reconciliation Center & Audit Integrity</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated integrity scanner comparing balance transaction ledgers, profit entries on DONE orders, and delivery outbox queues.
          </p>
        </div>
        <button
          onClick={handleRunScan}
          disabled={scanning}
          className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {scanning ? 'Scanning Database...' : 'Run Full Scan Now'}
        </button>
      </div>

      {feedback && (
        <div className="p-3.5 bg-slate-900 border border-slate-700 text-slate-200 rounded-xl text-xs flex justify-between items-center shadow-sm">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Active Issues Section */}
      <Card title="Active Discrepancies" subtitle="Detected variances requiring attention">
        {data.activeIssues?.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-slate-200">Zero Active Discrepancies</h4>
            <p className="text-xs text-slate-500 mt-1">
              The financial ledgers, outbox jobs, and order state machines are fully reconciled.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.activeIssues.map((issue) => (
              <div
                key={issue.id}
                className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start justify-between gap-4 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="danger" size="sm">
                      {issue.issue_type}
                    </Badge>
                    <span className="text-slate-400 font-mono text-[11px]">
                      Entity: {issue.entity_id}
                    </span>
                  </div>
                  <p className="text-slate-200 mt-1.5 leading-relaxed">{issue.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Past Runs Table */}
      <Card title="Reconciliation Scan History">
        {data.runs?.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No previous scan history.</div>
        ) : (
          <div className="overflow-x-auto text-xs font-mono">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2.5">RUN ID</th>
                  <th className="pb-2.5">TRIGGERED BY</th>
                  <th className="pb-2.5">STATUS</th>
                  <th className="pb-2.5">ISSUES FOUND</th>
                  <th className="pb-2.5">SCANNED AT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data.runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 font-bold text-cyan-400">{r.id.slice(0, 8)}...</td>
                    <td className="py-2.5 font-sans text-slate-200">{r.triggered_by}</td>
                    <td className="py-2.5">
                      <Badge variant={r.status === 'CLEAN' ? 'success' : 'danger'} size="sm">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-slate-300 font-bold">{r.issues_found}</td>
                    <td className="py-2.5 text-[11px] text-slate-400 font-sans">
                      {new Date(r.created_at).toLocaleString()}
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
