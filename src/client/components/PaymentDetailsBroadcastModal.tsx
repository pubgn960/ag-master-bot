import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { Send, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ShieldAlert, Layers } from 'lucide-react';

interface ProfileBreakdown {
  profileId: string;
  profileName: string;
  isDefault: boolean;
  groupCount: number;
}

interface PreviewData {
  success: boolean;
  totalGroups: number;
  activeCount: number;
  inactiveCount: number;
  skippedMissingChatIdCount: number;
  profiles: ProfileBreakdown[];
  error?: string;
}

interface FailedGroup {
  groupId: string;
  groupTitle: string;
  telegramChatId?: string;
  error: string;
}

interface BroadcastResult {
  broadcastId: string;
  totalAttempted: number;
  sentCount: number;
  failedCount: number;
  skippedMissingChatIdCount: number;
  skippedInvalidChatIdCount: number;
  failedGroups: FailedGroup[];
  profilesUsed: Array<{ profileId: string; profileName: string; count: number }>;
}

export const PaymentDetailsBroadcastModal: React.FC<{
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
      const res = await fetch('/api/broadcasts/payment-details-preview');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load recipient customer groups');
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
      const res = await fetch('/api/broadcasts/payment-details-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Broadcast execution failed');
      }
      setResultData(data);
      if (onComplete) {
        onComplete();
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send payment details broadcast');
    } finally {
      setIsSending(false);
    }
  };

  const maskChatId = (chatId?: string) => {
    if (!chatId) return 'missing';
    if (chatId.length <= 8) return chatId;
    return `${chatId.slice(0, 4)}...${chatId.slice(-3)}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSending) onClose();
      }}
      title={resultData ? 'Payment Details Broadcast Summary' : 'Send Assigned Payment Details to All Customers'}
      maxWidth="max-w-lg"
    >
      {/* 1. Loading State */}
      {loadingPreview && (
        <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <span>Resolving recipient customer groups and assigned payment profiles...</span>
        </div>
      )}

      {/* 2. Error Loading Preview */}
      {!loadingPreview && previewError && (
        <div className="space-y-4 py-4">
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <span>{previewError}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
            <button
              onClick={fetchPreview}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* 3. Confirmation Preview (Before Send) */}
      {!loadingPreview && !previewError && !resultData && previewData && (
        <div className="space-y-5 text-xs">
          <div className="p-3.5 bg-slate-800/60 border border-slate-700/60 rounded-xl">
            <p className="text-sm font-semibold text-slate-100">
              Send assigned payment details to all customers?
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Each customer group receives its own assigned payment details (VIP profile override or Global Default). Both active and inactive groups are included.
            </p>
          </div>

          {/* Group counts breakdown */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2.5 font-mono">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800 text-slate-300">
              <span className="font-semibold text-slate-200 font-sans text-xs">Total customer groups with Telegram Chat ID:</span>
              <span className="text-emerald-400 font-bold text-sm">{previewData.totalGroups}</span>
            </div>

            <div className="flex justify-between items-center text-slate-400 text-[11px] pl-2">
              <span>Active:</span>
              <span className="text-slate-200 font-semibold">{previewData.activeCount}</span>
            </div>

            <div className="flex justify-between items-center text-slate-400 text-[11px] pl-2">
              <span>Inactive:</span>
              <span className="text-amber-300 font-semibold">{previewData.inactiveCount}</span>
            </div>
          </div>

          {/* Profiles Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>By resolved payment profile:</span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 divide-y divide-slate-800/60">
              {previewData.profiles.map((p) => (
                <div key={p.profileId} className="py-1.5 first:pt-0 last:pb-0 flex justify-between items-center font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200 font-sans text-xs">{p.profileName}</span>
                    {p.isDefault && (
                      <Badge variant="success" size="sm">
                        Default
                      </Badge>
                    )}
                  </div>
                  <span className="text-cyan-400 font-bold text-xs">{p.groupCount} {p.groupCount === 1 ? 'group' : 'groups'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Skipped before send */}
          <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl text-[11px] text-amber-300/90 flex justify-between items-center font-mono">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Skipped before send (Missing Telegram Chat ID):</span>
            </span>
            <span className="font-bold text-amber-400">{previewData.skippedMissingChatIdCount}</span>
          </div>

          {sendError && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start gap-2">
              <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <span>{sendError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSend}
              disabled={isSending || previewData.totalGroups === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-950/40 transition-all"
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending to Telegram...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Confirm Send</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 4. Result Summary (After Send) */}
      {!loadingPreview && resultData && (
        <div className="space-y-4 text-xs">
          <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-200">Payment details broadcast completed</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Broadcast ID: <span className="font-mono text-cyan-400">{resultData.broadcastId.slice(0, 8)}...</span>
              </p>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2.5 font-mono">
            <div className="flex justify-between items-center text-slate-300">
              <span className="font-sans font-semibold text-slate-200">Sent:</span>
              <span className="text-emerald-400 font-bold text-sm">{resultData.sentCount}</span>
            </div>

            <div className="flex justify-between items-center text-slate-300">
              <span className="font-sans font-semibold text-slate-200">Failed:</span>
              <span className={resultData.failedCount > 0 ? 'text-rose-400 font-bold text-sm' : 'text-slate-400 font-bold text-sm'}>
                {resultData.failedCount}
              </span>
            </div>

            <div className="flex justify-between items-center text-slate-400 text-[11px] pt-1 border-t border-slate-800/80">
              <span>Skipped missing chat ID:</span>
              <span className="text-slate-300">{resultData.skippedMissingChatIdCount}</span>
            </div>

            <div className="flex justify-between items-center text-slate-400 text-[11px]">
              <span>Skipped invalid chat ID:</span>
              <span className="text-slate-300">{resultData.skippedInvalidChatIdCount}</span>
            </div>
          </div>

          {/* Failed groups list if any */}
          {resultData.failedGroups && resultData.failedGroups.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>Failed groups list:</span>
              </div>
              <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-3 max-h-40 overflow-y-auto divide-y divide-rose-900/40 font-mono text-[11px]">
                {resultData.failedGroups.map((f, idx) => (
                  <div key={idx} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                    <div className="flex justify-between items-center">
                      <span className="font-sans font-semibold text-slate-200 text-xs">{f.groupTitle}</span>
                      <span className="text-slate-400 text-[10px]">({maskChatId(f.telegramChatId)})</span>
                    </div>
                    <p className="text-rose-400 text-[10px]">{f.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
