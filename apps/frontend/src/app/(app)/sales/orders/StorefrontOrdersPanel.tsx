'use client';

import { useEffect, useState } from 'react';
import { ShoppingBag, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

interface StorefrontOrder {
    id: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    totalAmount: string | number;
    status: string;
    notes: string | null;
    created_at: string;
    items: {
        id: string;
        quantity: number;
        priceAtOrder: string | number;
        product: { id: string; name: string };
    }[];
}

interface PaginatedOrders {
    items: StorefrontOrder[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
    CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

export default function StorefrontOrdersPanel() {
    const { t } = useI18n();
    const m = t.storefront.dashboard.orders;
    const [data, setData] = useState<PaginatedOrders | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        loadOrders(page);
    }, [page]);

    const loadOrders = async (p: number) => {
        setLoading(true);
        try {
            const result = await fetchWithAuth(`/storefront/orders?page=${p}&limit=20`);
            setData(result);
        } catch (err) {
            console.error('Failed to load storefront orders', err);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (orderId: string, newStatus: string) => {
        setUpdatingId(orderId);
        try {
            await fetchWithAuth(`/storefront/orders/${orderId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            await loadOrders(page);
        } catch (err: any) {
            alert(err.message || m.updateFailed);
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full" />
                    </div>
                ) : !data?.items?.length ? (
                    <div className="text-center py-16 text-gray-400">
                        <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">{m.emptyTitle}</p>
                        <p className="text-sm mt-1">{m.emptyDescription}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50 text-left">
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.orderId}</th>
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.customer}</th>
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.items}</th>
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.total}</th>
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.date}</th>
                                    <th className="px-5 py-3 font-semibold text-gray-600">{m.columns.status}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {data.items.map((order) => (
                                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-5 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                                            {order.id.slice(0, 12)}...
                                        </td>
                                        <td className="px-5 py-3">
                                            <p className="font-semibold text-gray-900">{order.customerName}</p>
                                            <p className="text-xs text-gray-500">{order.customerEmail}</p>
                                            {order.customerPhone ? (
                                                <p className="text-xs text-gray-400">{order.customerPhone}</p>
                                            ) : null}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="space-y-0.5">
                                                {order.items.map((item) => (
                                                    <div key={item.id} className="text-xs text-gray-600">
                                                        {item.product.name} × {item.quantity}
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 font-bold text-gray-900 whitespace-nowrap">
                                            {formatBDT(Number(order.totalAmount))}
                                        </td>
                                        <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                                            {formatDate(order.created_at)}
                                        </td>
                                        <td className="px-5 py-3">
                                            <select
                                                value={order.status}
                                                disabled={updatingId === order.id}
                                                onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                                className={`text-xs font-semibold px-2 py-1 rounded-lg border cursor-pointer focus:outline-none ${
                                                    STATUS_COLORS[order.status] || 'bg-gray-50 text-gray-700 border-gray-200'
                                                }`}
                                            >
                                                <option value="PENDING">{m.status.pending}</option>
                                                <option value="CONFIRMED">{m.status.confirmed}</option>
                                                <option value="CANCELLED">{m.status.cancelled}</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {data && data.pages > 1 ? (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                        {formatMessage(m.pagination, {
                            start: (page - 1) * 20 + 1,
                            end: Math.min(page * 20, data.total),
                            total: data.total,
                        })}
                    </p>
                    <div className="flex items-center space-x-2">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-semibold text-gray-700 px-2">
                            {page} / {data.pages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                            disabled={page === data.pages}
                            className="p-2 rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}