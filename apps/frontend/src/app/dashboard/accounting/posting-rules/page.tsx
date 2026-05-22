'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle, Edit2, Settings, XCircle } from 'lucide-react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../lib/api';

const EVENT_TYPE_LABELS: Record<string, string> = {
    sale: 'Sale',
    sale_return: 'Sale Return',
    purchase: 'Purchase',
    purchase_return: 'Purchase Return',
    inventory_adjustment: 'Inventory Adjustment',
    fund_movement: 'Fund Movement',
};

const CONDITION_KEY_LABELS: Record<string, string> = {
    payment_mode: 'Payment Mode',
    reason_type: 'Reason Type',
    transfer_scope: 'Transfer Scope',
    none: 'None (default)',
};

const EVENT_TYPE_BADGE: Record<string, string> = {
    sale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sale_return: 'bg-amber-50 text-amber-700 border-amber-200',
    purchase: 'bg-sky-50 text-sky-700 border-sky-200',
    purchase_return: 'bg-orange-50 text-orange-700 border-orange-200',
    inventory_adjustment: 'bg-violet-50 text-violet-700 border-violet-200',
    fund_movement: 'bg-gray-50 text-gray-700 border-gray-200',
};

interface Account {
    id: string;
    name: string;
    code?: string | null;
}

interface PostingRule {
    id: string;
    eventType: string;
    conditionKey: string;
    conditionValue: string | null;
    debitAccount: Account;
    creditAccount: Account;
    priority: number;
    isActive: boolean;
    updatedAt: string;
}

interface EditForm {
    debitAccountId: string;
    creditAccountId: string;
    conditionKey: string;
    conditionValue: string;
    priority: number;
    isActive: boolean;
}

const columnHelper = createColumnHelper<PostingRule>();

