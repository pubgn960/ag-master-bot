import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { DollarSign, RefreshCw, Plus, Edit2, AlertTriangle, CheckCircle2, FileText, Play, RotateCcw } from 'lucide-react';

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

function formatCustomerPrice(price: number | string): string {
  const num = typeof price === 'number' ? price : parseFloat(String(price));
  if (isNaN(num)) return '0$';
  const rounded = Math.round(num * 100) / 100;
  if (rounded % 1 === 0) {
    return `${Math.round(rounded)}$`;
  }
  return `${rounded.toFixed(2)}$`;
}

function formatCustomerPriceLine(cpQuantity: number, price: number | string): string {
  const formattedQuantity = Number(cpQuantity).toLocaleString('en-US');
  const formattedPrice = formatCustomerPrice(price);
  return `💎${formattedQuantity} 👉 ${formattedPrice}`;
}

function generateGroupCustomerPriceList(groupBundles: any[], groupPrices: Record<string, any>): string {
  const items: Array<{ cpQuantity: number; price: number }> = [];
  const seenCp = new Set<number>();
  for (const b of groupBundles) {
    const cp = parseInt(b.cp_quantity, 10);
    if (isNaN(cp) || seenCp.has(cp)) continue;
    const cell = groupPrices[b.id];
    if (cell && cell.status === 'CONFIGURED' && typeof cell.salePrice === 'number') {
      seenCp.add(cp);
      items.push({ cpQuantity: cp, price: cell.salePrice });
    }
  }
  if (items.length === 0) return 'No packages currently available.';
  items.sort((a, b) => a.cpQuantity - b.cpQuantity);
  const lines = ['💎 CP Price List', ''];
  for (const item of items) {
    lines.push(formatCustomerPriceLine(item.cpQuantity, item.price));
  }
  return lines.join('\n');
}

