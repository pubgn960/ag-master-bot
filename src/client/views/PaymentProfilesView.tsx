import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Wallet, Plus, Edit2, Users, CheckCircle2, Copy, Star, Send, Building2, Smartphone, Globe, Landmark, Trash2 } from 'lucide-react';
import { PaymentDetailsBroadcastModal } from '../components/PaymentDetailsBroadcastModal';

export const PaymentProfilesView: React.FC = () => {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [payBroadcastModalOpen, setPayBroadcastModalOpen] = useState(false);

  // Create Modal
  const [createModal, setCreateModal] = useState(false);
  const [name, setName] = useState('');
  // Bank
  const [bankName, setBankName] = useState('');
  const [bankAccountTitle, setBankAccountTitle] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIban, setBankIban] = useState('');
  // Mobile Wallets
  const [localWalletName, setLocalWalletName] = useState('');
  const [localWalletTitle, setLocalWalletTitle] = useState('');
  const [localWalletNumber, setLocalWalletNumber] = useState('');
  const [easypaisaName, setEasypaisaName] = useState('');
  const [easypaisaNumber, setEasypaisaNumber] = useState('');
  const [jazzcashName, setJazzcashName] = useState('');
  const [jazzcashNumber, setJazzcashNumber] = useState('');
  const [sadapayName, setSadapayName] = useState('');
  const [sadapayNumber, setSadapayNumber] = useState('');
  const [nayapayName, setNayapayName] = useState('');
  const [nayapayNumber, setNayapayNumber] = useState('');
  // Crypto
  const [binanceName, setBinanceName] = useState('');
  const [binanceId, setBinanceId] = useState('');
  const [bybitName, setBybitName] = useState('');
  const [bybitUid, setBybitUid] = useState('');
  const [trc20Address, setTrc20Address] = useState('');
  const [bep20Address, setBep20Address] = useState('');
  // UPI / INR
  const [upiId, setUpiId] = useState('');
  const [upiName, setUpiName] = useState('');
  const [inrBankName, setInrBankName] = useState('');
  const [inrAccountNumber, setInrAccountNumber] = useState('');
  const [inrIfsc, setInrIfsc] = useState('');
  // Instructions
  const [instructions, setInstructions] = useState('⚠️ Please send exact amount. Forward transaction receipt screenshot after payment.');

  // Edit Modal
  const [editModal, setEditModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  // Bank
  const [editBankName, setEditBankName] = useState('');
  const [editBankAccountTitle, setEditBankAccountTitle] = useState('');
  const [editBankAccountNumber, setEditBankAccountNumber] = useState('');
  const [editBankIban, setEditBankIban] = useState('');
  // Mobile Wallets
  const [editLocalWalletName, setEditLocalWalletName] = useState('');
  const [editLocalWalletTitle, setEditLocalWalletTitle] = useState('');
  const [editLocalWalletNumber, setEditLocalWalletNumber] = useState('');
  const [editEasypaisaName, setEditEasypaisaName] = useState('');
  const [editEasypaisaNumber, setEditEasypaisaNumber] = useState('');
  const [editJazzcashName, setEditJazzcashName] = useState('');
  const [editJazzcashNumber, setEditJazzcashNumber] = useState('');
  const [editSadapayName, setEditSadapayName] = useState('');
  const [editSadapayNumber, setEditSadapayNumber] = useState('');
  const [editNayapayName, setEditNayapayName] = useState('');
  const [editNayapayNumber, setEditNayapayNumber] = useState('');
  // Crypto
  const [editBinanceName, setEditBinanceName] = useState('');
  const [editBinanceId, setEditBinanceId] = useState('');
  const [editBybitName, setEditBybitName] = useState('');
  const [editBybitUid, setEditBybitUid] = useState('');
  const [editTrc20, setEditTrc20] = useState('');
  const [editBep20, setEditBep20] = useState('');
  // UPI / INR
  const [editUpiId, setEditUpiId] = useState('');
  const [editUpiName, setEditUpiName] = useState('');
  const [editInrBankName, setEditInrBankName] = useState('');
  const [editInrAccountNumber, setEditInrAccountNumber] = useState('');
  const [editInrIfsc, setEditInrIfsc] = useState('');
  // Instructions
  const [editInstructions, setEditInstructions] = useState('');

  // Assign Groups Modal
  const [assignModal, setAssignModal] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState<string>('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, gRes] = await Promise.all([
        fetch('/api/payment-profiles').then((r) => r.json()),
        fetch('/api/groups').then((r) => r.json()),
      ]);
      if (Array.isArray(pRes)) setProfiles(pRes);
      if (Array.isArray(gRes)) setGroups(gRes);
    } catch (err: any) {
      setFeedback({ text: `Failed to load payment profiles: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCopy = (text: string, type: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleCreateProfile = async () => {
    if (!name || !name.trim()) {
      setFeedback({ text: 'Profile name is required.', type: 'error' });
      return;
    }
    try {
      const generatedCode = `PAY_${Date.now().toString(36).toUpperCase()}`;
      const res = await fetch('/api/payment-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: generatedCode,
          name: name.trim(),
          binanceName,
          binanceId,
          bybitName,
          bybitUid,
          trc20Address,
          bep20Address,
          bankName,
          bankAccountTitle,
          bankAccountNumber,
          bankIban,
          localWalletName,
          localWalletTitle,
          localWalletNumber,
          easypaisaName,
          easypaisaNumber,
          jazzcashName,
          jazzcashNumber,
          sadapayName,
          sadapayNumber,
          nayapayName,
          nayapayNumber,
          upiId,
          upiName,
          inrBankName,
          inrAccountNumber,
          inrIfsc,
          customInstructions: instructions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setCreateModal(false);
      setName('');
      setBankName('');
      setBankAccountTitle('');
      setBankAccountNumber('');
      setBankIban('');
      setLocalWalletName('');
      setLocalWalletTitle('');
      setLocalWalletNumber('');
      setEasypaisaName('');
      setEasypaisaNumber('');
      setJazzcashName('');
      setJazzcashNumber('');
      setSadapayName('');
      setSadapayNumber('');
      setNayapayName('');
      setNayapayNumber('');
      setBinanceName('');
      setBinanceId('');
      setBybitName('');
      setBybitUid('');
      setTrc20Address('');
      setBep20Address('');
      setUpiId('');
      setUpiName('');
      setInrBankName('');
      setInrAccountNumber('');
      setInrIfsc('');
      setFeedback({ text: 'Payment profile created successfully.', type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Create failed: ${err.message}`, type: 'error' });
    }
  };

  const handleEditProfile = async () => {
    if (!editingProfile) return;
    if (!editName || !editName.trim()) {
      setFeedback({ text: 'Profile name is required.', type: 'error' });
      return;
    }
    try {
      const res = await fetch(`/api/payment-profiles/${editingProfile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          isDefault: editingProfile.is_default,
          binanceName: editBinanceName,
          binanceId: editBinanceId,
          bybitName: editBybitName,
          bybitUid: editBybitUid,
          trc20Address: editTrc20,
          bep20Address: editBep20,
          bankName: editBankName,
          bankAccountTitle: editBankAccountTitle,
          bankAccountNumber: editBankAccountNumber,
          bankIban: editBankIban,
          localWalletName: editLocalWalletName,
          localWalletTitle: editLocalWalletTitle,
          localWalletNumber: editLocalWalletNumber,
          easypaisaName: editEasypaisaName,
          easypaisaNumber: editEasypaisaNumber,
          jazzcashName: editJazzcashName,
          jazzcashNumber: editJazzcashNumber,
          sadapayName: editSadapayName,
          sadapayNumber: editSadapayNumber,
          nayapayName: editNayapayName,
          nayapayNumber: editNayapayNumber,
          upiId: editUpiId,
          upiName: editUpiName,
          inrBankName: editInrBankName,
          inrAccountNumber: editInrAccountNumber,
          inrIfsc: editInrIfsc,
          customInstructions: editInstructions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setEditModal(false);
      setFeedback({ text: 'Payment profile updated successfully.', type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Update failed: ${err.message}`, type: 'error' });
    }
  };

  const handleSetGlobalDefault = async (profileId: string) => {
    try {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) return;

      const res = await fetch(`/api/payment-profiles/${profileId}/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: `${target.name} is now the Global Default payment profile.`, type: 'success' });
      fetchData();
    } catch (err: any) {
      setFeedback({ text: `Failed to set default: ${err.message}`, type: 'error' });
    }
  };

  const handleDeleteProfile = async (profile: any) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to delete payment profile "${profile.name}"?\n\nThis will remove the payment details and unassign any groups linked to it.`
    );
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/payment-profiles/${profile.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete payment profile');

      setFeedback({ text: `Payment profile "${profile.name}" deleted successfully.`, type: 'success' });
      await fetchData();
    } catch (err: any) {
      setFeedback({ text: `Delete failed: ${err.message}`, type: 'error' });
    }
  };

  const openAssignModal = (profile: any) => {
    setTargetProfileId(profile.id);
    const assigned = groups
      .filter((g) => g.payment_profile_id === profile.id || g.payment_profile_name === profile.name)
      .map((g) => g.id);
    setSelectedGroupIds(assigned);
    setAssignModal(true);
  };

  const handleSaveGroupAssignments = async () => {
    try {
      const res = await fetch(`/api/payment-profiles/${targetProfileId}/assign-groups`, {
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

  const openEdit = (p: any) => {
    setEditingProfile(p);
    setEditName(p.name || '');
    setEditBankName(p.bank_name || '');
    setEditBankAccountTitle(p.bank_account_title || p.bank_account_name || '');
    setEditBankAccountNumber(p.bank_account_number || '');
    setEditBankIban(p.bank_iban || '');
    setEditLocalWalletName(p.local_wallet_name || '');
    setEditLocalWalletTitle(p.local_wallet_title || p.bank_account_title || p.bank_account_name || '');
    setEditLocalWalletNumber(p.local_wallet_number || '');
    setEditEasypaisaName(p.easypaisa_name || '');
    setEditEasypaisaNumber(p.easypaisa_number || '');
    setEditJazzcashName(p.jazzcash_name || '');
    setEditJazzcashNumber(p.jazzcash_number || '');
    setEditSadapayName(p.sadapay_name || '');
    setEditSadapayNumber(p.sadapay_number || '');
    setEditNayapayName(p.nayapay_name || '');
    setEditNayapayNumber(p.nayapay_number || '');
    setEditBinanceName(p.binance_name || '');
    setEditBinanceId(p.binance_id || '');
    setEditBybitName(p.bybit_name || '');
    setEditBybitUid(p.bybit_uid || '');
    setEditTrc20(p.trc20_address || '');
    setEditBep20(p.bep20_address || '');
    setEditUpiId(p.upi_id || '');
    setEditUpiName(p.upi_name || '');
    setEditInrBankName(p.inr_bank_name || '');
    setEditInrAccountNumber(p.inr_account_number || '');
    setEditInrIfsc(p.inr_ifsc || '');
    setEditInstructions(p.custom_instructions || '');
    setEditModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Payment Details</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure Global Default + VIP Group-specific /pay response methods (Local Bank, Mobile Wallets, Crypto & UPI).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPayBroadcastModalOpen(true)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
            title="Send assigned payment details to all configured customer groups"
          >
            <Send className="w-3.5 h-3.5" />
            Send Assigned Payment Details to All Customers
          </button>
          <button
            onClick={() => setCreateModal(true)}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Payment Profile
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

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading payment profiles...</div>
      ) : profiles.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <Wallet className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-semibold mb-1">No Payment Profiles configured</p>
            <p className="text-xs text-slate-500 mb-4 font-mono">Add payment instructions for customer groups to pay via Local Bank, Wallets, or Crypto.</p>
            <button
              onClick={() => setCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl transition-colors shadow-lg shadow-cyan-950/40"
            >
              <Plus className="w-4 h-4" />
              + Add Payment Profile
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {profiles.map((p) => {
            const hasPk = Boolean(
              p.bank_name || p.bank_account_number || p.bank_iban ||
              p.local_wallet_number || p.easypaisa_number || p.jazzcash_number ||
              p.sadapay_number || p.nayapay_number
            );
            const hasCrypto = Boolean(
              p.binance_id || p.bybit_uid || p.trc20_address || p.bep20_address
            );
            const hasInr = Boolean(
              p.upi_id || p.inr_bank_name || p.inr_account_number
            );

            return (
              <Card
                key={p.id}
                title={p.name}
                subtitle={`Profile Code: ${p.code || 'PROFILE'}`}
                action={
                  p.is_default ? (
                    <Badge variant="success" size="sm">
                      Global Default
                    </Badge>
                  ) : (
                    <Badge variant="purple" size="sm">
                      Group Override ({p.assigned_groups_count || 0} groups)
                    </Badge>
                  )
                }
              >
                <div className="space-y-3.5 text-xs font-mono">
                  {/* 🇵🇰 Pakistan Local Bank & Wallets */}
                  {hasPk && (
                    <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-2">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px] font-sans">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>🇵🇰 Pakistan Local Bank & Wallets</span>
                      </div>
                      {(p.bank_name || p.bank_account_number || p.bank_iban) && (
                        <div className="space-y-1 text-slate-300">
                          {p.bank_name && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Bank:</span>
                              <span className="text-slate-100 font-bold">{p.bank_name}</span>
                            </div>
                          )}
                          {(p.bank_account_title || p.bank_account_name) && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Title:</span>
                              <span className="text-slate-200">{p.bank_account_title || p.bank_account_name}</span>
                            </div>
                          )}
                          {p.bank_account_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">Account:</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-cyan-300 font-bold">{p.bank_account_number}</span>
                                <button onClick={() => handleCopy(p.bank_account_number, p.id + 'acc')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'acc' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.bank_iban && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">IBAN:</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-cyan-300 font-bold break-all">{p.bank_iban}</span>
                                <button onClick={() => handleCopy(p.bank_iban, p.id + 'iban')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'iban' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mobile Wallets breakdown */}
                      {(p.local_wallet_number || p.easypaisa_number || p.jazzcash_number || p.sadapay_number || p.nayapay_number) && (
                        <div className="pt-2 border-t border-slate-900 space-y-1">
                          {p.local_wallet_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">{p.local_wallet_name || 'Wallet'}:</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-100">{p.local_wallet_number}</span>
                                <button onClick={() => handleCopy(p.local_wallet_number, p.id + 'lwal')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'lwal' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.easypaisa_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">Easypaisa ({p.easypaisa_name || p.bank_account_title || 'Title'}):</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-100">{p.easypaisa_number}</span>
                                <button onClick={() => handleCopy(p.easypaisa_number, p.id + 'ep')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'ep' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.jazzcash_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">JazzCash ({p.jazzcash_name || p.bank_account_title || 'Title'}):</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-100">{p.jazzcash_number}</span>
                                <button onClick={() => handleCopy(p.jazzcash_number, p.id + 'jc')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'jc' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.sadapay_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">SadaPay ({p.sadapay_name || p.bank_account_title || 'Title'}):</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-100">{p.sadapay_number}</span>
                                <button onClick={() => handleCopy(p.sadapay_number, p.id + 'sp')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'sp' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                          {p.nayapay_number && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">NayaPay ({p.nayapay_name || p.bank_account_title || 'Title'}):</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-100">{p.nayapay_number}</span>
                                <button onClick={() => handleCopy(p.nayapay_number, p.id + 'np')} className="text-slate-400 hover:text-cyan-300">
                                  {copied === p.id + 'np' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 🌐 Crypto Payment Details */}
                  {hasCrypto && (
                    <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-2">
                      <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px] font-sans">
                        <Globe className="w-3.5 h-3.5" />
                        <span>🌐 Binance & Crypto Details</span>
                      </div>
                      {p.binance_id && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Binance Pay ID:</span>
                          <span className="text-slate-100 font-bold">{p.binance_id} {p.binance_name ? `(${p.binance_name})` : ''}</span>
                        </div>
                      )}
                      {p.bybit_uid && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Bybit UID:</span>
                          <span className="text-slate-100 font-bold">{p.bybit_uid} {p.bybit_name ? `(${p.bybit_name})` : ''}</span>
                        </div>
                      )}
                      {p.trc20_address && (
                        <div>
                          <span className="text-slate-400 block mb-0.5 flex justify-between items-center">
                            USDT TRC20 Address:
                            <button onClick={() => handleCopy(p.trc20_address, p.id + 'trc20')} className="text-cyan-400 hover:text-cyan-300">
                              {copied === p.id + 'trc20' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </span>
                          <span className="text-cyan-300 font-semibold select-all break-all">{p.trc20_address}</span>
                        </div>
                      )}
                      {p.bep20_address && (
                        <div>
                          <span className="text-slate-400 block mb-0.5 flex justify-between items-center">
                            USDT BEP20 Address:
                            <button onClick={() => handleCopy(p.bep20_address, p.id + 'bep20')} className="text-cyan-400 hover:text-cyan-300">
                              {copied === p.id + 'bep20' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </span>
                          <span className="text-cyan-300 font-semibold select-all break-all">{p.bep20_address}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 🇮🇳 UPI & INR Bank */}
                  {hasInr && (
                    <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-2">
                      <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] font-sans">
                        <Landmark className="w-3.5 h-3.5" />
                        <span>🇮🇳 India UPI & INR Bank</span>
                      </div>
                      {p.upi_id && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">UPI ID:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-amber-300 font-bold">{p.upi_id}</span>
                            <button onClick={() => handleCopy(p.upi_id, p.id + 'upi')} className="text-slate-400 hover:text-amber-300">
                              {copied === p.id + 'upi' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      )}
                      {p.inr_bank_name && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Bank:</span>
                          <span className="text-slate-100">{p.inr_bank_name}</span>
                        </div>
                      )}
                      {p.inr_account_number && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Account:</span>
                          <span className="text-slate-100">{p.inr_account_number}</span>
                        </div>
                      )}
                      {p.inr_ifsc && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">IFSC:</span>
                          <span className="text-slate-100">{p.inr_ifsc}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {p.custom_instructions && (
                    <div className="p-2.5 bg-slate-950/60 rounded-lg font-sans text-slate-300 border border-slate-800">
                      {p.custom_instructions}
                    </div>
                  )}

                  {/* Management Action Bar */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-sans">
                    <div>
                      {!p.is_default && (
                        <button
                          onClick={() => handleSetGlobalDefault(p.id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 rounded text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <Star className="w-3 h-3" /> Set Default
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(p)}
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
                      <button
                        onClick={() => handleDeleteProfile(p)}
                        className="px-2.5 py-1 bg-rose-950/60 border border-rose-800/60 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 rounded text-xs flex items-center gap-1 transition-colors"
                        title="Delete Payment Profile"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title="Create Payment Profile" maxWidth="max-w-2xl">
        <div className="space-y-4 text-xs font-sans max-h-[80vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Profile Name / Label:</label>
            <input
              type="text"
              placeholder="e.g. Pakistan Local Bank + Crypto Global"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Section: 🇵🇰 Pakistan Local Bank */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              🇵🇰 Pakistan Local Bank Transfer
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Bank Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Meezan Bank, HBL, UBL"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Account Title / Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Muhammad Ali"
                  value={bankAccountTitle}
                  onChange={(e) => setBankAccountTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1 font-mono">Account Number:</label>
                <input
                  type="text"
                  placeholder="e.g. 010101010101"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-mono">IBAN Number:</label>
                <input
                  type="text"
                  placeholder="e.g. PK00MEZN0000000000000000"
                  value={bankIban}
                  onChange={(e) => setBankIban(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section: 📱 Mobile Wallets (PK) */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              📱 Pakistan Mobile Wallets (Easypaisa, JazzCash, SadaPay, NayaPay)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Easypaisa Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={easypaisaNumber}
                  onChange={(e) => setEasypaisaNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Easypaisa Title:</label>
                <input
                  type="text"
                  placeholder="Account Title"
                  value={easypaisaName}
                  onChange={(e) => setEasypaisaName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">JazzCash Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={jazzcashNumber}
                  onChange={(e) => setJazzcashNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">JazzCash Title:</label>
                <input
                  type="text"
                  placeholder="Account Title"
                  value={jazzcashName}
                  onChange={(e) => setJazzcashName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">SadaPay Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={sadapayNumber}
                  onChange={(e) => setSadapayNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">NayaPay Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={nayapayNumber}
                  onChange={(e) => setNayapayNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-900">
              <div>
                <label className="block text-slate-400 mb-1">Other Wallet Provider:</label>
                <input
                  type="text"
                  placeholder="e.g. Raast / Finja"
                  value={localWalletName}
                  onChange={(e) => setLocalWalletName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Wallet Number:</label>
                <input
                  type="text"
                  placeholder="Number"
                  value={localWalletNumber}
                  onChange={(e) => setLocalWalletNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Wallet Title:</label>
                <input
                  type="text"
                  placeholder="Title"
                  value={localWalletTitle}
                  onChange={(e) => setLocalWalletTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Section: 🌐 Crypto Payment Details */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              🌐 Binance & Crypto Details
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Binance Name:</label>
                <input
                  type="text"
                  value={binanceName}
                  onChange={(e) => setBinanceName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Binance Pay ID:</label>
                <input
                  type="text"
                  value={binanceId}
                  onChange={(e) => setBinanceId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Bybit Name:</label>
                <input
                  type="text"
                  value={bybitName}
                  onChange={(e) => setBybitName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Bybit UID:</label>
                <input
                  type="text"
                  value={bybitUid}
                  onChange={(e) => setBybitUid(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-mono">TRC20 Address:</label>
              <input
                type="text"
                value={trc20Address}
                onChange={(e) => setTrc20Address(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-mono">BEP20 Address:</label>
              <input
                type="text"
                value={bep20Address}
                onChange={(e) => setBep20Address(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
              />
            </div>
          </div>

          {/* Section: 🇮🇳 India UPI & INR Bank (Optional) */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" />
              🇮🇳 India UPI & INR Bank Details (Optional)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">UPI ID:</label>
                <input
                  type="text"
                  placeholder="e.g. merchant@okhdfcbank"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">UPI Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Account Name"
                  value={upiName}
                  onChange={(e) => setUpiName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">INR Bank Name:</label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank"
                  value={inrBankName}
                  onChange={(e) => setInrBankName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Account Number:</label>
                <input
                  type="text"
                  placeholder="Account Number"
                  value={inrAccountNumber}
                  onChange={(e) => setInrAccountNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">IFSC Code:</label>
                <input
                  type="text"
                  placeholder="HDFC0001234"
                  value={inrIfsc}
                  onChange={(e) => setInrIfsc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Payment Instructions:</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
            />
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

      {/* Edit Modal */}
      <Modal isOpen={editModal} onClose={() => setEditModal(false)} title="Edit Payment Profile" maxWidth="max-w-2xl">
        <div className="space-y-4 text-xs font-sans max-h-[80vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Profile Name / Label:</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Section: 🇵🇰 Pakistan Local Bank */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              🇵🇰 Pakistan Local Bank Transfer
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Bank Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Meezan Bank, HBL, UBL"
                  value={editBankName}
                  onChange={(e) => setEditBankName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Account Title / Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Muhammad Ali"
                  value={editBankAccountTitle}
                  onChange={(e) => setEditBankAccountTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1 font-mono">Account Number:</label>
                <input
                  type="text"
                  placeholder="e.g. 010101010101"
                  value={editBankAccountNumber}
                  onChange={(e) => setEditBankAccountNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-mono">IBAN Number:</label>
                <input
                  type="text"
                  placeholder="e.g. PK00MEZN0000000000000000"
                  value={editBankIban}
                  onChange={(e) => setEditBankIban(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section: 📱 Mobile Wallets (PK) */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              📱 Pakistan Mobile Wallets (Easypaisa, JazzCash, SadaPay, NayaPay)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Easypaisa Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={editEasypaisaNumber}
                  onChange={(e) => setEditEasypaisaNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Easypaisa Title:</label>
                <input
                  type="text"
                  placeholder="Account Title"
                  value={editEasypaisaName}
                  onChange={(e) => setEditEasypaisaName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">JazzCash Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={editJazzcashNumber}
                  onChange={(e) => setEditJazzcashNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">JazzCash Title:</label>
                <input
                  type="text"
                  placeholder="Account Title"
                  value={editJazzcashName}
                  onChange={(e) => setEditJazzcashName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">SadaPay Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={editSadapayNumber}
                  onChange={(e) => setEditSadapayNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">NayaPay Number:</label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={editNayapayNumber}
                  onChange={(e) => setEditNayapayNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-900">
              <div>
                <label className="block text-slate-400 mb-1">Other Wallet Provider:</label>
                <input
                  type="text"
                  placeholder="e.g. Raast / Finja"
                  value={editLocalWalletName}
                  onChange={(e) => setEditLocalWalletName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Wallet Number:</label>
                <input
                  type="text"
                  placeholder="Number"
                  value={editLocalWalletNumber}
                  onChange={(e) => setEditLocalWalletNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Wallet Title:</label>
                <input
                  type="text"
                  placeholder="Title"
                  value={editLocalWalletTitle}
                  onChange={(e) => setEditLocalWalletTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Section: 🌐 Crypto Payment Details */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              🌐 Binance & Crypto Details
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Binance Name:</label>
                <input
                  type="text"
                  value={editBinanceName}
                  onChange={(e) => setEditBinanceName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Binance Pay ID:</label>
                <input
                  type="text"
                  value={editBinanceId}
                  onChange={(e) => setEditBinanceId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Bybit Name:</label>
                <input
                  type="text"
                  value={editBybitName}
                  onChange={(e) => setEditBybitName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Bybit UID:</label>
                <input
                  type="text"
                  value={editBybitUid}
                  onChange={(e) => setEditBybitUid(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-mono">TRC20 Address:</label>
              <input
                type="text"
                value={editTrc20}
                onChange={(e) => setEditTrc20(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-mono">BEP20 Address:</label>
              <input
                type="text"
                value={editBep20}
                onChange={(e) => setEditBep20(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
              />
            </div>
          </div>

          {/* Section: 🇮🇳 India UPI & INR Bank (Optional) */}
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" />
              🇮🇳 India UPI & INR Bank Details (Optional)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">UPI ID:</label>
                <input
                  type="text"
                  placeholder="e.g. merchant@okhdfcbank"
                  value={editUpiId}
                  onChange={(e) => setEditUpiId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">UPI Name:</label>
                <input
                  type="text"
                  placeholder="e.g. Account Name"
                  value={editUpiName}
                  onChange={(e) => setEditUpiName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">INR Bank Name:</label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank"
                  value={editInrBankName}
                  onChange={(e) => setEditInrBankName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Account Number:</label>
                <input
                  type="text"
                  placeholder="Account Number"
                  value={editInrAccountNumber}
                  onChange={(e) => setEditInrAccountNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">IFSC Code:</label>
                <input
                  type="text"
                  placeholder="HDFC0001234"
                  value={editInrIfsc}
                  onChange={(e) => setEditInrIfsc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Payment Instructions:</label>
            <textarea
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
              rows={2}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
            />
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={() => {
                if (editingProfile) {
                  const target = editingProfile;
                  setEditModal(false);
                  handleDeleteProfile(target);
                }
              }}
              className="px-3 py-1.5 bg-rose-950/60 border border-rose-800/60 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Profile
            </button>
            <div className="flex gap-2">
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
        </div>
      </Modal>

      {/* Assign Groups Modal */}
      <Modal isOpen={assignModal} onClose={() => setAssignModal(false)} title="Assign Payment Profile to Groups" maxWidth="max-w-xl">
        <div className="space-y-4 text-xs font-sans">
          <p className="text-slate-400 text-xs">
            Select the customer groups that will use this payment profile for /pay instructions. Other groups will use the Global Default.
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
                    {g.payment_profile_name || 'Global Default'}
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

      <PaymentDetailsBroadcastModal
        isOpen={payBroadcastModalOpen}
        onClose={() => setPayBroadcastModalOpen(false)}
        onComplete={fetchData}
      />
    </div>
  );
};
