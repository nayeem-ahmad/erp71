'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Edit2, XCircle } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
    AccountingToolbar,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import { POSTING_RULES_FIELD_HELP, POSTING_RULES_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';
import { Button } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

const EVENT_TYPE_LABELS: Record<string, string> = {
    sale: 'Sale',
    sale_return: 'Sale Return',
    purchase: 'Purchase',
    purchase_return: 'Purchase Return',
    inventory_adjustment: 'Inventory Adjustment',
    fund_movement: 'Fund Movement',
    loan_disbursement: 'Loan Disbursement',
    loan_repayment: 'Loan Repayment',
};

const CONDITION_KEY_LABELS: Record<string, string> = {
    payment_mode: 'Payment Mode',
    reason_type: 'Reason Type',
    transfer_scope: 'Transfer Scope',
    loan_direction: 'Loan Direction',
    none: 'None (default)',
};

const EVENT_TYPE_BADGE: Record<string, string> = {
    sale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sale_return: 'bg-amber-50 text-amber-700 border-amber-200',
    purchase: 'bg-sky-50 text-sky-700 border-sky-200',
    purchase_return: 'bg-orange-50 text-orange-700 border-orange-200',
    inventory_adjustment: 'bg-primary-light text-blue-700 border-primary-border',
    fund_movement: 'bg-gray-50 text-gray-700 border-gray-200',
    loan_disbursement: 'bg-primary-light text-blue-700 border-primary-border',
    loan_repayment: 'bg-teal-50 text-teal-700 border-teal-200',
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
    const { t, locale } = useI18n();
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
                        className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover font-medium"
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
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.postingRules.title}
                subtitle="Configure how operational events automatically create accounting vouchers."
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.postingRules.title,
                    'accounting',
                )}
            />
            <AccountingToolbar help={POSTING_RULES_FIELD_HELP.page} />

            <ContextualHelpPanel {...POSTING_RULES_HELP} />

            <div className={compactDensity.filterBar}>
                <select value={filterEventType} onChange={(e) => setFilterEventType(e.target.value)} className={compactDensity.formField}>
                    <option value="">All events</option>
                    {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)} className={compactDensity.formField}>
                    <option value="">All statuses</option>
                    <option value="active">Active only</option>
                    <option value="inactive">Inactive only</option>
                </select>
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-400 text-sm">Loading posting rules...</div>
            ) : (
                <DataTable
                    tableId="posting-rules"
                    title={t.postingRules.title}
                    columns={columns}
                    data={filteredRules}
                />
            )}

            {editingRule && (
                <ModalShell size="md" onBackdropClick={() => setEditingRule(null)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title="Edit Posting Rule"
                            subtitle={(
                                <>
                                    {EVENT_TYPE_LABELS[editingRule.eventType] ?? editingRule.eventType}
                                    {editingRule.conditionValue && (
                                        <span className="ml-1 font-mono text-xs bg-gray-100 px-1 rounded">{editingRule.conditionValue}</span>
                                    )}
                                </>
                            )}
                            onClose={() => setEditingRule(null)}
                        />

                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={`${compactDensity.formLabel} block mb-1`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            Debit Account <span className="text-red-500">*</span>
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.debit} side="right" />
                                        </span>
                                    </label>
                                    <select
                                        value={form.debitAccountId}
                                        onChange={(e) => setForm((f) => ({ ...f, debitAccountId: e.target.value }))}
                                        className={compactDensity.formField}
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
                                    <label className={`${compactDensity.formLabel} block mb-1`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            Credit Account <span className="text-red-500">*</span>
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.credit} side="right" />
                                        </span>
                                    </label>
                                    <select
                                        value={form.creditAccountId}
                                        onChange={(e) => setForm((f) => ({ ...f, creditAccountId: e.target.value }))}
                                        className={compactDensity.formField}
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

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={`${compactDensity.formLabel} block mb-1`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            Priority
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.priority} side="right" />
                                        </span>
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={form.priority}
                                        onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                                        className={compactDensity.formField}
                                    />
                                    <p className="text-xs text-gray-400 mt-1">Lower number = higher priority</p>
                                </div>
                                <div className="flex flex-col justify-center">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={form.isActive}
                                            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/40"
                                        />
                                        <span className={`${compactDensity.formLabel} inline-flex items-center gap-1.5`}>
                                            Active
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.active} side="right" />
                                        </span>
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

                        <ModalFooter>
                            <Button variant="secondary" onClick={() => setEditingRule(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                loading={saving}
                                disabled={!form.debitAccountId || !form.creditAccountId}
                            >
                                Save Rule
                            </Button>
                        </ModalFooter>
                    </div>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
