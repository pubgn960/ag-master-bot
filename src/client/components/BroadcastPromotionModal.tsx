import React, { useState } from 'react';
import { Modal } from './Modal';
import { Megaphone, Pin, Send, CheckSquare, Square, AlertCircle, Sparkles } from 'lucide-react';

export interface BroadcastPromotionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  promo: {
    id: number | string;
    code: string;
    name: string;
    sale_price: number | string;
    bundle_name?: string;
    cp_quantity?: number;
    image_ref?: string | null;
    auto_pause_on_cost_increase?: boolean;
  } | null;
  groups: Array<{
    id?: number | string;
    chat_id?: number | string;
    telegram_chat_id?: number | string;
    name?: string;
    title?: string;
    group_name?: string;
  }>;
}

export const BroadcastPromotionModal: React.FC<BroadcastPromotionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  promo,
  groups,
}) => {
  const [selectedGroupIds, setSelectedGroupIds] = useState<Array<number | string>>([]);
  const [shouldPin, setShouldPin] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!promo) return null;

  const handleSelectAll = () => {
    if (selectedGroupIds.length === groups.length) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(
        groups.map((g) => g.id || g.chat_id || g.telegram_chat_id || '')
      );
    }
  };

  const toggleGroup = (id: number | string) => {
    if (selectedGroupIds.includes(id)) {
      setSelectedGroupIds(selectedGroupIds.filter((gId) => gId !== id));
    } else {
      setSelectedGroupIds([...selectedGroupIds, id]);
    }
  };

  const handleSendBroadcast = async () => {
    if (selectedGroupIds.length === 0) {
      setError('Please select at least one customer group.');
      return;
    }

    setIsBroadcasting(true);
    setError(null);

    try {
      const cpText = promo.bundle_name
        ? promo.bundle_name
        : promo.cp_quantity
        ? `${promo.cp_quantity.toLocaleString()} CP`
        : '';
      const priceText = `$${parseFloat(String(promo.sale_price)).toFixed(2)} USDT`;

      const messageText = `🔥 *SPECIAL PROMOTION DEAL* 🔥\n\n🎯 *${promo.name}*${cpText ? `\n📦 Package: *${cpText}*` : ''}\n💰 Promo Price: *${priceText}*\n\n⚡ Instant Automated Processing\n💬 Send your order in group to claim!`;

      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageText,
          imageRef: promo.image_ref || undefined,
          targetGroupIds: selectedGroupIds,
          shouldPin,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to broadcast promotion');

      const successMsg = `📢 Promotion "${promo.name}" broadcasted successfully to ${
        data.sentCount || selectedGroupIds.length
      } customer groups!${shouldPin ? ' (Pinned)' : ''}`;

      if (onSuccess) {
        onSuccess(successMsg);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to broadcast promotion');
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isBroadcasting) onClose();
      }}
      title="Broadcast Promotion to Groups"
      maxWidth="max-w-md"
    >
      <div className="space-y-4 text-xs font-sans">
        {/* Promotion Summary Card */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-slate-200">Promotion Summary</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div>
              <span className="text-slate-500">Name:</span>{' '}
              <span className="text-slate-200 font-semibold">{promo.name}</span>
            </div>
            <div>
              <span className="text-slate-500">Package:</span>{' '}
              <span className="text-cyan-400">
                {promo.bundle_name ||
                  (promo.cp_quantity ? `${promo.cp_quantity.toLocaleString()} CP` : '—')}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Promo Price:</span>{' '}
              <span className="text-emerald-400 font-bold">
                ${parseFloat(String(promo.sale_price)).toFixed(2)} USDT
              </span>
            </div>
            <div>
              <span className="text-slate-500">Loss-Guard:</span>{' '}
              <span className={promo.auto_pause_on_cost_increase ? 'text-emerald-400' : 'text-slate-500'}>
                {promo.auto_pause_on_cost_increase ? 'Active' : 'Off'}
              </span>
            </div>
          </div>
        </div>

        {/* Target Customer Groups */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-slate-300 font-semibold">
              Target Customer Groups ({selectedGroupIds.length} selected):
            </label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline"
            >
              {selectedGroupIds.length === groups.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-500 text-center">
              No active customer groups found.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg">
              {groups.map((group) => {
                const groupId = group.id || group.chat_id || group.telegram_chat_id || '';
                const chatId = group.chat_id || group.telegram_chat_id;
                const groupName = group.name || group.title || group.group_name || 'Unnamed Customer Group';
                const checked = selectedGroupIds.includes(groupId);

                return (
                  <label
                    key={String(group.id || group.chat_id || group.telegram_chat_id)}
                    className="flex items-center justify-between p-2 rounded hover:bg-slate-800/60 cursor-pointer border border-transparent hover:border-slate-700 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-400 bg-slate-900 w-4 h-4"
                        checked={checked}
                        onChange={() => toggleGroup(groupId)}
                      />
                      <div className="min-w-0">
                        <p className="text-slate-200 font-medium truncate text-xs">{groupName}</p>
                        {chatId && (
                          <p className="text-[10px] text-slate-500 font-mono">Chat ID: {chatId}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 shrink-0 ml-2">Active</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Pin Message Toggle */}
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pin className={`w-4 h-4 ${shouldPin ? 'text-cyan-400' : 'text-slate-500'}`} />
            <div>
              <p className="text-slate-200 font-semibold text-xs">Pin Broadcast in Groups</p>
              <p className="text-[10px] text-slate-400">Pins promotional card at the top of customer chats</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShouldPin(!shouldPin)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              shouldPin ? 'bg-cyan-600' : 'bg-slate-800'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                shouldPin ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-lg flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isBroadcasting}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSendBroadcast}
            disabled={isBroadcasting || selectedGroupIds.length === 0}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {isBroadcasting ? (
              <>Broadcasting...</>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" /> Broadcast Now ({selectedGroupIds.length})
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
