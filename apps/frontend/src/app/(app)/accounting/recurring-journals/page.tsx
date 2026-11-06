'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlarmClock, CheckCircle2, CircleOff, Play, Plus, Repeat, Wallet } from 'lucide-react';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Field, FormGrid, Input, Select, StatusBadge } from '@/components/ui';
import type { AccountOption } from '@/components/accounting/AccountSelect';
import { api } from '@/lib/api';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { calendarDayOf, inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import {
    TemplateLinesCell,
    TemplateLinesEditor,
    emptyLines,
    linePayload,
    lineTotals,
    templateAccountNames,
    templateAmount,
    type StoredTemplateLine,
    type TemplateLineDraft,
} from '../voucher-templates/template-ui';

const FREQUENCIES = ['MONTHLY', 'WEEKLY', 'DAILY'] as const;

interface RecurringJournal {
    id: string;
    name: string;
    description?: string | null;
    frequency: string;
    next_due_date: string;
    last_run_date?: string | null;
    is_active: boolean;
    lines: StoredTemplateLine[];
}

type FormState = { name: string; description: string; frequency: string; nextDueDate: string };

const EMPTY_FORM: FormState = { name: '', description: '', frequency: 'MONTHLY', nextDueDate: '' };

const statusOf = (row: RecurringJournal) => (row.is_active ? 'active' : 'inactive');

const columnHelper = createColumnHelper<RecurringJournal>();

export default function RecurringJournalsPage() {
    const { t, locale, fmt } = useI18n();
    const copy = t.accountingVouchersUi;
    const rj = t.recurringJournals;
    const title = rj.title;
    const formId = useId();
    const [templates, setTemplates] = useState<RecurringJournal[]>([]);
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [lines, setLines] = useState<TemplateLineDraft[]>(emptyLines);
    const [formError, setFormError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [posting, setPosting] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [frequencies, setFrequencies] = useState<string[]>([]);
    const [statuses, setStatuses] = useState<string[]>([]);
    const [nextDue, setNextDue] = useState<CreatedRange | null>(null);
    const [lastRun, setLastRun] = useState<CreatedRange | null>(null);
    const [amount, setAmount] = useState<NumberCondition | null>(null);

    useEffect(() => {
        void load();
        api.getAccounts({}).then((d: any) => setAccounts(Array.isArray(d) ? d : d.data ?? [])).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await api.listRecurringJournals();
            setTemplates(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setLoadError(e?.message ?? t.accountingShared.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const totals = lineTotals(lines);

    const openCreate = () => {
        setForm(EMPTY_FORM);
        setLines(emptyLines());
        setFormError(null);
        setShowCreate(true);
    };

    const closeCreate = () => {
        if (!creating) setShowCreate(false);
    };

    const handleCreate = async () => {
        setCreating(true);
        setFormError(null);
        try {
            await api.createRecurringJournal({
                name: form.name,
                description: form.description || undefined,
                frequency: form.frequency,
                nextDueDate: form.nextDueDate,
                lines: linePayload(lines),
            });
            setShowCreate(false);
            toast.success(t.common.created);
            await load();
        } catch (e: any) {
            setFormError(e?.message ?? t.accountingShared.createFailed);
        } finally {
            setCreating(false);
        }
    };

    const handlePost = async (template: RecurringJournal) => {
        setPosting(template.id);
        try {
            const result = await api.postRecurringJournal(template.id);
            toast.success(fmt(copy.common.postedAs, {
                voucherNumber: result?.voucher_number ?? result?.voucher?.voucher_number ?? '—',
            }));
            await load();
        } catch (e: any) {
            toast.error(e?.message ?? rj.postFailed);
        } finally {
            setPosting(null);
        }
    };

    const frequencyLabel = (value: string) =>
        (copy.common.frequencies as Record<string, string>)[value] ?? value;

    const filtered = useMemo(
        () => templates.filter((row) => {
            if (!matchesAnyOf(frequencies, row.frequency)) return false;
            if (!matchesAnyOf(statuses, statusOf(row))) return false;
            if (!inDateRange(row.next_due_date, nextDue)) return false;
            if (!inDateRange(row.last_run_date, lastRun)) return false;
            if (!matchesNumberCondition(templateAmount(row.lines), amount)) return false;
            return matchesSearch(search, row.name, row.description, ...templateAccountNames(row.lines));
        }),
        [templates, frequencies, statuses, nextDue, lastRun, amount, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'frequency',
            type: 'multi-select',
            label: rj.frequency,
            value: frequencies,
            onChange: setFrequencies,
            options: FREQUENCIES.map((value) => ({ value, label: copy.common.frequencies[value] })),
        },
        {
            id: 'nextDue',
            type: 'date-range',
            label: rj.columns.nextDue,
            value: nextDue,
            onChange: setNextDue,
            operators: true,
        },
        {
            id: 'status',
            type: 'multi-select',
            label: t.accountingShared.status,
            value: statuses,
            onChange: setStatuses,
            options: [
                { value: 'active', label: rj.active },
                { value: 'inactive', label: rj.inactive },
            ],
        },
        {
            id: 'amount',
            type: 'number',
            label: copy.common.amountPerRun,
            value: amount,
            onChange: setAmount,
            money: true,
            more: true,
        },
        {
            id: 'lastRun',
            type: 'date-range',
            label: rj.columns.lastRun,
            value: lastRun,
            onChange: setLastRun,
            operators: true,
            more: true,
        },
    ], [t, rj, copy, frequencies, nextDue, statuses, amount, lastRun]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const today = tenantDateOnly();
        const active = filtered.filter((row) => row.is_active);
        const due = active.filter((row) => (calendarDayOf(row.next_due_date) ?? '') <= today).length;
        const items: ListStat[] = [
            { id: 'count', icon: <Repeat aria-hidden />, label: title, value: n(filtered.length) },
            { id: 'active', icon: <CheckCircle2 aria-hidden />, label: rj.active, value: n(active.length) },
            {
                id: 'due',
                icon: <AlarmClock aria-hidden />,
                label: copy.common.dueNow,
                value: n(due),
                tone: due > 0 ? 'warning' : 'default',
            },
            { id: 'inactive', icon: <CircleOff aria-hidden />, label: rj.inactive, value: n(filtered.length - active.length) },
            {
                id: 'amount',
                icon: <Wallet aria-hidden />,
                label: copy.common.amountPerRun,
                value: formatBDT(
                    active.reduce((sum, row) => sum + templateAmount(row.lines), 0),
                    { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 },
                ),
            },
        ];
        return { items, loading, label: copy.recurringJournals.statsLabel };
    }, [filtered, loading, locale, title, rj, copy]);

    const columns: ColumnDef<RecurringJournal, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: rj.columns.name,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block font-medium text-gray-900">{row.name}</span>
                            {row.description ? <span className="block truncate text-gray-500">{row.description}</span> : null}
                        </div>
                    );
                },
                size: 220,
            }),
            columnHelper.accessor('frequency', {
                header: rj.columns.frequency,
                cell: (info) => frequencyLabel(info.getValue()),
                size: 100,
            }),
            columnHelper.accessor('next_due_date', {
                header: rj.columns.nextDue,
                cell: (info) => formatDate(info.getValue(), locale),
                size: 110,
            }),
            columnHelper.accessor((row) => row.last_run_date ?? '', {
                id: 'last_run_date',
                header: rj.columns.lastRun,
                cell: (info) => (info.getValue() ? formatDate(info.getValue(), locale) : '—'),
                size: 110,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => templateAccountNames(row.lines).join(', '), {
                id: 'lines',
                header: copy.common.lines,
                enableSorting: false,
                cell: (info) => <TemplateLinesCell lines={info.row.original.lines} />,
                size: 260,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => templateAmount(row.lines), {
                id: 'amount',
                header: copy.common.amountPerRun,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor(statusOf, {
                id: 'status',
                header: rj.columns.status,
                cell: (info) => info.getValue() === 'active'
                    ? <StatusBadge tone="success">{rj.active}</StatusBadge>
                    : <StatusBadge tone="neutral">{rj.inactive}</StatusBadge>,
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: rj.columns.actions,
                cell: ({ row }) => {
                    const template = row.original;
                    const busy = posting === template.id;
                    return (
                        <RowActions>
                            <RowActionButton
                                icon={<Play />}
                                label={busy ? rj.posting : rj.postNow}
                                intent="success"
                                disabled={busy || !template.is_active}
                                onClick={() => void handlePost(template)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 70,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, rj, copy, locale, posting],
    );

    const canSave = Boolean(form.name && form.nextDueDate && totals.balanced && totals.debit > 0);

    return (
        <AccountingPageShell>
            <PageHeader
                title={title}
                subtitle={rj.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    title,
                    'accounting',
                )}
                actions={(
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                        {rj.newTemplate}
                    </Button>
                )}
            />

            {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

            <DataTable<RecurringJournal>
                tableId="accounting-recurring-journals"
                columns={columns}
                data={filtered}
                title={title}
                isLoading={loading}
                emptyMessage={copy.recurringJournals.emptyMessage}
                emptyIcon={<Repeat className="w-10 h-10 text-gray-200" />}
                searchPlaceholder={copy.recurringJournals.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {showCreate && (
                <ModalShell size="lg" onBackdropClick={closeCreate}>
                    <ModalHeader
                        title={copy.recurringJournals.formTitle}
                        onClose={closeCreate}
                        closeLabel={t.common.close}
                    />
                    <div className="p-4 space-y-4 overflow-y-auto">
                        {formError ? <Alert tone="danger">{formError}</Alert> : null}
                        <FormGrid>
                            <FormGrid.Full>
                                <Field label={copy.common.templateName} htmlFor={`${formId}-name`} required>
                                    <Input
                                        id={`${formId}-name`}
                                        value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                        placeholder={copy.recurringVouchers.namePlaceholder}
                                        autoFocus
                                    />
                                </Field>
                            </FormGrid.Full>
                            <Field label={rj.frequency} htmlFor={`${formId}-frequency`}>
                                <Select
                                    id={`${formId}-frequency`}
                                    value={form.frequency}
                                    onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                                >
                                    {FREQUENCIES.map((value) => (
                                        <option key={value} value={value}>{copy.common.frequencies[value]}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={rj.nextDueDate} htmlFor={`${formId}-next`} required>
                                <Input
                                    id={`${formId}-next`}
                                    type="date"
                                    value={form.nextDueDate}
                                    onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))}
                                />
                            </Field>
                            <Field label={t.accountingShared.description} htmlFor={`${formId}-description`}>
                                <Input
                                    id={`${formId}-description`}
                                    value={form.description}
                                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                />
                            </Field>
                        </FormGrid>
                        <TemplateLinesEditor accounts={accounts} lines={lines} onChange={setLines} />
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeCreate} disabled={creating}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={() => void handleCreate()} loading={creating} disabled={!canSave || creating}>
                            {creating ? copy.common.saving : copy.common.saveTemplate}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

        </AccountingPageShell>
    );
}
