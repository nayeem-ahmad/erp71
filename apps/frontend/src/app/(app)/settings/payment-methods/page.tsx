'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CreditCard, Loader2, Plus, Edit2, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { toast } from '@/lib/toast';
import { BranchFilter, Button, Checkbox, Field, Input, PageShell, Select } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import AccountSelect from '@/components/accounting/AccountSelect';
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
    all_branches?: boolean;
    store_ids?: string[];
}

interface Branch {
    id: string;
    name: string;
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
    /** The tenant's branches; the branch field only shows when there is a choice (2+). */
    branches: Branch[];
    onSave: (data: any) => Promise<void>;
    onCancel: () => void;
}

function MethodForm({ initial, accounts, accountsError, branches, onSave, onCancel }: MethodFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [type, setType] = useState<string>(initial?.type ?? PaymentMethodType.CASH);
    const [accountId, setAccountId] = useState(initial?.account_id ?? '');
    const [isActive, setIsActive] = useState(initial?.is_active ?? true);
    const [showOnEntry, setShowOnEntry] = useState(initial?.show_on_entry ?? true);
    const [serial, setSerial] = useState<number>(initial?.sort_order ?? 0);
    const [allBranches, setAllBranches] = useState(initial?.all_branches ?? true);
    const [storeIds, setStoreIds] = useState<string[]>(initial?.store_ids ?? []);
    const [branchError, setBranchError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // A one-branch shop has nothing to choose: the field is hidden and the
    // request leaves the stored value alone (a new method defaults to all).
    const showBranches = branches.length > 1;

    const toggleStore = (id: string) => {
        setBranchError(null);
        setStoreIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (showBranches && !allBranches && storeIds.length === 0) {
            setBranchError('Pick at least one branch');
            return;
        }
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
                ...(showBranches
                    ? { all_branches: allBranches, store_ids: allBranches ? [] : storeIds }
                    : {}),
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
                    <AccountSelect
                        accounts={accounts}
                        value={accountId}
                        onChange={setAccountId}
                        ariaLabel="Account"
                        placeholder="— No account linked —"
                        allowClear
                        clearLabel="— No account linked —"
                    />
                    {accountsError ? (
                        <p className="mt-1 text-xs text-amber-600">
                            Accounts could not be loaded, so this list is empty. The method still
                            saves without a linked account.
                        </p>
                    ) : null}
                </Field>

                {showBranches && (
                    <Field label="Branches" error={branchError ?? undefined} className="sm:col-span-2">
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm text-gray-700 max-md:min-h-touch">
                                <Checkbox
                                    checked={allBranches}
                                    onChange={(e) => {
                                        setAllBranches(e.target.checked);
                                        setBranchError(null);
                                    }}
                                />
                                All branches
                            </label>
                            {!allBranches && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-6">
                                    {branches.map((branch) => (
                                        <label
                                            key={branch.id}
                                            className="flex items-center gap-2 text-sm text-gray-700 max-md:min-h-touch"
                                        >
                                            <Checkbox
                                                checked={storeIds.includes(branch.id)}
                                                onChange={() => toggleStore(branch.id)}
                                            />
                                            {branch.name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Field>
                )}

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
    const branchScope = useBranchScope();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);

    // The list follows the page's branch filter (header branch to start with;
    // "All branches" only for owners / consolidated holders), so it is fetched
    // again whenever the filter changes.
    const { ready: scopeReady, apiStoreId } = branchScope;
    const branchScopeRef = useRef(branchScope);
    branchScopeRef.current = branchScope;

    const loadMethods = useCallback(async () => {
        if (!scopeReady) return;
        try {
            const result = await api.getPaymentMethods(undefined, apiStoreId);
            setMethods(result ?? []);
        } catch (err: any) {
            if (!handleBranchForbidden(err, branchScopeRef.current, 'You do not have access to that branch.')) {
                toast.error(err?.message || 'Failed to load payment methods');
            }
        } finally {
            setLoading(false);
        }
    }, [scopeReady, apiStoreId]);

    useEffect(() => {
        void loadMethods();
    }, [loadMethods]);

    // Independent of the list, so a failure in either leaves the other intact:
    // the account picker is an optional extra, and a rejection there used to
    // take the payment-method list down with it.
    useEffect(() => {
        let cancelled = false;
        api.getPaymentMethodAccounts().then(
            (result) => {
                if (cancelled) return;
                setAccounts(result ?? []);
                setAccountsError(null);
            },
            (reason) => {
                if (cancelled) return;
                setAccounts([]);
                setAccountsError((reason as any)?.message || 'Failed to load accounts');
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        Promise.resolve(api.getStores()).then(
            (result: Branch[] | undefined) => {
                if (!cancelled) setBranches((result ?? []).map(({ id, name }) => ({ id, name })));
            },
            () => {
                if (!cancelled) setBranches([]);
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);

    const loadData = loadMethods;

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
    const branchNames = (method: PaymentMethod) => {
        if (method.all_branches ?? true) return 'All branches';
        const names = (method.store_ids ?? [])
            .map((id) => branches.find((branch) => branch.id === id)?.name)
            .filter((name): name is string => Boolean(name));
        return names.length > 0 ? names.join(', ') : 'No branches';
    };

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
                        <BranchFilter scope={branchScope} />
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
                        branches={branches}
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
                        branches={branches}
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
                                                {branches.length > 1 && (
                                                    <p className="text-xs text-gray-500">Branches: {branchNames(method)}</p>
                                                )}
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
