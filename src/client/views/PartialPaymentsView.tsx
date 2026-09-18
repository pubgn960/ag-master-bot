import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Percent, Send, AlertCircle, CheckCircle2, Search, Clock, RefreshCw } from 'lucide-react';

export const PartialPaymentsView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderModal, setReminderModal] = useState<{
    isOpen: boolean;
    order: any | null;
  }>({ isOpen: false, order: null });
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderStatus, setReminderStatus] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [reminderCooldowns, setReminderCooldowns] = useState<Record<string, number>>({});
  const [, setNow] = useState(Date.now());

  // Tick timer every second for active cooldown counters
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchPartialOrders = () => {
    setLoading(true);
    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const partials = data.filter(
            (o) => o.manual_payment_override !== 'MANUALLY_MARKED_PAID' && (
              o.payment_amount_state === 'PARTIAL' || 
              (o.payment_amount_state === 'UNPAID' && o.status === 'SENT_TO_LOADER') ||
              (parseFloat(o.amount_remaining || '0') > 0 && o.payment_status !== 'PAID')
            )
          );
          setOrders(partials);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchPartialOrders();
  }, []);

  const getCooldownRemaining = (orderId: string): number => {
    const exp = reminderCooldowns[orderId];
    if (!exp) return 0;
    const diff = Math.ceil((exp - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  };

  const handleSendReminder = async (order: any) => {
    setSendingReminder(true);
    setReminderStatus(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        setReminderStatus({ text: data.error || 'Failed to dispatch reminder', type: 'error' });
        setSendingReminder(false);
        return;
      }

      setReminderStatus({
        text: `✅ Payment reminder dispatched to "${data.groupTitle || order.group_title}" on Telegram! Remaining: $${parseFloat(data.remainingBalance || order.amount_remaining || '0').toFixed(2)} USDT.`,
        type: 'success'
      });

      // 60-second cooldown
      setReminderCooldowns((prev) => ({
        ...prev,
        [order.id]: Date.now() + 60000
      }));

      setTimeout(() => {
        setReminderModal({ isOpen: false, order: null });
        setReminderStatus(null);
        fetchPartialOrders();
      }, 1800);
    } catch (err: any) {
      setReminderStatus({ text: err.message || 'Network error sending reminder', type: 'error' });
    } finally {
      setSendingReminder(false);
    }
  };

  const handleManualOverride = async (orderId: string, override: 'MANUALLY_MARKED_PAID' | 'MANUALLY_MARKED_UNPAID') => {
    try {
      const res = await fetch(`/api/orders/${orderId}/manual-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          override,
          reason: override === 'MANUALLY_MARKED_PAID' ? 'Staff manual paid override' : 'Staff manual unpaid override',
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to update payment status');
        return;
      }
      fetchPartialOrders();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Partial Payments Dashboard</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Track unpaid balances, customer payment shortfalls, and trigger formatted Telegram payment reminders.
          </p>
        </div>
        <button
          onClick={fetchPartialOrders}
          disabled={loading}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh List
        </button>
      </div>

      <Card>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500 font-mono">Loading partial payment orders...</div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500/80 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-200">No Outstanding Partial Payments</h3>
            <p className="text-xs text-slate-500 mt-1">All active customer orders are either fully paid or cleanly allocated.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">ORDER NUMBER</th>
                  <th className="pb-3 font-medium">CUSTOMER & GROUP</th>
                  <th className="pb-3 font-medium">TOTAL SALE</th>
                  <th className="pb-3 font-medium">AMOUNT PAID</th>
                  <th className="pb-3 font-medium">REMAINING BALANCE</th>
                  <th className="pb-3 font-medium">PAYMENT STATE</th>
                  <th className="pb-3 font-medium">ORDER STATUS</th>
                  <th className="pb-3 font-medium">LAST REMINDER</th>
                  <th className="pb-3 font-medium text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {orders.map((o) => {
                  const cooldownSec = getCooldownRemaining(o.id);
                  const isCoolingDown = cooldownSec > 0;

                  return (
                    <tr key={o.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 font-mono font-bold text-cyan-400">{o.order_number}</td>
                      <td className="py-3">
                        <p className="text-slate-200">{o.customer_name || 'Customer'}</p>
                        <p className="text-[10px] text-slate-400 font-normal">{o.group_title}</p>
                      </td>
                      <td className="py-3 font-mono text-slate-300 font-semibold">
                        ${parseFloat(o.sale_price_snapshot || '0').toFixed(2)}
                      </td>
                      <td className="py-3 font-mono text-amber-400 font-bold">
                        ${parseFloat(o.amount_paid || '0').toFixed(2)}
                      </td>
                      <td className="py-3 font-mono text-rose-400 font-bold">
                        ${parseFloat(o.amount_remaining || String(parseFloat(o.sale_price_snapshot || '0') - parseFloat(o.amount_paid || '0'))).toFixed(2)}
                      </td>
                      <td className="py-3">
                        {o.manual_payment_override === 'MANUALLY_MARKED_PAID' ? (
                          <Badge variant="success" size="sm">MANUAL PAID</Badge>
                        ) : o.payment_amount_state === 'PARTIAL' ? (
                          <Badge variant="warning" size="sm">PARTIAL</Badge>
                        ) : (
                          <Badge variant="danger" size="sm">UNPAID</Badge>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge variant={o.status === 'SENT_TO_LOADER' ? 'info' : 'warning'} size="sm">
                          {o.status}
                        </Badge>
                      </td>
                      <td className="py-3 font-mono text-[10px] text-slate-400">
                        {o.last_reminder_sent_at ? (
                          <span>{new Date(o.last_reminder_sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        ) : (
                          <span className="text-slate-600">Never</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {o.manual_payment_override === 'MANUALLY_MARKED_PAID' ? (
                            <button
                              onClick={() => handleManualOverride(o.id, 'MANUALLY_MARKED_UNPAID')}
                              className="px-2 py-1 bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-800/50 rounded text-xs font-semibold transition-colors"
                            >
                              Mark Unpaid
                            </button>
                          ) : (
                            <button
                              onClick={() => handleManualOverride(o.id, 'MANUALLY_MARKED_PAID')}
                              className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/50 rounded text-xs font-semibold transition-colors"
                            >
                              Mark Paid
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setReminderStatus(null);
                              setReminderModal({ isOpen: true, order: o });
                            }}
                            disabled={isCoolingDown}
                            className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                              isCoolingDown
                                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                : 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30'
                            }`}
                            title={isCoolingDown ? `Please wait ${cooldownSec}s before sending another reminder` : 'Send Telegram Payment Reminder'}
                          >
                            {isCoolingDown ? (
                              <>
                                <Clock className="w-3 h-3" />
                                {cooldownSec}s
                              </>
                            ) : (
                              <>
                                <Send className="w-3 h-3" />
                                Reminder
                              </>
                            )}
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

      {/* Send Reminder Modal */}
      {reminderModal.order && (
        <Modal
          isOpen={reminderModal.isOpen}
          onClose={() => {
            if (!sendingReminder) {
              setReminderModal({ isOpen: false, order: null });
              setReminderStatus(null);
            }
          }}
          title={`Send Telegram Payment Reminder: Order #${reminderModal.order.order_number}`}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-mono text-[10px] uppercase tracking-wider font-semibold">Telegram Message Preview</span>
                <Badge variant="info" size="sm">HTML Format</Badge>
              </div>
              <div className="p-3 bg-slate-900/90 rounded-lg text-slate-200 font-sans leading-relaxed border border-slate-800 font-normal space-y-2">
                <p className="font-bold text-cyan-400">🔔 Payment Balance Reminder</p>
                <p className="font-bold text-slate-100">{reminderModal.order.group_title || 'Customer Group'}</p>
                <p>Hello <span className="text-cyan-300 underline font-medium">{reminderModal.order.customer_name || 'Customer'}</span>,</p>
                <p className="text-slate-300">You currently have pending orders with an outstanding balance:</p>
                <div className="border-t border-b border-slate-800/80 py-1.5 my-1 text-slate-300 font-mono text-[11px]">
                  ━━━━━━━━━━━━━━━━━━━━━<br />
                  💰 <strong>Total Due:</strong> <code className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-rose-400 font-bold">{parseFloat(reminderModal.order.amount_remaining || String(parseFloat(reminderModal.order.sale_price_snapshot || '0') - parseFloat(reminderModal.order.amount_paid || '0'))).toFixed(2)} USDT</code><br />
                  ━━━━━━━━━━━━━━━━━━━━━
                </div>
                <p className="text-slate-400 text-[11px]">Please settle your balance and drop the receipt screenshot here. Thank you!</p>
              </div>
            </div>

            {reminderStatus ? (
              <div
                className={`p-3 rounded-lg font-medium text-xs flex items-center gap-2 ${
                  reminderStatus.type === 'success'
                    ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/80 border border-rose-800 text-rose-300'
                }`}
              >
                {reminderStatus.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{reminderStatus.text}</span>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setReminderModal({ isOpen: false, order: null });
                    setReminderStatus(null);
                  }}
                  disabled={sendingReminder}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSendReminder(reminderModal.order)}
                  disabled={sendingReminder}
                  className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  {sendingReminder ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Dispatch Reminder</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