export const CurrentPricesView: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [bundles, setBundles] = useState<any[]>([]);
  const [priceMatrix, setPriceMatrix] = useState<Record<string, Record<string, any>>>({});
  const [loaderCosts, setLoaderCosts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const [showMissingConfigs, setShowMissingConfigs] = useState<boolean>(false);

  // Modal State
  const [editModal, setEditModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedBundle, setSelectedBundle] = useState<string>('');
  const [customCpQuantity, setCustomCpQuantity] = useState<string>('');
  const [salePriceInput, setSalePriceInput] = useState<string>('');
  const [targetProfitInput, setTargetProfitInput] = useState<string>('1.50');
  const [pricingType, setPricingType] = useState<'AUTO_PROFIT' | 'FIXED_PRICE'>('AUTO_PROFIT');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Bulk Modal State
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkTargetGroup, setBulkTargetGroup] = useState('all');
  const [bulkPreview, setBulkPreview] = useState<Array<{
    cpQuantity: number;
    price: number;
    currentPrice: number | null;
    isNewBundle: boolean;
  }> | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);

  // Customer Price List Preview State
  const [previewGroupPrices, setPreviewGroupPrices] = useState<{ groupTitle: string; text: string } | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  const fetchPriceMatrix = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pricing/sale?status=all');
      const data = await res.json();
      if (data && data.groups && data.bundles) {
        setGroups(data.groups);
        setBundles(data.bundles);
        setPriceMatrix(data.prices || {});
        setLoaderCosts(data.loaderCosts || {});
      }
    } catch (err: any) {
      setFeedback({ text: `Failed to load price matrix: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPriceMatrix();
  }, []);

  const openEditModal = (groupId?: string, bundleId?: string) => {
    const gId = groupId || groups[0]?.id || '';
    const bId = bundleId || bundles[0]?.id || '';
    setSelectedGroup(gId);
    setSelectedBundle(bId);
    setCustomCpQuantity('');

    const existing = priceMatrix[gId]?.[bId];
    if (existing && existing.status === 'CONFIGURED') {
      setSalePriceInput(existing.salePrice?.toFixed(2) || '');
      setTargetProfitInput(existing.targetProfit?.toFixed(2) || '1.50');
      setPricingType(existing.pricingMode || 'AUTO_PROFIT');
    } else {
      setSalePriceInput('');
      setTargetProfitInput('1.50');
      setPricingType('AUTO_PROFIT');
    }
    setEditModal(true);
  };

  // Helper variables for selected group, bundle, and calculation preview in modal
  const selectedGroupObj = groups.find((g) => g.id === selectedGroup);
  const selectedBundleObj = bundles.find((b) => b.id === selectedBundle);
  const currentCpQty = selectedBundleObj
    ? selectedBundleObj.cp_quantity
    : parseInt(customCpQuantity, 10) || 0;
  const assignedLoaderId = selectedGroupObj?.assigned_loader_id || null;
  const assignedLoaderName = selectedGroupObj?.assigned_loader_name || 'Unassigned Loader';

  // Resolve loader purchase cost: from loaderCosts dictionary, or fallback to existing cell.loaderCost
  let loaderPurchaseCost: number | null = null;
  if (assignedLoaderId && loaderCosts[assignedLoaderId]) {
    const fromDict =
      loaderCosts[assignedLoaderId][selectedBundle] ??
      loaderCosts[assignedLoaderId][`cp_${currentCpQty}`];
    if (typeof fromDict === 'number') {
      loaderPurchaseCost = fromDict;
    }
  }
  if (loaderPurchaseCost === null && selectedGroup && selectedBundle) {
    const existingCell = priceMatrix[selectedGroup]?.[selectedBundle];
    if (existingCell && typeof existingCell.loaderCost === 'number' && existingCell.loaderCost > 0) {
      loaderPurchaseCost = existingCell.loaderCost;
    }
  }

  const parsedTargetProfit = parseFloat(targetProfitInput);
  const validTargetProfit = !isNaN(parsedTargetProfit) ? parsedTargetProfit : 0;
  const parsedSalePrice = parseFloat(salePriceInput);
  const validSalePrice = !isNaN(parsedSalePrice) ? parsedSalePrice : 0;

  const calculatedSellingPrice =
    loaderPurchaseCost !== null ? Number((loaderPurchaseCost + validTargetProfit).toFixed(2)) : null;
  const expectedProfitAuto = loaderPurchaseCost !== null ? validTargetProfit : null;
  const expectedProfitFixed =
    loaderPurchaseCost !== null && !isNaN(parsedSalePrice)
      ? Number((validSalePrice - loaderPurchaseCost).toFixed(2))
      : null;

  const handleSavePrice = async () => {
    if (!selectedGroup) {
      setFeedback({ text: 'Please select a customer group first.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      let finalBundleId = selectedBundle;

      // Inline canonical bundle creation if new quantity entered or no bundles exist
      if ((!finalBundleId || finalBundleId === '__NEW__') && customCpQuantity) {
        const cpVal = parseInt(customCpQuantity, 10);
        if (isNaN(cpVal) || cpVal <= 0) {
          throw new Error('Please enter a valid positive CP quantity (e.g. 80)');
        }
        const bRes = await fetch('/api/products/bundles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpQuantity: cpVal, name: `${cpVal.toLocaleString()} CP` }),
        });
        const bData = await bRes.json();
        if (!bRes.ok) throw new Error(bData.error || 'Failed to create CP bundle');
        finalBundleId = bData.id;
      }

      if (!finalBundleId || finalBundleId === '__NEW__') {
        throw new Error('Please select or enter a CP bundle quantity');
      }

      let priceToSend: number;
      let profitToSend: number;

      if (pricingType === 'AUTO_PROFIT') {
        if (loaderPurchaseCost === null) {
          throw new Error(
            `Loader purchase cost missing for ${currentCpQty > 0 ? `${currentCpQty.toLocaleString()} CP` : 'this bundle'} / ${assignedLoaderName}. Add purchase cost first or use a valid configured bundle.`
          );
        }
        const profitVal = parseFloat(targetProfitInput);
        if (isNaN(profitVal) || profitVal < 0) {
          throw new Error('Please enter a valid target profit margin');
        }
        profitToSend = profitVal;
        priceToSend = Number((loaderPurchaseCost + profitVal).toFixed(2));
      } else {
        const priceVal = parseFloat(salePriceInput);
        if (isNaN(priceVal) || priceVal <= 0) {
          throw new Error('Please enter a valid positive fixed selling price');
        }
        priceToSend = priceVal;
        profitToSend = loaderPurchaseCost !== null ? Number((priceVal - loaderPurchaseCost).toFixed(2)) : 0;
      }

      const res = await fetch('/api/pricing/sale', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroup,
          bundleId: finalBundleId,
          salePrice: priceToSend,
          targetProfit: profitToSend,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save price');

      setFeedback({
        text: `Customer-specific sale price for ${selectedGroupObj?.title || 'customer'} successfully persisted and audited.`,
        type: 'success',
      });
      setEditModal(false);
      await fetchPriceMatrix();
    } catch (err: any) {
      setFeedback({ text: `Save failed: ${err.message}`, type: 'error' });
    }
      setSaving(false);
    };

    const [resetting, setResetting] = useState(false);

    const handleResetOverride = async (groupId: string, bundleId: string, resetAll: boolean = false) => {
      const promptMsg = resetAll
        ? 'Reset manual price override across ALL groups for this bundle back to Auto Profit?'
        : 'Reset manual price override for this customer group back to Auto Profit?';
      if (!window.confirm(promptMsg)) {
        return;
      }

      setResetting(true);
      try {
        const res = await fetch('/api/pricing/sale/override', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId,
            bundleId,
            resetAllGroups: resetAll,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove override');

        setFeedback({
          text: data.message || 'Manual override removed successfully. Returned to Auto Profit.',
          type: 'success',
        });
        setEditModal(false);
        await fetchPriceMatrix();
      } catch (err: any) {
        setFeedback({ text: `Reset failed: ${err.message}`, type: 'error' });
      } finally {
        setResetting(false);
      }
    };

  const handleBulkPreview = () => {
    const parsed = parseBulkText(bulkText);
    if (parsed.length === 0) {
      setFeedback({ text: 'No valid CP prices found in pasted text. Use format e.g. "80 = 0.90" or "2,400 = 15.50"', type: 'error' });
      return;
    }
    const targetGId = (!bulkTargetGroup || bulkTargetGroup === 'all') ? (groups[0]?.id || '') : bulkTargetGroup;
    const bundleByCp = new Map<number, any>();
    bundles.forEach((b) => bundleByCp.set(b.cp_quantity, b));

    const previewList = parsed.map((item) => {
      const existingBundle = bundleByCp.get(item.cpQuantity);
      const cell = existingBundle ? priceMatrix[targetGId]?.[existingBundle.id] : null;
      const currentPrice = cell && cell.status === 'CONFIGURED' ? Number(cell.salePrice) : null;
      return {
        cpQuantity: item.cpQuantity,
        price: item.price,
        currentPrice,
        isNewBundle: !existingBundle,
      };
    });

    setBulkPreview(previewList);
  };

  const handleApplyBulk = async () => {
    if (!bulkPreview || bulkPreview.length === 0) return;
    setSavingBulk(true);
    try {
      const targetGId = bulkTargetGroup || '';
      const payload: any = {
        groupIds: (!targetGId || targetGId === 'all') ? 'all' : [targetGId],
        items: bulkPreview.map((p) => ({ cpQuantity: p.cpQuantity, salePrice: p.price })),
      };
      if (targetGId && targetGId !== 'all') {
        payload.groupId = targetGId;
      }

      const res = await fetch('/api/pricing/sale/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply bulk sale prices');

      setFeedback({
        text: data.message || `Successfully applied ${data.updatedCount || bulkPreview.length} sale prices (${data.createdCount || 0} bundles created)!`,
        type: 'success',
      });
      setBulkModal(false);
      setBulkPreview(null);
      setBulkText('');
      await fetchPriceMatrix();
    } catch (err: any) {
      setFeedback({ text: `Bulk update failed: ${err.message}`, type: 'error' });
    }
    setSavingBulk(false);
  };

  const filteredGroups = groups.filter((g) => {
    if (statusFilter === 'ACTIVE' && g.is_active === false) return false;
    if (statusFilter === 'INACTIVE' && g.is_active !== false) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.title?.toLowerCase().includes(q) ||
      g.telegram_chat_id?.includes(q) ||
      g.assigned_loader_name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Sale Prices</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Live group-specific /prices customer selling prices, profit margins, and canonical database configuration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setBulkTargetGroup(selectedGroup || 'all');
              setBulkText('');
              setBulkPreview(null);
              setBulkModal(true);
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Bulk Update Prices
          </button>
          <button
            onClick={() => openEditModal()}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Set Sale Price
          </button>
          <button
            onClick={fetchPriceMatrix}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh Matrix
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

      {/* Filter and View Controls Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Filter groups by title or chat ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Customer Group Status Filter (Active / Inactive / All) */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-medium">
            {(['ACTIVE', 'INACTIVE', 'ALL'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md transition-colors capitalize ${
                  statusFilter === st
                    ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Show Missing Configurations Toggle (Default: OFF) */}
        <label className="flex items-center gap-2 cursor-pointer bg-slate-950 hover:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs transition-colors select-none">
          <input
            type="checkbox"
            checked={showMissingConfigs}
            onChange={(e) => setShowMissingConfigs(e.target.checked)}
            className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
          />
          <span className="font-medium text-slate-300">Show Missing Configurations</span>
        </label>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 font-mono">
          Calculating canonical selling prices matrix from PostgreSQL...
        </div>
      ) : filteredGroups.length === 0 || bundles.length === 0 ? (
        <div className="py-16 text-center bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8">
          <DollarSign className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-200">No Sale Prices configured</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {statusFilter === 'INACTIVE'
              ? 'No inactive customer groups found.'
              : 'No sale prices are currently configured. Create CP bundles and assign sale prices per customer group.'}
          </p>
          <button
            onClick={() => openEditModal()}
            className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            + Add Sale Price
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {filteredGroups.map((g) => {
            const isVip = g.price_profile_name?.includes('Wholesale') || g.title?.includes('Wholesale') || g.title?.includes('VIP');
            const isInactive = g.is_active === false;
            const groupPrices = priceMatrix[g.id] || {};

            // In default view (showMissingConfigs === false), show only configured prices
            const visibleBundles = showMissingConfigs
              ? bundles
              : bundles.filter((b) => groupPrices[b.id]?.status === 'CONFIGURED');

            return (
              <div
                key={g.id}
                className={isInactive ? 'opacity-75 ring-1 ring-amber-500/40 rounded-2xl transition-all' : 'transition-all'}
              >
                <Card
                  title={
                    <div className="flex items-center gap-2">
                      <span>{g.title}</span>
                      {isInactive && (
                        <Badge variant="warning" size="sm">
                          INACTIVE
                        </Badge>
                      )}
                    </div>
                  }
                  subtitle={`Chat ID: ${g.telegram_chat_id || 'Unbound'} • Loader: ${g.assigned_loader_name || 'Unassigned'} • Profile: ${g.price_profile_name || 'Standard Retail'}`}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const txt = generateGroupCustomerPriceList(bundles, groupPrices);
                          setPreviewGroupPrices({ groupTitle: g.title, text: txt });
                          setCopiedText(false);
                        }}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-[11px] font-medium transition-colors"
                        title="Preview Telegram /prices message"
                      >
                        💎 /prices Preview
                      </button>
                      <Badge variant={isVip ? 'purple' : 'info'} size="sm">
                        {g.price_profile_name || 'Standard Retail'}
                      </Badge>
                    </div>
                  }
                >
                  <div className="overflow-x-auto text-xs max-h-96 overflow-y-auto">
                    <table className="w-full text-left font-mono">
                      <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400 z-10">
                        <tr>
                          <th className="pb-2 pt-1 font-medium">Package / CP</th>
                          <th className="pb-2 pt-1 font-medium">Sale Price</th>
                          <th className="pb-2 pt-1 font-medium">Last Updated</th>
                          <th className="pb-2 pt-1 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {visibleBundles.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-slate-500 font-sans italic">
                              No configured sale prices for this group.{' '}
                              <button
                                onClick={() => setShowMissingConfigs(true)}
                                className="text-cyan-400 underline hover:text-cyan-300 ml-1"
                              >
                                Show Missing Configurations
                              </button>{' '}
                              or{' '}
                              <button
                                onClick={() => openEditModal(g.id)}
                                className="text-cyan-400 underline hover:text-cyan-300"
                              >
                                + Set Sale Price
                              </button>
                              .
                            </td>
                          </tr>
                        ) : (
                          visibleBundles.map((b: any) => {
                            const cell = groupPrices[b.id];
                            const isConfigured = cell && cell.status === 'CONFIGURED';

                            return (
                              <tr key={b.id} className="hover:bg-slate-800/30">
                                <td className="py-2 text-slate-200 font-semibold flex items-center gap-1.5">
                                  <span>{b.name || `${b.cp_quantity.toLocaleString()} CP`}</span>
                                  {cell?.isManualOverride && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/70 border border-amber-600/70 text-amber-300" title="Manual price override active">
                                      OVERRIDE
                                    </span>
                                  )}
                                </td>
                                <td className="py-2">
                                  {isConfigured ? (
                                    <span className="text-emerald-400 font-bold">
                                      ${Number(cell.salePrice).toFixed(2)}
                                    </span>
                                  ) : (
                                    <Badge variant="warning" size="sm">
                                      MISSING CONFIGURATION
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-2 text-slate-400 text-[11px]">
                                  {cell?.updatedAt ? new Date(cell.updatedAt).toLocaleDateString() : '-'}
                                </td>
                                <td className="py-2 text-right whitespace-nowrap">
                                  {cell?.isManualOverride && (
                                    <button
                                      onClick={() => handleResetOverride(g.id, b.id)}
                                      disabled={resetting}
                                      className="p-1 mr-1 text-amber-400 hover:text-amber-200 hover:bg-amber-950/50 rounded transition-colors"
                                      title="Reset manual override back to Auto Profit"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => openEditModal(g.id, b.id)}
                                    className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
                                    title="Edit Price / Profit"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit / Set Sale Price Modal */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title="Set / Edit Selling Price"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 text-xs font-sans">
          {/* Active Override Indicator / Reset Banner */}
          {priceMatrix[selectedGroup]?.[selectedBundle]?.isManualOverride && (
            <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-700/60 flex items-center justify-between text-xs text-amber-200">
              <div className="flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>Manual price override is currently active for this cell.</span>
              </div>
              <button
                type="button"
                disabled={resetting}
                onClick={() => handleResetOverride(selectedGroup, selectedBundle)}
                className="px-2.5 py-1 bg-amber-900/70 hover:bg-amber-800 text-amber-100 rounded text-[11px] font-semibold transition-colors flex items-center gap-1"
              >
                {resetting ? 'Resetting...' : 'Reset to Auto Profit'}
              </button>
            </div>
          )}
          {/* Critical Scope Clarification Notice */}
          <div className="p-3 rounded-lg bg-slate-900/90 border border-cyan-800/60 text-xs">
            <div className="text-cyan-300 font-semibold flex items-center gap-1.5">
              <span>ℹ️ Scope:</span>
              <span>
                Editing customer-specific price for{' '}
                <strong className="text-white">{selectedGroupObj?.title || 'Selected Customer Group'}</strong>.
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              This change sets a customer-specific price override for this customer group only.
            </p>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Customer Group:</label>
            <select
              value={selectedGroup}
              onChange={(e) => {
                const newGId = e.target.value;
                setSelectedGroup(newGId);
                const cell = priceMatrix[newGId]?.[selectedBundle];
                if (cell && cell.status === 'CONFIGURED') {
                  setSalePriceInput(cell.salePrice?.toFixed(2) || '');
                  setTargetProfitInput(cell.targetProfit?.toFixed(2) || '1.50');
                  setPricingType(cell.pricingMode || 'AUTO_PROFIT');
                }
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-medium focus:outline-none focus:border-cyan-500"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            {selectedGroupObj && (
              <p className="text-[11px] text-slate-400 mt-1">
                Chat ID: <span className="font-mono text-slate-300">{selectedGroupObj.telegram_chat_id || 'Unbound'}</span> • Loader: <span className="text-slate-300">{assignedLoaderName}</span> • Profile: <span className="text-slate-300">{selectedGroupObj.price_profile_name || 'Standard Retail'}</span>
              </p>
            )}
          </div>

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
                  value={selectedBundle}
                  onChange={(e) => {
                    const newBId = e.target.value;
                    setSelectedBundle(newBId);
                    if (newBId !== '__NEW__') {
                      const cell = priceMatrix[selectedGroup]?.[newBId];
                      if (cell && cell.status === 'CONFIGURED') {
                        setSalePriceInput(cell.salePrice?.toFixed(2) || '');
                        setTargetProfitInput(cell.targetProfit?.toFixed(2) || '1.50');
                        setPricingType(cell.pricingMode || 'AUTO_PROFIT');
                      }
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                >
                  {bundles.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || `${b.cp_quantity.toLocaleString()} CP`}
                    </option>
                  ))}
                  <option value="__NEW__">+ Enter new CP quantity...</option>
                </select>
                {selectedBundle === '__NEW__' && (
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
            <label className="block text-slate-300 font-semibold mb-1">Selling Price Mode:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPricingType('AUTO_PROFIT')}
                className={`p-2 rounded-lg border text-center font-medium transition-colors ${
                  pricingType === 'AUTO_PROFIT'
                    ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                Auto Profit Margin
              </button>
              <button
                type="button"
                onClick={() => setPricingType('FIXED_PRICE')}
                className={`p-2 rounded-lg border text-center font-medium transition-colors ${
                  pricingType === 'FIXED_PRICE'
                    ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                Fixed Selling Price
              </button>
            </div>
          </div>

          {pricingType === 'FIXED_PRICE' ? (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Fixed Customer Selling Price ($):
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 0.00"
                value={salePriceInput}
                onChange={(e) => setSalePriceInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Direct selling price override. Overrides loader cost derivation.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Target Profit Margin ($):
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 0.00"
                value={targetProfitInput}
                onChange={(e) => setTargetProfitInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Selling Price = Loader Purchase Cost + Target Profit.
              </p>
            </div>
          )}

          {/* Live Calculation Preview */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5 font-sans">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Live Calculation Preview</span>
              <span className="text-[10px] text-cyan-400 font-mono">
                {pricingType === 'AUTO_PROFIT' ? 'Auto Profit Mode' : 'Fixed Price Mode'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-slate-400">Customer Group:</span>
                <p className="font-semibold text-slate-200 truncate">{selectedGroupObj?.title || 'None'}</p>
              </div>
              <div>
                <span className="text-slate-400">Assigned Loader:</span>
                <p className="font-semibold text-slate-200 truncate">{assignedLoaderName}</p>
              </div>
              <div>
                <span className="text-slate-400">CP Bundle:</span>
                <p className="font-semibold text-slate-200 font-mono">
                  {currentCpQty > 0 ? `${currentCpQty.toLocaleString()} CP` : 'Not Selected'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Loader Purchase Cost:</span>
                <p className={`font-semibold font-mono ${loaderPurchaseCost !== null ? 'text-slate-200' : 'text-amber-400'}`}>
                  {loaderPurchaseCost !== null ? `$${loaderPurchaseCost.toFixed(2)}` : 'MISSING'}
                </p>
              </div>

              {pricingType === 'AUTO_PROFIT' ? (
                <>
                  <div>
                    <span className="text-slate-400">Target Profit Margin:</span>
                    <p className="font-semibold text-slate-200 font-mono">${validTargetProfit.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Calculated Selling Price:</span>
                    <p className={`font-bold font-mono text-sm ${calculatedSellingPrice !== null ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {calculatedSellingPrice !== null ? `$${calculatedSellingPrice.toFixed(2)}` : 'MISSING'}
                    </p>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400 font-medium">Expected Profit:</span>
                    <span className={`font-bold font-mono ${expectedProfitAuto !== null ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {expectedProfitAuto !== null ? `$${expectedProfitAuto.toFixed(2)}` : 'MISSING'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-slate-400">Fixed Selling Price:</span>
                    <p className="font-bold text-emerald-400 font-mono text-sm">
                      {!isNaN(parsedSalePrice) ? `$${parsedSalePrice.toFixed(2)}` : '$0.00'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Expected Profit:</span>
                    <p className={`font-bold font-mono ${
                      expectedProfitFixed === null
                        ? 'text-slate-400'
                        : expectedProfitFixed <= 0
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}>
                      {expectedProfitFixed !== null ? `$${expectedProfitFixed.toFixed(2)}` : 'UNKNOWN'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Warning for Missing Loader Cost in Auto Profit Mode */}
            {pricingType === 'AUTO_PROFIT' && loaderPurchaseCost === null && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300 text-xs flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  ⚠️ Loader purchase cost missing for {currentCpQty > 0 ? `${currentCpQty.toLocaleString()} CP` : 'this bundle'} / {assignedLoaderName}. Add purchase cost first or use a valid configured bundle.
                </span>
              </div>
            )}

            {/* Warning for at/below loader cost in Fixed Price Mode */}
            {pricingType === 'FIXED_PRICE' && loaderPurchaseCost !== null && !isNaN(parsedSalePrice) && (parsedSalePrice - loaderPurchaseCost) <= 0 && (
              <div className="mt-2 p-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>⚠️ Selling price is at/below loader cost.</span>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center gap-2 pt-2">
            {priceMatrix[selectedGroup]?.[selectedBundle]?.isManualOverride ? (
              <button
                type="button"
                disabled={saving || resetting}
                onClick={() => handleResetOverride(selectedGroup, selectedBundle)}
                className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg font-medium flex items-center gap-1.5 transition-colors text-xs"
                title="Remove manual override and return to Auto Profit"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {resetting ? 'Resetting...' : 'Reset Override'}
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditModal(false)}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || resetting || (pricingType === 'AUTO_PROFIT' && loaderPurchaseCost === null)}
                onClick={handleSavePrice}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 ${
                  saving || resetting || (pricingType === 'AUTO_PROFIT' && loaderPurchaseCost === null)
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}
              >
                {saving ? 'Saving...' : 'Save Price'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Bulk Update Sale Prices Modal */}
      <Modal
        isOpen={bulkModal}
        onClose={() => {
          setBulkModal(false);
          setBulkPreview(null);
        }}
        title="Bulk Update Sale Prices"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4 text-xs font-sans">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Target Customer Group:</label>
            <select
              value={bulkTargetGroup}
              onChange={(e) => setBulkTargetGroup(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Customer Groups (Shared Update)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Selecting &quot;All Customer Groups&quot; applies these shared prices to every configured group.
            </p>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Paste Shared CP Sale Prices:</label>
            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value);
                setBulkPreview(null);
              }}
              placeholder={`80 = 0.90\n420 = 4.20\n880 = 7.50\n2,400 = 15.50\n4800 = 29.00`}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Format: &lt;CP&gt; = &lt;Price&gt; (Supports comma quantities like 2,400, separators =, :, -, or space).
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
                {savingBulk
                  ? 'Applying...'
                  : `Confirm & Apply (${bulkPreview?.length || 0} Prices${bulkTargetGroup === 'all' ? ` × ${groups.length} Groups` : ''})`}
              </button>
            </div>
          </div>

          {bulkPreview && (
            <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex justify-between items-center">
                <span className="font-semibold text-slate-200">
                  Preview: {bulkPreview.length} Bundles to Update
                  {bulkTargetGroup === 'all' && (
                    <span className="ml-1.5 text-cyan-400 font-normal text-[11px]">(Across all {groups.length} active customer groups)</span>
                  )}
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
                      <th className="p-2">Current Price</th>
                      <th className="p-2">New Sale Price</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {bulkPreview.map((p) => (
                      <tr key={p.cpQuantity} className="hover:bg-slate-900/50">
                        <td className="p-2 text-slate-200 font-semibold">{p.cpQuantity.toLocaleString()} CP</td>
                        <td className="p-2 text-slate-400">
                          {p.currentPrice !== null ? `$${p.currentPrice.toFixed(2)}` : '-'}
                        </td>
                        <td className="p-2 text-emerald-400 font-bold">${p.price.toFixed(2)}</td>
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

      {/* Customer /prices Preview Modal */}
      <Modal
        isOpen={!!previewGroupPrices}
        onClose={() => setPreviewGroupPrices(null)}
        title={`Customer /prices Preview • ${previewGroupPrices?.groupTitle || ''}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs font-sans">
          <p className="text-[11px] text-slate-400">
            This is the exact customer-facing message sent when a customer runs <span className="text-cyan-300 font-mono">/prices</span> in Telegram:
          </p>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs whitespace-pre-wrap text-slate-100 select-all">
            {previewGroupPrices?.text}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPreviewGroupPrices(null)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (previewGroupPrices?.text) {
                  navigator.clipboard.writeText(previewGroupPrices.text);
                  setCopiedText(true);
                  setTimeout(() => setCopiedText(false), 2000);
                }
              }}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold flex items-center gap-1.5"
            >
              {copiedText ? 'Copied!' : 'Copy Price List'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
