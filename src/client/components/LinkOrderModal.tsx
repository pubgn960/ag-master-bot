import React, { useState, useMemo } from 'react';
import { Modal } from './Modal';

export interface LinkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentId: string;
  initialOrderId?: string;
  availableOrders: any[];
  onLinkOrder: (paymentId: string, orderId: string) => Promise<void>;
}

export const LinkOrderModal: React.FC<LinkOrderModalProps> = ({
  isOpen,
  onClose,
  paymentId,
  initialOrderId = '',
  availableOrders,
  onLinkOrder,
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve numerical or prefix input (e.g. '1', '#1', 'ORD-1') to matching order
  const filteredOrders = useMemo(() => {
    if (!searchInput.trim()) return availableOrders;
    const cleanSearch = searchInput.trim().toLowerCase().replace(/^#+/, '');
    return availableOrders.filter((o) => {
      const orderNum = String(o.order_number || '').toLowerCase().replace(/^#+/, '');
      const id = String(o.id || '').toLowerCase();
      const ign = String(o.player_ign || '').toLowerCase();
      return (
        orderNum.includes(cleanSearch) ||
        id.includes(cleanSearch) ||
        ign.includes(cleanSearch) ||
        `ord-${cleanSearch}`.includes(orderNum)
      );
    });
  }, [availableOrders, searchInput]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    const clean = val.trim().toLowerCase().replace(/^#+/, '');
    const exactMatch = availableOrders.find((o) => {
      const orderNum = String(o.order_number || '').toLowerCase().replace(/^#+/, '');
      const id = String(o.id || '').toLowerCase();
      return orderNum === clean || id === clean || orderNum === `ord-${clean}`;
    });
    if (exactMatch) {
      setSelectedOrderId(exactMatch.id);
    }
  };

  const handleSubmit = async () => {
    let finalId = selectedOrderId;
    if (!finalId && searchInput.trim()) {
      const clean = searchInput.trim().toLowerCase().replace(/^#+/, '');
      const match = availableOrders.find((o) => {
        const orderNum = String(o.order_number || '').toLowerCase().replace(/^#+/, '');
        const id = String(o.id || '').toLowerCase();
        return orderNum === clean || id === clean;
      });
      if (match) finalId = match.id;
      else finalId = searchInput.trim();
    }

    if (!finalId) {
      setError('Please select or enter a valid Order #');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onLinkOrder(paymentId, finalId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to link order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Link / Change Linked Order" maxWidth="max-w-md">
      <div className="space-y-4 text-xs">
        <p className="text-slate-300">
          Select an open or pending order for this customer group to associate with this payment record:
        </p>

        {error && (
          <div className="p-2 bg-rose-950/60 border border-rose-800 text-rose-300 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-slate-300 font-semibold mb-1">Target Order:</label>
          <select
            value={selectedOrderId}
            onChange={(e) => {
              setSelectedOrderId(e.target.value);
              setSearchInput('');
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
          >
            <option value="">-- Select an Order --</option>
            {filteredOrders.map((o) => {
              const price = Number(o.total_amount || o.sale_price_snapshot || o.sale_price || 0).toFixed(2);
              const orderNum = o.order_number || `ORD-${String(o.id).slice(0, 8)}`;
              return (
                <option key={o.id} value={o.id}>
                  {orderNum} - {o.player_ign || 'Player'} (${price}) - [{o.status}]
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Enter Order # (e.g. 1 or ORD-1):</label>
          <input
            type="text"
            placeholder="Enter Order # (e.g. 1 or ORD-1)"
            value={searchInput}
            onChange={handleSearchChange}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-medium hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Linking...' : 'Link Order'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
