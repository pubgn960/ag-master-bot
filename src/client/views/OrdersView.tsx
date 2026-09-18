import React, { useState, useEffect } from 'react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Search, Filter, Eye, DollarSign } from 'lucide-react';

export const OrdersView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  useEffect(() => {
    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOrders(data);
          setFilteredOrders(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let result = orders;
    if (statusFilter !== 'ALL') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          o.group_title.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q)
      );
    }
    setFilteredOrders(result);
  }, [statusFilter, searchQuery, orders]);

  return (
    <div className="space-y-6">
      {/* Top Header & Search/Filter Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Order Management</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Complete database ledger of all customer orders, price snapshots, and lifecycle states.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Search Input */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search ORD, group, customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="INCOMPLETE">INCOMPLETE</option>
            <option value="PENDING">PENDING</option>
            <option value="SENT_TO_LOADER">SENT_TO_LOADER</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="DONE">DONE</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="REVERSED">REVERSED</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <Card>
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No orders match your current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">ORDER NUMBER</th>
                  <th className="pb-3 font-medium">GROUP & CUSTOMER</th>
                  <th className="pb-3 font-medium">PACKAGE</th>
                  <th className="pb-3 font-medium">SALE PRICE</th>
                  <th className="pb-3 font-medium">LOADER COST</th>
                  <th className="pb-3 font-medium">STATUS</th>
                  <th className="pb-3 font-medium">PAYMENT</th>
                  <th className="pb-3 font-medium">CREATED AT</th>
                  <th className="pb-3 font-medium text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-cyan-400">{o.order_number}</td>
                    <td className="py-3">
                      <p className="text-slate-200">{o.group_title}</p>
                      <p className="text-[10px] text-slate-400 font-normal">{o.customer_name}</p>
                    </td>
                    <td className="py-3 text-slate-300">{o.bundle_name || `${o.cp_quantity} CP`}</td>
                    <td className="py-3 font-mono text-emerald-400 font-bold">
                      ${parseFloat(o.sale_price_snapshot).toFixed(2)}
                    </td>
                    <td className="py-3 font-mono text-slate-400">
                      ${parseFloat(o.loader_cost_snapshot).toFixed(2)}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={
                          o.status === 'DONE'
                            ? 'success'
                            : o.status === 'SENT_TO_LOADER'
                            ? 'info'
                            : o.status === 'PENDING'
                            ? 'warning'
                            : o.status === 'CANCELLED'
                            ? 'danger'
                            : 'default'
                        }
                        size="sm"
                      >
                        {o.status}
                      </Badge>
                    </td>
                    <td className="py-3">
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
                    </td>
                    <td className="py-3 font-mono text-[11px] text-slate-400">
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={async () => {
                          const card = await fetch(`/api/orders/${o.id}`).then((r) => r.json());
                          setSelectedOrder(card);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order Details: ${selectedOrder.order_number}`}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 p-4 bg-slate-950 rounded-xl border border-slate-800">
              <div>
                <p className="text-slate-400">Customer Group</p>
                <p className="text-slate-200 font-semibold mt-0.5">{selectedOrder.group_title}</p>
              </div>
              <div>
                <p className="text-slate-400">Customer Name</p>
                <p className="text-slate-200 font-semibold mt-0.5">{selectedOrder.customer_name}</p>
              </div>
              <div>
                <p className="text-slate-400">Snapshotted Sale Price</p>
                <p className="text-emerald-400 font-mono font-bold mt-0.5">
                  ${parseFloat(selectedOrder.sale_price_snapshot).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Snapshotted Loader Cost</p>
                <p className="text-slate-300 font-mono font-bold mt-0.5">
                  ${parseFloat(selectedOrder.loader_cost_snapshot).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Masked credentials list */}
            <div>
              <p className="font-bold text-slate-300 mb-2">Masked Fields (Encrypted):</p>
              <div className="space-y-1.5">
                {selectedOrder.masked_fields?.map((f: any) => (
                  <div
                    key={f.field_name}
                    className="flex items-center justify-between p-2 bg-slate-950 border border-slate-800 rounded-lg"
                  >
                    <span className="font-mono text-slate-400">{f.field_name}:</span>
                    <span className="font-mono text-slate-200">{f.field_value_masked}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
