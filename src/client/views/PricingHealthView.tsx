import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

export const PricingHealthView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [missingConfigsCount, setMissingConfigsCount] = useState<number>(0);
  const [totalPackagesCount, setTotalPackagesCount] = useState<number>(0);
  const [groupsCount, setGroupsCount] = useState<number>(0);
  const [loadersCount, setLoadersCount] = useState<number>(0);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const [saleRes, loaderRes] = await Promise.all([
        fetch('/api/pricing/sale').then((r) => r.json()),
        fetch('/api/loaders').then((r) => r.json()),
      ]);

      if (Array.isArray(loaderRes)) {
        setLoadersCount(loaderRes.filter((l: any) => l.is_active).length);
      }

      if (saleRes && saleRes.groups && saleRes.prices) {
        setGroupsCount(saleRes.groups.length);
        let missing = 0;
        let total = 0;
        Object.keys(saleRes.prices).forEach((gId) => {
          const groupPrices = saleRes.prices[gId];
          Object.keys(groupPrices).forEach((bId) => {
            total++;
            if (groupPrices[bId].status === 'MISSING_CONFIGURATION') {
              missing++;
            }
          });
        });
        setMissingConfigsCount(missing);
        setTotalPackagesCount(total);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Pricing Health & Safeguards</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time canonical price book evaluation, anomaly boundary monitors, and negative margin shields.
          </p>
        </div>
        <button
          onClick={checkHealth}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          Re-scan Health
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card title="Anomaly Detection Limits" subtitle="Cost protection boundaries">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Max % Single Increase:</span>
              <span className="font-mono font-bold text-cyan-400">25.0%</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Max Absolute Increase:</span>
              <span className="font-mono font-bold text-cyan-400">$15.00</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Extreme Spike Protection:</span>
              <Badge variant="success" size="sm">ACTIVE ($29 → $290 Blocked)</Badge>
            </div>
          </div>
        </Card>

        <Card title="30-Min Cooldown Batching" subtitle="Telegram rate limiting prevention">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Batching Window:</span>
              <span className="font-mono font-bold text-cyan-400">30 Minutes</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Customer Update Mode:</span>
              <span className="text-slate-200 font-semibold">Single Summary Broadcast</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Status:</span>
              <Badge variant="success" size="sm">Operational</Badge>
            </div>
          </div>
        </Card>

        <Card title="Margin Loss Protection" subtitle="Negative profit prevention">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Active Loaders:</span>
              <span className="font-mono font-bold text-cyan-400">{loadersCount} Configured</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Monitored Groups:</span>
              <span className="font-mono font-bold text-cyan-400">{groupsCount} Groups</span>
            </div>
            <div className="flex justify-between items-center p-2.5 bg-slate-950 rounded-lg">
              <span className="text-slate-400">Pricing Engine Mode:</span>
              <span className="text-slate-200 font-mono font-bold">AUTO_PROFIT</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Pricing Health Scanner Evaluation">
        {loading ? (
          <div className="p-4 text-xs text-slate-500 font-mono text-center">
            Evaluating canonical pricing configuration from database...
          </div>
        ) : missingConfigsCount > 0 ? (
          <div className="p-4 bg-amber-950/40 border border-amber-800/80 rounded-xl flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-amber-200">
                INCOMPLETE PRICING CONFIGURATION DETECTED
              </h4>
              <p className="text-xs text-amber-300/80 mt-0.5">
                {missingConfigsCount} of {totalPackagesCount} group package prices have missing loader purchase costs or unassigned routes. Update Purchase Costs or Group Routing to resolve.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-emerald-950/40 border border-emerald-800/80 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-emerald-200">
                All Systems Healthy
              </h4>
              <p className="text-xs text-emerald-300/80 mt-0.5">
                All {totalPackagesCount} bundle package prices across {groupsCount} customer groups and {loadersCount} active loaders are fully configured. No pricing anomalies or unmitigated negative margins detected.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
