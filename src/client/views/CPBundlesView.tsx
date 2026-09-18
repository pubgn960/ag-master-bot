import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Layers, Plus, Edit2, Power } from 'lucide-react';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';

export const CPBundlesView: React.FC = () => {
  const [bundles, setBundles] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'NONE'|'ADD'|'EDIT'>('NONE');
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (Array.isArray(data)) {
        setProducts(data);
        // Extract all unique CP quantities across all products
        const uniqueMap = new Map();
        data.forEach(p => {
          if (p.bundles && Array.isArray(p.bundles)) {
            p.bundles.forEach((b: any) => {
              if (!uniqueMap.has(b.cp_quantity)) {
                uniqueMap.set(b.cp_quantity, b);
              }
            });
          }
        });
        const sorted = Array.from(uniqueMap.values()).sort((a: any, b: any) => a.cp_quantity - b.cp_quantity);
        setBundles(sorted);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveBundle = async () => {
    setSaving(true);
    try {
      // Create/Update in all products implicitly for now, or just the first product if it's shared.
      // Since the backend API expects productId, we can just apply to all active products.
      if (modalMode === 'ADD') {
         for (const p of products) {
            await fetch('/api/products/bundles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                productId: p.id,
                name: `${formData.cpQuantity} CP`,
                cpQuantity: Number(formData.cpQuantity),
                sortOrder: Number(formData.cpQuantity),
                defaultTargetProfit: 0.50
              })
            });
         }
      } else if (modalMode === 'EDIT') {
         // The edit API expects ID. We will need an endpoint or just modify the single bundle item.
         // Actually, wait, the user says "shared canonical catalog". The backend schema currently links bundle -> product.
         // If we edit, we edit the specific bundle ID. But to be canonical, maybe we edit ALL bundles with that CP?
         const allMatchingBundles: any[] = [];
         products.forEach(p => {
            if (p.bundles) {
               p.bundles.forEach((b: any) => {
                  if (b.cp_quantity === formData.originalCpQuantity) allMatchingBundles.push(b);
               });
            }
         });
         
         for (const b of allMatchingBundles) {
            await fetch(`/api/products/bundles/${b.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `${formData.cpQuantity} CP`,
                cpQuantity: Number(formData.cpQuantity),
                sortOrder: Number(formData.cpQuantity),
                isActive: formData.isActive
              })
            });
         }
      }
      setFeedback(`Bundle ${modalMode === 'ADD' ? 'created' : 'updated'} successfully.`);
      setModalMode('NONE');
      fetchData();
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (bundle: any) => {
     try {
       const allMatchingBundles: any[] = [];
       products.forEach(p => {
          if (p.bundles) {
             p.bundles.forEach((b: any) => {
                if (b.cp_quantity === bundle.cp_quantity) allMatchingBundles.push(b);
             });
          }
       });
       
       for (const b of allMatchingBundles) {
          await fetch(`/api/products/bundles/${b.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: b.name,
              cpQuantity: b.cp_quantity,
              sortOrder: b.sort_order,
              isActive: !bundle.is_active
            })
          });
       }
       setFeedback(`Bundle ${bundle.cp_quantity} CP ${!bundle.is_active ? 'activated' : 'deactivated'}.`);
       fetchData();
     } catch (err: any) {
       setFeedback(`Error: ${err.message}`);
     }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">CP Bundles</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Canonical catalog of all official Call of Duty: Mobile CP quantities.
          </p>
        </div>
        <button
          onClick={() => { setFormData({ isActive: true }); setModalMode('ADD'); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add CP Bundle
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex justify-between items-center">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">×</button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading CP Bundles...</div>
      ) : (
        <Card title="Official CP Quantities" subtitle={`${bundles.length} available bundle(s)`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bundles.map((b) => (
              <div
                key={b.cp_quantity}
                className={`flex items-center justify-between p-4 bg-slate-950/50 border border-slate-800 rounded-xl ${!b.is_active ? 'opacity-50 grayscale' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-950/50 flex items-center justify-center border border-indigo-900/50">
                    <Layers className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-200">{b.cp_quantity} CP</p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Service Speed: {b.cp_quantity === 420 ? 'Slow' : 'Standard'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={b.is_active ? 'success' : 'default'}>
                    {b.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <button onClick={() => { setFormData({ originalCpQuantity: b.cp_quantity, cpQuantity: b.cp_quantity, isActive: b.is_active }); setModalMode('EDIT'); }} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded" title="Edit">
                     <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleToggleActive(b)} className={`p-1.5 rounded ${b.is_active ? 'bg-rose-950 text-rose-400 hover:bg-rose-900' : 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900'}`} title="Toggle Status">
                     <Power className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {modalMode !== 'NONE' && (
        <Modal
          isOpen={true}
          onClose={() => setModalMode('NONE')}
          title={modalMode === 'ADD' ? 'Add CP Bundle' : 'Edit CP Bundle'}
          maxWidth="max-w-sm"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">CP Quantity</label>
              <input type="number" value={formData.cpQuantity || ''} onChange={e => setFormData({...formData, cpQuantity: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono" />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Service Speed</label>
              <input type="text" disabled value={Number(formData.cpQuantity) === 420 ? 'Slow' : 'Standard'} className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-slate-500 font-mono cursor-not-allowed" />
            </div>
            {modalMode === 'EDIT' && (
              <label className="flex items-center gap-2 text-slate-300 mt-2">
                <input type="checkbox" checked={formData.isActive ?? true} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="rounded bg-slate-800 border-slate-700" />
                Active
              </label>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
              <button onClick={() => setModalMode('NONE')} className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSaveBundle} disabled={saving} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
