import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { PromotionFormModal } from '../components/PromotionFormModal';
import { BroadcastPromotionModal } from '../components/BroadcastPromotionModal';
import {
  Tag,
  Plus,
  Edit2,
  ShieldCheck,
  Play,
  Pause,
  Image as ImageIcon,
  Eye,
  Megaphone,
} from 'lucide-react';

export const PromotionsView: React.FC = () => {
  const [promos, setPromos] = useState<any[]>([]);
  const [bundles, setBundles] = useState<any[]>([]);
  const [loaders, setLoaders] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Broadcast Promo Modal
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [broadcastingPromo, setBroadcastingPromo] = useState<any | null>(null);

  // Unified Form Modal (Create / Edit)
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<any | null>(null);

  // Card Preview Modal
  const [cardPreviewPromo, setCardPreviewPromo] = useState<any | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [promoRes, prodRes, loadersRes, groupsRes] = await Promise.all([
        fetch('/api/promotions').then((r) => r.json()),
        fetch('/api/products').then((r) => r.json()),
        fetch('/api/loaders').then((r) => r.json()),
        fetch('/api/groups').then((r) => r.json()),
      ]);

      if (Array.isArray(promoRes)) setPromos(promoRes);
      if (Array.isArray(loadersRes)) setLoaders(loadersRes);
      if (Array.isArray(groupsRes)) setGroups(groupsRes);

      if (Array.isArray(prodRes)) {
        const bList: any[] = [];
        prodRes.forEach((p: any) => {
          if (Array.isArray(p.bundles)) {
            p.bundles.forEach((b: any) => {
              bList.push({ ...b, product_code: p.code });
            });
          }
        });
        setBundles(bList);
      }
    } catch (err: any) {
      setFeedback({ text: `Error loading promotions: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleStatus = async (promo: any) => {
    try {
      const nextPaused = !promo.is_paused;
      const res = await fetch(`/api/promotions/${promo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPaused: nextPaused }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({
        text: `Promotion ${nextPaused ? 'paused' : 'activated'} successfully.`,
        type: 'success',
      });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Status change failed: ${err.message}`, type: 'error' });
    }
  };

  const openCreate = () => {
    setEditingPromo(null);
    setFormModalOpen(true);
  };

  const openEdit = (p: any) => {
    setEditingPromo(p);
    setFormModalOpen(true);
  };

  const openBroadcastPromo = (p: any) => {
    setBroadcastingPromo(p);
    setBroadcastModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Promotions & Loss-Guarded Sales</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Fixed promotional selling prices in USDT with loss-guard: automatically pauses if loader cost increases above promo price.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Promotion
        </button>
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

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading active promotions...</div>
        ) : promos.length === 0 ? (
          <div className="py-16 text-center">
            <Tag className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No Promotions configured</p>
            <p className="text-xs text-slate-500 font-mono">Create special promotional deals and loss-guard thresholds.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium w-12">IMAGE</th>
                  <th className="pb-3 font-medium">NAME</th>
                  <th className="pb-3 font-medium">CP PACKAGE / DESCRIPTION</th>
                  <th className="pb-3 font-medium">SALE PRICE (USDT)</th>
                  <th className="pb-3 font-medium">PURCHASE COST</th>
                  <th className="pb-3 font-medium">ROUTING</th>
                  <th className="pb-3 font-medium">EXPIRY DATE</th>
                  <th className="pb-3 font-medium">LOSS-GUARD</th>
                  <th className="pb-3 font-medium">STATUS</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {promos.map((p) => {
                  const isExpired = p.expires_at && new Date(p.expires_at).getTime() < Date.now();
                  const salePriceNum = parseFloat(p.sale_price) || 0;
                  const loaderCostNum = p.loader_cost ? parseFloat(p.loader_cost) : null;

                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3">
                        {p.image_ref ? (
                          <img
                            src={p.image_ref}
                            alt={p.name}
                            className="w-10 h-10 rounded object-cover border border-slate-700 bg-slate-900 shadow-sm"
                          />
                        ) : (
                          <div
                            className="w-10 h-10 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600"
                            title="No image uploaded"
                          >
                            <ImageIcon className="w-5 h-5" />
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-slate-100 font-semibold">{p.name}</td>
                      <td className="py-3 font-mono text-cyan-400">
                        {p.bundle_name ? (
                          <span>{p.bundle_name}</span>
                        ) : p.cp_quantity ? (
                          `${p.cp_quantity.toLocaleString()} CP`
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 font-mono text-emerald-400 font-bold text-sm">
                        ${salePriceNum.toFixed(2)} <span className="text-[10px] text-slate-500">USDT</span>
                      </td>
                      <td className="py-3 font-mono text-slate-300">
                        {loaderCostNum !== null ? (
                          <span>${loaderCostNum.toFixed(2)}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        {p.routing_mode === 'DESIGNATED_ONLY' && (p.designated_loader_name || p.designated_loader_code) ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800 text-purple-300 font-mono text-[11px]"
                            title={`Designated Loader ID: ${p.designated_loader_id}`}
                          >
                            <span>🎯</span> {p.designated_loader_name || p.designated_loader_code}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-300 font-mono text-[11px]">
                            <span>⚡</span> Cheapest Capable
                          </span>
                        )}
                      </td>
                      <td className="py-3 font-mono text-slate-400">
                        {p.expires_at ? (
                          <span className={isExpired ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {new Date(p.expires_at).toLocaleDateString()} {isExpired && '(Expired)'}
                          </span>
                        ) : (
                          <span className="text-slate-500">Never</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge variant={p.auto_pause_on_cost_increase ? 'success' : 'default'} size="sm">
                          {p.auto_pause_on_cost_increase ? 'Active Shield' : 'Off'}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <Badge variant={p.is_paused ? 'warning' : 'success'} size="sm">
                          {p.is_paused ? 'Paused' : 'Active'}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openBroadcastPromo(p)}
                            className="px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 rounded text-xs flex items-center gap-1 font-medium transition-colors"
                            title="Broadcast promotion to customer groups"
                          >
                            <Megaphone className="w-3 h-3" /> Broadcast
                          </button>
                          <button
                            onClick={() => setCardPreviewPromo(p)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded text-xs flex items-center gap-1 transition-colors"
                            title="Preview customer card"
                          >
                            <Eye className="w-3 h-3" /> Preview
                          </button>
                          <button
                            onClick={() => handleToggleStatus(p)}
                            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 ${
                              p.is_paused
                                ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300 hover:bg-emerald-900'
                                : 'bg-amber-950/60 border border-amber-800 text-amber-300 hover:bg-amber-900'
                            }`}
                          >
                            {p.is_paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                            {p.is_paused ? 'Activate' : 'Pause'}
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Customer-Facing Promo Card Preview Modal */}
      {cardPreviewPromo && (
        <Modal
          isOpen={!!cardPreviewPromo}
          onClose={() => setCardPreviewPromo(null)}
          title="Customer Promo Card Preview"
          maxWidth="max-w-sm"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {/* Uploaded Image or Safe Placeholder */}
            <div className="h-44 w-full bg-slate-950 flex items-center justify-center relative overflow-hidden border-b border-slate-800">
              {cardPreviewPromo.image_ref ? (
                <img
                  src={cardPreviewPromo.image_ref}
                  alt={cardPreviewPromo.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-600 gap-1.5">
                  <ImageIcon className="w-10 h-10 stroke-[1.5]" />
                  <span className="text-[11px] font-mono text-slate-500">No Image Configured</span>
                </div>
              )}
              <div className="absolute top-2 right-2">
                <Badge variant={cardPreviewPromo.is_paused ? 'warning' : 'success'} size="sm">
                  {cardPreviewPromo.is_paused ? 'PAUSED' : 'ACTIVE DEAL'}
                </Badge>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                  {cardPreviewPromo.code}
                </div>
                <h3 className="text-base font-bold text-slate-100 mt-0.5">
                  {cardPreviewPromo.name}
                </h3>
                {cardPreviewPromo.bundle_name && (
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {cardPreviewPromo.bundle_name}
                  </p>
                )}
              </div>

              <div className="flex items-baseline justify-between pt-2 border-t border-slate-800/80">
                <div>
                  <span className="text-[10px] uppercase text-slate-500 block font-mono">Special Price</span>
                  <span className="text-xl font-bold text-emerald-400 font-mono">
                    ${parseFloat(cardPreviewPromo.sale_price).toFixed(2)}{' '}
                    <span className="text-xs text-slate-400 font-normal">USDT</span>
                  </span>
                </div>
                {cardPreviewPromo.auto_pause_on_cost_increase && (
                  <div className="flex items-center gap-1 text-[11px] text-cyan-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Loss-Guarded</span>
                  </div>
                )}
              </div>

              {cardPreviewPromo.expires_at && (
                <div className="text-[11px] text-slate-400 font-mono bg-slate-950/60 p-2 rounded border border-slate-800/60">
                  Expires: {new Date(cardPreviewPromo.expires_at).toLocaleDateString()}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setCardPreviewPromo(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Unified Promotion Modal (Create & Edit) */}
      <PromotionFormModal
        isOpen={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingPromo(null);
        }}
        onSuccess={() => {
          setFeedback({
            text: editingPromo ? 'Promotion updated successfully.' : 'Promotion created and loss-guard active.',
            type: 'success',
          });
          fetchData();
        }}
        promo={editingPromo}
        bundles={bundles}
        loaders={loaders}
      />

      {/* Broadcast Promotion Modal */}
      <BroadcastPromotionModal
        isOpen={broadcastModalOpen}
        onClose={() => {
          setBroadcastModalOpen(false);
          setBroadcastingPromo(null);
        }}
        onSuccess={(msg) => {
          setFeedback({ text: msg, type: 'success' });
          fetchData();
        }}
        promo={broadcastingPromo}
        groups={groups}
      />
    </div>
  );
};
