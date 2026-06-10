'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Truck, Plus, Pencil, Trash2, X } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Supplier {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    created_at: string;
}

const emptyForm = { name: '', phone: '', email: '', address: '' };

const columnHelper = createColumnHelper<Supplier>();

export default function SuppliersPage() {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Supplier | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getSuppliers();
            setSuppliers(data);
        } catch (err) {
            console.error('Failed to load suppliers', err);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setForm(emptyForm);
        setError('');
        setModalOpen(true);
    };

    const openEdit = (supplier: Supplier) => {
        setEditTarget(supplier);
        setForm({
            name: supplier.name,
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
        });
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            setError('Supplier name is required.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) {
                await api.updateSupplier(editTarget.id, {
                    name: form.name.trim(),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                });
            } else {
                await api.createSupplier({
                    name: form.name.trim(),
                    phone: form.phone.trim() || undefined,
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                });
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || 'Failed to save supplier.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteSupplier(id);
            void load();
        } catch (err) {
            console.error('Failed to delete supplier', err);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Supplier, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: 'Supplier',
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 220,
            }),
            columnHelper.accessor('phone', {
                header: 'Phone',
                cell: (info) => (
                    <span className="text-sm text-gray-600">{info.getValue() ?? '-'}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor('email', {
                header: 'Email',
                cell: (info) => (
                    <span className="text-sm text-gray-600">{info.getValue() ?? '-'}</span>
                ),
                size: 200,
            }),
            columnHelper.accessor('address', {
                header: 'Address',
                cell: (info) => (
                    <span className="text-sm text-gray-500 truncate max-w-xs block">{info.getValue() ?? '-'}</span>
                ),
                size: 240,
            }),
            columnHelper.accessor('created_at', {
                header: 'Added',
                cell: (info) => (
                    <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>
                ),
                size: 130,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => openEdit(info.row.original)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Edit"
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setDeleteId(info.row.original.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Suppliers</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Manage your supplier directory
                        </p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Supplier
                    </button>
                </div>

                <DataTable<Supplier>
                    tableId="suppliers"
                    columns={columns}
                    data={suppliers}
                    title="Suppliers"
                    isLoading={loading}
                    emptyMessage="No suppliers yet. Add your first supplier."
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by name, phone, or email..."
                />
            </div>

            {/* Create / Edit Modal */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-lg font-black tracking-tight">
                                {editTarget ? 'Edit Supplier' : 'New Supplier'}
                            </h2>
                            <button onClick={closeModal} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {error && (
                                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{error}</div>
                            )}
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">
                                    Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="Supplier name"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">Phone</label>
                                <input
                                    type="text"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    placeholder="01XXXXXXXXX"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">Email</label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    placeholder="supplier@example.com"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-widest text-gray-500 block mb-1.5">Address</label>
                                <textarea
                                    value={form.address}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    placeholder="Street address"
                                    rows={3}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none resize-none"
                                />
                            </div>
                        </div>
                        <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={closeModal}
                                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : editTarget ? 'Save Changes' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirm */}
            {deleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-4">
                        <h2 className="text-lg font-black tracking-tight">Delete Supplier?</h2>
                        <p className="text-sm text-gray-500">
                            This supplier will be removed from your directory. Existing purchases linked to them will not be affected.
                        </p>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => setDeleteId(null)}
                                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(deleteId)}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
