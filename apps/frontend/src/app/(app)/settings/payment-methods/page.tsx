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
import { PAYMENT_METHOD_TYPE_VALUES, PaymentMethodType } from '@erp71/shared-types';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'is_active', label: 'Is Active', required: false },
];

interface Account {
    id: string;
    name: string;
    code?: string | null;
}

interface PaymentMethod {
    id: string;
    name: string;
    type: string;
    account_id?: string | null;
    is_active: boolean;
    show_on_entry: boolean;
    sort_order: number;
}

// Values come from the shared PaymentMethodType contract so they always match
// what the backend DTO validates — a mismatch here 400s every create.
const PAYMENT_TYPE_LABELS: Record<PaymentMethodType, string> = {
    [PaymentMethodType.CASH]: 'Cash',
    [PaymentMethodType.MOBILE_WALLET]: 'Mobile Wallet (bKash / Nagad)',
    [PaymentMethodType.CARD]: 'Card',
    [PaymentMethodType.BANK]: 'Bank Transfer',
};

const PAYMENT_TYPES = PAYMENT_METHOD_TYPE_VALUES.map((value) => ({
    value,
    label: PAYMENT_TYPE_LABELS[value],
}));

interface MethodFormProps {
    initial?: Partial<PaymentMethod>;
    accounts: Account[];
    accountsError?: string | null;
    onSave: (data: any) => Promise<void>;
    onCancel: () => void;
}

function MethodForm({ initial, accounts, accountsError, onSave, onCancel }: MethodFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [type, setType] = useState<string>(initial?.type ?? PaymentMethodType.CASH);
    const [accountId, setAccountId] = useState(initial?.account_id ?? '');
    const [isActive, setIsActive] = useState(initial?.is_active ?? true);
    const [showOnEntry, setShowOnEntry] = useState(initial?.show_on_entry ?? true);
    const [serial, setSerial] = useState<number>(initial?.sort_order ?? 0);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            await onSave({
                name: name.trim(),
                type,
                // null, not undefined: the backend leaves an absent key alone,
                // so undefined could never clear an existing link.
                account_id: accountId || null,
                is_active: isActive,
                show_on_entry: showOnEntry,
                sort_order: Number(serial) || 0,
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

                <Field label="Serial">
                    <Input
                        type="number"
                        min={0}
                        value={serial}
                        onChange={(e) => setSerial(parseInt(e.target.value, 10) || 0)}
                        placeholder="e.g. 1"
                    />
                </Field>

                <Field
                    label={(
                        <>
                            Account <span className="font-normal text-gray-400">(optional)</span>
                        </>
                    )}
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
                    {accountsError ? (
                        <p className="mt-1 text-xs text-amber-600">
                            Accounts could not be loaded, so this list is empty. The method still
                            saves without a linked account.
                        </p>
                    ) : null}
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

                <div className="flex items-center gap-3 pt-6">
                    <button
                        type="button"
                        onClick={() => setShowOnEntry((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                            showOnEntry ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                showOnEntry ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                    <span className="text-sm font-semibold text-gray-700">Show on Entry UI</span>
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
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    // Settled, not Promise.all: the account picker is an optional extra, and a
    // rejection there used to take the payment-method list down with it — the
    // page rendered empty and toasted whatever the accounts call had complained
    // about. The two loads are independent, so failure is too.
    const loadData = useCallback(async () => {
        try {
            const [methodsResult, accountsResult] = await Promise.allSettled([
                api.getPaymentMethods(),
                api.getPaymentMethodAccounts(),
            ]);

            if (methodsResult.status === 'fulfilled') {
                setMethods(methodsResult.value ?? []);
            } else {
                toast.error((methodsResult.reason as any)?.message || 'Failed to load payment methods');
            }

            if (accountsResult.status === 'fulfilled') {
                setAccounts(accountsResult.value ?? []);
                setAccountsError(null);
            } else {
                setAccounts([]);
                setAccountsError((accountsResult.reason as any)?.message || 'Failed to load accounts');
            }
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

    // The API returns account_id only, so the name is resolved against the
    // picker's own list rather than read off a relation that never ships.
    const accountName = (accountId?: string | null) =>
        accountId ? accounts.find((acc) => acc.id === accountId)?.name : undefined;

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-primary-light flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-primary" />
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
                        accountsError={accountsError}
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
                        {[...methods].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((method) => (
                            <div key={method.id}>
                                {editingId === method.id ? (
                                    <MethodForm
                                        initial={method}
                                        accounts={accounts}
                                        accountsError={accountsError}
                                        onSave={(data) => handleUpdate(method.id, data)}
                                        onCancel={() => setEditingId(null)}
                                    />
                                ) : (
                                    <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
                                                <CreditCard className="w-4 h-4 text-primary" />
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
                                                    {accountName(method.account_id) ? ` · ${accountName(method.account_id)}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => { setEditingId(method.id); setShowCreate(false); }}
                                                className="p-2 rounded-lg text-gray-400 hover:text-primary hover:bg-primary-light transition-colors"
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
