import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Settings, Shield, CheckCircle2, Lock, Radio, Database, Cloud, AlertTriangle, RefreshCw } from 'lucide-react';

export interface DestinationDiagItem {
  name: string;
  variable: string;
  configured: boolean;
  connection: 'CONNECTED' | 'FAILED' | 'NOT_CONFIGURED' | 'UNKNOWN';
  error: string | null;
  maskedChatId: string | null;
  chatTitle: string | null;
}

export const SettingsView: React.FC<{
  currentMode: 'NORMAL' | 'SAFE_MODE' | 'READ_ONLY';
  onModeChange: (mode: 'NORMAL' | 'SAFE_MODE' | 'READ_ONLY') => void;
}> = ({ currentMode, onModeChange }) => {
  const [flags, setFlags] = useState<Array<{ key: string; enabled: boolean; description?: string }>>([]);
  const [environment, setEnvironment] = useState<'STAGING' | 'PRODUCTION' | null>(() => {
    if (typeof window !== 'undefined' && (window.location.hostname.includes('staging') || window.location.hostname.includes('localhost') || window.location.hostname === '127.0.0.1')) {
      return 'STAGING';
    }
    return null;
  });
  const [tgDiag, setTgDiag] = useState<any>(null); // Preserve reference
  const [tgDiagError, setTgDiagError] = useState<string | undefined>(undefined);
  const _tgDiag = tgDiag;
  const [destinations, setDestinations] = useState<DestinationDiagItem[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [destError, setDestError] = useState<string | null>(null);
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [updatingMode, setUpdatingMode] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Staging Start From Scratch Reset State
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetLoadingPreview, setResetLoadingPreview] = useState(false);
  const [resetPreview, setResetPreview] = useState<{
    customers: number;
    loaders: number;
    routes: number;
    cpBundles: number;
    salePrices: number;
    purchaseCosts: number;
    paymentProfiles: number;
    orders: number;
    payments: number;
    staff: number;
    calcSessions: number;
  } | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [resetExecuting, setResetExecuting] = useState(false);
  const [userRole, setUserRole] = useState<string>('OWNER');

  useEffect(() => {
    // 1. Fetch Environment Isolation Mode & User Role
    fetch('/api/config/env')
      .then((r) => r.json())
      .then((data) => {
        if (data?.environment) {
          setEnvironment(data.environment);
        }
        if (data?.role) {
          setUserRole(data.role);
        }
      })
      .catch((e) => {
        console.error('Failed to fetch environment:', e);
      });

    // 2. Fetch Telegram diagnostics
    fetch('/api/telegram/status')
      .then((r) => r.json())
      .then((data) => {
        setTgDiag(data);
      })
      .catch((e) => { setTgDiagError(e?.message ?? 'Error loading diagnostics'); setTgDiag(null); });

    // 3. Fetch Feature Flags
    fetch('/api/feature-flags')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFlags(data);
        }
      })
      .catch((e) => {
        console.error('Failed to load feature flags:', e);
      })
      .finally(() => setLoadingFlags(false));

    // 4. Fetch Operational Telegram Destinations
    fetchDestinations();
  }, []);

  const fetchDestinations = () => {
    setLoadingDestinations(true);
    setDestError(null);
    fetch('/api/telegram/destinations/status')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.ok && Array.isArray(data.destinations)) {
          setDestinations(data.destinations);
        } else if (data && data.error) {
          setDestError(data.error);
        } else {
          setDestError('Unexpected response from server');
        }
      })
      .catch((e) => {
        setDestError(e?.message ?? 'Failed to load destinations');
      })
      .finally(() => setLoadingDestinations(false));
  };


  const handleSelectMode = async (mode: 'NORMAL' | 'SAFE_MODE' | 'READ_ONLY') => {
    if (mode === currentMode || updatingMode) return;
    setUpdatingMode(true);
    try {
      const res = await fetch('/api/settings/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update mode');

      onModeChange(data.mode || mode);
      setFeedback({ text: `Operational Mode updated to ${mode} and persisted to PostgreSQL.`, type: 'success' });
    } catch (err: any) {
      setFeedback({ text: `Mode switch failed: ${err.message}`, type: 'error' });
    }
    setUpdatingMode(false);
  };

  const handleToggleFlag = async (key: string, currentVal: boolean) => {
    try {
      const nextVal = !currentVal;
      const res = await fetch('/api/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: nextVal }),
      });
      if (!res.ok) throw new Error('Failed to update flag');

      setFlags((prev) =>
        prev.map((f) => (f.key === key ? { ...f, enabled: nextVal } : f))
      );
      setFeedback({ text: `Feature flag ${key} updated.`, type: 'success' });
    } catch (err: any) {
      setFeedback({ text: `Flag update failed: ${err.message}`, type: 'error' });
    }
  };

  const handleOpenResetModal = async () => {
    setResetLoadingPreview(true);
    setConfirmationInput('');
    try {
      const res = await fetch('/api/admin/reset-preview');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to fetch reset preview');
        setResetLoadingPreview(false);
        return;
      }
      const data = await res.json();
      setResetPreview(data);
      setResetModalOpen(true);
    } catch (err: any) {
      alert('Error loading reset preview: ' + err.message);
    }
    setResetLoadingPreview(false);
  };

  const handleExecuteReset = async () => {
    if (confirmationInput !== 'START FROM SCRATCH') return;
    setResetExecuting(true);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'START FROM SCRATCH' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert('❌ RESET REJECTED: ' + (data.error || 'Reset failed.'));
        setResetExecuting(false);
        return;
      }
      alert('✅ All business data wiped successfully. Starting fresh in SAFE MODE.');
      setResetModalOpen(false);
      window.location.reload();
    } catch (err: any) {
      alert('Reset error: ' + err.message);
      setResetExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Integrations & Operational Mode</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational mode controls, persisted feature flags, database engine architecture, and environment isolation.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Operational Mode Switcher */}
        <div className="lg:col-span-2">
          <Card title="System Operational Mode" subtitle="Controls bot autonomy and safeguard levels. Persisted to PostgreSQL.">
            <div className="space-y-6">

              {[
                {
                  id: 'NORMAL' as const,
                  title: 'NORMAL OPERATIONS',
                  desc: 'Automated order extraction, dynamic pricing calculation, and dispatch to loaders per group routing.',
                  badge: 'success' as const,
                },
                {
                  id: 'SAFE_MODE' as const,
                  title: 'SAFE MODE (MANUAL REVIEW)',
                  desc: 'All new orders hold in PENDING status for staff manual review and verification before dispatch.',
                  badge: 'warning' as const,
                },
                {
                  id: 'READ_ONLY' as const,
                  title: 'READ ONLY / EMERGENCY FREEZE',
                  desc: 'Telegram order ingestion and financial writes blocked. Bot returns maintenance notice.',
                  badge: 'danger' as const,
                },
              ].map((m) => (
                <div
                  key={m.id}
                  onClick={() => handleSelectMode(m.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start justify-between gap-4 ${
                    currentMode === m.id
                      ? 'bg-slate-900 border-cyan-500/80 shadow-md ring-1 ring-cyan-500/20'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="opMode"
                      checked={currentMode === m.id}
                      onChange={() => handleSelectMode(m.id)}
                      disabled={updatingMode}
                      className="mt-1 text-cyan-500 bg-slate-950 border-slate-800 focus:ring-0"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-100">{m.title}</h4>
                        <Badge variant={m.badge} size="sm">
                          {m.id === currentMode ? 'ACTIVE' : 'SELECT'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{m.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Database & Environment */}
        <div>
          <Card title="Runtime Environment" subtitle="Engine architecture">
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                <span className="text-slate-400">Environment:</span>
                <Badge variant={environment === 'PRODUCTION' ? 'purple' : 'info'} size="sm">
                  {environment || 'STAGING'}
                </Badge>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                <span className="text-slate-400">Database Engine:</span>
                <Badge variant="success" size="sm">PostgreSQL 16 (ACID)</Badge>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                <span className="text-slate-400">Encryption at Rest:</span>
                <Badge variant="purple" size="sm">AES-256-GCM (KMS)</Badge>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                <span className="text-slate-400">Financial Ledger:</span>
                <Badge variant="info" size="sm">Append-Only + FOR UPDATE</Badge>
              </div>
            </div>
          </Card>
        </div>

        {/* Telegram Diagnostics */}
        <div className="col-span-1">
          <Card title="Telegram Diagnostics" subtitle="Engine connectivity and webhook status.">
            {tgDiagError ? (
              <div className="py-4 text-center text-xs text-rose-300">Status: ERROR – Unable to load diagnostics</div>
            ) : tgDiag ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Bot Username:</span>
                  <Badge variant="info" size="sm">{tgDiag.botUsername || 'N/A'}</Badge>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Bot ID:</span>
                  <Badge variant="info" size="sm">{tgDiag.botId || 'N/A'}</Badge>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Webhook Target:</span>
                  <Badge variant="info" size="sm">{tgDiag.webhookTarget || 'None'}</Badge>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Webhook Status:</span>
                  <Badge variant={tgDiag.webhookStatus === 'HEALTHY' ? 'success' : tgDiag.webhookStatus === 'MISCONFIGURED' ? 'warning' : 'info'} size="sm">
                    {tgDiag.webhookStatus || 'UNKNOWN'}
                  </Badge>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Pending Updates:</span>
                  <Badge variant="info" size="sm">{tgDiag.pendingUpdateCount ?? 0}</Badge>
                </div>
                {tgDiag.lastWebhookError && (
                  <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                    <span className="text-slate-400">Last Webhook Error:</span>
                    <Badge variant="warning" size="sm">{tgDiag.lastWebhookError}</Badge>
                  </div>
                )}
                {tgDiag.requiresSeparateBot && (
                  <div className="p-3 bg-rose-950/20 border border-rose-900 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <span className="text-rose-300 text-sm">Separate Staging Telegram bot required.</span>
                  </div>
                )}
                <div className="p-3 bg-slate-950 rounded-lg flex items-center justify-between">
                  <span className="text-slate-400">Expected URL:</span>
                  <Badge variant="info" size="sm">{tgDiag.expectedUrl || 'N/A'}</Badge>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-slate-500">Loading Telegram diagnostics...</div>
            )}
          </Card>
        </div>

        {/* Operational Telegram Destinations */}
        <div className="lg:col-span-2">
          <Card
            title="Operational Telegram Destinations"
            subtitle="Railway environment destination check and connectivity status."
            action={
              <button
                onClick={fetchDestinations}
                disabled={loadingDestinations}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh destination connectivity"
              >
                <RefreshCw className={`w-3 h-3 ${loadingDestinations ? 'animate-spin text-cyan-400' : ''}`} />
                <span>Refresh</span>
              </button>
            }
          >
            {destError ? (
              <div className="py-4 text-center text-xs text-rose-300 font-medium">
                Status: ERROR – Unable to load destination status ({destError})
              </div>
            ) : loadingDestinations && !destinations.length ? (
              <div className="py-6 text-center text-xs text-slate-500 font-mono">
                Checking operational Telegram destinations...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="pb-2.5">Destination</th>
                      <th className="pb-2.5">Variable</th>
                      <th className="pb-2.5">Configured</th>
                      <th className="pb-2.5">Connection</th>
                      <th className="pb-2.5">Chat ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {destinations.map((d) => (
                      <tr key={d.variable} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-3 font-medium text-slate-200">
                          <div>{d.name}</div>
                          {d.chatTitle && (
                            <div className="text-[10px] text-cyan-400 font-sans mt-0.5">
                              {d.chatTitle}
                            </div>
                          )}
                          {d.error && (
                            <div className="text-[10px] text-rose-400 mt-0.5 max-w-xs break-words">
                              {d.error}
                            </div>
                          )}
                        </td>
                        <td className="py-3 font-mono text-[11px] text-slate-400">
                          {d.variable}
                        </td>
                        <td className="py-3">
                          <Badge variant={d.configured ? 'success' : 'warning'} size="sm">
                            {d.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <Badge
                            variant={
                              d.connection === 'CONNECTED'
                                ? 'success'
                                : d.connection === 'FAILED'
                                ? 'danger'
                                : d.connection === 'NOT_CONFIGURED'
                                ? 'default'
                                : 'warning'
                            }
                            size="sm"
                          >
                            {d.connection}
                          </Badge>
                        </td>
                        <td className="py-3 font-mono text-[11px] text-slate-300">
                          {d.maskedChatId || (
                            <span className="text-slate-600 italic font-sans">Not set</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
              <span>Set or update variables in Railway Dashboard → Variables.</span>
              <span className="text-slate-600 font-mono text-[10px]">Safe read-only getChat check</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Feature Flags */}
      <Card title="Operational Feature Flags" subtitle="Toggle core system behavior safely. Changes persist to PostgreSQL.">
        {loadingFlags ? (
          <div className="py-6 text-center text-xs text-slate-500 font-mono">Loading flags...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {flags.map((f) => (
              <div key={f.key} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-slate-100 font-mono text-[11px]">{f.key}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {f.description || 'System operational flag'}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={() => handleToggleFlag(f.key, f.enabled)}
                  className="mt-1 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Danger Zone: Visible to OWNER only */}
      {userRole === 'OWNER' && (
        <Card title="Danger Zone" subtitle="Irreversible administrative actions (Owner Only)" className="border-red-900/50">
          <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-red-500">Reset All Data / Start Fresh</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Completely wipes all business configuration and runtime data (customers, loaders, routes, CP bundles, sale prices, purchase costs, payment profiles, orders, payments, profit, calculator sessions) and sets operational mode to SAFE MODE. Preserves Owner and system infrastructure.
                </p>
              </div>
              <button
                onClick={handleOpenResetModal}
                disabled={resetLoadingPreview}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap shadow-md shadow-red-950"
              >
                {resetLoadingPreview ? 'Loading...' : 'RESET ALL DATA'}
              </button>
            </div>
          </div>
        </Card>
      )}


      {/* Strong Confirmation Modal for Start From Scratch */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => !resetExecuting && setResetModalOpen(false)}
        title="Reset All Data / Start Fresh"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-red-950/40 border border-red-800 rounded-lg text-red-300 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-200 text-sm">WARNING: Irreversible Database Reset</p>
              <p className="mt-1 leading-relaxed">
                This will wipe ALL business rows and set the system into a pristine "new installation" state with zero configured business entities. Operational mode will be set to SAFE MODE (Manual Review).
              </p>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1.5 font-mono text-slate-300">
            <div className="text-[11px] text-slate-400 font-semibold mb-2 uppercase tracking-wider">
              Destructive Preview:
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>Customers: <span className="text-red-400 font-bold">{resetPreview?.customers ?? 0} → 0</span></div>
              <div>Loaders: <span className="text-red-400 font-bold">{resetPreview?.loaders ?? 0} → 0</span></div>
              <div>Routes: <span className="text-red-400 font-bold">{resetPreview?.routes ?? 0} → 0</span></div>
              <div>CP Bundles: <span className="text-red-400 font-bold">{resetPreview?.cpBundles ?? 0} → 0</span></div>
              <div>Sale Prices: <span className="text-red-400 font-bold">{resetPreview?.salePrices ?? 0} → 0</span></div>
              <div>Purchase Costs: <span className="text-red-400 font-bold">{resetPreview?.purchaseCosts ?? 0} → 0</span></div>
              <div>Payment Profiles: <span className="text-red-400 font-bold">{resetPreview?.paymentProfiles ?? 0} → 0</span></div>
              <div>Orders: <span className="text-red-400 font-bold">{resetPreview?.orders ?? 0} → 0</span></div>
              <div>Payments: <span className="text-red-400 font-bold">{resetPreview?.payments ?? 0} → 0</span></div>
              <div>Staff: <span className="text-emerald-400 font-bold">{resetPreview?.staff ?? 0} → Owner only</span></div>
              <div>Calculator Sessions: <span className="text-red-400 font-bold">{resetPreview?.calcSessions ?? 0} → 0</span></div>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="block text-slate-300 font-semibold">
              To proceed, type <span className="font-mono text-red-400 font-bold">START FROM SCRATCH</span> exactly:
            </label>
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder="START FROM SCRATCH"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-red-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setResetModalOpen(false)}
              disabled={resetExecuting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirmationInput !== 'START FROM SCRATCH' || resetExecuting}
              onClick={handleExecuteReset}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg shadow-red-950 transition-colors flex items-center gap-2"
            >
              {resetExecuting ? 'Deleting Business Data...' : '[ DELETE ALL BUSINESS DATA ]'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
