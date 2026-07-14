'use client';

import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Loader2, Plus, Edit2, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { toast } from '@/lib/toast';
import { Button, Field, Input, PageShell, Select } from '@/components/ui';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'is_active', label: 'Is Active', required: false },
];

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
        <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name">
                    <Input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. bKash, Main Cash"
                        required
                    />
                </Field>

                <Field label="Type">
                    <Select
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                    >
                        {PAYMENT_TYPES.map((pt) => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                        ))}
                    </Select>
                </Field>

                <Field
                    label={(
                        <>
                            Account <span className="font-normal text-gray-400">(optional)</span>
                        </>
                    ) as unknown as string}
                >
                    <Select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                    >
                        <option value="">— No account linked —</option>
                        {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                                {acc.code ? `[${acc.code}] ` : ''}{acc.name}
                            </option>
                        ))}
                    </Select>
                </Field>

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
                <Button type="submit" disabled={saving || !name.trim()} loading={saving}>
                    {saving ? 'Saving...' : initial?.id ? 'Update' : 'Create'}
                </Button>
                <Button type="button" variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}

export default function PaymentMethodsSettingsPage() {
    const { t } = useI18n();
    const pageTitle = 'Payment Methods';
    const [methods, setMethods] = useState<PaymentMethod[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const [methodsData, accountsData] = await Promise.all([
                api.getPaymentMethods(),
                api.getAccounts(),
            ]);
            setMethods(methodsData ?? []);
            setAccounts(accountsData?.data ?? accountsData ?? []);
        } catch (err: any) {
            toast.error(err?.message || 'Failed to load data');
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
            toast.success('Payment method created');
            setShowCreate(false);
            loadData();
        } catch (err: any) {
            toast.error(err?.message || 'Failed to create');
        }
    };

    const handleUpdate = async (id: string, data: any) => {
        try {
            await api.updatePaymentMethod(id, data);
            toast.success('Payment method updated');
            setEditingId(null);
            loadData();
        } catch (err: any) {
            toast.error(err?.message || 'Failed to update');
        }
    };

    const handleDelete = async (id: string) => {
        if (!globalThis.confirm('Delete this payment method? This cannot be undone.')) return;
        setDeletingId(id);
        try {
            await api.deletePaymentMethod(id);
            toast.success('Payment method deleted');
            loadData();
        } catch (err: any) {
            toast.error(err?.message || 'Failed to delete');
        } finally {
            setDeletingId(null);
        }
    };

    const typeLabel = (type: string) =>
        PAYMENT_TYPES.find((pt) => pt.value === type)?.label ?? type;

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-indigo-600" />
                        </span>
                        {pageTitle}
                    </span>
                )}
                subtitle="Manage accepted payment methods for sales"
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    pageTitle,
                    'settings',
                )}
                actions={(
                    <>
                        <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                            Import
                        </Button>
                        <Button icon={<Plus className="w-4 h-4" />} onClick={() => { setShowCreate(true); setEditingId(null); }}>
                            Add Method
                        </Button>
                    </>
                )}
            />

            <div className="space-y-4 mt-4">
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
                                    <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                                <CreditCard className="w-4 h-4 text-indigo-600" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-bold text-gray-900">{method.name}</p>
                                                    {!method.is_active && (
                                                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-md">
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

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel="Payment Methods"
                fields={IMPORT_FIELDS}
                importFn={(rows, mode) => api.importPaymentMethods(rows, mode)}
                onSuccess={() => void loadData()}
            />
        </PageShell>
    );
}
