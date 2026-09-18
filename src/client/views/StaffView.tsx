import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { UserCheck, Shield, Check, X, Plus, Edit2, Ban, Power, Lock, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';

export const StaffView: React.FC = () => {
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'NONE'|'ADD'|'EDIT'>('NONE');
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('OWNER');

  useEffect(() => {
    fetch('/api/config/env')
      .then((r) => r.json())
      .then((data) => {
        if (data?.role) setCurrentUserRole(data.role);
      })
      .catch(() => {});
  }, []);

  const permissionGroups = [
    {
      name: 'Orders & Fulfillment',
      perms: [
        { id: 'VIEW_ORDERS', label: 'View Orders' },
        { id: 'PROCESS_ORDER', label: 'Process Order' },
        { id: 'UNDO_PROCESS_ORDER', label: 'Undo Process Order' },
        { id: 'CANCEL_ORDER', label: 'Cancel Order' },
        { id: 'UNDO_CANCEL_ORDER', label: 'Undo Cancel Order' },
        { id: 'DISPATCH_ORDER', label: 'Dispatch Order' },
        { id: 'RESEND_LOADER_DELIVERY', label: 'Resend Loader Delivery' },
        { id: 'REVEAL_ORDER_CREDENTIALS', label: 'Reveal Order Credentials' },
      ]
    },
    {
      name: 'Payments & Credit',
      perms: [
        { id: 'VIEW_PAYMENTS', label: 'View Payments' },
        { id: 'VERIFY_PAYMENT', label: 'Verify Payment' },
        { id: 'MANUAL_MARK_PAID', label: 'Manual Mark Paid' },
        { id: 'MANUAL_MARK_UNPAID', label: 'Manual Mark Unpaid' },
        { id: 'ALLOCATE_PAYMENT', label: 'Allocate Payment' },
        { id: 'REVERSE_PAYMENT', label: 'Reverse Payment' },
        { id: 'VIEW_CUSTOMER_CREDIT', label: 'View Customer Credit' },
        { id: 'APPLY_CUSTOMER_CREDIT', label: 'Apply Customer Credit' },
        { id: 'ADJUST_CUSTOMER_CREDIT', label: 'Adjust Customer Credit' },
      ]
    },
    {
      name: 'Pricing & Promotions',
      perms: [
        { id: 'VIEW_SALE_PRICES', label: 'View Sale Prices' },
        { id: 'EDIT_SALE_PRICE', label: 'Edit Sale Price' },
        { id: 'BULK_EDIT_SALE_PRICES', label: 'Bulk Edit Sale Prices' },
        { id: 'VIEW_LOADER_COSTS', label: 'View Loader Costs' },
        { id: 'EDIT_LOADER_COST', label: 'Edit Loader Cost' },
        { id: 'BULK_EDIT_LOADER_COSTS', label: 'Bulk Edit Loader Costs' },
        { id: 'PREVIEW_AUTO_PRICING', label: 'Preview Auto Pricing' },
        { id: 'CONFIRM_AUTO_PRICING', label: 'Confirm Auto Pricing' },
        { id: 'CREATE_PROMOTION', label: 'Create Promotion' },
        { id: 'EDIT_PROMOTION', label: 'Edit Promotion' },
        { id: 'CHANGE_PROMOTION_STATUS', label: 'Change Promotion Status' },
      ]
    },
    {
      name: 'Configuration',
      perms: [
        { id: 'VIEW_GROUPS', label: 'View Groups' },
        { id: 'ADD_GROUP', label: 'Add Group' },
        { id: 'EDIT_GROUP', label: 'Edit Group' },
        { id: 'BIND_GROUP_TELEGRAM_ID', label: 'Bind Group Telegram ID' },
        { id: 'CHANGE_GROUP_ROUTING', label: 'Change Group Routing' },
        { id: 'VIEW_LOADERS', label: 'View Loaders' },
        { id: 'ADD_LOADER', label: 'Add Loader' },
        { id: 'EDIT_LOADER', label: 'Edit Loader' },
        { id: 'CHANGE_LOADER_STATUS', label: 'Change Loader Status' },
        { id: 'VIEW_PAYMENT_PROFILES', label: 'View Payment Profiles' },
        { id: 'EDIT_PAYMENT_PROFILES', label: 'Edit Payment Profiles' },
        { id: 'VIEW_TEMPLATES', label: 'View Templates' },
        { id: 'EDIT_TEMPLATES', label: 'Edit Templates' },
      ]
    },
    {
      name: 'System & Admin',
      perms: [
        { id: 'CREATE_BROADCAST_DRAFT', label: 'Create Broadcast Draft' },
        { id: 'PREVIEW_BROADCAST', label: 'Preview Broadcast' },
        { id: 'SEND_BROADCAST', label: 'Send Broadcast' },
        { id: 'VIEW_PROFIT', label: 'View Profit' },
        { id: 'VIEW_AUDIT_LOG', label: 'View Audit Log' },
        { id: 'RUN_RECONCILIATION', label: 'Run Reconciliation' },
        { id: 'RESOLVE_RECONCILIATION', label: 'Resolve Reconciliation' },
        { id: 'VIEW_INTEGRATIONS', label: 'View Integrations' },
        { id: 'MANAGE_INTEGRATIONS', label: 'Manage Integrations' },
        { id: 'VIEW_FEATURE_FLAGS', label: 'View Feature Flags' },
        { id: 'MANAGE_FEATURE_FLAGS', label: 'Manage Feature Flags' },
        { id: 'VIEW_STAFF', label: 'View Staff' },
        { id: 'ADD_STAFF', label: 'Add Staff' },
        { id: 'EDIT_STAFF_PERMISSIONS', label: 'Edit Staff Permissions' },
        { id: 'DEACTIVATE_STAFF', label: 'Deactivate Staff' }
      ]
    }
  ];

  const fetchStaff = () => {
    setLoading(true);
    fetch('/api/auth/staff')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setStaff(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleSaveStaff = async () => {
    if (!formData.username || !formData.telegramUserId) {
      setModalError('Name and Telegram User ID are required.');
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      const isNew = modalMode === 'ADD';
      const endpoint = isNew ? '/api/auth/staff' : `/api/auth/staff/${formData.id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          telegramUserId: formData.telegramUserId,
          isActive: formData.isActive ?? true,
          role: formData.role || 'STAFF',
          notes: formData.notes
        })
      });

      if (!res.ok) {
         const data = await res.json();
         throw new Error(data.error || 'Failed to save staff');
      }

      const savedData = await res.json();
      const newStaffId = isNew ? savedData.id : formData.id;

      // Handle permissions if not owner
      if (formData.role !== 'OWNER' && formData.permissions) {
        // Find existing perms
        const existingUser = staff.find(s => s.id === newStaffId);
        const existingPerms = existingUser?.permissions || [];
        
        // Revoke removed
        for (const p of existingPerms) {
           if (!formData.permissions.includes(p) && p !== '*') {
              await fetch('/api/auth/permissions/revoke', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ userId: newStaffId, permissionId: p }),
              });
           }
        }
        
        // Grant added
        for (const p of formData.permissions) {
           if (!existingPerms.includes(p)) {
              await fetch('/api/auth/permissions/grant', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ userId: newStaffId, permissionId: p }),
              });
           }
        }
      }

      setFeedback(`Staff ${formData.username} ${isNew ? 'added' : 'updated'} successfully.`);
      setModalMode('NONE');
      fetchStaff();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: any) => {
    try {
       const res = await fetch(`/api/auth/staff/${u.id}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ isActive: !u.is_active })
       });
       if (!res.ok) {
         const data = await res.json();
         throw new Error(data.error || 'Failed to update status');
       }
       setFeedback(`Staff ${u.username} ${!u.is_active ? 'activated' : 'deactivated'}.`);
       fetchStaff();
    } catch(err: any) {
       alert(err.message);
    }
  };

  const handleDeleteStaff = async (u: any) => {
    if (!window.confirm(`Are you sure you want to permanently delete staff member "${u.username}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/auth/staff/${u.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete staff member');
      }
      setFeedback(`Staff member ${u.username} deleted successfully.`);
      fetchStaff();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Staff & Roles</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage operational personnel, RBAC permissions, and dashboard access.
          </p>
        </div>
        <button
          onClick={() => { setFormData({ isActive: true, permissions: [] }); setModalMode('ADD'); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Staff
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex justify-between items-center">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      <Card title="Staff Directory">
        <div className="overflow-x-auto -mx-5 px-5 pb-4">
          <table className="w-full text-xs text-left min-w-[600px]">
            <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="pb-3 w-48">Identity</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 text-center">Permissions</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {staff.map((u) => {
                const isOwner = u.role === 'OWNER' || u.username === 'owner' || u.id === '00000000-0000-0000-0000-000000000001';
                const rawTgId = u.telegramUserId || u.telegram_user_id;
                const displayTgId = isOwner && currentUserRole !== 'OWNER'
                  ? '••••••••'
                  : (rawTgId ? String(rawTgId) : (isOwner ? 'Not Configured' : '—'));

                return (
                  <tr key={u.id} className={`transition-colors ${!u.is_active ? 'opacity-50 grayscale' : 'hover:bg-slate-800/30'}`}>
                    <td className="py-3">
                      <p className="text-slate-100 font-bold">{u.username}</p>
                      <p className="text-xs text-slate-400 font-mono mb-1 tracking-wide">{displayTgId}</p>
                      <Badge variant={isOwner ? 'purple' : 'info'} size="sm">
                        {isOwner ? 'OWNER' : u.role}
                      </Badge>
                    </td>
                    <td className="py-3 text-center">
                      <Badge variant={u.is_active ? 'success' : 'danger'} size="sm">
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-3 text-center">
                       {isOwner ? (
                         <span className="text-purple-400 font-semibold">* (All)</span>
                       ) : (
                         <span className="text-cyan-400 font-semibold">{(u.permissions || []).length} / 53</span>
                       )}
                    </td>
                    <td className="py-3 text-right">
                       <div className="flex justify-end gap-2">
                         {u.username === 'owner' || u.id === '00000000-0000-0000-0000-000000000001' ? (
                           <div className="p-1.5 bg-slate-900/60 text-slate-600 rounded cursor-not-allowed border border-slate-800" title="Root Owner is locked">
                             <Lock className="w-3.5 h-3.5" />
                           </div>
                         ) : (
                           <button onClick={() => { setFormData({
                             id: u.id,
                             username: u.username,
                             telegramUserId: u.telegram_user_id,
                             isActive: u.is_active,
                             role: u.role,
                             permissions: u.permissions || []
                           }); setModalMode('EDIT'); }} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded" title="Edit Staff & Permissions">
                              <Edit2 className="w-3.5 h-3.5" />
                           </button>
                         )}
                          {u.username !== 'owner' && u.id !== '00000000-0000-0000-0000-000000000001' && u.role !== 'OWNER' && (
                            <>
                              <button onClick={() => handleToggleActive(u)} className={`p-1.5 rounded ${u.is_active ? 'bg-rose-950 text-rose-400 hover:bg-rose-900' : 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900'}`} title={u.is_active ? 'Deactivate' : 'Activate'}>
                                <Power className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteStaff(u)} className="p-1.5 rounded bg-rose-950/80 text-rose-400 hover:bg-rose-900 transition-colors border border-rose-900/50" title="Delete Staff Member">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                       </div>
                    </td>
                  </tr>
                );
              })}
              {staff.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No staff configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modalMode !== 'NONE' && (
        <Modal
          isOpen={true}
          onClose={() => setModalMode('NONE')}
          title={modalMode === 'ADD' ? 'Add Staff' : 'Edit Staff'}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4 text-xs">
            {modalError && (
               <div className="p-2 bg-rose-950 border border-rose-900 text-rose-300 rounded text-xs">{modalError}</div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1">Staff Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500"
                  placeholder="e.g. Staff Name"
                  value={formData.username || ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Telegram User ID (Authoritative)</label>
                <input
                  type="text"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 font-mono"
                  placeholder="e.g. Telegram User ID"
                  value={formData.telegramUserId || ''}
                  onChange={(e) => setFormData({ ...formData, telegramUserId: e.target.value })}
                />
                <p className="text-[9px] text-slate-500 mt-1">Users can message `/whoami` to iTech-Avengers-Bot.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1">Role</label>
                <select
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500"
                  value={formData.role || 'STAFF'}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="STAFF">Staff (Requires specific permissions)</option>
                  <option value="OWNER">Owner (Full admin rights)</option>
                </select>
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={formData.isActive ?? true}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-cyan-600 focus:ring-cyan-500"
                  />
                  Active Account
                </label>
              </div>
            </div>

            {formData.role !== 'OWNER' && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <label className="block font-semibold text-slate-200 mb-3 text-sm">Action-Level Permissions</label>
                <div className="space-y-4">
                   {permissionGroups.map(grp => (
                     <div key={grp.name} className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                        <h4 className="font-semibold text-slate-400 mb-2 border-b border-slate-800 pb-1">{grp.name}</h4>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                          {grp.perms.map(p => (
                             <label key={p.id} className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors cursor-pointer">
                               <input 
                                 type="checkbox" 
                                 checked={(formData.permissions || []).includes(p.id)}
                                 onChange={(e) => {
                                    const perms = formData.permissions || [];
                                    if (e.target.checked) setFormData({...formData, permissions: [...perms, p.id]});
                                    else setFormData({...formData, permissions: perms.filter((x:string) => x !== p.id)});
                                 }}
                                 className="rounded bg-slate-800 border-slate-700 text-cyan-600 focus:ring-cyan-500"
                               />
                               {p.label}
                             </label>
                          ))}
                        </div>
                     </div>
                   ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
              <button
                onClick={() => setModalMode('NONE')}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveStaff}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
