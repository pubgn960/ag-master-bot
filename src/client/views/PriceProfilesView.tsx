import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Sliders, Plus, Edit2, Users, CheckCircle2, Star } from 'lucide-react';

export const PriceProfilesView: React.FC = () => {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Create Modal
  const [createModal, setCreateModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [pricingMode, setPricingMode] = useState('AUTO_PROFIT');
  const [createOverrides, setCreateOverrides] = useState('{\n  "80": { "mode": "FIXED_MARGIN", "value": 0.12 },\n  "420": { "mode": "FIXED_PRICE", "value": 4.50 }\n}');

  // Edit Modal
  const [editModal, setEditModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editMode, setEditMode] = useState('AUTO_PROFIT');
  const [editOverrides, setEditOverrides] = useState('{}');

  // Assign Groups Modal
  const [assignModal, setAssignModal] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState<string>('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, gRes] = await Promise.all([
        fetch('/api/price-profiles').then((r) => r.json()),
        fetch('/api/groups').then((r) => r.json()),
      ]);
      if (Array.isArray(pRes)) setProfiles(pRes);
      if (Array.isArray(gRes)) setGroups(gRes);
    } catch (err: any) {
      setFeedback({ text: `Error loading profiles: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProfile = async () => {
    try {
      let parsedOverrides = {};
      if (createOverrides.trim()) {
        try {
          parsedOverrides = JSON.parse(createOverrides);
        } catch {
          throw new Error('Bundle Overrides must be valid JSON');
        }
      }

      const res = await fetch('/api/price-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          isDefault,
          pricingMode,
          bundleOverrides: parsedOverrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setCreateModal(false);
      setCode('');
      setName('');
      setFeedback({ text: 'Price profile created successfully.', type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Create failed: ${err.message}`, type: 'error' });
    }
  };

  const handleEditProfile = async () => {
    if (!editingProfile) return;
    try {
      let parsedOverrides = {};
      if (editOverrides.trim()) {
        try {
          parsedOverrides = JSON.parse(editOverrides);
        } catch {
          throw new Error('Bundle Overrides must be valid JSON');
        }
      }

      const res = await fetch(`/api/price-profiles/${editingProfile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          pricingMode: editMode,
          isDefault: editingProfile.is_default,
          bundleOverrides: parsedOverrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setEditModal(false);
      setFeedback({ text: 'Price profile updated successfully.', type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Edit failed: ${err.message}`, type: 'error' });
    }
  };

  const handleSetGlobalDefault = async (profileId: string) => {
    try {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) return;
      const res = await fetch(`/api/price-profiles/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: target.name,
          pricingMode: target.pricing_mode,
          isDefault: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: `${target.name} is now the Global Default profile.`, type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Failed: ${err.message}`, type: 'error' });
    }
  };

  const openAssignModal = (profile: any) => {
    setTargetProfileId(profile.id);
    const assigned = groups
      .filter((g) => g.price_profile_id === profile.id || g.price_profile_name === profile.name)
      .map((g) => g.id);
    setSelectedGroupIds(assigned);
    setAssignModal(true);
  };

  const handleSaveGroupAssignments = async () => {
    try {
      const res = await fetch(`/api/price-profiles/${targetProfileId}/assign-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: selectedGroupIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAssignModal(false);
      setFeedback({ text: 'Group assignments saved successfully.', type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Assignment failed: ${err.message}`, type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Price Profiles</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure pricing margin profiles and assign them to specific customer groups. Exactly one global default.
          </p>
        </div>
        <button
          onClick={() => setCreateModal(true)}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Profile
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
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading price profiles...</div>
        ) : profiles.length === 0 ? (
          <div className="py-16 text-center">
            <Sliders className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No Price Profiles configured</p>
            <p className="text-xs text-slate-500 mb-4 font-mono">Create a price profile to manage margins and group tiering.</p>
            <button
              onClick={() => setCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-cyan-950/40"
            >
              <Plus className="w-4 h-4" />
              + Add Price Profile
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">PROFILE CODE</th>
                  <th className="pb-3 font-medium">PROFILE NAME</th>
                  <th className="pb-3 font-medium">PRICING MODE</th>
                  <th className="pb-3 font-medium">DEFAULT STATUS</th>
                  <th className="pb-3 font-medium">ASSIGNED GROUPS</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-cyan-400">{p.code}</td>
                    <td className="py-3 text-slate-100 font-semibold">{p.name}</td>
                    <td className="py-3">
                      <Badge variant="info" size="sm">
                        {p.pricing_mode === 'AUTO_PROFIT' ? 'Automatic' : 'Manual'}
                      </Badge>
                    </td>
                    <td className="py-3">
                      {p.is_default ? (
                        <Badge variant="success" size="sm">
                          Default Global Profile
                        </Badge>
                      ) : (
                        <button
                          onClick={() => handleSetGlobalDefault(p.id)}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded text-[11px] flex items-center gap-1"
                          title="Set as single global default"
                        >
                          <Star className="w-3 h-3" /> Set Default
                        </button>
                      )}
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      {p.assigned_groups_count || 0} groups
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingProfile(p);
                            setEditName(p.name);
                            setEditMode(p.pricing_mode || 'AUTO_PROFIT');
                            setEditOverrides(JSON.stringify(p.bundle_overrides || {}, null, 2));
                            setEditModal(true);
                          }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => openAssignModal(p)}
                          className="px-2.5 py-1 bg-cyan-950/60 border border-cyan-800/60 hover:bg-cyan-900/60 text-cyan-300 rounded text-xs flex items-center gap-1"
                        >
                          <Users className="w-3 h-3" /> Assign Groups
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

      {/* Create Profile Modal */}
      <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title="Create New Price Profile" maxWidth="max-w-md">
        <div className="space-y-4 text-xs font-sans">
          <div>
            <label className="block text-slate-300 font-semibold mb-1 font-mono">Profile Code:</label>
            <input
              type="text"
              placeholder="e.g. PROFILE_CODE"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono uppercase focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Profile Name:</label>
            <input
              type="text"
              placeholder="e.g. Price Profile Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Pricing Mode:</label>
            <select
              value={pricingMode}
              onChange={(e) => setPricingMode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="AUTO_PROFIT">Automatic Pricing (Loader Cost + Target Profit)</option>
              <option value="FIXED_PRICE">Manual Pricing (Fixed Customer Sale Price)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1 font-mono">
              Bundle Overrides (JSON):
            </label>
            <textarea
              rows={4}
              value={createOverrides}
              onChange={(e) => setCreateOverrides(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              placeholder='{\n  "80": { "mode": "FIXED_MARGIN", "value": 0.12 },\n  "420": { "mode": "FIXED_PRICE", "value": 4.50 }\n}'
            />
            <p className="text-[10px] text-slate-500 mt-0.5">
              Pin small bundles to fixed price or fixed margin (e.g. 80 CP, 420 CP).
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isDef"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
            />
            <label htmlFor="isDef" className="text-slate-300">Set as default for new customer groups</label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCreateModal(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateProfile}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
            >
              Save Profile
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal isOpen={editModal} onClose={() => setEditModal(false)} title="Edit Price Profile" maxWidth="max-w-md">
        <div className="space-y-4 text-xs font-sans">
          <div>
            <label className="block text-slate-400 mb-1 font-mono">Profile Code (Immutable):</label>
            <input
              type="text"
              disabled
              value={editingProfile?.code || ''}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-400 font-mono cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Profile Name:</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Pricing Mode:</label>
            <select
              value={editMode}
              onChange={(e) => setEditMode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="AUTO_PROFIT">Automatic Pricing (Loader Cost + Target Profit)</option>
              <option value="FIXED_PRICE">Manual Pricing (Fixed Customer Sale Price)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1 font-mono">
              Bundle Overrides (JSON):
            </label>
            <textarea
              rows={4}
              value={editOverrides}
              onChange={(e) => setEditOverrides(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              placeholder='{\n  "80": { "mode": "FIXED_MARGIN", "value": 0.12 },\n  "420": { "mode": "FIXED_PRICE", "value": 4.50 }\n}'
            />
            <p className="text-[10px] text-slate-500 mt-0.5">
              Pin small bundles to fixed price or fixed margin (e.g. 80 CP, 420 CP).
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditModal(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleEditProfile}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
            >
              Save Changes
            </button>
          </div>
        </div>
      </Modal>

      {/* Assign Groups Modal */}
      <Modal isOpen={assignModal} onClose={() => setAssignModal(false)} title="Assign Profile to Groups" maxWidth="max-w-xl">
        <div className="space-y-4 text-xs font-sans">
          <p className="text-slate-400 text-xs">
            Select the customer groups that will use this price profile. Unselected groups will continue using their respective assigned profiles or the Global Default.
          </p>

          <div className="max-h-72 overflow-y-auto space-y-1.5 p-2 bg-slate-950 rounded-xl border border-slate-800">
            {groups.map((g) => {
              const checked = selectedGroupIds.includes(g.id);
              return (
                <label
                  key={g.id}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                    checked ? 'bg-cyan-950/40 border border-cyan-800/40' : 'hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGroupIds([...selectedGroupIds, g.id]);
                        } else {
                          setSelectedGroupIds(selectedGroupIds.filter((id) => id !== g.id));
                        }
                      }}
                      className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <div>
                      <p className="text-slate-200 font-semibold">{g.title}</p>
                      <p className="text-[10px] text-slate-500 font-mono">Chat ID: {g.telegram_chat_id || 'Unbound'}</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {g.price_profile_name || 'Standard Retail'}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-slate-400 font-mono text-[11px]">
              {selectedGroupIds.length} groups selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setAssignModal(false)}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveGroupAssignments}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
              >
                Save Group Assignments
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
