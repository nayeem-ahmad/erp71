'use client';

import { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, X, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface DeliveryOrder {
    id: string;
    saleId: string | null;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string;
    driverName: string | null;
    driverPhone: string | null;
    status: string;
    scheduledAt: string | null;
    deliveredAt: string | null;
    created_at: string;
}

const STATUS_OPTIONS = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'];

const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    IN_TRANSIT: 'bg-blue-100 text-blue-800',
    DELIVERED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-700',
};

const EMPTY_FORM = {
    saleId: '',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    driverName: '',
    driverPhone: '',
    notes: '',
    scheduledAt: '',
    status: 'PENDING',
};

export default function DeliveryPage() {
    const { t } = useI18n();
    const [orders, setOrders] = useState<DeliveryOrder[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (statusFilter) params.set('status', statusFilter);
            const data = await fetchWithAuth(`/delivery?${params}`);
            setOrders(data.items ?? []);
            setTotal(data.total ?? 0);
            setPages(data.pages ?? 1);
        } catch {
            setError('Failed to load deliveries');
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter]);

    useEffect(() => { load(); }, [load]);

    function openCreate() {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setSaveError('');
        setShowModal(true);
    }

    function openEdit(order: DeliveryOrder) {
        setEditingId(order.id);
        setForm({
            saleId: order.saleId ?? '',
            customerName: order.customerName,
            customerPhone: order.customerPhone ?? '',
            deliveryAddress: order.deliveryAddress,
            driverName: order.driverName ?? '',
            driverPhone: order.driverPhone ?? '',
            notes: '',
            scheduledAt: order.scheduledAt ? order.scheduledAt.slice(0, 16) : '',
            status: order.status,
        });
        setSaveError('');
        setShowModal(true);
    }

    async function handleSave() {
        if (!form.customerName.trim() || !form.deliveryAddress.trim()) {
            setSaveError('Customer name and delivery address are required.');
            return;
        }
        setSaving(true);
        setSaveError('');
        try {
            const body: any = {
                customerName: form.customerName,
                customerPhone: form.customerPhone || undefined,
                deliveryAddress: form.deliveryAddress,
                driverName: form.driverName || undefined,
                driverPhone: form.driverPhone || undefined,
                notes: form.notes || undefined,
                scheduledAt: form.scheduledAt || undefined,
            };
            if (!editingId && form.saleId) body.saleId = form.saleId;
            if (editingId) body.status = form.status;

            const url = editingId ? `/delivery/${editingId}` : '/delivery';
            const method = editingId ? 'PATCH' : 'POST';
            await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setShowModal(false);
            load();
        } catch (e: any) {
            setSaveError(e.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    async function handleCancel(id: string) {
        if (!confirm('Cancel this delivery?')) return;
        try {
            await fetchWithAuth(`/delivery/${id}`, { method: 'DELETE' });
            load();
        } catch {
            alert('Failed to cancel delivery');
        }
    }

    const filterTabs = [
        { label: 'All', value: '' },
        { label: 'Pending', value: 'PENDING' },
        { label: 'In Transit', value: 'IN_TRANSIT' },
        { label: 'Delivered', value: 'DELIVERED' },
        { label: 'Failed / Cancelled', value: 'FAILED' },
    ];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px] space-y-4">
            <PageHeader
                title={
                    <span className="inline-flex items-center gap-2">
                        <Truck className="h-6 w-6 text-gray-600" />
                        {t.delivery.title}
                        <span className="text-sm text-gray-500 font-normal">({total} total)</span>
                    </span>
                }
                subtitle={t.delivery.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.sales,
                    t.delivery.title,
                    'sales',
                )}
                actions={
                    <>
                        <button onClick={load} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                            <RefreshCw className="h-4 w-4" />
                        </button>
                        <button
                            onClick={openCreate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            {t.delivery.newDelivery}
                        </button>
                    </>
                }
            />

            {/* Status filter tabs */}
            <div className="flex gap-1 border-b border-gray-200">
                {filterTabs.map(tab => (
                    <button
                        key={tab.value}
                        onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            statusFilter === tab.value
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            {loading ? (
                <div className="text-center py-12 text-gray-500">Loading...</div>
            ) : orders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Truck className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>No delivery orders yet</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Customer</th>
                                <th className="px-4 py-3 text-left">Address</th>
                                <th className="px-4 py-3 text-left">Driver</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Scheduled</th>
                                <th className="px-4 py-3 text-left">Created</th>
                                <th className="px-4 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orders.map(order => (
                                <tr key={order.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900">{order.customerName}</div>
                                        {order.customerPhone && <div className="text-gray-500">{order.customerPhone}</div>}
                                    </td>
                                    <td className="px-4 py-3 max-w-xs">
                                        <span className="truncate block" title={order.deliveryAddress}>
                                            {order.deliveryAddress.length > 40
                                                ? order.deliveryAddress.slice(0, 40) + '…'
                                                : order.deliveryAddress}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {order.driverName ? (
                                            <>
                                                <div>{order.driverName}</div>
                                                {order.driverPhone && <div className="text-gray-500">{order.driverPhone}</div>}
                                            </>
                                        ) : (
                                            <span className="text-gray-400 italic">Unassigned</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                            {order.status.replace('_', ' ')}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        {order.scheduledAt ? formatDate(order.scheduledAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        {formatDate(order.created_at)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => openEdit(order)}
                                                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                            >
                                                Edit
                                            </button>
                                            {order.status !== 'CANCELLED' && order.status !== 'DELIVERED' && (
                                                <button
                                                    onClick={() => handleCancel(order.id)}
                                                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                                                >
                                                    Cancel
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

            {/* Pagination */}
            {pages > 1 && (
                <div className="flex justify-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-600">Page {page} of {pages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(pages, p + 1))}
                        disabled={page === pages}
                        className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b">
                            <h2 className="text-lg font-semibold">
                                {editingId ? 'Edit Delivery' : 'New Delivery Order'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {saveError && (
                                <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{saveError}</div>
                            )}

                            {!editingId && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Sale ID (optional)</label>
                                    <input
                                        type="text"
                                        value={form.saleId}
                                        onChange={e => setForm(f => ({ ...f, saleId: e.target.value }))}
                                        placeholder={t.delivery.placeholders.saleId}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
                                <input
                                    type="text"
                                    value={form.customerName}
                                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Phone</label>
                                <input
                                    type="text"
                                    value={form.customerPhone}
                                    onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address *</label>
                                <textarea
                                    rows={2}
                                    value={form.deliveryAddress}
                                    onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                                    <input
                                        type="text"
                                        value={form.driverName}
                                        onChange={e => setForm(f => ({ ...f, driverName: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
                                    <input
                                        type="text"
                                        value={form.driverPhone}
                                        onChange={e => setForm(f => ({ ...f, driverPhone: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Date/Time</label>
                                <input
                                    type="datetime-local"
                                    value={form.scheduledAt}
                                    onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>

                            {editingId && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                                    <select
                                        value={form.status}
                                        onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        {STATUS_OPTIONS.map(s => (
                                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <textarea
                                    rows={2}
                                    value={form.notes}
                                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-6 border-t bg-gray-50 rounded-b-xl gap-3">
                            {editingId && (
                                <button
                                    onClick={() => { setShowModal(false); handleCancel(editingId); }}
                                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                                >
                                    Cancel Delivery
                                </button>
                            )}
                            <div className="flex gap-3 ml-auto">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-100"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
