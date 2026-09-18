import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Send, CheckCircle2, AlertTriangle, XCircle, RefreshCw, BellRing, DollarSign, Users } from 'lucide-react';

interface OrderSummary {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerUserId?: string;
  cpQuantity: number;
  salePrice: number;
  amountPaid: number;
  remainingBalance: number;
}

interface GroupSummary {
  groupId: string;
  groupTitle: string;
  telegramChatId: string;
  customerName: string;
  customerUserId?: string;
  ordersCount: number;
  totalGroupPending: number;
  orders: OrderSummary[];
}

interface PreviewData {
  success: boolean;
  unpaidOrdersCount: number;
  totalPendingReceivables: number;
  groupsCount: number;
  groupsSummary: GroupSummary[];
  error?: string;
}

interface BroadcastResult {
  success: boolean;
  groupsReminded: number;
  ordersReminded: number;
  totalAmount: number;
  failedGroups: string[];
}

export const PaymentRemindersBroadcastModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}> = ({ isOpen, onClose, onComplete }) => {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [resultData, setResultData] = useState<BroadcastResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetchPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await fetch('/api/broadcasts/payment-reminders/preview');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load unpaid orders preview');
      }
      setPreviewData(data);
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setResultData(null);
      setSendError(null);
      fetchPreview();
    }
  }, [isOpen]);

  const handleConfirmSend = async () => {
    if (isSending) return;
    setIsSending(true);
    setSendError(null);

    try {
      const res = await fetch('/api/broadcasts/payment-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Broadcast execution failed');
      }
      setResultData(data);
      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send payment reminders');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSending) {
          onClose();
        }
      }}
      title="📢 Send Payment Reminders to All Unpaid Customers"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {loadingPreview ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
            <p className="text-slate-400 font-mono text-xs">Auditing unpaid orders & recipient channels...</p>
          </div>
        ) : previewError ? (
          <div className="p-4 bg-rose-950/80 border border-rose-800 rounded-xl space-y-2 text-rose-300">
            <div className="flex items-center gap-2 font-bold">
              <XCircle className="w-4 h-4" />
              <span>Failed to load unpaid payment audit</span>
            </div>
            <p className="text-xs text-rose-200/90">{previewError}</p>
            <button
              onClick={fetchPreview}
              className="mt-2 px-3 py-1.5 bg-rose-900/60 hover:bg-rose-900 border border-rose-700/60 rounded text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        ) : resultData ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-950/80 border border-emerald-800 rounded-xl space-y-3 text-emerald-200">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-400">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Payment Reminders Broadcast Complete!</span>
              </div>
              <p className="text-xs leading-relaxed">
                Consolidated payment reminders were successfully sent to <strong>{resultData.groupsReminded}</strong> customer group(s) covering <strong>{resultData.ordersReminded}</strong> unpaid order(s).
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-center">
                <div className="p-2 bg-emerald-900/40 rounded border border-emerald-800/60">
                  <span className="text-[10px] text-emerald-300/80 block">GROUPS</span>
                  <span className="text-sm font-bold text-white">{resultData.groupsReminded}</span>
                </div>
                <div className="p-2 bg-emerald-900/40 rounded border border-emerald-800/60">
                  <span className="text-[10px] text-emerald-300/80 block">ORDERS</span>
                  <span className="text-sm font-bold text-white">{resultData.ordersReminded}</span>
                </div>
                <div className="p-2 bg-emerald-900/40 rounded border border-emerald-800/60">
                  <span className="text-[10px] text-emerald-300/80 block">TOTAL AMOUNT</span>
                  <span className="text-sm font-bold text-emerald-300">${resultData.totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {resultData.failedGroups && resultData.failedGroups.length > 0 && (
              <div className="p-3 bg-amber-950/80 border border-amber-800 rounded-lg text-amber-200 text-xs space-y-1">
                <span className="font-semibold block">⚠️ Delivery warnings on following groups:</span>
                <ul className="list-disc list-inside text-[11px] text-amber-300/90">
                  {resultData.failedGroups.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[10px] uppercase">
                  <BellRing className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Unpaid Orders</span>
                </div>
                <p className="text-lg font-bold text-cyan-400 font-mono">
                  {previewData?.unpaidOrdersCount ?? 0}
                </p>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[10px] uppercase">
                  <DollarSign className="w-3.5 h-3.5 text-rose-400" />
                  <span>Pending Receivables</span>
                </div>
                <p className="text-lg font-bold text-rose-400 font-mono">
                  ${parseFloat(String(previewData?.totalPendingReceivables || 0)).toFixed(2)} <span className="text-[10px] text-slate-400">USDT</span>
                </p>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[10px] uppercase">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>Target Groups</span>
                </div>
                <p className="text-lg font-bold text-slate-100 font-mono">
                  {previewData?.groupsCount ?? 0}
                </p>
              </div>
            </div>

            {/* Recipient Groups List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10px] uppercase">
                <span>Groups With Outstanding Balances ({previewData?.groupsSummary.length || 0})</span>
                <span>Breakdown per Group</span>
              </div>

              {previewData?.groupsSummary.length === 0 ? (
                <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-400">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-1.5" />
                  <p className="font-semibold text-slate-200">No Unpaid Orders Found</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">All customer orders are fully settled.</p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {previewData?.groupsSummary.map((grp) => (
                    <div
                      key={grp.groupId}
                      className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <span className="font-bold text-slate-100 block text-xs">{grp.groupTitle}</span>
                        <p className="text-[11px] text-slate-400">
                          Customer: <span className="text-slate-300 font-medium">{grp.customerName}</span>
                        </p>
                      </div>
                      <div className="text-right font-mono flex-shrink-0">
                        <span className="text-[10px] text-slate-400 block uppercase">PENDING</span>
                        <span className="text-sm font-bold text-rose-400">
                          ${grp.totalGroupPending.toFixed(2)} USDT
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {sendError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{sendError}</span>
              </div>
            )}

            {/* Action Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-500">
                Rate limited with 1.2s delay between channels.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSending}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSend}
                  disabled={isSending || (previewData?.groupsSummary.length === 0)}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  {isSending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Dispatching Reminders...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Confirm & Send Reminders</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
