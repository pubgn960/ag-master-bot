import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { BookOpen, TrendingUp, AlertTriangle, ShieldCheck, Play, Plus, Edit2, Trash2, CheckCircle2, RefreshCw, FileText } from 'lucide-react';

function parseBulkText(text: string) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const map = new Map<number, number>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    let normalized = line.replace(/(\d+),(\d+)/g, '$1$2');
    while (/(\d+),(\d+)/.test(normalized)) {
      normalized = normalized.replace(/(\d+),(\d+)/g, '$1$2');
    }
    const match = normalized.match(/^(\d+)(?:\s*cp)?\s*(?:=|:|-|->|\s)\s*\$?([0-9]+(?:\.[0-9]+)?)$/i);
    if (match) {
      const cp = parseInt(match[1], 10);
      const pr = parseFloat(match[2]);
      if (!isNaN(cp) && cp > 0 && !isNaN(pr) && pr >= 0) {
        map.set(cp, Number(pr.toFixed(2)));
      }
    }
  }
  return Array.from(map.entries())
    .map(([cpQuantity, price]) => ({ cpQuantity, price }))
    .sort((a, b) => a.cpQuantity - b.cpQuantity);
}

export const LoaderPricesView: React.FC = () => {
  const [loaders, setLoaders] = useState<any[]>([]);
  const [selectedLoaderId, setSelectedLoaderId] = useState<string>('');
  const [bundles, setBundles] = useState<any[]>([]);
  const [priceRows, setPriceRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMissingBundles, setShowMissingBundles] = useState<boolean>(false);

  // Edit / Simulation
  const [costEdits, setCostEdits] = useState<Record<string, number>>({});
  const [simulations, setSimulations] = useState<any[] | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Single Item Edit Modal
  const [editModal, setEditModal] = useState(false);
  const [editBundleId, setEditBundleId] = useState('');
  const [customCpQuantity, setCustomCpQuantity] = useState('');
  const [editCostInput, setEditCostInput] = useState('');
  const [savingSingle, setSavingSingle] = useState(false);

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
    bundleId: string;
    cpQuantity: number;
    bundleName: string;
    loaderName: string;
    currentCost?: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk Modal State
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<Array<{
    cpQuantity: number;
    cost: number;
    currentCost: number | null;
    isNewBundle: boolean;
  }> | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);

  const fetchLoadersAndBundles = async () => {
    setLoading(true);
    try {
      const [lRes, pRes] = await Promise.all([
        fetch('/api/loaders').then((r) => r.json()),
        fetch('/api/products').then((r) => r.json()),
      ]);

      if (Array.isArray(lRes) && lRes.length > 0) {
        setLoaders(lRes);
        const lId = selectedLoaderId || lRes[0].id;
        setSelectedLoaderId(lId);
        await fetchPriceBook(lId, showMissingBundles);
      }

      if (Array.isArray(pRes)) {
        const cpMap = new Map<number, any>();
        pRes.forEach((p: any) => {
          if (Array.isArray(p.bundles)) {
            p.bundles.forEach((b: any) => {
              if (!cpMap.has(b.cp_quantity)) {
                cpMap.set(b.cp_quantity, {
                  ...b,
                  name: `${b.cp_quantity.toLocaleString()} CP`,
                });
              }
            });
          }
        });
        const distinctBundles = Array.from(cpMap.values()).sort((a, b) => a.cp_quantity - b.cp_quantity);
        setBundles(distinctBundles);
      }
    } catch (err: any) {
      setFeedback({ text: `Error loading data: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  const fetchPriceBook = async (loaderId: string, includeMissing: boolean = showMissingBundles) => {
    try {
      const res = await fetch(`/api/loaders/${loaderId}/prices?includeMissing=${includeMissing}`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.prices) ? data.prices : [];
      setPriceRows(rows);

      const initial: Record<string, number> = {};
      rows.forEach((p: any) => {
        if (p.cost !== null && p.cost !== undefined) {
          initial[p.bundle_id] = parseFloat(p.cost);
          if (p.cp_quantity) {
            initial[`cp_${p.cp_quantity}`] = parseFloat(p.cost);
          }
        }
      });
      setCostEdits(initial);
      setSimulations(null);
    } catch {}
  };

  useEffect(() => {
    fetchLoadersAndBundles();
  }, []);

  const handleSimulate = async () => {
    if (!selectedLoaderId || displayBundles.length === 0) return;
    try {
      const items = displayBundles
        .map((b) => {
          const cost = costEdits[b.id] !== undefined ? costEdits[b.id] : costEdits[`cp_${b.cp_quantity}`];
          return { bundleId: b.id, newCost: cost };
        })
        .filter((item) => item.newCost !== undefined && !isNaN(item.newCost) && item.newCost > 0);

      const res = await fetch('/api/pricing/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loaderId: selectedLoaderId, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Simulation failed');
      setSimulations(data);
    } catch (err: any) {
      setFeedback({ text: `Simulation failed: ${err.message}`, type: 'error' });
    }
  };

  const handleApplyUpdate = async (bypassSafeguards: boolean = false) => {
    if (!selectedLoaderId || displayBundles.length === 0) return;
    try {
      const items = displayBundles
        .map((b) => {
          const cost = costEdits[b.id] !== undefined ? costEdits[b.id] : costEdits[`cp_${b.cp_quantity}`];
          return { bundleId: b.id, newCost: cost };
        })
        .filter((item) => item.newCost !== undefined && !isNaN(item.newCost) && item.newCost > 0);

      const res = await fetch(`/api/loaders/${selectedLoaderId}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, bypassSafeguards }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');

      setFeedback({
        text: `Price Book Version incremented to v${data.version || 2}! Downstream selling prices recomputed.`,
        type: 'success',
      });
      await fetchPriceBook(selectedLoaderId, showMissingBundles);
    } catch (err: any) {
      setFeedback({ text: `Update failed: ${err.message}`, type: 'error' });
    }
  };

  const handleSaveSingleCost = async () => {
    if (!selectedLoaderId) return;
    setSavingSingle(true);
    try {
      const costNum = parseFloat(editCostInput);
      if (isNaN(costNum) || costNum <= 0) throw new Error('Enter a valid positive cost price.');

      let targetBundleId = editBundleId;

      // Inline canonical bundle creation if new quantity entered or no bundles exist
      if ((!targetBundleId || targetBundleId === '__NEW__') && customCpQuantity) {
        const cpVal = parseInt(customCpQuantity, 10);
        if (isNaN(cpVal) || cpVal <= 0) {
          throw new Error('Please enter a valid positive CP quantity (e.g. 80)');
        }
        // Do not create duplicate CP bundles: reuse existing bundle if already present
        const existingCanonical = bundles.find((b) => b.cp_quantity === cpVal);
        if (existingCanonical) {
          targetBundleId = existingCanonical.id;
        } else {
          const bRes = await fetch('/api/products/bundles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpQuantity: cpVal, name: `${cpVal.toLocaleString()} CP` }),
          });
          const bData = await bRes.json();
          if (!bRes.ok) throw new Error(bData.error || 'Failed to create CP bundle');
          targetBundleId = bData.id;
        }
      }

      if (!targetBundleId || targetBundleId === '__NEW__') {
        throw new Error('Please select or enter a CP bundle quantity');
      }

      const res = await fetch(`/api/loaders/${selectedLoaderId}/prices/${targetBundleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost: costNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update cost');

      setFeedback({ text: 'Purchase cost saved and audited successfully.', type: 'success' });
      setEditModal(false);
      await fetchLoadersAndBundles();
      await fetchPriceBook(selectedLoaderId, showMissingBundles);
    } catch (err: any) {
      setFeedback({ text: `Failed: ${err.message}`, type: 'error' });
    }
    setSavingSingle(false);
  };

  const openAddCost = (bundleId?: string) => {
    const missing = bundles.find((b) => {
      const p = priceMap[b.id] || priceMap[`cp_${b.cp_quantity}`];
      return !p || p.cost === null || p.cost === undefined;
    });
    const targetId = bundleId || missing?.id || bundles[0]?.id || '';
    setEditBundleId(targetId);
    setCustomCpQuantity('');
    setEditCostInput('');
    setEditModal(true);
  };

  const openSingleEdit = (bundleId?: string, currentCost?: number) => {
    const targetId = bundleId || (bundles[0]?.id ?? '');
    const selectedB = bundles.find((b) => b.id === targetId);
    const p = priceMap[targetId] || (selectedB ? priceMap[`cp_${selectedB.cp_quantity}`] : undefined);
    const cost = currentCost !== undefined ? currentCost : (p && p.cost !== null && p.cost !== undefined ? parseFloat(p.cost) : undefined);
    setEditBundleId(targetId);
    setCustomCpQuantity('');
    setEditCostInput(cost !== undefined ? cost.toFixed(2) : '');
    setEditModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedLoaderId || !deleteModal) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/loaders/${selectedLoaderId}/prices/${deleteModal.bundleId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404 && data.error && data.error.includes('already missing')) {
          setFeedback({ text: 'Purchase cost is already missing.', type: 'error' });
          setDeleteModal(null);
          await fetchPriceBook(selectedLoaderId, showMissingBundles);
          return;
        }
        throw new Error(data.error || 'Failed to delete purchase cost');
      }
      setFeedback({ text: 'Purchase cost removed successfully.', type: 'success' });
      setDeleteModal(null);
      setCostEdits((prev) => {
        const next = { ...prev };
        delete next[deleteModal.bundleId];
        delete next[`cp_${deleteModal.cpQuantity}`];
        return next;
      });
      await fetchPriceBook(selectedLoaderId, showMissingBundles);
      await fetchLoadersAndBundles();
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to delete purchase cost', type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  // Price map for quick lookup
  const priceMap: Record<string, any> = {};
  priceRows.forEach((r) => {
    if (r.cost !== null && r.cost !== undefined) {
      priceMap[r.bundle_id] = r;
      if (r.cp_quantity) {
        priceMap[`cp_${r.cp_quantity}`] = r;
      }
    }
  });

  // Display bundles: hide unconfigured bundles by default unless showMissingBundles is enabled
  const displayBundles = showMissingBundles
    ? bundles
    : bundles.filter((b) => {
        const p = priceMap[b.id] || priceMap[`cp_${b.cp_quantity}`];
        return p && p.cost !== null && p.cost !== undefined;
      });

  const selectedLoader = loaders.find((l) => l.id === selectedLoaderId);

  const handleBulkPreview = () => {
    const parsed = parseBulkText(bulkText);
    if (parsed.length === 0) {
      setFeedback({
        text: 'No valid CP loader costs found in pasted text. Use format e.g. "80 = 0.88" or "2,400 = 14.00"',
        type: 'error',
      });
      return;
    }
    const bundleByCp = new Map<number, any>();
    bundles.forEach((b) => bundleByCp.set(b.cp_quantity, b));

    const previewList = parsed.map((item) => {
      const existingBundle = bundleByCp.get(item.cpQuantity);
      const p = existingBundle
        ? priceMap[existingBundle.id] || priceMap[`cp_${item.cpQuantity}`]
        : priceMap[`cp_${item.cpQuantity}`];
      const currentCost = p && p.cost ? parseFloat(p.cost) : null;
      return {
        cpQuantity: item.cpQuantity,
        cost: item.price,
        currentCost,
        isNewBundle: !existingBundle,
      };
    });

    setBulkPreview(previewList);
  };

  const handleApplyBulk = async () => {
    if (!selectedLoaderId || !bulkPreview || bulkPreview.length === 0) return;
    setSavingBulk(true);
    try {
      const res = await fetch(`/api/loaders/${selectedLoaderId}/prices/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: bulkPreview.map((p) => ({ cpQuantity: p.cpQuantity, cost: p.cost })),
          bypassSafeguards: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply bulk loader costs');

      setFeedback({
        text: `Successfully applied ${data.updatedCount || bulkPreview.length} shared loader costs (${data.createdCount || 0} bundles created)! Price Book version incremented.`,
        type: 'success',
      });
      setBulkModal(false);
      setBulkPreview(null);
      setBulkText('');
      await fetchLoadersAndBundles();
      await fetchPriceBook(selectedLoaderId, showMissingBundles);
    } catch (err: any) {
      setFeedback({ text: `Bulk update failed: ${err.message}`, type: 'error' });
    }
    setSavingBulk(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Purchase Costs</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Canonical loader cost management, version-controlled price books, anomaly limits, and cooldown safeguards.
          </p>
        </div>

        {/* Loader Select & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Select Loader:</span>
            <select
              value={selectedLoaderId}
              onChange={(e) => {
                const lId = e.target.value;
                setSelectedLoaderId(lId);
                fetchPriceBook(lId, showMissingBundles);
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
            >
              {loaders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.display_name || l.name || l.code}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 transition-colors select-none text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showMissingBundles}
              onChange={(e) => {
                const nextVal = e.target.checked;
                setShowMissingBundles(nextVal);
                fetchPriceBook(selectedLoaderId, nextVal);
              }}
              className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="font-medium text-slate-300">Show Missing Bundles</span>
          </label>

          <button
            onClick={() => {
              setBulkText('');
              setBulkPreview(null);
              setBulkModal(true);
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Bulk Update Costs
          </button>

          <button
            onClick={() => openAddCost()}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            + Add Cost
          </button>
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

      {/* Safeguards & Cooldown Banner */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-950/60 border border-cyan-800/80 rounded-lg text-cyan-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-200">
              Active Price Book: v{priceRows[0]?.version || 1} • {selectedLoader?.display_name || 'Loader'}
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              30-min cooldown batching is active. Anomaly thresholds: max 25% single-step increase, max $15 absolute change.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSimulate}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3 h-3 text-cyan-400" />
            Simulate Selling Prices
          </button>
          <button
            onClick={() => handleApplyUpdate(false)}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            Apply & Batch Update
          </button>
        </div>
      </div>

      {/* Simulation Results Drawer if open */}
      {simulations && (
        <Card title="Price Simulation (Dry Run)" subtitle="Downstream impacts on customer groups if applied">
          <div className="overflow-x-auto text-xs font-mono max-h-60 overflow-y-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2">GROUP</th>
                  <th className="pb-2">PACKAGE</th>
                  <th className="pb-2">NEW COST</th>
                  <th className="pb-2">NEW SALE</th>
                  <th className="pb-2">PROJECTED MARGIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {simulations.map((sim, i) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="py-2 text-slate-300 font-semibold">{sim.groupTitle}</td>
                    <td className="py-2 text-slate-400">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{sim.bundleName}</span>
                        {sim.hasOverride && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Override Active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-slate-200">${Number(sim.loaderCost).toFixed(2)}</td>
                    <td className="py-2 text-emerald-400 font-bold">${Number(sim.newSalePrice).toFixed(2)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={sim.isNegativeMargin ? 'text-rose-400 font-bold' : 'text-cyan-300 font-semibold'}>
                          {sim.margin >= 0 ? `+$${Number(sim.margin).toFixed(2)}` : `-$${Math.abs(Number(sim.margin)).toFixed(2)}`}
                        </span>
                        {sim.hasOverride && (
                          <span className="text-[10px] text-amber-400/80 font-mono">
                            ({sim.overrideType === 'FIXED_PRICE' ? 'Locked Price' : 'Fixed Margin'})
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Package Cost Sheet */}
      <Card
        title="Package Cost Sheet"
        subtitle={
          showMissingBundles
            ? "Showing all canonical CP bundles including unconfigured (MISSING)"
            : "Showing only configured purchase costs for this loader"
        }
      >
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading package costs...</div>
        ) : loaders.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-200">No Purchase Costs configured</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No loaders or purchase costs are currently configured. Create a loader first to configure purchase costs.
            </p>
          </div>
        ) : displayBundles.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-200">No Purchase Costs configured</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {showMissingBundles
                ? "No canonical CP bundles exist yet. Add the first CP bundle below."
                : "No purchase costs are currently configured for this loader. Click below to add a cost or enable 'Show Missing Bundles'."}
            </p>
            <button
              onClick={() => openAddCost()}
              className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              + Add Cost
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">Package / CP</th>
                  <th className="pb-3 font-medium">Current Cost</th>
                  <th className="pb-3 font-medium">New Cost</th>
                  <th className="pb-3 font-medium">Last Updated</th>
                  <th className="pb-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium font-mono">
                {displayBundles.map((b: any) => {
                  const p = priceMap[b.id] || priceMap[`cp_${b.cp_quantity}`];
                  const currentCost = p && p.cost !== null && p.cost !== undefined ? parseFloat(p.cost) : undefined;
                  const editVal = costEdits[b.id] !== undefined ? costEdits[b.id] : (costEdits[`cp_${b.cp_quantity}`] !== undefined ? costEdits[`cp_${b.cp_quantity}`] : (currentCost !== undefined ? currentCost : ''));

                  return (
                    <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 text-slate-100 font-semibold">{b.name}</td>
                      <td className="py-3">
                        {currentCost !== undefined ? (
                          <span className="text-emerald-400 font-bold text-sm">${currentCost.toFixed(2)}</span>
                        ) : (
                          <Badge variant="warning" size="sm">
                            MISSING
                          </Badge>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="relative w-28">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={editVal}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setCostEdits((prev) => ({
                                ...prev,
                                [b.id]: !isNaN(val) ? val : 0,
                                [`cp_${b.cp_quantity}`]: !isNaN(val) ? val : 0,
                              }));
                            }}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 pl-5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </td>
                      <td className="py-3 text-[11px] text-slate-400">
                        {p?.effective_from ? new Date(p.effective_from).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-3 text-right font-sans">
                        {currentCost !== undefined ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openSingleEdit(b.id, currentCost)}
                              className="px-2 py-1 text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors text-xs flex items-center gap-1"
                              title="Edit Cost"
                            >
                              <Edit2 className="w-3 h-3" /> Edit
                            </button>
                            <button
                              onClick={() => {
                                const currentLoader = loaders.find((l) => l.id === selectedLoaderId);
                                setDeleteModal({
                                  bundleId: p?.bundle_id || b.id,
                                  cpQuantity: b.cp_quantity,
                                  bundleName: b.name || `${b.cp_quantity?.toLocaleString() || b.cp_quantity} CP`,
                                  loaderName: currentLoader?.display_name || currentLoader?.name || 'this loader',
                                  currentCost,
                                });
                              }}
                              className="px-2 py-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors text-xs flex items-center gap-1"
                              title="Delete / Remove Cost"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openAddCost(b.id)}
                              className="px-2 py-1 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/40 rounded transition-colors text-xs flex items-center gap-1 font-semibold"
                              title="Add Cost for this bundle"
                            >
                              <Plus className="w-3 h-3" /> + Add Cost
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit / Add Cost Modal */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title={
          editBundleId && priceMap[editBundleId] && priceMap[editBundleId].cost !== null && priceMap[editBundleId].cost !== undefined
            ? 'Edit Loader Purchase Cost'
            : 'Add Loader Purchase Cost'
        }
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs font-sans">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">CP Bundle:</label>
            {bundles.length === 0 ? (
              <div className="space-y-1">
                <input
                  type="number"
                  placeholder="Enter CP quantity (e.g. 80)"
                  value={customCpQuantity}
                  onChange={(e) => setCustomCpQuantity(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[11px] text-slate-500">
                  Creates or reuses the canonical shared CP bundle across products.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={editBundleId}
                  onChange={(e) => {
                    setEditBundleId(e.target.value);
                    if (e.target.value !== '__NEW__') {
                      const selectedB = bundles.find((b) => b.id === e.target.value);
                      const p = priceMap[e.target.value] || (selectedB ? priceMap[`cp_${selectedB.cp_quantity}`] : undefined);
                      setEditCostInput(p && p.cost !== null && p.cost !== undefined ? parseFloat(p.cost).toFixed(2) : '');
                    } else {
                      setEditCostInput('');
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                >
                  {bundles.map((b) => {
                    const p = priceMap[b.id] || priceMap[`cp_${b.cp_quantity}`];
                    const isConfigured = p && p.cost !== null && p.cost !== undefined;
                    return (
                      <option key={b.id} value={b.id}>
                        {b.name} {!isConfigured ? '(Missing Cost)' : ''}
                      </option>
                    );
                  })}
                  <option value="__NEW__">+ Enter new CP quantity...</option>
                </select>
                {editBundleId === '__NEW__' && (
                  <input
                    type="number"
                    placeholder="Enter CP quantity (e.g. 80)"
                    value={customCpQuantity}
                    onChange={(e) => setCustomCpQuantity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                  />
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Purchase Cost ($ USD):</label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 0.00"
              value={editCostInput}
              onChange={(e) => setEditCostInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Anomaly safeguards apply. Updates price book version.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditModal(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingSingle}
              onClick={handleSaveSingleCost}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
            >
              {savingSingle ? 'Saving...' : 'Save Cost'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Update Purchase Costs Modal */}
      <Modal
        isOpen={bulkModal}
        onClose={() => {
          setBulkModal(false);
          setBulkPreview(null);
        }}
        title="Bulk Update Purchase Costs"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4 text-xs font-sans">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Target Loader:</label>
            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 font-mono flex items-center justify-between">
              <span>{selectedLoader?.display_name || selectedLoader?.name || selectedLoader?.code}</span>
              <Badge variant="info" size="sm">Active Loader</Badge>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Paste Shared Loader Costs:</label>
            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value);
                setBulkPreview(null);
              }}
              placeholder={`80 = 0.88\n420 = 3.70\n880 = 6.50\n2,400 = 14.00\n4800 = 28.50`}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Format: &lt;CP&gt; = &lt;Cost&gt; (Supports comma quantities like 2,400, separators =, :, -, or space).
            </p>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={handleBulkPreview}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg font-semibold flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Preview Changes
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setBulkModal(false);
                  setBulkPreview(null);
                }}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!bulkPreview || bulkPreview.length === 0 || savingBulk}
                onClick={handleApplyBulk}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5"
              >
                {savingBulk ? 'Applying...' : `Confirm & Apply (${bulkPreview?.length || 0} Costs)`}
              </button>
            </div>
          </div>

          {bulkPreview && (
            <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex justify-between items-center">
                <span className="font-semibold text-slate-200">
                  Preview: {bulkPreview.length} Bundle Costs to Update
                </span>
                <span className="text-[11px] text-slate-400">
                  {bulkPreview.filter((p) => p.isNewBundle).length} new bundles will be created
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto font-mono text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2">Package / CP</th>
                      <th className="p-2">Current Cost</th>
                      <th className="p-2">New Cost</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {bulkPreview.map((p) => (
                      <tr key={p.cpQuantity} className="hover:bg-slate-900/50">
                        <td className="p-2 text-slate-200 font-semibold">{p.cpQuantity.toLocaleString()} CP</td>
                        <td className="p-2 text-slate-400">
                          {p.currentCost !== null ? `$${p.currentCost.toFixed(2)}` : '-'}
                        </td>
                        <td className="p-2 text-emerald-400 font-bold">${p.cost.toFixed(2)}</td>
                        <td className="p-2">
                          {p.isNewBundle ? (
                            <Badge variant="purple" size="sm">NEW BUNDLE</Badge>
                          ) : (
                            <Badge variant="info" size="sm">UPDATE</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Cost Confirmation Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => !deleting && setDeleteModal(null)}
        title="Remove Purchase Cost"
        maxWidth="max-w-md"
      >
        {deleteModal && (
          <div className="space-y-4 text-xs font-sans">
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
              <p className="text-slate-200 text-sm font-medium mb-1">
                Remove purchase cost for <span className="text-white font-bold">{deleteModal.bundleName}</span> from <span className="text-cyan-400 font-bold">{deleteModal.loaderName}</span>?
              </p>
              <p className="text-slate-400 text-xs mt-2">
                This will not delete the CP bundle or sale price.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                disabled={deleting}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-sm"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Deleting...
                  </>
                ) : (
                  'Delete Cost'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
