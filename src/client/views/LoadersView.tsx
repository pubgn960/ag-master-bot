import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Truck, Plus, Edit2, Power, CheckCircle2, CircleSlash, AlertCircle } from 'lucide-react';

export const LoadersView: React.FC = () => {
  const [loaders, setLoaders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit Loader modal
  const [modalMode, setModalMode] = useState<'NONE'|'ADD'|'EDIT'>('NONE');
  const [formData, setFormData] = useState<any>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchLoaders = () => {
    setLoading(true);
    fetch('/api/loaders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLoaders(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchLoaders();
  }, []);

  const handleSaveLoader = async () => {
    setFormError(null);
    const isAct = formData.isActive ?? true;
    const isAvail = (formData.availabilityStatus || 'AVAILABLE') === 'AVAILABLE';
    const groupChatId = (formData.telegramLoaderGroupChatId ?? formData.telegramChatId)?.toString().trim();

    // Required destination check when active and available
    if (isAct && isAvail && (!groupChatId || groupChatId === '')) {
      setFormError('Loader Group / Chat ID is required for active fulfillment.');
      return;
    }

    setSaving(true);
    try {
      const isNew = modalMode === 'ADD';
      const endpoint = isNew ? '/api/loaders' : `/api/loaders/${formData.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: formData.code?.trim().toUpperCase(),
          displayName: formData.displayName?.trim(),
          telegramLoaderGroupChatId: groupChatId || null,
          telegramChatId: groupChatId || null,
          telegramUserId: formData.telegramUserId?.toString().trim() || null,
          availabilityStatus: formData.availabilityStatus || 'AVAILABLE',
          isActive: isAct,
          currency: formData.currency?.trim() || 'USD',
          notes: formData.notes?.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback(`Loader ${formData.code} ${isNew ? 'created' : 'updated'} successfully!`);
      setModalMode('NONE');
      fetchLoaders();
    } catch (err: any) {
      setFormError(`Failed to save loader: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (l: any) => {
    try {
      const nextActive = !l.is_active;
      const dest = (l.telegram_loader_group_chat_id ?? l.telegram_chat_id)?.toString().trim();
      if (nextActive && l.availability_status === 'AVAILABLE' && (!dest || dest === '')) {
        setFeedback('Error: Loader Group / Chat ID is required for active fulfillment.');
        return;
      }

      const res = await fetch(`/api/loaders/${l.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: nextActive
        })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setFeedback(`Loader ${l.code} ${nextActive ? 'activated' : 'deactivated'}.`);
      fetchLoaders();
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    }
  };

  const handleToggleAvailability = async (l: any) => {
    try {
      const nextStatus = l.availability_status === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE';
      const dest = (l.telegram_loader_group_chat_id ?? l.telegram_chat_id)?.toString().trim();
      if (nextStatus === 'AVAILABLE' && l.is_active && (!dest || dest === '')) {
        setFeedback('Error: Loader Group / Chat ID is required for active fulfillment.');
        return;
      }

      const res = await fetch(`/api/loaders/${l.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availabilityStatus: nextStatus
        })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setFeedback(`Loader ${l.code} availability set to ${nextStatus}.`);
      fetchLoaders();
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    }
  };

  const openAddModal = () => {
    setFormData({
      code: '',
      displayName: '',
      telegramLoaderGroupChatId: '',
      telegramUserId: '',
      availabilityStatus: 'AVAILABLE',
      isActive: true,
      currency: 'USD',
      notes: '',
    });
    setFormError(null);
    setModalMode('ADD');
  };

  const openEditModal = (l: any) => {
    setFormData({
      id: l.id,
      code: l.code,
      displayName: l.display_name,
      telegramLoaderGroupChatId: (l.telegram_loader_group_chat_id ?? l.telegram_chat_id ?? '').toString(),
      telegramUserId: (l.telegram_user_id ?? '').toString(),
      availabilityStatus: l.availability_status || 'AVAILABLE',
      isActive: l.is_active ?? true,
      currency: l.currency || 'USD',
      notes: l.notes || '',
    });
    setFormError(null);
    setModalMode('EDIT');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Loaders & Fulfillment Stations</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure loader environments, Telegram fulfillment group destinations, reply verification IDs, and routing availability.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Loader
        </button>
      </div>

      {feedback && (
        <div className={`p-3 border rounded-xl text-xs flex justify-between items-center ${
          feedback.startsWith('Error') 
            ? 'bg-rose-950/80 border-rose-800 text-rose-300' 
            : 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
        }`}>
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading loaders directory...</div>
        ) : loaders.length === 0 ? (
          <div className="py-16 text-center">
            <Truck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No loaders configured</p>
            <p className="text-xs text-slate-500 mb-4 font-mono">Create your first loader station to handle fulfillment.</p>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-cyan-950/40"
            >
              <Plus className="w-4 h-4" />
              + Add Loader
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">CODE</th>
                  <th className="pb-3 font-medium">DISPLAY NAME</th>
                  <th className="pb-3 font-medium">LOADER GROUP / CHAT ID</th>
                  <th className="pb-3 font-medium">LOADER USER ID</th>
                  <th className="pb-3 font-medium">AVAILABILITY</th>
                  <th className="pb-3 font-medium text-center">CURRENCY</th>
                  <th className="pb-3 font-medium text-center">ASSIGNED GROUPS</th>
                  <th className="pb-3 font-medium text-center">STATUS</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {loaders.map((l) => {
                  const destChat = l.telegram_loader_group_chat_id || l.telegram_chat_id;
                  const isAvailable = l.availability_status === 'AVAILABLE';
                  return (
                    <tr key={l.id} className={`transition-colors ${!l.is_active ? 'opacity-50 grayscale' : 'hover:bg-slate-800/30'}`}>
                      <td className="py-3 font-mono font-bold text-cyan-400">{l.code}</td>
                      <td className="py-3 text-slate-100 font-semibold">{l.display_name}</td>
                      <td className="py-3 font-mono text-[11px]">
                        {destChat ? (
                          <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/60">
                            {destChat}
                          </span>
                        ) : (
                          <span className="text-amber-400 italic">None (Unset)</span>
                        )}
                      </td>
                      <td className="py-3 font-mono text-[11px] text-slate-400">
                        {l.telegram_user_id || <span className="text-slate-600">None</span>}
                      </td>
                      <td className="py-3">
                        <Badge
                          variant={
                            l.availability_status === 'AVAILABLE'
                              ? 'success'
                              : l.availability_status === 'BUSY'
                              ? 'warning'
                              : 'danger'
                          }
                          size="sm"
                        >
                          {l.availability_status}
                        </Badge>
                      </td>
                      <td className="py-3 font-mono text-center text-slate-300">{l.currency || 'USD'}</td>
                      <td className="py-3 font-mono text-slate-300 text-center">{l.assigned_groups_count || 0}</td>
                      <td className="py-3 text-center">
                        <Badge variant={l.is_active ? 'success' : 'danger'} size="sm">
                          {l.is_active ? 'Active' : 'Deactivated'}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleToggleAvailability(l)}
                            className={`p-1.5 rounded transition-colors ${
                              isAvailable
                                ? 'bg-amber-950/60 hover:bg-amber-900 text-amber-300'
                                : 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300'
                            }`}
                            title={isAvailable ? 'Set Unavailable' : 'Set Available'}
                          >
                            {isAvailable ? <CircleSlash className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleToggleActive(l)}
                            className={`p-1.5 rounded transition-colors ${
                              l.is_active
                                ? 'bg-rose-950 text-rose-400 hover:bg-rose-900'
                                : 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900'
                            }`}
                            title={l.is_active ? 'Deactivate' : 'Activate'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEditModal(l)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                            title="Edit Loader"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
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

      {/* Add/Edit Loader Modal */}
      {modalMode !== 'NONE' && (
        <Modal
          isOpen={true}
          onClose={() => setModalMode('NONE')}
          title={modalMode === 'ADD' ? 'Register New Loader' : `Edit Loader: ${formData.code}`}
          maxWidth="max-w-md"
        >
          <div className="space-y-3.5 text-xs">
            {formError && (
              <div className="p-2.5 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span className="font-semibold">{formError}</span>
              </div>
            )}

            {/* 1. Loader Code */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono">
                Loader Code:
              </label>
              <input
                type="text"
                placeholder="e.g. LOADER_CODE"
                value={formData.code || ''}
                disabled={modalMode === 'EDIT'}
                onChange={(e) => {
                  setFormData({ ...formData, code: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono uppercase focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>

            {/* 2. Display Name */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Display Name:
              </label>
              <input
                type="text"
                placeholder="e.g. Loader Name"
                value={formData.displayName || ''}
                onChange={(e) => {
                  setFormData({ ...formData, displayName: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* 3. Telegram Loader Group / Chat ID */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono flex items-center justify-between">
                <span>
                  Telegram Loader Group / Chat ID:
                  <span className="text-cyan-400 ml-1 font-sans text-[11px]">(Fulfillment Destination)</span>
                </span>
                {(formData.isActive ?? true) && (formData.availabilityStatus || 'AVAILABLE') === 'AVAILABLE' && (
                  <span className="text-rose-400 text-[10px] font-sans">Required</span>
                )}
              </label>
              <input
                type="text"
                placeholder="Optional. Use /id in the loader Telegram group."
                value={formData.telegramLoaderGroupChatId || ''}
                onChange={(e) => {
                  setFormData({ ...formData, telegramLoaderGroupChatId: e.target.value, telegramChatId: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Canonical fulfillment destination where iTech Avengers sends loader orders. Required for active fulfillment.
              </p>
            </div>

            {/* 4. Telegram Loader User ID (Optional) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono">
                Telegram Loader User ID (Optional):
              </label>
              <input
                type="text"
                placeholder="Optional. Telegram User ID"
                value={formData.telegramUserId || ''}
                onChange={(e) => {
                  setFormData({ ...formData, telegramUserId: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Optional human loader identity used for completion authentication and reply verification. Not the delivery destination.
              </p>
            </div>

            {/* 5. Available / Unavailable */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Availability Status:
              </label>
              <select
                value={formData.availabilityStatus || 'AVAILABLE'}
                onChange={(e) => {
                  setFormData({ ...formData, availabilityStatus: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="AVAILABLE">Available (Routable for fulfillment)</option>
                <option value="BUSY">Busy</option>
                <option value="OFFLINE">Unavailable / Offline</option>
              </select>
            </div>

            {/* 6. Active / Inactive */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Operational Status:
              </label>
              <select
                value={formData.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                onChange={(e) => {
                  setFormData({ ...formData, isActive: e.target.value === 'ACTIVE' });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive / Deactivated</option>
              </select>
            </div>

            {/* 7. Currency */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono">
                Currency:
              </label>
              <select
                value={formData.currency || 'USD'}
                onChange={(e) => {
                  setFormData({ ...formData, currency: e.target.value });
                  if (formError) setFormError(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="USDT">USDT</option>
              </select>
            </div>

            {/* 8. Notes */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Notes:
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Notes about loader"
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setModalMode('NONE')}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveLoader}
                disabled={saving}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Loader'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
