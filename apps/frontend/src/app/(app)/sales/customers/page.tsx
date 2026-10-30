'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye, Pencil, BookOpen, RefreshCw, Crown, AlertTriangle, UserCheck, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import CustomerFormModal from './CustomerFormModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { BranchFilter, PageShell, Button, Field, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { useServerList } from '@/hooks/useServerList';
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
}

interface SegmentBreakdown {
    segment: string;
    count: number;
    percentage: number;
}

interface SegmentStats {
    total: number;
    breakdown: SegmentBreakdown[];
}

const segmentTones: Record<string, StatusBadgeTone> = {
    VIP: 'success',
    'AT-RISK': 'danger',
    'At-Risk': 'danger',
    NEW: 'info',
    LOYAL: 'warning',
};

const columnHelper = createColumnHelper<Customer>();

export default function CustomersPage() {
    const { t, locale } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Customer | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importBranch, setImportBranch] = useState('');
    const [segmentStats, setSegmentStats] = useState<SegmentStats | null>(null);
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

    const segmentCardStyle: Record<string, { bg: string; text: string; bar: string; icon: React.ReactNode }> = useMemo(() => ({
        VIP: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', icon: <Crown className="w-4 h-4 text-emerald-500" /> },
        'At-Risk': { bg: 'bg-danger-light border-red-200', text: 'text-danger-text', bar: 'bg-danger', icon: <AlertTriangle className="w-4 h-4 text-danger" /> },
        Regular: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-700', bar: 'bg-gray-400', icon: <UserCheck className="w-4 h-4 text-gray-400" /> },
    }), []);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [segment, setSegment] = useState<string | null>(null);
    const [customerType, setCustomerType] = useState<string | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const {
        items: customers,
        loading,
        error: listError,
        serverPagination,
        reload: loadCustomers,
    } = useServerList<Customer>({
        tableId: 'customers',
        fetch: (p) => api.getCustomersPaged({
            search: debouncedSearch || undefined,
            segment: segment || undefined,
            customerType: customerType || undefined,
            ...applyCreatedRangeQuery(createdRange),
            storeId: branch.apiStoreId,
            ...p,
        }),
        deps: [debouncedSearch, segment, customerType, createdRange, branch.apiStoreId],
        enabled: branch.ready,
        columnFilters: true,
    });
    useBranchForbiddenReset(listError, branch, t.dashboardLayout.branchFilterForbidden);

    useEffect(() => {
        if (branch.ready) loadSegmentStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    const loadSegmentStats = async () => {
        try {
            const stats = await api.getCustomerSegmentStats(branch.apiStoreId);
            setSegmentStats(stats);
        } catch (error) {
            console.error('Failed to load segment stats', error);
        }
    };

    const handleRunSegmentation = async () => {
        setRunningSegmentation(true);
        try {
            await api.runCustomerSegmentation();
            await Promise.all([loadCustomers(), loadSegmentStats()]);
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
        await loadCustomers();
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
                // The toolbar select sends an exact type.
                enableColumnFilter: false,
                cell: (info) => {
                    const type = info.getValue() || 'INDIVIDUAL';
                    return <StatusBadge tone={type === 'ORGANIZATION' ? 'info' : 'neutral'}>{type}</StatusBadge>;
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
                    const segment = info.getValue() || 'GENERAL';
                    return <StatusBadge tone={segmentTones[segment] ?? 'neutral'}>{segment}</StatusBadge>;
                },
                size: 130,
                meta: { hideOnMobile: true },
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
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

    // Page-owned: each goes to the server with the page query. Filtering the
    // loaded rows would only ever narrow the current page.
    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'segment',
                type: 'select',
                label: t.customers.columns.segment,
                value: segment,
                onChange: setSegment,
                options: [
                    { value: 'VIP', label: t.customers.filters.vip },
                    { value: 'At-Risk', label: t.customers.filters.atRisk },
                ],
            },
            {
                id: 'customerType',
                type: 'select',
                label: t.customers.columns.type,
                value: customerType,
                onChange: setCustomerType,
                options: [
                    { value: 'INDIVIDUAL', label: t.customers.modal.individual },
                    { value: 'ORGANIZATION', label: t.customers.modal.organization },
                ],
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange },
        ],
        [t, segment, customerType, createdRange],
    );

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

                {segmentStats && segmentStats.total > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                        <div className="bg-white border border-gray-100 rounded-lg px-3 py-2.5 shadow-sm">
                            <p className="text-xs font-medium text-gray-500 truncate">{t.customers.totalCustomers}</p>
                            <p className="text-xl font-bold text-gray-900 mt-0.5">{segmentStats.total}</p>
                        </div>
                        {segmentStats.breakdown.map((seg) => {
                            const style = segmentCardStyle[seg.segment] ?? segmentCardStyle['Regular'];
                            return (
                                <div key={seg.segment} className={`border rounded-lg px-3 py-2.5 shadow-sm ${style.bg}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className={`text-xs font-semibold truncate ${style.text}`}>{seg.segment}</p>
                                        {style.icon}
                                    </div>
                                    <div className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
                                        <p className={`text-xl font-bold ${style.text}`}>{seg.count}</p>
                                        <p className={`text-xs font-semibold ${style.text} opacity-70`}>
                                            {formatMessage(t.customers.percentOfTotal, { percent: String(seg.percentage) })}
                                        </p>
                                    </div>
                                    <div className="mt-1.5 bg-white/60 rounded-full h-1 overflow-hidden">
                                        <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${seg.percentage}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

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
                    onSuccess={() => void loadCustomers()}
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
                    viewOptions
                    serverPagination={serverPagination}
                />
            
        </PageShell>
    );
}