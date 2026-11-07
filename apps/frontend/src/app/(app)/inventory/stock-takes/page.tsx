'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ClipboardCheck, FolderOpen, Hash, Plus } from 'lucide-react';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { warehouseLabel } from '@/lib/warehouse-label';
import { STOCK_TAKES_FIELD_HELP, STOCK_TAKES_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { BranchFilter, Button, Checkbox, Field, Input, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

interface StockTakeSession {
    id: string;
    session_number: string;
    status: string;
    created_at: string;
    warehouse?: { name: string } | null;
    summary?: { countedLines: number; totalLines: number; discrepantLines: number };
}

const OPEN_STATUSES = new Set(['DRAFT', 'COUNTING', 'REVIEW']);

const STATUS_TONE: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    COUNTING: 'info',
    REVIEW: 'warning',
    POSTED: 'success',
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<StockTakeSession>();

export default function StockTakesPage() {
    const { t, locale } = useI18n();
    const copy = t.inventoryStockTakes;
    const listUi = copy.listUi;
    const branch = useBranchScope();
    const [sessions, setSessions] = useState<StockTakeSession[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ warehouseId: '', notes: '', startImmediately: true });
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    // The new-session form's warehouses belong to the header branch, so they
    // load once; the list follows the branch filter.
    useEffect(() => {
        void loadWarehouses();
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadSessions();
    }, [createdRange, branch.ready, branch.apiStoreId]);

    const loadSessions = async () => {
        setLoading(true);
        try {
            const data = await api.getStockTakes({ ...applyCreatedRangeQuery(createdRange), storeId: branch.apiStoreId });
            setSessions(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load stock takes', error);
        } finally {
            setLoading(false);
        }
    };

    const loadWarehouses = async () => {
        try {
            const data = await api.getInventoryWarehouses();
            setWarehouses(data.filter((warehouse: any) => warehouse.is_active));
        } catch (error) {
            console.error('Failed to load warehouses', error);
        }
    };

    const openForm = () => {
        setForm({ warehouseId: '', notes: '', startImmediately: true });
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.warehouseId) return;
        setSaving(true);
        try {
            await api.createStockTake(form);
            toast.success(copy.sessionCreated);
            setForm({ warehouseId: '', notes: '', startImmediately: true });
            setFormOpen(false);
            await loadSessions();
        } catch (error: any) {
            toast.error(error.message || copy.createFailed);
        } finally {
            setSaving(false);
        }
    };

    const statusLabel = (status: string) =>
        copy.statuses[status.toLowerCase() as keyof typeof copy.statuses] ?? status;

    const columns: ColumnDef<StockTakeSession, any>[] = useMemo(
        () => [
            columnHelper.accessor('session_number', { header: copy.columns.sessionNumber, size: 150 }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', { id: 'warehouse', header: copy.columns.warehouse, size: 180 }),
            columnHelper.accessor('status', {
                header: copy.columns.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue()] ?? 'neutral'}>
                        {statusLabel(info.getValue())}
                    </StatusBadge>
                ),
                size: 140,
            }),
            columnHelper.accessor((row) => `${row.summary?.countedLines ?? 0}/${row.summary?.totalLines ?? 0}`, {
                id: 'progress',
                header: copy.columns.progress,
                size: 120,
            }),
            columnHelper.accessor((row) => row.summary?.discrepantLines ?? 0, {
                id: 'discrepancies',
                header: copy.columns.discrepancies,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 120,
                meta: { align: 'end' },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
            columnHelper.display({
                id: 'actions',
                header: copy.columns.actions,
                cell: (info) => (
                    <Link
                        href={`/inventory/stock-takes/${info.row.original.id}`}
                        className="text-sm font-bold text-blue-700 hover:text-blue-900"
                    >
                        {copy.columns.open}
                    </Link>
                ),
                size: 100,
            }),
        ],
        [t, copy],
    );

    const filters = useMemo<ListFilter[]>(
        () => [{ id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true }],
        [createdRange],
    );

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const open = sessions.filter((session) => OPEN_STATUSES.has(session.status)).length;
        const discrepant = sessions.filter((session) => (session.summary?.discrepantLines ?? 0) > 0).length;
        const items: ListStat[] = [
            { id: 'sessions', icon: <Hash aria-hidden />, label: listUi.sessions, value: n(sessions.length) },
            { id: 'open', icon: <FolderOpen aria-hidden />, label: listUi.open, value: n(open) },
            {
                id: 'discrepant',
                icon: <AlertTriangle aria-hidden />,
                label: listUi.discrepant,
                value: n(discrepant),
                tone: discrepant > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [sessions, loading, locale, listUi]);

    return (
        <PageShell>
                <PageHeader
                    title={(
                        <span className="inline-flex items-center gap-2">
                            {copy.title}
                            <HelpTooltip text={STOCK_TAKES_FIELD_HELP.page} wide />
                        </span>
                    )}
                    subtitle={copy.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        copy.title,
                        'inventory',
                    )}
                    actions={(
                        <>
                            <BranchFilter scope={branch} />
                            <Button onClick={openForm} icon={<Plus className="w-4 h-4" />}>
                                {copy.newSession}
                            </Button>
                        </>
                    )}
                />

                <ContextualHelpPanel {...STOCK_TAKES_HELP} />

                <DataTable<StockTakeSession>
                    tableId="inventory-stock-takes"
                    columns={columns}
                    data={sessions}
                    title={copy.sessionsTitle}
                    isLoading={loading}
                    emptyMessage={copy.emptyMessage}
                    emptyIcon={<ClipboardCheck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={copy.searchPlaceholder}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                />

                {formOpen ? (
                    <ModalShell size="md" onBackdropClick={closeForm}>
                        <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col" noValidate>
                            <ModalHeader
                                title={(
                                    <span className="inline-flex items-center gap-2">
                                        <ClipboardCheck className="w-5 h-5 text-blue-600" />
                                        {copy.newSession}
                                    </span>
                                )}
                                onClose={closeForm}
                                closeLabel={t.common.close}
                            />
                            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                                <Field
                                    label={(
                                        <span className="inline-flex items-center gap-1.5">
                                            {copy.warehouse}
                                            <HelpTooltip text={STOCK_TAKES_FIELD_HELP.warehouse} side="top" />
                                        </span>
                                    )}
                                    required
                                    htmlFor="stock-take-warehouse"
                                >
                                    <Select
                                        id="stock-take-warehouse"
                                        required
                                        value={form.warehouseId}
                                        onChange={(e) => setForm((current) => ({ ...current, warehouseId: e.target.value }))}
                                    >
                                        <option value="">{copy.selectWarehouse}</option>
                                        {warehouses.map((warehouse) => (
                                            <option key={warehouse.id} value={warehouse.id}>
                                                {warehouseLabel(warehouse, warehouses)}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label={copy.sessionNotes} htmlFor="stock-take-notes">
                                    <Input
                                        id="stock-take-notes"
                                        value={form.notes}
                                        onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                                        placeholder={copy.sessionNotes}
                                    />
                                </Field>
                                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                                    <Checkbox
                                        checked={form.startImmediately}
                                        onChange={(e) => setForm((current) => ({ ...current, startImmediately: e.target.checked }))}
                                    />
                                    <span className="inline-flex items-center gap-1.5">
                                        {copy.startImmediately}
                                        <HelpTooltip text={STOCK_TAKES_FIELD_HELP.startImmediately} side="top" />
                                    </span>
                                </label>
                            </div>
                            <ModalFooter>
                                <Button variant="secondary" onClick={closeForm} disabled={saving}>
                                    {t.common.cancel}
                                </Button>
                                <Button type="submit" loading={saving} icon={<Plus className="w-4 h-4" />}>
                                    {copy.createSession}
                                </Button>
                            </ModalFooter>
                        </form>
                    </ModalShell>
                ) : null}
    </PageShell>
    );
}
