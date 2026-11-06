'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Users, Plus, Eye, Pencil, BookOpen, RefreshCw, Crown, AlertTriangle, Upload, UserPlus, HandCoins, Wallet } from 'lucide-react';
import { api, type CustomerListFilterParams, type CustomerListSummary } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import CustomerFormModal from './CustomerFormModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListFilterOption, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { BranchFilter, PageShell, Button, Field, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { useServerList } from '@/hooks/useServerList';
import { useListSummary } from '@/hooks/useListSummary';
import { useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { routes } from '@/lib/routes';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'customer_code', label: 'Customer Code', required: false },
    { key: 'name', label: 'Name', required: true },
    { key: 'owner_name', label: 'Owner Name', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'customer_group_name', label: 'Customer Group', required: false },
    // A branch's code or name; empty rows go to the branch picked for the file.
    { key: 'branch', label: 'Branch', required: false },
];

interface Customer {
    id: string;
    name: string;
    phone?: string | null;
    owner_name?: string | null;
    customer_code?: string | null;
    customer_type?: string | null;
    email?: string | null;
    address?: string | null;
    profile_pic_url?: string | null;
    customer_group_id?: string | null;
    territory_id?: string | null;
    store_id?: string | null;
    store?: { id: string; name: string } | null;
    credit_limit?: string | number | null;
    default_discount_pct?: string | number | null;
    birthday?: string | null;
    total_spent?: string | number | null;
    segment_category?: string | null;
    loyalty_points?: number | null;
    due_balance?: string | number | null;
    created_at: string;
    customerGroup?: { name: string } | null;
    territory?: { name: string } | null;
    /** Newest completed sale to this customer; null when they have none. */
    last_sale?: {
        id: string;
        serial_number: string;
        sale_date: string;
        total_amount: number | string;
    } | null;
}

/** The segments the nightly segmentation writes, as `segment_category` holds them. */
const SEGMENTS = ['New', 'Regular', 'VIP', 'At-Risk'] as const;
const SEGMENT_KEYS: Record<string, 'new' | 'regular' | 'vip' | 'atRisk'> = {
    New: 'new',
    Regular: 'regular',
    VIP: 'vip',
    'At-Risk': 'atRisk',
};

const segmentTones: Record<string, StatusBadgeTone> = {
    VIP: 'success',
    'At-Risk': 'danger',
    New: 'info',
};

/** The group and territory chips' value for a customer in none. */
const NONE = 'none';

const columnHelper = createColumnHelper<Customer>();

