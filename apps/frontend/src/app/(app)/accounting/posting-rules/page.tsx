'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleOff, Filter, ListChecks, Pencil, Workflow } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
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
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { toast } from '@/lib/toast';
import { compactDensity } from '@/lib/ui/compact-density';
import { Button, StatusBadge } from '@/components/ui';
import AccountSelect from '@/components/accounting/AccountSelect';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

const EVENT_TYPES = [
    'sale',
    'sale_return',
    'purchase',
    'purchase_return',
    'inventory_adjustment',
    'fund_movement',
    'loan_disbursement',
    'loan_repayment',
] as const;

const CONDITION_KEYS = ['none', 'payment_mode', 'reason_type', 'transfer_scope', 'loan_direction'] as const;

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
    const p = t.postingRules;
    const m = t.accountingMastersUi.postingRules;
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
    const [search, setSearch] = useState('');
    const [eventFilter, setEventFilter] = useState<string[]>([]);
    const [eventExclude, setEventExclude] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [conditionFilter, setConditionFilter] = useState<string[]>([]);
    const [debitFilter, setDebitFilter] = useState<string[]>([]);
    const [creditFilter, setCreditFilter] = useState<string[]>([]);
    const [priorityFilter, setPriorityFilter] = useState<NumberCondition | null>(null);

    useEffect(() => {
        void loadData();
        // Loaded once; the loader reads only the copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadData = async () => {
        try {
            const [rulesData, accountsData] = await Promise.all([
                api.getPostingRules(),
                api.getAccounts(),
            ]);
            setRules(rulesData.data ?? []);
            setAccounts(Array.isArray(accountsData) ? accountsData : []);
        } catch (err) {
            console.error('Failed to load posting rules', err);
            toast.error(p.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const eventLabel = (type: string) => m.eventTypes[type as keyof typeof m.eventTypes] ?? type;
    const conditionLabel = (key: string) => m.conditionKeys[key as keyof typeof m.conditionKeys] ?? key;
    const statusOf = (rule: PostingRule) => (rule.isActive ? 'active' : 'inactive');

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
            toast.success(m.saved);
        } catch (err: any) {
            setSaveError(err.message ?? p.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const filteredRules = useMemo(
        () =>
            rules.filter((r) => {
                if (!matchesAnyOf(eventFilter, r.eventType, eventExclude)) return false;
                if (!matchesAnyOf(statusFilter, statusOf(r))) return false;
                if (!matchesAnyOf(conditionFilter, r.conditionKey)) return false;
                if (!matchesAnyOf(debitFilter, r.debitAccount?.id)) return false;
                if (!matchesAnyOf(creditFilter, r.creditAccount?.id)) return false;
                if (!matchesNumberCondition(r.priority, priorityFilter)) return false;
                return matchesSearch(
                    search,
                    eventLabel(r.eventType),
                    conditionLabel(r.conditionKey),
                    r.conditionValue,
                    r.debitAccount?.name,
                    r.debitAccount?.code,
                    r.creditAccount?.name,
                    r.creditAccount?.code,
                );
            }),
        // eventLabel/conditionLabel read only `m`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rules, eventFilter, eventExclude, statusFilter, conditionFilter, debitFilter, creditFilter, priorityFilter, search, m],
    );

    const filters = useMemo<ListFilter[]>(() => {
        /** The accounts some rule posts to on one side, so the chip offers only those. */
        const sideOptions = (pick: (rule: PostingRule) => Account) => {
            const seen = new Map<string, Account>();
            rules.forEach((rule) => {
                const account = pick(rule);
                if (account?.id) seen.set(account.id, account);
            });
            return [...seen.values()]
                .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name))
                .map((account) => ({ value: account.id, label: account.code ? `${account.code} · ${account.name}` : account.name }));
        };
        return [
            {
                id: 'event',
                type: 'multi-select',
                label: p.columns.event,
                value: eventFilter,
                onChange: setEventFilter,
                exclude: { value: eventExclude, onChange: setEventExclude },
                options: EVENT_TYPES.map((type) => ({ value: type, label: m.eventTypes[type] })),
            },
            {
                id: 'status',
                type: 'multi-select',
                label: p.columns.status,
                value: statusFilter,
                onChange: setStatusFilter,
                options: [
                    { value: 'active', label: p.active },
                    { value: 'inactive', label: p.inactive },
                ],
            },
            {
                id: 'condition',
                type: 'multi-select',
                label: p.columns.condition,
                value: conditionFilter,
                onChange: setConditionFilter,
                options: CONDITION_KEYS.map((key) => ({ value: key, label: m.conditionKeys[key] })),
            },
            {
                id: 'debitAccount',
                type: 'multi-select',
                label: p.columns.debitAccount,
                value: debitFilter,
                onChange: setDebitFilter,
                options: sideOptions((rule) => rule.debitAccount),
                more: true,
            },
            {
                id: 'creditAccount',
                type: 'multi-select',
                label: p.columns.creditAccount,
                value: creditFilter,
                onChange: setCreditFilter,
                options: sideOptions((rule) => rule.creditAccount),
                more: true,
            },
            {
                id: 'priority',
                type: 'number',
                label: p.columns.priority,
                value: priorityFilter,
                onChange: setPriorityFilter,
                more: true,
            },
        ];
    }, [p, m, rules, eventFilter, eventExclude, statusFilter, conditionFilter, debitFilter, creditFilter, priorityFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const active = filteredRules.filter((r) => r.isActive);
        const items: ListStat[] = [
            { id: 'rules', icon: <ListChecks aria-hidden />, label: m.rules, value: n(filteredRules.length) },
            { id: 'active', icon: <CheckCircle2 aria-hidden />, label: p.active, value: n(active.length) },
            { id: 'inactive', icon: <CircleOff aria-hidden />, label: p.inactive, value: n(filteredRules.length - active.length) },
            {
                id: 'conditional',
                icon: <Filter aria-hidden />,
                label: m.conditional,
                value: n(filteredRules.filter((r) => r.conditionKey !== 'none').length),
            },
            {
                id: 'events',
                icon: <Workflow aria-hidden />,
                label: m.eventsCovered,
                value: n(new Set(active.map((r) => r.eventType)).size),
                hint: `/ ${n(EVENT_TYPES.length)}`,
            },
        ];
        return { items, loading, label: m.statsLabel };
    }, [filteredRules, loading, locale, m, p]);

    const columns = useMemo<ColumnDef<PostingRule, any>[]>(
        () => [
            columnHelper.accessor('eventType', {
                header: p.columns.event,
                cell: (info) => <StatusBadge tone="neutral">{eventLabel(info.getValue())}</StatusBadge>,
                size: 170,
            }),
            columnHelper.accessor('conditionKey', {
                header: p.columns.condition,
                cell: (info) => {
                    const key = info.getValue();
                    const value = info.row.original.conditionValue;
                    if (key === 'none') {
                        return <span className="text-gray-400 italic">{p.defaultCondition}</span>;
                    }
                    return (
                        <span className="text-gray-700">
                            {conditionLabel(key)}
                            {value && (
                                <span className="ms-1 font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{value}</span>
                            )}
                        </span>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor((row) => row.debitAccount?.name ?? '', {
                id: 'debitAccount',
                header: p.columns.debitAccount,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <span className="block truncate text-gray-900">{row.original.debitAccount.name}</span>
                        {row.original.debitAccount.code && (
                            <span className="block text-xs font-mono text-gray-400">{row.original.debitAccount.code}</span>
                        )}
                    </div>
                ),
                size: 200,
            }),
            columnHelper.accessor((row) => row.creditAccount?.name ?? '', {
                id: 'creditAccount',
                header: p.columns.creditAccount,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <span className="block truncate text-gray-900">{row.original.creditAccount.name}</span>
                        {row.original.creditAccount.code && (
                            <span className="block text-xs font-mono text-gray-400">{row.original.creditAccount.code}</span>
                        )}
                    </div>
                ),
                size: 200,
            }),
            columnHelper.accessor('priority', {
                header: p.columns.priority,
                cell: (info) => <span className="font-mono text-gray-500">{info.getValue()}</span>,
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
            columnHelper.accessor((row) => statusOf(row), {
                id: 'status',
                header: p.columns.status,
                cell: (info) =>
                    info.getValue() === 'active' ? (
                        <StatusBadge tone="success">{p.active}</StatusBadge>
                    ) : (
                        <StatusBadge tone="neutral">{p.inactive}</StatusBadge>
                    ),
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(row.original)} />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 70,
            }),
        ],
        // eventLabel/conditionLabel/openEdit read only the copy and setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, p, m],
    );

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={p.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    p.title,
                    'accounting',
                )}
            />
            <AccountingToolbar help={POSTING_RULES_FIELD_HELP.page} />

            <ContextualHelpPanel {...POSTING_RULES_HELP} />

            <DataTable<PostingRule>
                tableId="posting-rules"
                title={p.title}
                columns={columns}
                data={filteredRules}
                isLoading={loading}
                emptyIcon={<Workflow className="h-10 w-10 text-gray-200" />}
                searchPlaceholder={m.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.id}
            />

            {editingRule && (
                <ModalShell size="md" onBackdropClick={() => setEditingRule(null)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={p.editTitle}
                            subtitle={(
                                <>
                                    {eventLabel(editingRule.eventType)}
                                    {editingRule.conditionValue && (
                                        <span className="ms-1 font-mono text-xs bg-gray-100 px-1 rounded">{editingRule.conditionValue}</span>
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
                                            {p.columns.debitAccount} <span className="text-red-500">*</span>
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.debit} side="right" />
                                        </span>
                                    </label>
                                    <AccountSelect
                                        accounts={accounts}
                                        value={form.debitAccountId}
                                        onChange={(id) => setForm((f) => ({ ...f, debitAccountId: id }))}
                                        ariaLabel={p.columns.debitAccount}
                                        placeholder={t.accountingShared.selectAccountPlaceholder}
                                        className={compactDensity.formField}
                                    />
                                </div>
                                <div>
                                    <label className={`${compactDensity.formLabel} block mb-1`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            {p.columns.creditAccount} <span className="text-red-500">*</span>
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.credit} side="right" />
                                        </span>
                                    </label>
                                    <AccountSelect
                                        accounts={accounts}
                                        value={form.creditAccountId}
                                        onChange={(id) => setForm((f) => ({ ...f, creditAccountId: id }))}
                                        ariaLabel={p.columns.creditAccount}
                                        placeholder={t.accountingShared.selectAccountPlaceholder}
                                        className={compactDensity.formField}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={`${compactDensity.formLabel} block mb-1`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            {p.columns.priority}
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
                                    <p className="text-xs text-gray-400 mt-1">{p.priorityHint}</p>
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
                                            {p.active}
                                            <HelpTooltip text={POSTING_RULES_FIELD_HELP.active} side="right" />
                                        </span>
                                    </label>
                                    <p className="text-xs text-gray-400 mt-1 ms-6">{p.inactiveSkipped}</p>
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
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                loading={saving}
                                disabled={!form.debitAccountId || !form.creditAccountId}
                            >
                                {p.saveRule}
                            </Button>
                        </ModalFooter>
                    </div>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