export default function PostingRulesPage() {
    const [rules, setRules] = useState<PostingRule[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingRule, setEditingRule] = useState<PostingRule | null>(null);
    const [form, setForm] = useState<EditForm>({
        debitAccountId: '',
        creditAccountId: '',
        conditionKey: 'none',
        conditionValue: '',
        priority: 100,
        isActive: true,
    });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [filterActive, setFilterActive] = useState<string>('');
    const [filterEventType, setFilterEventType] = useState('');

    useEffect(() => {
        void loadData();
    }, []);

    const loadData = async () => {
        try {
            const [rulesData, accountsData] = await Promise.all([
                api.getPostingRules(),
                api.getAccounts(),
            ]);
            setRules(rulesData.data ?? []);
            setAccounts(accountsData);
        } catch (err) {
            console.error('Failed to load posting rules', err);
        } finally {
            setLoading(false);
        }
    };

    const openEdit = (rule: PostingRule) => {
        setEditingRule(rule);
        setForm({
            debitAccountId: rule.debitAccount.id,
            creditAccountId: rule.creditAccount.id,
            conditionKey: rule.conditionKey,
            conditionValue: rule.conditionValue ?? '',
            priority: rule.priority,
            isActive: rule.isActive,
        });
        setSaveError('');
    };

    const handleSave = async () => {
        if (!editingRule) return;
        setSaving(true);
        setSaveError('');
        try {
            await api.updatePostingRule(editingRule.id, {
                debitAccountId: form.debitAccountId,
                creditAccountId: form.creditAccountId,
                conditionKey: form.conditionKey,
                conditionValue: form.conditionKey === 'none' ? null : form.conditionValue || null,
                priority: form.priority,
                isActive: form.isActive,
            });
            await loadData();
            setEditingRule(null);
        } catch (err: any) {
            setSaveError(err.message ?? 'Failed to save rule');
        } finally {
            setSaving(false);
        }
    };

    const filteredRules = useMemo(() => {
        return rules.filter((r) => {
            if (filterActive === 'active' && !r.isActive) return false;
            if (filterActive === 'inactive' && r.isActive) return false;
            if (filterEventType && r.eventType !== filterEventType) return false;
            return true;
        });
    }, [rules, filterActive, filterEventType]);

    const columns = useMemo(
        () => [
            columnHelper.accessor('eventType', {
                header: 'Event',
                cell: (info) => {
                    const v = info.getValue();
                    return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${EVENT_TYPE_BADGE[v] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {EVENT_TYPE_LABELS[v] ?? v}
                        </span>
                    );
                },
            }),
            columnHelper.accessor('conditionKey', {
                header: 'Condition',
                cell: (info) => {
                    const key = info.getValue();
                    const value = info.row.original.conditionValue;
                    if (key === 'none') {
                        return <span className="text-sm text-gray-400 italic">Default (no condition)</span>;
                    }
                    return (
                        <span className="text-sm text-gray-700">
                            {CONDITION_KEY_LABELS[key] ?? key}
                            {value && (
                                <span className="ml-1 font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{value}</span>
                            )}
                        </span>
                    );
                },
            }),
            columnHelper.display({
                id: 'debitAccount',
                header: 'Debit Account',
                cell: ({ row }) => (
                    <div>
                        <span className="block text-sm font-medium text-gray-900">{row.original.debitAccount.name}</span>
                        {row.original.debitAccount.code && (
                            <span className="block text-xs font-mono text-gray-400">{row.original.debitAccount.code}</span>
                        )}
                    </div>
                ),
            }),
            columnHelper.display({
                id: 'creditAccount',
                header: 'Credit Account',
                cell: ({ row }) => (
                    <div>
                        <span className="block text-sm font-medium text-gray-900">{row.original.creditAccount.name}</span>
                        {row.original.creditAccount.code && (
                            <span className="block text-xs font-mono text-gray-400">{row.original.creditAccount.code}</span>
                        )}
                    </div>
                ),
            }),
            columnHelper.accessor('priority', {
                header: 'Priority',
                cell: (info) => (
                    <span className="text-sm text-gray-500 font-mono">{info.getValue()}</span>
                ),
            }),
            columnHelper.accessor('isActive', {
                header: 'Status',
                cell: (info) => {
                    const active = info.getValue();
                    return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                            {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {active ? 'Active' : 'Inactive'}
                        </span>
                    );
                },
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <button
                        onClick={() => openEdit(row.original)}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                    </button>
                ),
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1200px] mx-auto space-y-6">
                {/* Header */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Link href="/dashboard/accounting" className="hover:text-gray-600 transition-colors">
                            <ArrowLeft className="w-4 h-4 inline mr-1" />
                            Accounting
                        </Link>
                        <span>/</span>
                        <span className="text-gray-600 font-medium">Posting Rules</span>
                    </div>
                    <div className="flex items-end justify-between gap-6 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className="inline-flex rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-indigo-700">
                                <Settings className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-gray-950">Posting Rules</h1>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    Configure how operational events automatically create accounting vouchers.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                    <select
                        value={filterEventType}
                        onChange={(e) => setFilterEventType(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">All events</option>
                        {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                    <select
                        value={filterActive}
                        onChange={(e) => setFilterActive(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">All statuses</option>
                        <option value="active">Active only</option>
                        <option value="inactive">Inactive only</option>
                    </select>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="text-center py-16 text-gray-400">Loading posting rules...</div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <DataTable
                            tableId="posting-rules"
                            title="Posting Rules"
                            columns={columns}
                            data={filteredRules}
                        />
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {editingRule && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
                        <div className="flex items-center justify-between p-5 border-b">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900">Edit Posting Rule</h2>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    {EVENT_TYPE_LABELS[editingRule.eventType] ?? editingRule.eventType}
                                    {editingRule.conditionValue && (
                                        <span className="ml-1 font-mono text-xs bg-gray-100 px-1 rounded">{editingRule.conditionValue}</span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={() => setEditingRule(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Debit Account <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={form.debitAccountId}
                                        onChange={(e) => setForm((f) => ({ ...f, debitAccountId: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">Select account</option>
                                        {accounts.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.code ? `[${a.code}] ` : ''}{a.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Credit Account <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={form.creditAccountId}
                                        onChange={(e) => setForm((f) => ({ ...f, creditAccountId: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">Select account</option>
                                        {accounts.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.code ? `[${a.code}] ` : ''}{a.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={form.priority}
                                        onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">Lower number = higher priority</p>
                                </div>
                                <div className="flex flex-col justify-center">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={form.isActive}
                                            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700">Active</span>
                                    </label>
                                    <p className="text-xs text-gray-400 mt-1 ml-6">Inactive rules are skipped</p>
                                </div>
                            </div>

                            {saveError && (
                                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    {saveError}
                                </p>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 p-5 border-t">
                            <button
                                onClick={() => setEditingRule(null)}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving || !form.debitAccountId || !form.creditAccountId}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                {saving ? 'Saving...' : 'Save Rule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
