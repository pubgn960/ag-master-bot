import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  Eye,
  CheckCircle,
  XCircle,
  CreditCard,
  Send,
  AlertTriangle,
  Lock,
  User,
  Shield,
  HelpCircle,
} from 'lucide-react';

export const PendingOrdersView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [revealModal, setRevealModal] = useState<{
    isOpen: boolean;
    orderId: string;
    orderNumber: string;
    fieldName: string;
    revealedValue?: string;
  }>({ isOpen: false, orderId: '', orderNumber: '', fieldName: '' });

  const [revealPurpose, setRevealPurpose] = useState('Staff verification for fulfillment');
  const [revealing, setRevealing] = useState(false);

  const [confirmManualProcess, setConfirmManualProcess] = useState<{isOpen: boolean; orderId: string; orderNumber: string;}>({ isOpen: false, orderId: '', orderNumber: '' });
  const [confirmProcess, setConfirmProcess] = useState<{
    isOpen: boolean;
    orderId: string;
    orderNumber: string;
    loaderName: string;
  }>({ isOpen: false, orderId: '', orderNumber: '', loaderName: '' });

  const [confirmCancel, setConfirmCancel] = useState<{
    isOpen: boolean;
    orderId: string;
    orderNumber: string;
  }>({ isOpen: false, orderId: '', orderNumber: '' });
  const [cancelReason, setCancelReason] = useState('Customer requested cancellation');

  const [manualPaidModal, setManualPaidModal] = useState<{
    isOpen: boolean;
    orderId: string;
    orderNumber: string;
  }>({ isOpen: false, orderId: '', orderNumber: '' });
  const [manualPaidReason, setManualPaidReason] = useState('Approved by Owner for VIP customer');

  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchPendingOrders = () => {
    setLoading(true);
    fetch('/api/orders?status=PENDING')
      .then((r) => r.json())
      .then(async (data) => {
        if (Array.isArray(data)) {
          // Fetch full card for each
          const fullCards = await Promise.all(
            data.map((o) => fetch(`/api/orders/${o.id}`).then((r) => r.json()))
          );
          setOrders(fullCards);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchPendingOrders();
  }, []);

  const handleReveal = async () => {
    setRevealing(true);
    try {
      const res = await fetch(`/api/orders/${revealModal.orderId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldName: revealModal.fieldName,
          purpose: revealPurpose,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRevealModal((prev) => ({ ...prev, revealedValue: data.plainText }));
    } catch (err: any) {
      setFeedbackMsg({ text: `Failed to reveal secret: ${err.message}`, type: 'error' });
    } finally {
      setRevealing(false);
    }
  };

  const handleManualProcess = async () => {
    try {
      const res = await fetch(`/api/orders/${confirmManualProcess.orderId}/process`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedbackMsg({ text: `Order ${confirmManualProcess.orderNumber} manually processed!`, type: 'success' });
      setConfirmManualProcess({ isOpen: false, orderId: '', orderNumber: '' });
      fetchPendingOrders();
    } catch (err: any) {
      setFeedbackMsg({ text: `Process failed: ${err.message}`, type: 'error' });
    }
  };

  const handleDispatch = async () => {
    try {
      const res = await fetch(`/api/orders/${confirmProcess.orderId}/dispatch`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedbackMsg({ text: `Order ${confirmProcess.orderNumber} dispatched to loader queue!`, type: 'success' });
      setConfirmProcess({ isOpen: false, orderId: '', orderNumber: '', loaderName: '' });
      fetchPendingOrders();
    } catch (err: any) {
      setFeedbackMsg({ text: `Dispatch failed: ${err.message}`, type: 'error' });
    }
  };

  const handleCancel = async () => {
    try {
      const res = await fetch(`/api/orders/${confirmCancel.orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedbackMsg({ text: `Order ${confirmCancel.orderNumber} cancelled.`, type: 'success' });
      setConfirmCancel({ isOpen: false, orderId: '', orderNumber: '' });
      fetchPendingOrders();
    } catch (err: any) {
      setFeedbackMsg({ text: `Cancel failed: ${err.message}`, type: 'error' });
    }
  };

  const handleManualPaid = async () => {
    try {
      const res = await fetch(`/api/orders/${manualPaidModal.orderId}/manual-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: 'MANUALLY_MARKED_PAID', reason: manualPaidReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedbackMsg({ text: `Manual override applied to ${manualPaidModal.orderNumber}.`, type: 'success' });
      setManualPaidModal({ isOpen: false, orderId: '', orderNumber: '' });
      fetchPendingOrders();
    } catch (err: any) {
      setFeedbackMsg({ text: `Manual override failed: ${err.message}`, type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Pending Orders Cards</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational staff station with masked secrets, reveal auditing, and safe dispatching.
          </p>
        </div>
        <button
          onClick={fetchPendingOrders}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
        >
          Refresh Queue
        </button>
      </div>

      {feedbackMsg && (
        <div
          className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button onClick={() => setFeedbackMsg(null)} className="font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-xs font-mono">Loading pending orders...</div>
      ) : orders.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-12 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-500/80 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-200">No Pending Orders</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            All orders are currently processed or completed. New customer orders from Telegram will appear here immediately.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {orders.map((o) => {
            const isFulfillable =
              o.fulfillment_rule_snapshot === 'FULFILL_REGARDLESS_OF_PAYMENT' ||
              o.payment_amount_state === 'PAID' ||
              o.payment_amount_state === 'OVERPAID' ||
              o.manual_payment_override === 'MANUALLY_MARKED_PAID';

            return (
              <div
                key={o.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 shadow-sm flex flex-col justify-between transition-all"
              >
                <div>
                  {/* Card Top */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                        {o.order_number}
                      </span>
                      <p className="text-xs font-semibold text-slate-200 mt-1.5">{o.group_title}</p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          o.fulfillment_rule_snapshot === 'PAYMENT_REQUIRED' ? 'warning' : 'info'
                        }
                        size="sm"
                      >
                        {o.fulfillment_rule_snapshot}
                      </Badge>
                      <p className="text-[10px] text-slate-400 mt-1 font-mono">{o.customer_name}</p>
                    </div>
                  </div>

                  {/* Order Details */}
                  <div className="my-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Package:</span>
                      <span className="font-semibold text-slate-100 font-mono">
                        {o.bundle_name || `${o.cp_quantity} CP`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Sale Price / Loader Cost:</span>
                      <span className="font-mono">
                        <strong className="text-emerald-400 font-bold">${parseFloat(o.sale_price_snapshot).toFixed(2)}</strong>
                        <span className="text-slate-500 text-[10px]"> (Cost: ${parseFloat(o.loader_cost_snapshot).toFixed(2)})</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Assigned Loader:</span>
                      <span className="font-semibold text-cyan-300">{o.loader_name || 'Unassigned'}</span>
                    </div>

                    {/* Payment Status row */}
                    <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between mt-2">
                      <div>
                        <p className="text-[10px] text-slate-400 font-medium uppercase">Payment State</p>
                        <p className="text-xs font-bold text-slate-200 mt-0.5 font-mono">
                          ${parseFloat(o.amount_paid).toFixed(2)} paid • ${parseFloat(o.amount_remaining).toFixed(2)} left
                        </p>
                      </div>
                      <Badge
                        variant={
                          o.payment_amount_state === 'PAID'
                            ? 'success'
                            : o.payment_amount_state === 'PARTIAL'
                            ? 'amber'
                            : 'danger'
                        }
                        size="sm"
                      >
                        {o.payment_amount_state}
                      </Badge>
                    </div>

                    {o.manual_payment_override === 'MANUALLY_MARKED_PAID' && (
                      <div className="p-2 bg-amber-950/40 border border-amber-800/60 rounded text-[11px] text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Staff Manual Payment Override Applied</span>
                      </div>
                    )}

                    {/* Masked Credentials section */}
                    <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Lock className="w-3 h-3 text-cyan-400" /> Credentials (Encrypted at Rest)
                      </p>
                      {o.masked_fields && o.masked_fields.length > 0 ? (
                        o.masked_fields.map((f: any) => (
                          <div
                            key={f.field_name}
                            className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded border border-slate-800/80"
                          >
                            <span className="text-[11px] text-slate-400 font-mono">{f.field_name}:</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-slate-200">
                                {f.field_value_masked}
                              </span>
                              <button
                                onClick={() =>
                                  setRevealModal({
                                    isOpen: true,
                                    orderId: o.id,
                                    orderNumber: o.order_number,
                                    fieldName: f.field_name,
                                  })
                                }
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-400 transition-colors"
                                title="Reveal Secret (Audit Logged)"
                              >
                                <Eye className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">No credential fields attached</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        setManualPaidModal({
                          isOpen: true,
                          orderId: o.id,
                          orderNumber: o.order_number,
                        })
                      }
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                      title="Apply Staff Manual Paid Override"
                    >
                      Mark Paid
                    </button>
                    <button
                      onClick={() =>
                        setConfirmCancel({
                          isOpen: true,
                          orderId: o.id,
                          orderNumber: o.order_number,
                        })
                      }
                      className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 rounded-lg text-xs font-medium border border-rose-800/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>

                  <button
                    onClick={() =>
                      setConfirmProcess({
                        isOpen: true,
                        orderId: o.id,
                        orderNumber: o.order_number,
                        loaderName: o.loader_name || 'Assigned Loader',
                      })
                    }
                    disabled={!isFulfillable}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                      isFulfillable
                        ? 'bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Process (Send)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reveal Secret Modal */}
      <Modal
        isOpen={revealModal.isOpen}
        onClose={() =>
          setRevealModal({ isOpen: false, orderId: '', orderNumber: '', fieldName: '', revealedValue: undefined })
        }
        title={`Reveal Secret: ${revealModal.fieldName} (${revealModal.orderNumber})`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-950/60 border border-amber-800/80 rounded-xl text-xs text-amber-300 flex items-start gap-2">
            <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Security Invariant:</strong> Decrypting and revealing customer secrets is strictly audited. Your staff username, IP address, timestamp, and purpose will be permanently logged in <code>credential_access_log</code>.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Purpose / Reason for Reveal:
            </label>
            <input
              type="text"
              value={revealPurpose}
              onChange={(e) => setRevealPurpose(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {revealModal.revealedValue ? (
            <div className="p-3 bg-slate-950 border border-emerald-800/80 rounded-xl">
              <p className="text-[10px] text-slate-400 uppercase font-mono">Decrypted Plaintext Value:</p>
              <p className="text-sm font-mono font-bold text-emerald-400 mt-1 select-all">
                {revealModal.revealedValue}
              </p>
            </div>
          ) : (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleReveal}
                disabled={revealing}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {revealing ? 'Decrypting...' : 'Confirm Reveal Secret'}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Manual Process Modal */}
        <ConfirmModal
          isOpen={confirmManualProcess.isOpen}
          onClose={() => setConfirmManualProcess({ isOpen: false, orderId: '', orderNumber: '' })}
          onConfirm={handleManualProcess}
          title={`Process ${confirmManualProcess.orderNumber}?`}
          message={`Are you sure you want to manually process this order? This will mark the order as DONE and realize profit exactly once. It will NOT be sent to the loader.`}
          confirmText="Confirm & Process"
          variant="primary"
        />
        
        {/* Confirm Process Modal */}
      <ConfirmModal
        isOpen={confirmProcess.isOpen}
        onClose={() => setConfirmProcess({ isOpen: false, orderId: '', orderNumber: '', loaderName: '' })}
        onConfirm={handleDispatch}
        title={`Dispatch ${confirmProcess.orderNumber}?`}
        message={`Are you sure you want to dispatch this order to ${confirmProcess.loaderName}? The order credentials will be queued in the durable outbox and sent to the loader's configured Telegram environment.`}
        confirmText="Confirm & Dispatch"
        variant="primary"
      />

      {/* Confirm Cancel Modal */}
      <Modal
        isOpen={confirmCancel.isOpen}
        onClose={() => setConfirmCancel({ isOpen: false, orderId: '', orderNumber: '' })}
        title={`Cancel ${confirmCancel.orderNumber}?`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-300">
            Are you sure you want to cancel order <strong>{confirmCancel.orderNumber}</strong>? Any allocated payments will become customer credit in the balance ledger.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Cancellation Reason:</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirmCancel({ isOpen: false, orderId: '', orderNumber: '' })}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-medium"
            >
              Back
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold"
            >
              Confirm Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Manual Paid Override Modal */}
      <Modal
        isOpen={manualPaidModal.isOpen}
        onClose={() => setManualPaidModal({ isOpen: false, orderId: '', orderNumber: '' })}
        title={`Manual Payment Override: ${manualPaidModal.orderNumber}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-950/60 border border-amber-800/80 rounded-xl text-xs text-amber-300">
            <strong>Important:</strong> Manual override releases fulfillment for PAYMENT_REQUIRED orders. It will NOT fake an exchange transaction or create verified financial funds.
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Override Reason:</label>
            <input
              type="text"
              value={manualPaidReason}
              onChange={(e) => setManualPaidReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setManualPaidModal({ isOpen: false, orderId: '', orderNumber: '' })}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleManualPaid}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold"
            >
              Apply Override
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
