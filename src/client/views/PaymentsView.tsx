import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { LinkOrderModal } from '../components/LinkOrderModal';
import { CreditCard, CheckCircle2, XCircle, RotateCcw, Plus, DollarSign, Layers, Link as LinkIcon, AlertTriangle, Check, RefreshCw } from 'lucide-react';

export const PaymentsView: React.FC = () => {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);

  // Modals
  const [newPayModal, setNewPayModal] = useState(false);
  const [newAmount, setNewAmount] = useState('31.00');
  const [newTxid, setNewTxid] = useState('');
  const [newSource, setNewSource] = useState('EXCHANGE_API');

  const [allocateModal, setAllocateModal] = useState<{
    isOpen: boolean;
    paymentId: string;
    amount: number;
    unallocated: number;
    result?: any;
  }>({ isOpen: false, paymentId: '', amount: 0, unallocated: 0 });

  const [reverseModal, setReverseModal] = useState<{
    isOpen: boolean;
    paymentId: string;
    amount: number;
  }>({ isOpen: false, paymentId: '', amount: 0 });
  const [reverseReason, setReverseReason] = useState('Exchange transaction reverted / invalid proof');

  // Link Order Modal
  const [linkOrderModal, setLinkOrderModal] = useState<{
    isOpen: boolean;
    paymentId: string;
    selectedOrderId: string;
  }>({ isOpen: false, paymentId: '', selectedOrderId: '' });

  // Mark Partial Modal
  const [partialModal, setPartialModal] = useState<{
    isOpen: boolean;
    paymentId: string;
    orderId: string;
    amount: string;
    remainingAmount: string;
  }>({ isOpen: false, paymentId: '', orderId: '', amount: '0', remainingAmount: '0' });

  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Manual fields state for payment verification queue cards
  const [manualInputs, setManualInputs] = useState<
    Record<string, { paymentReference?: string; amount?: string; paymentSource?: string }>
  >({});

  const handleManualInputChange = (
    paymentId: string,
    field: 'paymentReference' | 'amount' | 'paymentSource',
    value: string
  ) => {
    setManualInputs((prev) => ({
      ...prev,
      [paymentId]: {
        ...prev[paymentId],
        [field]: value,
      },
    }));
  };

  const fetchPayments = () => {
    setLoading(true);
    fetch('/api/payments')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPayments(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchPayments();
    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAvailableOrders(data);
      })
      .catch(() => {});
  }, []);

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/payments/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(newAmount),
          currency: 'USD',
          source: newSource,
          txid: newTxid || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: `Payment of $${newAmount} ingested successfully (ID: ${data.id})!`, type: 'success' });
      setNewPayModal(false);
      setNewTxid('');
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Ingestion failed: ${err.message}`, type: 'error' });
    }
  };

  // Real Backend Routes for the 6 Review Actions
  const handleVerifyNow = async (paymentId: string) => {
    try {
      const inputs = manualInputs[paymentId] || {};
      const res = await fetch(`/api/payments/${paymentId}/verify-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentReference: inputs.paymentReference,
          amount: inputs.amount,
          paymentSource: inputs.paymentSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.verificationState === 'VERIFIED') {
        const amtStr = data.verifiedTx?.amount ? `${data.verifiedTx.amount} ${data.verifiedTx.currency || 'USDT'}` : 'USDT';
        setFeedback({ text: `Payment verified automatically via Exchange API! Received: ${amtStr}`, type: 'success' });
      } else {
        setFeedback({ text: `Exchange check completed. Verification state: ${data.verificationState}`, type: 'success' });
      }
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Verify Now failed: ${err.message}`, type: 'error' });
    }
  };

  const handleApprove = async (paymentId: string) => {
    try {
      const manual = manualInputs[paymentId];
      const res = await fetch(`/api/payments/${paymentId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: manual?.amount ? parseFloat(manual.amount) : undefined,
          txid: manual?.paymentReference,
          source: manual?.paymentSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: 'Payment approved, marked received, and dispatched to loader.', type: 'success' });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Approve failed: ${err.message}`, type: 'error' });
    }
  };

  const handleReject = async (paymentId: string) => {
    try {
      const res = await fetch(`/api/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Staff rejected / payment not received' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: 'Payment marked as not received (rejected). Customer group notified in Telegram.', type: 'success' });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Reject failed: ${err.message}`, type: 'error' });
    }
  };

  const handleMarkAlreadyUsed = async (paymentId: string) => {
    try {
      const res = await fetch(`/api/payments/${paymentId}/mark-already-used`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'ALREADY_USED' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: 'Payment marked as ALREADY_USED. Customer group notified in Telegram.', type: 'success' });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Mark Already Used failed: ${err.message}`, type: 'error' });
    }
  };

  const handleLinkOrderSubmit = async () => {
    try {
      if (!linkOrderModal.selectedOrderId) {
        throw new Error('Please select or specify an order to link');
      }
      const res = await fetch(`/api/payments/${linkOrderModal.paymentId}/link-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: linkOrderModal.selectedOrderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: 'Linked order updated successfully.', type: 'success' });
      setLinkOrderModal({ isOpen: false, paymentId: '', selectedOrderId: '' });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Link Order failed: ${err.message}`, type: 'error' });
    }
  };

  const handleMarkPartialSubmit = async () => {
    try {
      if (!partialModal.orderId) {
        throw new Error('Please select or specify an order for partial payment');
      }
      const amt = parseFloat(partialModal.amount);
      const rem = parseFloat(partialModal.remainingAmount);
      if (isNaN(amt) || isNaN(rem)) {
        throw new Error('Please enter valid numeric amounts for partial payment and remainder');
      }

      const res = await fetch(`/api/payments/${partialModal.paymentId}/mark-partial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: partialModal.orderId,
          amount: amt,
          remainingAmount: rem,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: `Partial payment recorded: $${amt.toFixed(2)} received, $${rem.toFixed(2)} remaining.`, type: 'success' });
      setPartialModal({ isOpen: false, paymentId: '', orderId: '', amount: '0', remainingAmount: '0' });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Mark Partial failed: ${err.message}`, type: 'error' });
    }
  };

  const handleAllocate = async (paymentId: string) => {
    try {
      const res = await fetch(`/api/payments/${paymentId}/allocate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAllocateModal((prev) => ({ ...prev, result: data }));
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Allocation failed: ${err.message}`, type: 'error' });
    }
  };

  const handleReverse = async () => {
    try {
      const res = await fetch(`/api/payments/${reverseModal.paymentId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reverseReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ text: `Payment reversed. ${data.unwoundAllocations?.length || 0} order allocations unwound.`, type: 'success' });
      setReverseModal({ isOpen: false, paymentId: '', amount: 0 });
      fetchPayments();
    } catch (err: any) {
      setFeedback({ text: `Reversal failed: ${err.message}`, type: 'error' });
    }
  };

  const reviewPayments = payments.filter(
    (p) => p.verification_state === 'NEEDS_REVIEW' || p.verification_state === 'PENDING' || p.verification_state === 'ALREADY_USED'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Payments & Financial Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Deduplicated cryptocurrency TXIDs, verification state, FIFO multi-order allocation, and immutable reversals.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setNewPayModal(true)}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Ingest Payment
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

      {/* Payment Verification Review Queue */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Payment Verification Queue
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Items requiring staff verification, exchange lookup, order linking, or duplicate confirmation.
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-slate-800 text-slate-300 rounded-full">
            {reviewPayments.length} awaiting review
          </span>
        </div>

        {reviewPayments.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 font-mono">
            No pending payments in verification queue. Customer proofs requiring review will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            {reviewPayments.map((p) => (
              <div
                key={p.id}
                className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3 hover:border-slate-700 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Badge
                      variant={
                        p.verification_state === 'VERIFIED'
                          ? 'success'
                          : p.verification_state === 'ALREADY_USED'
                          ? 'amber'
                          : p.verification_state === 'NEEDS_REVIEW'
                          ? 'warning'
                          : 'danger'
                      }
                      size="sm"
                    >
                      {p.verification_state}
                    </Badge>
                    <span className="text-xs font-bold text-slate-200">
                      {p.customer_name || 'Customer'}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      ({p.group_title || 'Telegram Group'})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-slate-400">Detected Amount:</span>
                    <span className="text-emerald-400 font-bold text-sm">
                      {p.amount_display === 'UNKNOWN' || !p.amount || parseFloat(p.amount) === 0
                        ? 'UNKNOWN'
                        : (p.verification_state === 'VERIFIED' ? `${parseFloat(p.amount).toFixed(2)} USDT` : `$${parseFloat(p.amount).toFixed(2)}`)}
                    </span>
                    {p.txid && (
                      <span className="text-slate-500 text-[10px] ml-2">TXID: {p.txid}</span>
                    )}
                  </div>
                </div>

                {/* Screenshot Thumbnail Preview */}
                {p.thumbnail_url && (
                  <div className="flex items-center gap-3 p-2.5 bg-slate-950/40 rounded-lg border border-slate-800/80">
                    <div
                      className="cursor-pointer group relative overflow-hidden rounded border border-slate-700 hover:border-cyan-400 transition-colors"
                      onClick={() => setPreviewImage(p.thumbnail_url)}
                      title="Click to view full screenshot"
                    >
                      <img
                        src={p.thumbnail_url}
                        alt="Screenshot thumbnail"
                        className="w-16 h-16 object-cover group-hover:scale-105 transition-transform"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    </div>
                    <div className="text-xs font-mono">
                      <span className="text-slate-200 font-semibold block">Uploaded Screenshot Receipt</span>
                      <button
                        type="button"
                        onClick={() => setPreviewImage(p.thumbnail_url)}
                        className="text-[11px] text-cyan-400 hover:underline mt-0.5 inline-block"
                      >
                        🔍 Click to view full image
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 bg-slate-950/60 rounded-lg text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block text-[10px]">LIKELY ORDER:</span>
                    <span className="text-cyan-400 font-semibold">
                      {p.linked_order_number || (p.linked_order_id ? (p.linked_order_number || `ORD-${p.linked_order_id.slice(0, 8)}`) : 'NONE')}
                    </span>
                    {p.linked_player_ign && (
                      <span className="text-slate-400 text-[11px] block">IGN: {p.linked_player_ign}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">ORDER EMAIL:</span>
                    <span className="text-slate-200 font-semibold truncate block" title={p.linked_order_email || 'N/A'}>
                      {p.linked_order_email || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">PACKAGE:</span>
                    <span className="text-slate-200 font-semibold">
                      {p.linked_order_bundle || p.linked_order_package || (p.linked_cp_quantity ? `${p.linked_cp_quantity} CP` : '80 CP')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">EXPECTED / REMAINING:</span>
                    <span className="text-emerald-400 font-semibold">
                      {p.linked_order_remaining !== null && p.linked_order_remaining !== undefined
                        ? `$${parseFloat(p.linked_order_remaining).toFixed(2)} remaining`
                        : (p.linked_order_price ? `$${parseFloat(p.linked_order_price).toFixed(2)} price` : 'N/A')}
                    </span>
                  </div>
                </div>

                {/* Manual Fields for Payment Reference / TXID, Amount, and Payment Source */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-950/40 border border-slate-800/80 rounded-lg text-xs font-mono">
                  <div>
                    <label className="block text-slate-400 text-[10px] mb-1 font-semibold uppercase">
                      Payment Reference / TXID:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 452972739808239616 or TXID"
                      value={manualInputs[p.id]?.paymentReference ?? (p.txid || p.raw_evidence?.payment_reference || '')}
                      onChange={(e) => handleManualInputChange(p.id, 'paymentReference', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-[10px] mb-1 font-semibold uppercase">
                      Amount:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 134.00"
                      value={manualInputs[p.id]?.amount ?? (p.amount && parseFloat(p.amount) > 0 ? parseFloat(p.amount).toString() : '')}
                      onChange={(e) => handleManualInputChange(p.id, 'amount', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-[10px] mb-1 font-semibold uppercase">
                      Payment Source:
                    </label>
                    <select
                      value={manualInputs[p.id]?.paymentSource ?? (p.source && p.source !== 'SCREENSHOT' ? p.source : (p.raw_evidence?.payment_source || 'Binance'))}
                      onChange={(e) => handleManualInputChange(p.id, 'paymentSource', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-mono"
                    >
                      <option value="Binance">Binance</option>
                      <option value="Bybit">Bybit</option>
                      <option value="Wallet">Wallet</option>
                      <option value="Unknown">Unknown</option>
                    </select>
                  </div>
                </div>

                {/* The 6 Buttons calling real backend routes */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => handleVerifyNow(p.id)}
                    className="px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Check exchange API to verify transaction"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Verify Now
                  </button>

                  <button
                    onClick={() => handleApprove(p.id)}
                    className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Staff approve and mark payment received"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Approve / Mark Received
                  </button>

                  <button
                    onClick={() => handleReject(p.id)}
                    className="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Reject proof / mark not received"
                  >
                    <XCircle className="w-3 h-3" />
                    Reject / Not Received
                  </button>

                  <button
                    onClick={() => handleMarkAlreadyUsed(p.id)}
                    className="px-2.5 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Mark as already used without double-crediting"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Mark Already Used
                  </button>

                  <button
                    onClick={() => {
                      setLinkOrderModal({
                        isOpen: true,
                        paymentId: p.id,
                        selectedOrderId: p.linked_order_id || '',
                      });
                    }}
                    className="px-2.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Link or change linked order"
                  >
                    <LinkIcon className="w-3 h-3" />
                    Link / Change Linked Order
                  </button>

                  <button
                    onClick={() => {
                      const currAmt = parseFloat(p.amount || 0);
                      const expAmt = p.linked_order_remaining ? parseFloat(p.linked_order_remaining) : (p.linked_order_price ? parseFloat(p.linked_order_price) : 0);
                      const remAmt = Math.max(0, expAmt - currAmt);
                      setPartialModal({
                        isOpen: true,
                        paymentId: p.id,
                        orderId: p.linked_order_id || '',
                        amount: String(currAmt > 0 ? currAmt : '10.00'),
                        remainingAmount: String(remAmt > 0 ? remAmt : '21.00'),
                      });
                    }}
                    className="px-2.5 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Apply partial payment and record remaining amount"
                  >
                    <DollarSign className="w-3 h-3" />
                    Mark Partial
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* General Ledger Table */}
      <Card>
        <div className="pb-3 border-b border-slate-800 mb-3">
          <h3 className="text-sm font-bold text-slate-100">All Payments Ledger</h3>
        </div>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading payments ledger...</div>
        ) : payments.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No payments ingested. Click "Ingest Payment" or send a payment screenshot in Telegram.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">TXID / SOURCE</th>
                  <th className="pb-3 font-medium">CUSTOMER / GROUP</th>
                  <th className="pb-3 font-medium">LINKED ORDER</th>
                  <th className="pb-3 font-medium">TOTAL AMOUNT</th>
                  <th className="pb-3 font-medium">ALLOCATED / LEFT</th>
                  <th className="pb-3 font-medium">VERIFICATION</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3">
                      <p className="font-mono text-cyan-400 font-semibold">{p.txid || `INTERNAL_${p.id.slice(0, 8)}`}</p>
                      <p className="text-[10px] text-slate-400 font-normal">{p.source}</p>
                    </td>
                    <td className="py-3 text-slate-300">
                      <div>{p.customer_name || 'Unassigned'}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{p.group_title || 'No Group'}</div>
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      {p.linked_order_number || (p.linked_order_id ? `ORD-${p.linked_order_id.slice(0, 8)}` : '—')}
                    </td>
                    <td className="py-3 font-mono font-bold text-emerald-400 text-sm">
                      {p.amount_display === 'UNKNOWN' || !p.amount || parseFloat(p.amount) === 0
                        ? 'UNKNOWN'
                        : (p.verification_state === 'VERIFIED' ? `${parseFloat(p.amount).toFixed(2)} USDT` : `${parseFloat(p.amount).toFixed(2)}`)}
                    </td>
                    <td className="py-3 font-mono">
                      <span className="text-slate-300">${parseFloat(p.allocated_amount || 0).toFixed(2)}</span>
                      <span className="text-slate-500 text-[10px]"> / ${parseFloat(p.unallocated_amount || 0).toFixed(2)} left</span>
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={
                          p.verification_state === 'VERIFIED'
                            ? 'success'
                            : p.verification_state === 'ALREADY_USED'
                            ? 'amber'
                            : p.verification_state === 'NEEDS_REVIEW' || p.verification_state === 'PENDING'
                            ? 'warning'
                            : 'danger'
                        }
                        size="sm"
                      >
                        {p.verification_state}
                      </Badge>
                      {p.verification_reason && (
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{p.verification_reason}</p>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {p.verification_state !== 'VERIFIED' && (
                          <>
                            <button
                              onClick={() => handleVerifyNow(p.id)}
                              className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded text-[11px] font-semibold transition-colors"
                              title="Verify Now"
                            >
                              Verify Now
                            </button>
                            <button
                              onClick={() => handleApprove(p.id)}
                              className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-semibold transition-colors"
                              title="Approve / Mark Received"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(p.id)}
                              className="px-2 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded text-[11px] font-semibold transition-colors"
                              title="Reject / Not Received"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleMarkAlreadyUsed(p.id)}
                              className="px-2 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded text-[11px] font-semibold transition-colors"
                              title="Mark Already Used"
                            >
                              Already Used
                            </button>
                          </>
                        )}

                        {!(parseFloat(p.allocated_amount || 0) > 0 || p.linked_order_id) ? (
                          <button
                            onClick={() => {
                              setLinkOrderModal({
                                isOpen: true,
                                paymentId: p.id,
                                selectedOrderId: p.linked_order_id || '',
                              });
                            }}
                            className="px-2 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded text-[11px] font-semibold transition-colors"
                            title="Link Order (Manual Override)"
                          >
                            Link Order
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setLinkOrderModal({
                                isOpen: true,
                                paymentId: p.id,
                                selectedOrderId: p.linked_order_id || '',
                              });
                            }}
                            className="px-1.5 py-0.5 bg-slate-800/40 hover:bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700/40 rounded text-[10px] transition-colors"
                            title="Change Linked Order"
                          >
                            Re-link
                          </button>
                        )}

                        <button
                          onClick={() => {
                            const currAmt = parseFloat(p.amount || 0);
                            const expAmt = p.linked_order_remaining ? parseFloat(p.linked_order_remaining) : (p.linked_order_price ? parseFloat(p.linked_order_price) : 0);
                            const remAmt = Math.max(0, expAmt - currAmt);
                            setPartialModal({
                              isOpen: true,
                              paymentId: p.id,
                              orderId: p.linked_order_id || '',
                              amount: String(currAmt > 0 ? currAmt : '10.00'),
                              remainingAmount: String(remAmt > 0 ? remAmt : '21.00'),
                            });
                          }}
                          className="px-2 py-1 bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 rounded text-[11px] font-semibold transition-colors"
                          title="Mark Partial"
                        >
                          Partial
                        </button>

                        {p.verification_state === 'VERIFIED' && parseFloat(p.unallocated_amount) > 0 && (
                          <button
                            onClick={() => {
                              setAllocateModal({
                                isOpen: true,
                                paymentId: p.id,
                                amount: parseFloat(p.amount),
                                unallocated: parseFloat(p.unallocated_amount),
                              });
                              handleAllocate(p.id);
                            }}
                            className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
                          >
                            <Layers className="w-3 h-3" />
                            Allocate
                          </button>
                        )}

                        {p.verification_state === 'VERIFIED' && (
                          <button
                            onClick={() =>
                              setReverseModal({
                                isOpen: true,
                                paymentId: p.id,
                                amount: parseFloat(p.amount),
                              })
                            }
                            className="p-1.5 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 rounded transition-colors"
                            title="Reverse Payment"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Link / Change Linked Order Modal */}
      <LinkOrderModal
        isOpen={linkOrderModal.isOpen}
        onClose={() => setLinkOrderModal({ isOpen: false, paymentId: '', selectedOrderId: '' })}
        paymentId={linkOrderModal.paymentId}
        initialOrderId={linkOrderModal.selectedOrderId}
        availableOrders={availableOrders}
        onLinkOrder={async (paymentId, orderId) => {
          const res = await fetch(`/api/payments/${paymentId}/link-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          setFeedback({ text: 'Linked order updated successfully.', type: 'success' });
          fetchPayments();
        }}
      />

      {/* Mark Partial Modal */}
      {partialModal.isOpen && (
        <Modal
          isOpen={partialModal.isOpen}
          onClose={() => setPartialModal({ isOpen: false, paymentId: '', orderId: '', amount: '0', remainingAmount: '0' })}
          title="Mark Partial Payment"
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">
              Record a partial payment received and explicitly set the remaining balance due:
            </p>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Target Order:</label>
              <select
                value={partialModal.orderId}
                onChange={(e) => setPartialModal((prev) => ({ ...prev, orderId: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500"
              >
                <option value="">-- Select Order --</option>
                {availableOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number || `ORD-${o.id.slice(0, 8)}`} - {o.player_ign || 'Player'} (${parseFloat(o.total_amount || o.sale_price_snapshot || 0).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Amount Received (USD):</label>
                <input
                  type="number"
                  step="0.01"
                  value={partialModal.amount}
                  onChange={(e) => setPartialModal((prev) => ({ ...prev, amount: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Remaining Balance (USD):</label>
                <input
                  type="number"
                  step="0.01"
                  value={partialModal.remainingAmount}
                  onChange={(e) => setPartialModal((prev) => ({ ...prev, remainingAmount: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPartialModal({ isOpen: false, paymentId: '', orderId: '', amount: '0', remainingAmount: '0' })}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPartialSubmit}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-semibold"
              >
                Confirm Partial Payment
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Ingest Modal */}
      <Modal isOpen={newPayModal} onClose={() => setNewPayModal(false)} title="Ingest New Payment" maxWidth="max-w-md">
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Amount (USD):</label>
            <input
              type="number"
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">TXID (Transaction Hash / Binance Order ID):</label>
            <input
              type="text"
              placeholder="e.g. TXID or payment reference"
              value={newTxid}
              onChange={(e) => setNewTxid(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Source Gateway:</label>
            <select
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="EXCHANGE_API">EXCHANGE_API (Binance / Bybit)</option>
              <option value="BLOCKCHAIN_RPC">BLOCKCHAIN_RPC (USDT TRC20 / BEP20)</option>
              <option value="MANUAL">MANUAL (Staff Cash / Direct Deposit)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setNewPayModal(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleCreatePayment}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
            >
              Confirm Ingest
            </button>
          </div>
        </div>
      </Modal>

      {/* Allocation Result Modal */}
      {allocateModal.isOpen && (
        <Modal
          isOpen={allocateModal.isOpen}
          onClose={() => setAllocateModal({ isOpen: false, paymentId: '', amount: 0, unallocated: 0 })}
          title="FIFO Order Payment Allocation Result"
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-xs">
            {allocateModal.result ? (
              <div>
                <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 font-medium">
                  Allocated <strong>${allocateModal.result.totalAllocated.toFixed(2)}</strong> across {allocateModal.result.allocations?.length || 0} open orders.
                  {allocateModal.result.surplusCredit > 0 && (
                    <span className="block mt-1 text-cyan-300">
                      Surplus of <strong>${allocateModal.result.surplusCredit.toFixed(2)}</strong> posted to customer balance ledger.
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="font-bold text-slate-300">Applied Allocations:</p>
                  {allocateModal.result.allocations?.map((a: any) => (
                    <div key={a.orderId} className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                      <div className="flex justify-between font-mono">
                        <span className="text-cyan-400 font-bold">{a.orderNumber}</span>
                        <span className="text-emerald-400 font-bold">+${a.allocatedAmount.toFixed(2)}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 font-sans italic">{a.customerConfirmationText}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-slate-400 font-mono">Running atomic FIFO allocation...</div>
            )}
          </div>
        </Modal>
      )}

      {/* Reverse Modal */}
      <Modal
        isOpen={reverseModal.isOpen}
        onClose={() => setReverseModal({ isOpen: false, paymentId: '', amount: 0 })}
        title="Reverse Payment"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300">
            Reversing payment of <strong>${reverseModal.amount.toFixed(2)}</strong> will atomic-unwind any allocated orders, adjust their remaining balances, and maintain immutable ledger records in <code>payment_reversals</code>.
          </p>
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Reason for Reversal:</label>
            <textarea
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-rose-500"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setReverseModal({ isOpen: false, paymentId: '', amount: 0 })}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleReverse}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold"
            >
              Confirm Reversal
            </button>
          </div>
        </div>
      </Modal>

      {/* Full Screenshot Preview Modal */}
      {previewImage && (
        <Modal
          isOpen={!!previewImage}
          onClose={() => setPreviewImage(null)}
          title="Payment Receipt Screenshot"
          maxWidth="max-w-2xl"
        >
          <div className="flex flex-col items-center justify-center p-2">
            <img
              src={previewImage}
              alt="Full Receipt"
              className="max-w-full max-h-[75vh] object-contain rounded-lg border border-slate-700 shadow-2xl"
            />
            <div className="mt-4 flex justify-end w-full">
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
