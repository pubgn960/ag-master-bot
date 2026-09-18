import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ArrowRightLeft, Plus, Edit2, Shield, AlertTriangle, Users } from 'lucide-react';
import { Modal } from '../components/Modal';

export interface CustomerGroup {
  id: string;
  title: string;
  telegram_chat_id: string | null;
  is_supergroup?: boolean;
  is_active: boolean;
  is_broadcast_enabled?: boolean;
  credit_limit?: number | string | null;
  assigned_loader_id?: string | null;
  assigned_loader_name?: string | null;
  fulfillment_rule?: string | null;
  price_profile_id?: string | null;
  price_profile_name?: string | null;
  payment_profile_id?: string | null;
  payment_profile_name?: string | null;
  total_orders?: number | string;
}

export const CustomersGroupsView: React.FC = () => {
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loaders, setLoaders] = useState<any[]>([]);
  const [priceProfiles, setPriceProfiles] = useState<any[]>([]);
  const [paymentProfiles, setPaymentProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'NONE' | 'ADD' | 'EDIT' | 'REBIND'>('NONE');
  const [formData, setFormData] = useState<any>({});
  const [creditLimit, setCreditLimit] = useState<string>('0');
  const [rebindData, setRebindData] = useState<{ id: string; title: string; oldChatId: string | null; newChatId: string }>({
    id: '',
    title: '',
    oldChatId: null,
    newChatId: ''
  });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [gRes, lRes, ppRes, payRes] = await Promise.all([
        fetch('/api/groups').then(r => r.json()),
        fetch('/api/loaders').then(r => r.json()),
        fetch('/api/price-profiles').then(r => r.json()).catch(() => []),
        fetch('/api/payment-profiles').then(r => r.json()).catch(() => [])
      ]);
      if (Array.isArray(gRes)) setGroups(gRes);
      if (Array.isArray(lRes)) setLoaders(lRes);
      if (Array.isArray(ppRes)) setPriceProfiles(ppRes);
      if (Array.isArray(payRes)) setPaymentProfiles(payRes);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const activeLoaders = loaders.filter(l => l.is_active !== false);

  const handleSaveGroup = async () => {
    setSaving(true);
    try {
      const parsedCreditLimit = creditLimit.trim() === '' ? 0 : parseFloat(creditLimit);
      if (modalMode === 'ADD') {
        const res = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: formData.title,
            telegramChatId: formData.telegramChatId,
            isSupergroup: formData.isSupergroup || false,
            isBroadcastEnabled: formData.isBroadcastEnabled ?? true,
            isActive: formData.isActive ?? true,
            assignedLoaderId: formData.assignedLoaderId || null,
            fulfillmentRule: formData.fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT',
            priceProfileId: formData.priceProfileId || null,
            paymentProfileId: formData.paymentProfileId || null,
            creditLimit: parsedCreditLimit,
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create customer group');
      } else if (modalMode === 'EDIT') {
        const res = await fetch(`/api/groups/${formData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: formData.title,
            isBroadcastEnabled: formData.isBroadcastEnabled ?? true,
            isActive: formData.isActive ?? true,
            assignedLoaderId: formData.assignedLoaderId !== undefined ? (formData.assignedLoaderId || null) : undefined,
            fulfillmentRule: formData.fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT',
            priceProfileId: formData.priceProfileId !== undefined ? (formData.priceProfileId || null) : undefined,
            paymentProfileId: formData.paymentProfileId !== undefined ? (formData.paymentProfileId || null) : undefined,
            creditLimit: parsedCreditLimit,
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update customer group');
      }
      
      setFeedback(`Group ${modalMode === 'ADD' ? 'created' : 'updated'} successfully.`);
      setModalMode('NONE');
      fetchData();
    } catch (err: any) {
      setFeedback(`Action failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmRebind = async () => {
    if (!rebindData.newChatId || String(rebindData.newChatId).trim() === '') {
      setFeedback('New Telegram Chat ID is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${rebindData.id}/bind`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newChatId: rebindData.newChatId.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rebind Telegram group');
      }
      setFeedback(data.message || 'Telegram group rebound successfully.');
      setModalMode('NONE');
      fetchData();
    } catch (err: any) {
      setFeedback(`Action failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Telegram Groups & Customers</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Group fulfillment routing rules, assigned price profiles, payment profiles, and smooth supergroup migration.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700"
          >
            Refresh Groups
          </button>
          <button
            onClick={() => {
              setFormData({
                title: '',
                telegramChatId: '',
                assignedLoaderId: '',
                fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
                priceProfileId: '',
                paymentProfileId: '',
                isBroadcastEnabled: true,
                isActive: true
              });
              setCreditLimit('0');
              setModalMode('ADD');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Customer Group
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex justify-between items-center">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading groups catalog...</div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No customers configured</p>
            <p className="text-xs text-slate-500 mb-4 font-mono">Create your first customer group to begin routing and orders.</p>
            <button
              onClick={() => {
                setFormData({
                  title: '',
                  telegramChatId: '',
                  assignedLoaderId: '',
                  fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
                  priceProfileId: '',
                  paymentProfileId: '',
                  isBroadcastEnabled: true,
                  isActive: true
                });
                setCreditLimit('0');
                setModalMode('ADD');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-cyan-950/40"
            >
              <Plus className="w-4 h-4" />
              + Add Customer Group
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">GROUP NAME & IDs</th>
                  <th className="pb-3 font-medium">ASSIGNED LOADER</th>
                  <th className="pb-3 font-medium">FULFILLMENT RULE</th>
                  <th className="pb-3 font-medium">PROFILES</th>
                  <th className="pb-3 font-medium text-center">STATUS</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {groups.map((g) => (
                  <tr key={g.id} className={`transition-colors ${!g.is_active ? 'opacity-50' : 'hover:bg-slate-800/30'}`}>
                    <td className="py-3">
                      <p className="text-slate-100 font-semibold">{g.title}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        Chat ID: {g.telegram_chat_id ? <span className="text-cyan-300 font-semibold">{g.telegram_chat_id}</span> : <span className="text-slate-500 italic">Unbound</span>}
                      </p>
                    </td>
                    <td className="py-3">
                      <span className="font-semibold text-cyan-300">{g.assigned_loader_name || 'Unassigned'}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-200">
                          {g.fulfillment_rule || 'FULFILL_REGARDLESS_OF_PAYMENT'}
                        </span>
                        {(!g.fulfillment_rule || g.fulfillment_rule === 'FULFILL_REGARDLESS_OF_PAYMENT') && (
                          <span className="text-[11px] text-gray-400">
                            Limit: {parseFloat(String(g.credit_limit || '0')) > 0 ? `$${parseFloat(String(g.credit_limit)).toFixed(2)}` : 'Unlimited'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="text-slate-300 font-mono text-[10px] space-y-1">
                        <div><span className="text-slate-500">Price:</span> {g.price_profile_name || 'Default'}</div>
                        <div><span className="text-slate-500">Pay:</span> {g.payment_profile_name || 'Default'}</div>
                      </div>
                    </td>
                    <td className="py-3 text-center">
                       <Badge variant={g.is_active ? 'success' : 'danger'} size="sm">{g.is_active ? 'Active' : 'Inactive'}</Badge>
                       {!g.is_broadcast_enabled && <p className="text-[9px] text-rose-400 mt-1">Broadcasts Disabled</p>}
                    </td>
                    <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setFormData({
                                id: g.id,
                                title: g.title,
                                telegramChatId: g.telegram_chat_id,
                                isBroadcastEnabled: g.is_broadcast_enabled,
                                isActive: g.is_active,
                                assignedLoaderId: g.assigned_loader_id || '',
                                fulfillmentRule: g.fulfillment_rule || 'FULFILL_REGARDLESS_OF_PAYMENT',
                                priceProfileId: g.price_profile_id || '',
                                paymentProfileId: g.payment_profile_id || ''
                              });
                              setCreditLimit(g.credit_limit !== undefined && g.credit_limit !== null ? String(g.credit_limit) : '0');
                              setModalMode('EDIT');
                            }}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded" title="Edit Customer Group"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setRebindData({
                                id: g.id,
                                title: g.title,
                                oldChatId: g.telegram_chat_id,
                                newChatId: ''
                              });
                              setModalMode('REBIND');
                            }}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700/60"
                            title={g.telegram_chat_id ? "Rebind Telegram Group" : "Bind Telegram Group"}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                          </button>
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* REBIND / BIND DIALOG (Section 5 & 6) */}
      {modalMode === 'REBIND' && (
        <Modal
          isOpen={true}
          onClose={() => setModalMode('NONE')}
          title={rebindData.oldChatId ? 'Rebind Telegram Group' : 'Bind Telegram Group'}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-xs">
            <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Customer:</span>
                <span className="text-slate-100 font-bold">{rebindData.title}</span>
              </div>
              <div className="flex justify-between items-center font-mono">
                <span className="text-slate-400 font-sans">Current Telegram Chat ID:</span>
                <span className={rebindData.oldChatId ? 'text-cyan-300 font-semibold' : 'text-slate-500 italic font-sans'}>
                  {rebindData.oldChatId || 'Unbound'}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-slate-200 font-semibold mb-1">New Telegram Chat ID</label>
              <input
                type="text"
                placeholder="Optional. Use /id in the Telegram group to get this."
                value={rebindData.newChatId || ''}
                onChange={e => setRebindData({ ...rebindData, newChatId: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                autoFocus
              />
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Send <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded border border-slate-800">/id</code> inside the customer's new Telegram group and paste the Chat ID here.
              </p>
            </div>

            <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800 space-y-1.5 font-mono text-[11px]">
              <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Binding Preview</div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current:</span>
                <span className="text-slate-300">{rebindData.oldChatId || 'Unbound'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">New:</span>
                <span className={rebindData.newChatId ? 'text-cyan-300 font-bold' : 'text-slate-600 italic font-sans'}>
                  {rebindData.newChatId || 'Awaiting input...'}
                </span>
              </div>
            </div>

            <div className="p-3 bg-cyan-950/30 border border-cyan-800/40 rounded-lg text-slate-300 space-y-1 text-[11px]">
              <div className="font-semibold text-cyan-300 mb-1 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" /> What happens next:
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                <li>Existing customer history will be preserved.</li>
                <li>New orders/messages will use the new Telegram group.</li>
                <li>The old Telegram group will no longer identify this customer in iTech-Avengers-Bot.</li>
                <li>Loader/pricing/payment assignments remain unchanged.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalMode('NONE')}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRebind}
                disabled={saving || !rebindData.newChatId?.trim()}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold disabled:opacity-50 transition-colors shadow-lg shadow-cyan-950/40"
              >
                {saving ? 'Binding...' : 'Confirm Rebind'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ADD / EDIT CUSTOMER GROUP MODAL (Section 3 & 4) */}
      {(modalMode === 'ADD' || modalMode === 'EDIT') && (
        <Modal
          isOpen={true}
          onClose={() => setModalMode('NONE')}
          title={modalMode === 'ADD' ? 'Add Customer Group' : 'Edit Customer Group'}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Group Name</label>
              <input
                type="text"
                placeholder="e.g. Customer Group Name"
                value={formData.title || ''}
                onChange={e => setFormData({...formData, title: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {modalMode === 'ADD' && (
              <div>
                <label className="block text-slate-400 mb-1">Telegram Chat ID</label>
                <input
                  type="text"
                  placeholder="Optional. Use /id in the Telegram group to get this."
                  value={formData.telegramChatId || ''}
                  onChange={e => setFormData({...formData, telegramChatId: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            )}

            {modalMode === 'EDIT' && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-400 font-medium">Telegram Group / Chat ID</label>
                  {formData.telegramChatId ? (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-medium">Bound</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 font-medium">Unbound</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-slate-500 text-[10px] font-mono">Current Telegram Chat ID:</p>
                    <p className={formData.telegramChatId ? "font-mono font-semibold text-cyan-300 text-xs" : "font-mono text-slate-500 text-xs italic"}>
                      {formData.telegramChatId || 'Unbound'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRebindData({
                        id: formData.id,
                        title: formData.title,
                        oldChatId: formData.telegramChatId,
                        newChatId: ''
                      });
                      setModalMode('REBIND');
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    {formData.telegramChatId ? 'Rebind Telegram Group' : 'Bind Telegram Group'}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-400 mb-1">Assigned Loader</label>
              <select
                value={formData.assignedLoaderId || ''}
                onChange={e => setFormData({...formData, assignedLoaderId: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {activeLoaders.length === 0 ? (
                  <option value="">No loaders configured</option>
                ) : (
                  <>
                    <option value="">Unassigned</option>
                    {activeLoaders.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.display_name || l.name || l.code}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {Boolean(formData.assignedLoaderId) && (
              <div>
                <label className="block text-slate-400 mb-1">Fulfillment Rule</label>
                <select
                  value={formData.fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT'}
                  onChange={e => setFormData({...formData, fulfillmentRule: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value="FULFILL_REGARDLESS_OF_PAYMENT">FULFILL_REGARDLESS_OF_PAYMENT</option>
                  <option value="PAYMENT_REQUIRED">PAYMENT_REQUIRED</option>
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-300">
                Credit Limit (USDT)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0.00 (0 = Unlimited tab)"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-gray-400">
                Applies when Fulfillment Rule is FULFILL_REGARDLESS_OF_PAYMENT. Orders are held if the group tab exceeds this amount. Set to 0 for unlimited.
              </p>
            </div>

            {priceProfiles.length > 0 && (
              <div>
                <label className="block text-slate-400 mb-1">Pricing Profile</label>
                <select
                  value={formData.priceProfileId || ''}
                  onChange={e => setFormData({...formData, priceProfileId: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="">Default Profile</option>
                  {priceProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) {p.is_default ? '★ Default' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {paymentProfiles.length > 0 && (
              <div>
                <label className="block text-slate-400 mb-1">Payment Profile</label>
                <select
                  value={formData.paymentProfileId || ''}
                  onChange={e => setFormData({...formData, paymentProfileId: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="">Default Profile</option>
                  {paymentProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) {p.is_default ? '★ Default' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-3 mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
               <label className="flex items-center gap-2 text-slate-300">
                 <input type="checkbox" checked={formData.isBroadcastEnabled ?? true} onChange={e => setFormData({...formData, isBroadcastEnabled: e.target.checked})} className="rounded bg-slate-800 border-slate-700" />
                 Broadcast Enabled
               </label>
               <label className="flex items-center gap-2 text-slate-300">
                 <input type="checkbox" checked={formData.isActive ?? true} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="rounded bg-slate-800 border-slate-700" />
                 Active Group
               </label>
            </div>

            {/* Section 4: Internal UUID UI hidden from normal flow, exposed only in Advanced / Technical Details */}
            {modalMode === 'EDIT' && (
              <details className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
                <summary className="cursor-pointer hover:text-slate-400 font-mono select-none">
                  Advanced / Technical Details
                </summary>
                <div className="mt-2 p-2.5 bg-slate-950/60 rounded border border-slate-800 font-mono text-[10px] space-y-1">
                  <div className="text-slate-400">
                    Internal Customer UUID: <span className="text-cyan-400 select-all">{formData.id}</span>
                  </div>
                  <p className="text-slate-500 text-[9px]">
                    Immutable primary key for orders, balances, ledger, and routing history. Cannot be edited.
                  </p>
                </div>
              </details>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setModalMode('NONE')} className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSaveGroup} disabled={saving} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