export default function CustomersPage() {
    const { t, locale } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Customer | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importBranch, setImportBranch] = useState('');
    const [runningSegmentation, setRunningSegmentation] = useState(false);
    // The tenant admin's Sales Settings switch: adds each customer's credit
    // limit under their due. Off until it reads true, so the limit never
    // flashes in for a shop that has it off.
    const [showCredit, setShowCredit] = useState(false);
    // Customers are company-level, so a member who may see every branch starts
    // on all of them. A limited member sees only their branches' customers —
    // the server enforces that whatever is sent; see customer-visibility.ts.
    const branch = useBranchScope({ startOnAll: true });

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            api.getSalesSettings()
                .then((s: { show_customer_credit?: boolean }) => { if (!cancelled) setShowCredit(Boolean(s?.show_customer_credit)); })
                .catch(() => { /* keep the column hidden if settings cannot be read */ });
        };
        load();
        window.addEventListener('erp71:sales-settings-updated', load);
        return () => {
            cancelled = true;
            window.removeEventListener('erp71:sales-settings-updated', load);
        };
    }, []);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [groupIds, setGroupIds] = useState<string[]>([]);
    const [territoryIds, setTerritoryIds] = useState<string[]>([]);
    const [segments, setSegments] = useState<string[]>([]);
    const [segmentExclude, setSegmentExclude] = useState(false);
    const [dueFilter, setDueFilter] = useState<NumberCondition | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [customerTypes, setCustomerTypes] = useState<string[]>([]);
    const [spentFilter, setSpentFilter] = useState<NumberCondition | null>(null);
    const [pointsFilter, setPointsFilter] = useState<NumberCondition | null>(null);
    const [groupOptions, setGroupOptions] = useState<ListFilterOption[]>([]);
    const [territoryOptions, setTerritoryOptions] = useState<ListFilterOption[]>([]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // The group and territory chips offer the tenant's own; both lists are short.
    useEffect(() => {
        const named = (rows: unknown) =>
            (Array.isArray(rows) ? rows : []).map((row: { id: string; name: string; parent?: { name: string } | null }) => ({
                value: row.id,
                label: row.parent ? `${row.parent.name} › ${row.name}` : row.name,
            }));
        api.getCustomerGroups().then((rows: unknown) => setGroupOptions(named(rows))).catch(() => { /* chip offers "No group" alone */ });
        api.getTerritories().then((rows: unknown) => setTerritoryOptions(named(rows))).catch(() => { /* chip offers "No territory" alone */ });
    }, []);

    // Sent alike to the list and to the strip, so the figures describe the
    // customers listed rather than the page on screen.
    const filterParams = useMemo<CustomerListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            groupIds,
            territoryIds,
            segments,
            segmentExclude,
            due: dueFilter,
            customerTypes,
            totalSpent: spentFilter,
            points: pointsFilter,
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
        }),
        [debouncedSearch, groupIds, territoryIds, segments, segmentExclude, dueFilter, customerTypes, spentFilter, pointsFilter, createdRange, branch.apiStoreId],
    );

    const {
        items: customers,
        loading,
        error: listError,
        serverPagination,
        reload: loadCustomers,
    } = useServerList<Customer>({
        tableId: 'customers',
        fetch: (p) => api.getCustomersPaged({ ...filterParams, ...p }),
        deps: [filterParams],
        enabled: branch.ready,
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    const { summary, loading: summaryLoading, reload: reloadSummary } = useListSummary<
        CustomerListFilterParams,
        CustomerListSummary
    >({ fetch: api.getCustomersListSummary, params: filterParams, enabled: branch.ready });

    const refresh = async () => {
        reloadSummary();
        await loadCustomers();
    };

    const handleRunSegmentation = async () => {
        setRunningSegmentation(true);
        try {
            await api.runCustomerSegmentation();
            await refresh();
        } catch (error) {
            console.error('Failed to run segmentation', error);
        } finally {
            setRunningSegmentation(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setIsModalOpen(true);
    };

    const openEdit = (customer: Customer) => {
        setEditTarget(customer);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditTarget(null);
    };

    const handleSaveCustomer = async (data: any) => {
        if (editTarget) {
            await api.updateCustomer(editTarget.id, data);
        } else {
            await api.createCustomer(data);
        }
        await refresh();
    };

    const columns: ColumnDef<Customer, any>[] = useMemo(
        () => [
            columnHelper.accessor('customer_code', {
                header: t.customers.columns.code,
                cell: (info) => info.getValue() || '-',
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('name', {
                header: t.customers.columns.customer,
                cell: (info) => {
                    const customer = info.row.original;
                    return (
                        <>
                            <span className="block">{customer.name}</span>
                            {customer.phone && <span className="block text-gray-500">{customer.phone}</span>}
                        </>
                    );
                },
                size: 190,
            }),
            columnHelper.accessor('owner_name', {
                header: t.customers.columns.ownerName,
                cell: (info) => info.getValue() || '-',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('customer_type', {
                header: t.customers.columns.type,
                cell: (info) => {
                    const organization = info.getValue() === 'ORGANIZATION';
                    return (
                        <StatusBadge tone={organization ? 'info' : 'neutral'}>
                            {organization ? t.customers.modal.organization : t.customers.modal.individual}
                        </StatusBadge>
                    );
                },
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.customerGroup?.name ?? '', {
                id: 'group',
                header: t.customers.columns.group,
                cell: (info) => info.getValue() || '-',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.territory?.name ?? '', {
                id: 'territory',
                header: t.customers.columns.territory,
                cell: (info) => info.getValue() || '-',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_spent', {
                header: t.customers.columns.totalSpent,
                cell: (info) => formatBDT(Number(info.getValue() || 0), { locale }),
                sortingFn: (a, b) => Number(a.getValue('total_spent') || 0) - Number(b.getValue('total_spent') || 0),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.last_sale?.sale_date ?? '', {
                id: 'last_sale',
                header: t.customers.columns.lastSale,
                // Computed per page on the server, not a customer column, so
                // it cannot be sorted there.
                enableSorting: false,
                cell: (info) => {
                    const sale = info.row.original.last_sale;
                    if (!sale) return <span className="text-gray-400">{t.customers.columns.noSales}</span>;
                    return (
                        <>
                            <span className="block">
                                {formatDate(sale.sale_date, locale)} · {formatBDT(Number(sale.total_amount || 0), { locale })}
                            </span>
                            <Link
                                href={routes.sales.detail(sale.id)}
                                className="block text-blue-600 hover:underline"
                            >
                                {sale.serial_number}
                            </Link>
                        </>
                    );
                },
                size: 170,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('due_balance', {
                header: t.customers.columns.due,
                cell: (info) => {
                    const due = Number(info.getValue() || 0);
                    const limit = info.row.original.credit_limit;
                    return (
                        <>
                            <span className={`block ${due > 0 ? 'text-amber-700' : 'text-gray-500'}`}>{formatBDT(due, { locale })}</span>
                            {showCredit && limit != null ? (
                                <span className="block text-gray-400">/ {formatBDT(Number(limit), { locale })}</span>
                            ) : null}
                        </>
                    );
                },
                sortingFn: (a, b) => Number(a.original.due_balance || 0) - Number(b.original.due_balance || 0),
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('loyalty_points', {
                header: t.customers.columns.points,
                cell: (info) => {
                    const pts = info.getValue();
                    if (pts == null) return <span className="text-gray-400">—</span>;
                    return `${Number(pts).toLocaleString()} ${t.customers.columns.pointsSuffix}`;
                },
                sortingFn: (a, b) => Number(a.getValue('loyalty_points') || 0) - Number(b.getValue('loyalty_points') || 0),
                size: 110,
                meta: { hideOnMobile: true, align: 'end' },
            }),
            columnHelper.accessor('segment_category', {
                header: t.customers.columns.segment,
                cell: (info) => {
                    // A customer the segmentation has not reached yet reads as Regular, its default.
                    const segment = info.getValue() || 'Regular';
                    const key = SEGMENT_KEYS[segment];
                    return (
                        <StatusBadge tone={segmentTones[segment] ?? 'neutral'}>
                            {key ? t.salesMasterLists.customers.segments[key] : segment}
                        </StatusBadge>
                    );
                },
                size: 130,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => (
                    <RowActions>
                        <RowActionButton icon={<Eye />} label={t.common.view} href={`/sales/customers/${info.row.original.id}`} />
                        <RowActionButton
                            icon={<BookOpen />}
                            label={t.customers.viewLedger}
                            href={routes.sales.customerLedgerFor(info.row.original.id)}
                        />
                        <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(info.row.original)} />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, locale, showCredit],
    );

    // Each goes to the server with the page query and the strip's; filtering
    // the loaded rows would only ever narrow the current page.
    const filters = useMemo<ListFilter[]>(() => {
        const copy = t.salesMasterLists.customers;
        return [
            {
                id: 'group',
                type: 'multi-select',
                label: t.customers.columns.group,
                value: groupIds,
                onChange: setGroupIds,
                options: [{ value: NONE, label: copy.noGroup }, ...groupOptions],
            },
            {
                id: 'territory',
                type: 'multi-select',
                label: t.customers.columns.territory,
                value: territoryIds,
                onChange: setTerritoryIds,
                options: [{ value: NONE, label: copy.noTerritory }, ...territoryOptions],
            },
            {
                id: 'segment',
                type: 'multi-select',
                label: t.customers.columns.segment,
                value: segments,
                onChange: setSegments,
                exclude: { value: segmentExclude, onChange: setSegmentExclude },
                options: SEGMENTS.map((segment) => ({ value: segment, label: copy.segments[SEGMENT_KEYS[segment]] })),
            },
            {
                id: 'due',
                type: 'number',
                label: t.customers.columns.due,
                value: dueFilter,
                onChange: setDueFilter,
                money: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true },
            {
                id: 'customerType',
                type: 'multi-select',
                label: t.customers.columns.type,
                value: customerTypes,
                onChange: setCustomerTypes,
                options: [
                    { value: 'INDIVIDUAL', label: t.customers.modal.individual },
                    { value: 'ORGANIZATION', label: t.customers.modal.organization },
                ],
                more: true,
            },
            {
                id: 'totalSpent',
                type: 'number',
                label: t.customers.columns.totalSpent,
                value: spentFilter,
                onChange: setSpentFilter,
                money: true,
                more: true,
            },
            {
                id: 'points',
                type: 'number',
                label: t.customers.columns.points,
                value: pointsFilter,
                onChange: setPointsFilter,
                more: true,
            },
        ];
    }, [t, groupIds, groupOptions, territoryIds, territoryOptions, segments, segmentExclude, dueFilter, createdRange, customerTypes, spentFilter, pointsFilter]);

    const stats = useMemo(() => {
        const copy = t.salesMasterLists.customers;
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const count = (value: number) => value.toLocaleString(locale);
        const dash = '—';
        const items: ListStat[] = [
            { id: 'count', icon: <Users aria-hidden />, label: copy.stats.customers, value: summary ? count(summary.count) : dash },
            {
                id: 'new',
                icon: <UserPlus aria-hidden />,
                label: copy.stats.newThisMonth,
                value: summary ? count(summary.newThisMonth) : dash,
            },
            {
                id: 'withDue',
                icon: <HandCoins aria-hidden />,
                label: copy.stats.withDue,
                value: summary ? count(summary.withDue) : dash,
                tone: summary?.withDue ? 'warning' : 'default',
            },
            {
                id: 'receivable',
                icon: <Wallet aria-hidden />,
                label: copy.stats.receivable,
                value: summary ? money(summary.receivable) : dash,
                tone: summary?.receivable ? 'warning' : 'default',
            },
            { id: 'vip', icon: <Crown aria-hidden />, label: copy.stats.vip, value: summary ? count(summary.vip) : dash },
            {
                id: 'atRisk',
                icon: <AlertTriangle aria-hidden />,
                label: copy.stats.atRisk,
                value: summary ? count(summary.atRisk) : dash,
                tone: summary?.atRisk ? 'danger' : 'default',
            },
        ];
        return { items, loading: summaryLoading && !summary, label: copy.statsLabel };
    }, [summary, summaryLoading, locale, t]);

    return (
        <PageShell>
                <PageHeader
                    title={t.customers.title}
                    subtitle={t.customers.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        t.customers.title,
                        'sales',
                    )}
                    actions={
                        <>
                            <BranchFilter scope={branch} />
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleRunSegmentation}
                                disabled={runningSegmentation}
                                title={t.customers.runSegmentationTitle}
                                icon={<RefreshCw className={`w-4 h-4 ${runningSegmentation ? 'animate-spin' : ''}`} />}
                            >
                                {runningSegmentation ? t.customers.running : t.customers.runSegmentation}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => { setImportBranch(branch.headerBranchId ?? ''); setImportOpen(true); }}
                                icon={<Upload className="w-4 h-4" />}
                            >
                                {t.common.import}
                            </Button>
                            <Button type="button" variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                                {t.customers.newCustomer}
                            </Button>
                        </>
                    }
                />

                <CustomerFormModal
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    onSave={handleSaveCustomer}
                    customer={editTarget}
                    branches={branch.hidden ? undefined : branch.branches}
                    canSetBranch={branch.canSeeAll}
                    defaultBranchId={branch.headerBranchId}
                />

                <ImportDialog
                    open={importOpen}
                    onClose={() => setImportOpen(false)}
                    entityLabel="Customers"
                    fields={IMPORT_FIELDS}
                    importFn={(rows, mode) => api.importCustomers(rows, mode, importBranch || undefined)}
                    options={branch.hidden ? undefined : (
                        <Field label={t.branchParties.importBranchLabel} hint={t.branchParties.importBranchHint} htmlFor="customer-import-branch">
                            <Select id="customer-import-branch" value={importBranch} onChange={(e) => setImportBranch(e.target.value)} className="w-full">
                                {branch.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </Select>
                        </Field>
                    )}
                    onSuccess={() => void refresh()}
                />
                <DataTable<Customer>
                    tableId="customers"
                    columns={columns}
                    data={customers}
                    title={t.customers.title}
                    isLoading={loading}
                    emptyMessage={t.customers.emptyMessage}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.customers.searchPlaceholder}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                    serverPagination={serverPagination}
                />
            
        </PageShell>
    );
}