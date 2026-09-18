import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Upload, Trash2, RefreshCw, ShieldCheck, Sparkles, Bot, Zap, ArrowRight, TrendingUp, AlertTriangle } from 'lucide-react';

export interface PromotionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg?: string) => void;
  promo?: any | null;
  initialData?: any | null;
  bundles?: any[];
  loaders?: any[];
}

export const PromotionFormModal: React.FC<PromotionFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  promo,
  initialData,
  bundles = [],
  loaders = [],
}) => {
  const activePromo = promo || initialData || null;
  const isEditMode = !!activePromo;

  const [name, setName] = useState('');
  const [bundleQuantity, setBundleQuantity] = useState('');
  const [salePrice, setSalePrice] = useState<string>('');
  const [purchaseCost, setPurchaseCost] = useState<string>('');
  const [designatedLoaderId, setDesignatedLoaderId] = useState<string>('');
  const [routingMode, setRoutingMode] = useState<'CHEAPEST_AVAILABLE' | 'DESIGNATED_ONLY'>('CHEAPEST_AVAILABLE');
  const [forceNegativeMargin, setForceNegativeMargin] = useState(false);
  const [lossGuardEnabled, setLossGuardEnabled] = useState(true);
  const [expiryDate, setExpiryDate] = useState('');
  const [imageRef, setImageRef] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (activePromo) {
        setName(activePromo.name || '');
        setBundleQuantity(activePromo.bundle_name || activePromo.bundleQuantity || (activePromo.cp_quantity ? String(activePromo.cp_quantity) + ' CP' : ''));
        setSalePrice(activePromo.sale_price ? String(parseFloat(activePromo.sale_price).toFixed(2)) : '');
        setPurchaseCost(activePromo.loader_cost ? String(parseFloat(activePromo.loader_cost).toFixed(2)) : (activePromo.purchase_cost ? String(parseFloat(activePromo.purchase_cost).toFixed(2)) : ''));
        setDesignatedLoaderId(activePromo.designated_loader_id || '');
        setRoutingMode(activePromo.routing_mode || (activePromo.designated_loader_id ? 'DESIGNATED_ONLY' : 'CHEAPEST_AVAILABLE'));
        setLossGuardEnabled(activePromo.loss_guard_enabled !== undefined ? !!activePromo.loss_guard_enabled : (activePromo.auto_pause_on_cost_increase !== undefined ? !!activePromo.auto_pause_on_cost_increase : true));
        setExpiryDate(activePromo.expires_at ? new Date(activePromo.expires_at).toISOString().slice(0, 10) : '');
        setImageRef(activePromo.image_ref || activePromo.image_url || null);
        setImagePreview(activePromo.image_ref || activePromo.image_url || null);
        setRemoveImage(false);
      } else {
        setName('');
        setBundleQuantity('');
        setSalePrice('');
        setPurchaseCost('');
        setDesignatedLoaderId('');
        setRoutingMode('CHEAPEST_AVAILABLE');
        setLossGuardEnabled(true);
        setExpiryDate('');
        setImageRef(null);
        setImagePreview(null);
        setRemoveImage(false);
      }
      setForceNegativeMargin(false);
      setUploadError(null);
      setFormError(null);
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [isOpen, activePromo]);

  // Financial calculations
  const salePriceNum = salePrice !== '' && !isNaN(Number(salePrice)) ? Number(salePrice) : null;
  const purchaseCostNum = purchaseCost !== '' && !isNaN(Number(purchaseCost)) ? Number(purchaseCost) : null;

  const profit =
    typeof salePriceNum === 'number' && typeof purchaseCostNum === 'number'
      ? Number((salePriceNum - purchaseCostNum).toFixed(2))
      : null;

  const marginPct =
    profit !== null && typeof salePriceNum === 'number' && salePriceNum > 0
      ? Number(((profit / salePriceNum) * 100).toFixed(1))
      : null;

  const isBlockedByLoss = profit !== null && profit <= 0 && !forceNegativeMargin;

  const handleBundleChange = (val: string) => {
    setBundleQuantity(val);
    const cleanQty = val.trim();
    if (!cleanQty) return;

    let matched = bundles.find(
      (b) =>
        b.id === cleanQty ||
        b.name?.toLowerCase() === cleanQty.toLowerCase() ||
        (b.name + ' (' + b.cp_quantity + ' CP)').toLowerCase() === cleanQty.toLowerCase()
    );
    if (!matched) {
      const numOnly = parseInt(cleanQty.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(numOnly) && numOnly > 0) {
        matched = bundles.find((b) => b.cp_quantity === numOnly);
      }
    }

    if (matched) {
      const costVal = matched.loader_cost ?? matched.cost ?? matched.default_cost;
      if (costVal != null && !isNaN(Number(costVal))) {
        setPurchaseCost(String(parseFloat(costVal).toFixed(2)));
      }
    }
  };

  const handleImageFileSelect = async (file: File) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const lowerName = file.name.toLowerCase();
    const lowerMime = file.type.toLowerCase();

    const hasValidExt = allowedExtensions.some((ext) => lowerName.endsWith(ext));
    const hasValidMime = allowedMimeTypes.includes(lowerMime);

    if (!hasValidExt && !hasValidMime) {
      setUploadError('Only JPG, PNG, or WEBP images are supported.');
      return;
    }

    const MAX_SIZE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError('File size exceeds 5MB limit.');
      return;
    }

    setUploadingImage(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target?.result as string;
          const res = await fetch('/api/promotions/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileData: base64Data,
              mimeType: file.type || 'image/jpeg',
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');

          setImageRef(data.imageRef);
          setImagePreview(data.imageRef);
          setRemoveImage(false);
          setUploadingImage(false);
        } catch (err: any) {
          setUploadError(err.message || 'Upload failed');
          setUploadingImage(false);
        }
      };
      reader.onerror = () => {
        setUploadError('Failed to read image file');
        setUploadingImage(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Promotion Name is required');
      return;
    }

    const priceNum = parseFloat(salePrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError('Sale price must be a valid positive number');
      return;
    }

    if (profit !== null && profit <= 0 && !forceNegativeMargin) {
      setFormError('Cannot save negative or zero profit promotion without enabling "Force Negative Margin".');
      return;
    }

    setSubmitting(true);
    try {
      const cleanBundleText = bundleQuantity.trim() || null;
      let matchedBundle: any = null;
      if (cleanBundleText && Array.isArray(bundles)) {
        matchedBundle = bundles.find(
          (b) =>
            b.id === cleanBundleText ||
            b.name?.toLowerCase() === cleanBundleText.toLowerCase() ||
            (b.name + ' (' + b.cp_quantity + ' CP)').toLowerCase() === cleanBundleText.toLowerCase()
        );
        if (!matchedBundle) {
          const numOnly = parseInt(cleanBundleText.replace(/[^0-9]/g, ''), 10);
          if (!isNaN(numOnly) && numOnly > 0) {
            matchedBundle = bundles.find((b) => b.cp_quantity === numOnly);
          }
        }
      }

      const payload = {
        name: name.trim(),
        bundleName: cleanBundleText,
        bundleQuantity: cleanBundleText,
        bundleId: matchedBundle?.id || (activePromo?.bundle_id ?? null),
        productId: matchedBundle?.product_id || (activePromo?.product_id ?? null),
        salePrice: priceNum,
        loaderCost: purchaseCost ? parseFloat(purchaseCost) : null,
        purchaseCost: purchaseCost ? parseFloat(purchaseCost) : null,
        designatedLoaderId: designatedLoaderId ? designatedLoaderId : null,
        routingMode: designatedLoaderId ? routingMode : 'CHEAPEST_AVAILABLE',
        lossGuardEnabled,
        autoPauseOnCostIncrease: lossGuardEnabled,
        imageRef: removeImage ? null : (imageRef || undefined),
        imageUrl: removeImage ? null : (imageRef || undefined),
        removeImage,
        expiresAt: expiryDate ? new Date(expiryDate).toISOString() : null,
      };

      if (isEditMode) {
        const res = await fetch('/api/promotions/' + activePromo.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update promotion');
        onSuccess('Promotion updated successfully.');
      } else {
        const generatedCode = 'PROMO_' + Date.now().toString(36).toUpperCase();
        const res = await fetch('/api/promotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            code: generatedCode,
            currency: 'USDT',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create promotion');
        onSuccess('Promotion created and loss-guard active.');
      }

      onClose();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save promotion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditMode ? 'Edit Promotion' : 'Create Promotion'} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs font-sans">
        {formError && (
          <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 font-medium text-xs">
            {formError}
          </div>
        )}

        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Promotion Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Weekend Flash Deal (5,000 + 880 CP)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-medium"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            CP Bundle / Package Description (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. 4000 CP Bundles and MSMC Legendary Gun"
            value={bundleQuantity}
            onChange={(e) => handleBundleChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono text-xs"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Custom bundle description or CP package text for broadcasts and cards.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Sale Price ($ USDT) <span className="text-rose-400">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 29.99"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Loader Purchase Cost ($)
            </label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 24.50"
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Real-Time Net Profit & Margin Calculator */}
        {salePriceNum !== null && purchaseCostNum !== null && (
          <div
            className={`p-2.5 rounded-lg border flex items-center justify-between text-xs font-mono ${
              profit !== null && profit > 0
                ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {profit !== null && profit > 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400" />
              )}
              <span>Net Profit:</span>
              <strong className="font-bold">
                {profit !== null ? (profit >= 0 ? '+$' + profit.toFixed(2) : '-$' + Math.abs(profit).toFixed(2)) : '—'}
              </strong>
            </div>
            <div className="text-[11px]">
              <span>Margin: </span>
              <strong>{marginPct !== null ? marginPct + '%' : '—'}</strong>
            </div>
          </div>
        )}

        {/* Loss Warning & Override Toggle */}
        {profit !== null && profit <= 0 && (
          <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs space-y-2">
            <p className="font-medium">
              ⚠️ Sale price (${Number(salePrice).toFixed(2)}) is less than or equal to purchase cost (${Number(purchaseCost).toFixed(2)}).
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-slate-200 font-semibold">
              <input
                type="checkbox"
                checked={forceNegativeMargin}
                onChange={(e) => setForceNegativeMargin(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-400"
              />
              <span>Force Negative Margin (Sell at loss)</span>
            </label>
          </div>
        )}

        {/* Loader Routing & Assignment Section */}
        <div className="space-y-2 border border-slate-800 bg-slate-900/50 p-2.5 rounded-lg">
          <div className="flex items-center justify-between">
            <label className="text-slate-300 font-semibold flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-cyan-400" />
              Loader Routing & Assignment
            </label>
            <span className="text-[10px] text-cyan-400 font-mono">
              {routingMode === 'DESIGNATED_ONLY' && designatedLoaderId ? 'Targeted' : 'Cheapest'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Designated Loader:</label>
              <select
                value={designatedLoaderId}
                onChange={(e) => {
                  const val = e.target.value;
                  setDesignatedLoaderId(val);
                  if (val) {
                    setRoutingMode('DESIGNATED_ONLY');
                  } else {
                    setRoutingMode('CHEAPEST_AVAILABLE');
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="">None (Auto-Route to Cheapest)</option>
                {loaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.display_name || l.name || l.code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Routing Mode:</label>
              <select
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="CHEAPEST_AVAILABLE">⚡ Cheapest Available</option>
                <option value="DESIGNATED_ONLY" disabled={!designatedLoaderId}>
                  🎯 Designated Only
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* Loss Guard & Expiry */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <input
              type="checkbox"
              checked={lossGuardEnabled}
              onChange={(e) => setLossGuardEnabled(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-cyan-500"
            />
            <div className="flex-1">
              <div className="text-slate-200 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                Auto Loss-Guard Shield
              </div>
              <p className="text-[11px] text-slate-400">
                Auto-pauses this promotion if supplier/loader costs increase above sale price.
              </p>
            </div>
          </label>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Expiry Date (Optional):</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Promotion Image Upload */}
        <div>
          <label className="block text-slate-300 font-semibold mb-1">Promotion Banner Image (Optional):</label>
          <input
            ref={fileInputRef}
            type="file"
            id="unified-promo-image"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFileSelect(file);
            }}
            className="hidden"
          />
          {imagePreview ? (
            <div className="border border-slate-700 bg-slate-900 rounded-lg p-2.5 flex items-center gap-3">
              <img
                src={imagePreview}
                alt="Promotion banner"
                className="w-14 h-14 object-cover rounded-md border border-slate-800 bg-slate-950"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 font-semibold">Current Image</p>
                <p className="text-[11px] text-slate-400 truncate">{imageRef}</p>
                <div className="flex items-center gap-2 mt-2">
                  <label
                    htmlFor="unified-promo-image"
                    className="px-2 py-1 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 rounded text-[11px] flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <RefreshCw className="w-3 h-3" /> Replace Image
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setImageRef(null);
                      setImagePreview(null);
                      setRemoveImage(true);
                    }}
                    className="px-2 py-1 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded text-[11px] flex items-center gap-1 font-medium"
                  >
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="unified-promo-image"
                className={`w-full flex items-center justify-center gap-2 border border-dashed border-slate-700 hover:border-cyan-500 rounded-lg p-3 cursor-pointer bg-slate-950 hover:bg-slate-900 transition-colors ${
                  uploadingImage ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {uploadingImage ? (
                  <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 text-cyan-400" />
                )}
                <span className="text-slate-300 font-medium">
                  {uploadingImage ? 'Uploading image...' : 'Upload Promotion Banner Image'}
                </span>
              </label>
            </div>
          )}
          {uploadError && <p className="text-rose-400 text-[11px] mt-1 font-mono">{uploadError}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || isBlockedByLoss}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting ? 'Saving...' : (isEditMode ? 'Update Promotion' : 'Create Promotion')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PromotionFormModal;
