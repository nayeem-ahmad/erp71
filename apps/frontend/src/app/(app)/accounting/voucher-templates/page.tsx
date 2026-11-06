'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BookOpen, FilePlus2, Layers, ListOrdered, Plus, Trash2, Wallet } from 'lucide-react';
import { VoucherType } from '@erp71/shared-types';
import { AccountingPageShell } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, ConfirmDialog, Field, FormGrid, Input, Select } from '@/components/ui';
import type { AccountOption } from '@/components/accounting/AccountSelect';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import type { NumberCondition } from '@/lib/number-condition';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { voucherTypeLabel, voucherTypeOptions } from '../vouchers/voucher-list-filters';
import {
    TemplateLinesCell,
    TemplateLinesEditor,
    emptyLines,
    linePayload,
    templateAccountNames,
    templateAmount,
    type StoredTemplateLine,
    type TemplateLineDraft,
} from './template-ui';

interface VoucherTemplate {
    id: string;
    name: string;
    description?: string | null;
    voucher_type: string;
    lines: StoredTemplateLine[];
}

type FormState = { name: string; description: string; voucherType: string };

const EMPTY_FORM: FormState = { name: '', description: '', voucherType: VoucherType.JOURNAL };

const columnHelper = createColumnHelper<VoucherTemplate>();

export default function VoucherTemplatesPage() {
    const { t, locale, fmt } = useI18n();
    const copy = t.accountingVouchersUi;
    const vt = copy.voucherTemplates;
    const title = t.accounting.links.voucherTemplates.title;
    const formId = useId();
    const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [lines, setLines] = useState<TemplateLineDraft[]>(emptyLines);
    const [formError, setFormError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<VoucherTemplate | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [search, setSearch] = useState('');
    const [types, setTypes] = useState<string[]>([]);
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
            const data = await api.listVoucherTemplates();
            setTemplates(Array.isArray(data) ? data : data.data ?? []);
        } catch (e: any) {
            setLoadError(e?.message ?? t.accountingShared.loadFailed);
        } finally {
            setLoading(false);
        }
    };

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
            await api.createVoucherTemplate({
                name: form.name,
                description: form.description || undefined,
                voucherType: form.voucherType,
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

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteVoucherTemplate(deleteTarget.id);
            toast.success(t.common.deleted);
            setDeleteTarget(null);
            await load();
        } catch (e: any) {
            toast.error(e?.message ?? t.common.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const filtered = useMemo(
        () => templates.filter((row) => {
            if (!matchesAnyOf(types, row.voucher_type)) return false;
            if (!matchesNumberCondition(templateAmount(row.lines), amount)) return false;
            return matchesSearch(search, row.name, row.description, ...templateAccountNames(row.lines));
        }),
        [templates, types, amount, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'voucherType',
            type: 'multi-select',
            label: t.accountingShared.type,
            value: types,
            onChange: setTypes,
            options: voucherTypeOptions(t),
        },
        {
            id: 'amount',
            type: 'number',
            label: t.accountingShared.amount,
            value: amount,
            onChange: setAmount,
            money: true,
        },
    ], [t, types, amount]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const lineCount = filtered.reduce((sum, row) => sum + (row.lines?.length ?? 0), 0);
        const accountsUsed = new Set(filtered.flatMap((row) => templateAccountNames(row.lines))).size;
        const items: ListStat[] = [
            { id: 'count', icon: <Layers aria-hidden />, label: title, value: n(filtered.length) },
            { id: 'lines', icon: <ListOrdered aria-hidden />, label: copy.common.lines, value: n(lineCount) },
            { id: 'accounts', icon: <BookOpen aria-hidden />, label: copy.common.accounts, value: n(accountsUsed) },
            {
                id: 'amount',
                icon: <Wallet aria-hidden />,
                label: t.accountingShared.amount,
                value: formatBDT(
                    filtered.reduce((sum, row) => sum + templateAmount(row.lines), 0),
                    { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 },
                ),
            },
        ];
        return { items, loading, label: vt.statsLabel };
    }, [filtered, loading, locale, title, t, copy, vt]);

    const columns: ColumnDef<VoucherTemplate, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.recurringJournals.columns.name,
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
            columnHelper.accessor('voucher_type', {
                header: t.accountingShared.type,
                cell: (info) => voucherTypeLabel(t, info.getValue()),
                size: 130,
            }),
            columnHelper.accessor((row) => templateAccountNames(row.lines).join(', '), {
                id: 'lines',
                header: copy.common.lines,
                enableSorting: false,
                cell: (info) => <TemplateLinesCell lines={info.row.original.lines} />,
                size: 300,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => templateAmount(row.lines), {
                id: 'amount',
                header: t.accountingShared.amount,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton
                            icon={<FilePlus2 />}
                            label={vt.useTemplate}
                            href={`${routes.accounting.voucherEntry}?templateId=${row.original.id}`}
                        />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={vt.deleteLabel}
                            intent="danger"
                            onClick={() => setDeleteTarget(row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t, copy, vt, locale],
    );

    const canSave = Boolean(form.name && lines.filter((line) => line.accountId).length >= 2);

    return (
        <AccountingPageShell>
            <PageHeader
                title={title}
                subtitle={t.accounting.links.voucherTemplates.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    title,
                    'accounting',
                )}
                actions={(
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                        {t.recurringJournals.newTemplate}
                    </Button>
                )}
            />

            {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

            <DataTable<VoucherTemplate>
                tableId="accounting-voucher-templates"
                columns={columns}
                data={filtered}
                title={title}
                isLoading={loading}
                emptyMessage={vt.emptyMessage}
                emptyIcon={<Layers className="w-10 h-10 text-gray-200" />}
                searchPlaceholder={vt.searchPlaceholder}
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
                    <ModalHeader title={vt.formTitle} onClose={closeCreate} closeLabel={t.common.close} />
                    <div className="p-4 space-y-4 overflow-y-auto">
                        {formError ? <Alert tone="danger">{formError}</Alert> : null}
                        <FormGrid>
                            <Field label={copy.common.templateName} htmlFor={`${formId}-name`} required>
                                <Input
                                    id={`${formId}-name`}
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    placeholder={vt.namePlaceholder}
                                    autoFocus
                                />
                            </Field>
                            <Field label={copy.common.voucherType} htmlFor={`${formId}-type`}>
                                <Select
                                    id={`${formId}-type`}
                                    value={form.voucherType}
                                    onChange={(e) => setForm((f) => ({ ...f, voucherType: e.target.value }))}
                                >
                                    {voucherTypeOptions(t).map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </Select>
                            </Field>
                            <FormGrid.Full>
                                <Field label={t.accountingShared.description} htmlFor={`${formId}-description`}>
                                    <Input
                                        id={`${formId}-description`}
                                        value={form.description}
                                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                    />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>
                        {/* A template may leave the amounts for the voucher it starts. */}
                        <TemplateLinesEditor accounts={accounts} lines={lines} onChange={setLines} showBalance={false} />
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

            <ConfirmDialog
                open={deleteTarget !== null}
                title={vt.deleteTitle}
                prompt={fmt(vt.deleteBody, { name: deleteTarget?.name ?? '' })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!deleting) setDeleteTarget(null); }}
            />
        </AccountingPageShell>
    );
}
