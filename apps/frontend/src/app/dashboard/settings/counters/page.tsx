'use client';

import { useState, useEffect } from 'react';
import { Monitor, Plus, Pencil, Trash2, X, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

type Counter = {
    id: string;
    name: string;
    counter_number: number;
    status: string;
    store_id: string;
};

type ToastState = { type: 'success' | 'error'; message: string } | null;

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;

    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold transition-all ${
            toast.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
        }`}>
            {toast.type === 'success'
                ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
            {toast.message}
        </div>
    );
}

export default function CountersPage() {
    const [counters, setCounters] = useState<Counter[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<ToastState>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [editCounter, setEditCounter] = useState<Counter | null>(null);
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState('');
    const [counterNumber, setCounterNumber] = useState<number | ''>('');
    const [status, setStatus] = useState('ACTIVE');

    const storeId = typeof window !== 'undefined' ? (localStorage.getItem('store_id') || '') : '';

    useEffect(() => {
        if (storeId) loadCounters();
    }, [storeId]);

    const loadCounters = async () => {
        setLoading(true);
        try {
            const data = await api.getCounters(storeId);
            setCounters(Array.isArray(data) ? data : (data?.data ?? []));
        } catch {
            setToast({ type: 'error', message: 'Failed to load counters' });
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setName('');
        setCounterNumber('');
        setStatus('ACTIVE');
        setShowAdd(true);
        setEditCounter(null);
    };

    const openEdit = (c: Counter) => {
        setName(c.name);
        setCounterNumber(c.counter_number);
        setStatus(c.status);
        setEditCounter(c);
        setShowAdd(true);
    };

    const handleSave = async () => {
        if (!name.trim() || counterNumber === '') {
            setToast({ type: 'error', message: 'Name and counter number are required' });
            return;
        }
        setSaving(true);
        try {
            if (editCounter) {
                await api.updateCounter(editCounter.id, { name: name.trim(), status });
                setToast({ type: 'success', message: 'Counter updated' });
            } else {
                await api.createCounter({ storeId, name: name.trim(), counterNumber: Number(counterNumber) });
                setToast({ type: 'success', message: 'Counter created' });
            }
            setShowAdd(false);
            await loadCounters();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to save counter' });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this counter? This cannot be undone.')) return;
        try {
            await api.deleteCounter(id);
            setToast({ type: 'success', message: 'Counter deleted' });
            await loadCounters();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to delete counter' });
        }
    };

    const handleToggleStatus = async (c: Counter) => {
        try {
            const newStatus = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
            await api.updateCounter(c.id, { status: newStatus });
            setToast({ type: 'success', message: `Counter ${newStatus === 'ACTIVE' ? 'activated' : 'deactivated'}` });
            await loadCounters();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to update counter' });
        }
    };

    if (!storeId) {
        return (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                No store selected. Please select a store first.
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">POS Counters</h1>
                        <p className="mt-1 text-sm text-gray-500">Manage the sales counters for this store. Each cashier session is tied to a counter.</p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Add Counter
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : counters.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
                        <Monitor className="w-12 h-12 mx-auto text-gray-200 mb-3" />
                        <p className="text-sm font-bold text-gray-400">No counters yet</p>
                        <p className="text-xs text-gray-300 mt-1">Add counters to allow multiple cashier stations</p>
                        <button
                            onClick={openAdd}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-colors"
                        >
                            <Plus className="w-3 h-3" /> Add First Counter
                        </button>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 bg-gray-50">
                                    <th className="text-left px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">#</th>
                                    <th className="text-left px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Name</th>
                                    <th className="text-left px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-400">Status</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {counters.map((c) => (
                                    <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-3.5 font-black text-gray-900">{c.counter_number}</td>
                                        <td className="px-5 py-3.5 font-semibold text-gray-800">{c.name}</td>
                                        <td className="px-5 py-3.5">
                                            <button
                                                onClick={() => handleToggleStatus(c)}
                                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                                                    c.status === 'ACTIVE'
                                                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                }`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-400'}`} />
                                                {c.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                                            </button>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => openEdit(c)}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(c.id)}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add / Edit Modal */}
            {showAdd && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[420px] rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <h2 className="text-lg font-black tracking-tight">
                                {editCounter ? 'Edit Counter' : 'Add Counter'}
                            </h2>
                            <button onClick={() => setShowAdd(false)} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-900 transition-all">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Counter Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Counter 1, Express Lane"
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm text-sm"
                                />
                            </div>
                            {!editCounter && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Counter Number</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={counterNumber}
                                        onChange={(e) => setCounterNumber(e.target.value === '' ? '' : parseInt(e.target.value))}
                                        placeholder="1"
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm text-sm"
                                    />
                                </div>
                            )}
                            {editCounter && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">Status</label>
                                    <select
                                        value={status}
                                        onChange={(e) => setStatus(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm text-sm"
                                    >
                                        <option value="ACTIVE">Active</option>
                                        <option value="INACTIVE">Inactive</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? 'Saving…' : editCounter ? 'Save Changes' : 'Create Counter'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
