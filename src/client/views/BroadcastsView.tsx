import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Megaphone, Pin, Send, BellRing } from 'lucide-react';
import { PaymentDetailsBroadcastModal } from '../components/PaymentDetailsBroadcastModal';
import { PaymentRemindersBroadcastModal } from '../components/PaymentRemindersBroadcastModal';

export const BroadcastsView: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [imageRef, setImageRef] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [shouldPin, setShouldPin] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null);
  const [payBroadcastModalOpen, setPayBroadcastModalOpen] = useState(false);
  const [payRemindersModalOpen, setPayRemindersModalOpen] = useState(false);

  const fetchHistory = () => {
    fetch('/api/broadcasts')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setHistory(data);
      })
      .catch(() => {});

    fetch('/api/groups')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setGroups(data);
          setSelectedGroups([]);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handlePreview = () => {
    if (selectedGroups.length === 0) {
      setFeedback({ text: 'Please select at least one customer group.', type: 'warning' });
      return;
    }
    if (!messageText.trim()) {
      setFeedback({ text: 'Please enter a message.', type: 'warning' });
      return;
    }
    setConfirmModalOpen(true);
  };

  const handleSendBroadcast = async () => {
    setConfirmModalOpen(false);
    if (selectedGroups.length === 0) return;
    setSending(true);
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageText,
          imageRef: imageRef.trim() || undefined,
          targetGroupIds: selectedGroups,
          shouldPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = typeof data?.error === 'string' ? data.error : (data?.error?.message || 'Broadcast failed');
        throw new Error(errorMsg);
      }

      if (data.status === 'SENT') {
        if (data.pinFailedCount > 0) {
          setFeedback({
            text: `Broadcast sent to ${data.sentCount} group${data.sentCount > 1 ? 's' : ''}, but pin failed.`,
            type: 'warning',
          });
        } else {
          setFeedback({
            text: `Broadcast sent to ${data.sentCount} group${data.sentCount > 1 ? 's' : ''}.`,
            type: 'success',
          });
        }
      } else if (data.status === 'PARTIAL_FAILED') {
        setFeedback({
          text: `Broadcast partially failed (${data.sentCount} of ${data.targetCount} sent). See delivery log.`,
          type: 'warning',
        });
      } else if (data.status === 'FAILED') {
        setFeedback({
          text: 'Broadcast failed. See delivery log.',
          type: 'error',
        });
      } else if (data.status === 'QUEUED') {
        setFeedback({
          text: `Broadcast queued for ${data.targetCount} group${data.targetCount > 1 ? 's' : ''}.`,
          type: 'info',
        });
      } else {
        setFeedback({
          text: `Broadcast status: ${data.status}.`,
          type: 'info',
        });
      }

      setMessageText('');
      setImageRef('');
      fetchHistory();
    } catch (err: any) {
      setFeedback({
        text: `Broadcast failed: ${err.message}`,
        type: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Broadcast Announcements & Group Pinning</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Compose announcements, target specific customer groups, preview Telegram styling, and track pin deliveries.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 border rounded-xl text-xs flex justify-between items-center ${
            feedback.type === 'error'
              ? 'bg-rose-950/80 border-rose-800 text-rose-300'
              : feedback.type === 'warning'
              ? 'bg-amber-950/80 border-amber-800 text-amber-300'
              : feedback.type === 'info'
              ? 'bg-blue-950/80 border-blue-800 text-blue-300'
              : 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="font-bold ml-4 hover:opacity-80">
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Composer */}
        <Card
          title="Broadcast Composer"
          subtitle="Send announcements across customer channels"
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setPayRemindersModalOpen(true)}
                disabled={sending}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                title="Send payment reminders to all groups with unpaid balances"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>📢 Send Pending Payment Reminders to All Unpaid</span>
              </button>
              <button
                type="button"
                onClick={() => setPayBroadcastModalOpen(true)}
                disabled={sending}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                title="Send assigned payment details to all configured customer groups"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Assigned Payment Details to All Customers</span>
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-300 font-semibold">Message Content:</label>
              </div>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={8}
                placeholder="Compose announcement message for customer groups..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono text-xs leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Optional Image Attachment URL:</label>
              <input
                type="text"
                placeholder="https://..."
                value={imageRef}
                onChange={(e) => setImageRef(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Target Groups */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-slate-300 font-semibold">
                  Target Customer Groups ({selectedGroups.length} selected):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGroups(groups.map((g) => g.id))}
                    className="text-[10px] text-cyan-400 hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedGroups([])}
                    className="text-[10px] text-slate-400 hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 bg-slate-950 rounded-lg border border-slate-800">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center justify-between text-slate-300 cursor-pointer hover:bg-slate-900/60 p-1 rounded">
                    <div className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(g.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroups([...selectedGroups, g.id]);
                          } else {
                            setSelectedGroups(selectedGroups.filter((id) => id !== g.id));
                          }
                        }}
                        className="rounded bg-slate-900 border-slate-700 text-cyan-500"
                      />
                      <span className="truncate">{g.title}</span>
                    </div>
                    {g.price_profile_name && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 shrink-0 ml-2">
                        {g.price_profile_name}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pinCheck"
                checked={shouldPin}
                onChange={(e) => setShouldPin(e.target.checked)}
                className="rounded bg-slate-950 border-slate-800 text-cyan-500"
              />
              <label htmlFor="pinCheck" className="text-slate-300 flex items-center gap-1.5 font-medium">
                <Pin className="w-3.5 h-3.5 text-cyan-400" />
                Pin broadcast message in all selected Telegram channels
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={handlePreview}
                disabled={sending}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Preview Broadcast Draft
              </button>
            </div>
          </div>
        </Card>

        {/* Telegram Bubble Preview */}
        <Card
          title="Telegram Bubble Preview"
          subtitle="Real-time rendering of outbound message"
        >
          <div className="p-4 bg-[#0e1621] rounded-xl border border-slate-800/80 font-sans text-slate-100 min-h-[160px] flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-[11px] text-cyan-400 font-semibold">
                <Megaphone className="w-3.5 h-3.5" />
                <span>iTech Avengers Official Announcement</span>
                {shouldPin && (
                  <span className="ml-auto text-[10px] text-amber-400 flex items-center gap-1">
                    <Pin className="w-3 h-3" /> Pinned
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
                {messageText || 'Enter message above to preview Telegram rendering...'}
              </p>
            </div>
            <div className="text-right text-[10px] text-slate-500 font-mono mt-4">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
            </div>
          </div>
        </Card>
      </div>

      {/* Broadcast History Table */}
      <Card title="Broadcast History & Delivery Log">
        {history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No broadcasts recorded yet.</div>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-2.5">BROADCAST ID</th>
                  <th className="pb-2.5">TYPE / SOURCE</th>
                  <th className="pb-2.5">MESSAGE / PROFILES</th>
                  <th className="pb-2.5">DELIVERY</th>
                  <th className="pb-2.5">PIN STATUS</th>
                  <th className="pb-2.5">STATUS</th>
                  <th className="pb-2.5">DETAILS / ERROR</th>
                  <th className="pb-2.5">CREATED AT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {history.map((h) => {
                  const badgeVariant =
                    h.status === 'SENT'
                      ? 'success'
                      : h.status === 'PARTIAL_FAILED'
                      ? 'warning'
                      : h.status === 'FAILED'
                      ? 'danger'
                      : h.status === 'SENDING'
                      ? 'info'
                      : 'default';

                  return (
                    <tr key={h.id} className="hover:bg-slate-800/30">
                      <td className="py-3 font-mono text-cyan-400 font-bold">{h.id.slice(0, 8)}...</td>
                      <td className="py-3">
                        {h.broadcast_type === 'PRICE_BROADCAST' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-cyan-300 font-semibold flex items-center gap-1">
                              💎 PRICE
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 uppercase">{h.trigger_source || 'DASHBOARD'}</span>
                          </div>
                        ) : h.broadcast_type === 'PAYMENT_DETAILS_BROADCAST' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-emerald-300 font-semibold flex items-center gap-1">
                              💳 PAYMENT
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 uppercase">{h.trigger_source || 'DASHBOARD'}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-slate-300 font-medium">GENERAL</span>
                            <span className="text-[9px] font-mono text-slate-400 uppercase">{h.trigger_source || 'DASHBOARD'}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 max-w-xs">
                        {h.price_profiles_used ? (
                          <div className="text-[11px] text-cyan-300 font-mono" title={h.price_profiles_used}>
                            Profiles: {h.price_profiles_used}
                          </div>
                        ) : (
                          <div className="text-slate-200 text-xs truncate">{h.message_text}</div>
                        )}
                      </td>
                      <td className="py-3 font-mono text-slate-300">
                        <span>{h.sent_count ?? 0}/{h.total_targets ?? 1} sent</span>
                        {h.failed_count && Number(h.failed_count) > 0 ? (
                          <span className="text-rose-400 ml-1">({h.failed_count} failed)</span>
                        ) : null}
                      </td>
                      <td className="py-3 font-mono text-[11px]">
                        {h.pinned_count && Number(h.pinned_count) > 0 ? (
                          <span className="text-emerald-400 font-semibold">{h.pinned_count} PINNED</span>
                        ) : h.pin_failed_count && Number(h.pin_failed_count) > 0 ? (
                          <span className="text-amber-400 font-semibold">{h.pin_failed_count} PIN FAILED</span>
                        ) : (
                          <span className="text-slate-500">SKIPPED</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge variant={badgeVariant} size="sm">
                          {h.status || 'PENDING'}
                        </Badge>
                      </td>
                      <td className="py-3 text-[11px] max-w-xs truncate">
                        {h.error_summary ? (
                          <span className="text-rose-400" title={h.error_summary}>{h.error_summary}</span>
                        ) : h.pin_error_summary ? (
                          <span className="text-amber-400" title={h.pin_error_summary}>{h.pin_error_summary}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 font-mono text-[11px] text-slate-400">
                        {new Date(h.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title="Confirm Broadcast"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <div className="space-y-3">
            <p className="text-slate-300">
              You are about to send a broadcast to <strong className="text-white">{selectedGroups.length}</strong> recipient groups.
            </p>
            <div className="p-3 bg-slate-900 rounded border border-slate-700 text-slate-200 whitespace-pre-wrap font-mono">
              {messageText}
            </div>
            {shouldPin && (
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium">
                <Pin className="w-3.5 h-3.5" />
                <span>Messages will be pinned in target customer groups</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirmModalOpen(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSendBroadcast}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-semibold"
            >
              Confirm & Send
            </button>
          </div>
        </div>
      </Modal>

      <PaymentDetailsBroadcastModal
        isOpen={payBroadcastModalOpen}
        onClose={() => setPayBroadcastModalOpen(false)}
        onComplete={fetchHistory}
      />

      <PaymentRemindersBroadcastModal
        isOpen={payRemindersModalOpen}
        onClose={() => setPayRemindersModalOpen(false)}
        onComplete={fetchHistory}
      />
    </div>
  );

};
