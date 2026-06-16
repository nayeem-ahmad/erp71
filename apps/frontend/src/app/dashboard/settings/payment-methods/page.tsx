'use client';

import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Loader2, Plus, Edit2, Trash2, CheckCircle, XCircle, ArrowLeft, X } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';

type ToastState = { type: 'success' | 'error'; message: string } | null;

interface Account {
    id: string;
    name: string;
    code?: string;
}

interface PaymentMethod {
    id: string;
    name: string;
    type: string;
    account_id?: string;
    account?: Account;
    is_active: boolean;
}

const PAYMENT_TYPES = [
    { value: 'CASH', label: 'Cash' },
    { value: 'MOBILE_WALLET', label: 'Mobile Wallet (bKash / Nagad)' },
    { value: 'CARD', label: 'Card' },
    { value: 'BANK', label: 'Bank Transfer' },
];

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;
    const isSuccess = toast.type === 'success';
    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${
                isSuccess
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
            }`}
        >
            {isSuccess ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {toast.message}
        </div>
    );
}

interface MethodFormProps {
    initial?: Partial<PaymentMethod>;
    accounts: Account[];
    onSave: (data: any) => Promise<void>;
    onCancel: () => void;
}

function MethodForm({ initial, accounts, onSave, onCancel }: MethodFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [type, setType] = useState(initial?.type ?? 'CASH');
    const [accountId, setAccountId] = useState(initial?.account_id ?? '');
    const [isActive, setIsActive] = useState(initial?.is_active ?? true);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            await onSave({
                name: name.trim(),
                type,
                account_id: accountId || undefined,
                is_active: isActive,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. bKash, Main Cash"
                        required
                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Type</label>
                    <select
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    >
                        {PAYMENT_TYPES.map((pt) => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Account <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    >
                        <option value="">— No account linked —</option>
                        {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                                {acc.code ? `[${acc.code}] ` : ''}{acc.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-3 pt-6">
                    <button
                        type="button"
                        onClick={() => setIsActive((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                            isActive ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                isActive ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                    <span className="text-sm font-semibold text-gray-700">Active</span>
                </div>
            </div>

            <div className="flex gap-3">
                <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {saving ? 'Saving...' : initial?.id ? 'Update' : 'Create'}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

export default function PaymentMethodsSettingsPage() {
    const [methods, setMethods] = useState<PaymentMethod[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<ToastState>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        try {
            const [methodsData, accountsData] = await Promise.all([
                api.getPaymentMethods(),
                api.getAccounts(),
            ]);
            setMethods(methodsData ?? []);
            setAccounts(accountsData?.data ?? accountsData ?? []);
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to load data' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCreate = async (data: any) => {
        try {
            await api.createPaymentMethod(data);
            setToast({ type: 'success', message: 'Payment method created' });
            setShowCreate(false);
            loadData();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to create' });
        }
    };

    const handleUpdate = async (id: string, data: any) => {
        try {
            await api.updatePaymentMethod(id, data);
            setToast({ type: 'success', message: 'Payment method updated' });
            setEditingId(null);
            loadData();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to update' });
        }
    };

    const handleDelete = async (id: string) => {
        if (!globalThis.confirm('Delete this payment method? This cannot be undone.')) return;
        setDeletingId(id);
        try {
            await api.deletePaymentMethod(id);
            setToast({ type: 'success', message: 'Payment method deleted' });
            loadData();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to delete' });
        } finally {
            setDeletingId(null);
        }
    };

    const typeLabel = (type: string) =>
        PAYMENT_TYPES.find((pt) => pt.value === type)?.label ?? type;

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                {/* Back link */}
                <div className="flex items-center gap-3">
                    <Link
                        href="/dashboard/settings"
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Settings
                    </Link>
                </div>

                {/* Page title */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Payment Methods</h1>
                            <p className="text-sm text-gray-500">Manage accepted payment methods for sales</p>
                        </div>
                    </div>
                    <button
                        onClick={() => { setShowCreate(true); setEditingId(null); }}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Add Method
                    </button>
                </div>

                {/* Create form */}
                {showCreate && (
                    <MethodForm
                        accounts={accounts}
                        onSave={handleCreate}
                        onCancel={() => setShowCreate(false)}
                    />
                )}

                {/* Methods list */}
                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading...
                    </div>
                ) : methods.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                        <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-semibold">No payment methods yet</p>
                        <p className="text-xs mt-1">Add one using the button above</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {methods.map((method) => (
                            <div key={method.id}>
                                {editingId === method.id ? (
                                    <MethodForm
                                        initial={method}
                                        accounts={accounts}
                                        onSave={(data) => handleUpdate(method.id, data)}
                                        onCancel={() => setEditingId(null)}
                                    />
                                ) : (
                                    <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                                <CreditCard className="w-4 h-4 text-indigo-600" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-bold text-gray-900">{method.name}</p>
                                                    {!method.is_active && (
                                                        <span className="text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-md">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-500">
                                                    {typeLabel(method.type)}
                                                    {method.account?.name ? ` · ${method.account.name}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => { setEditingId(method.id); setShowCreate(false); }}
                                                className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(method.id)}
                                                disabled={deletingId === method.id}
                                                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                title="Delete"
                                            >
                                                {deletingId === method.id
                                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                                    : <Trash2 className="w-4 h-4" />
                                                }
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
