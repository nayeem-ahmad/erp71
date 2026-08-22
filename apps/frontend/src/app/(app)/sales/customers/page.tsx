'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye, Pencil, RefreshCw, Crown, AlertTriangle, UserCheck, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import CustomerFormModal from './CustomerFormModal';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, Button, Input } from '@/components/ui';
import { useServerList } from '@/hooks/useServerList';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'customer_code', label: 'Customer Code', required: false },
    { key: 'name', label: 'Name', required: true },
    { key: 'owner_name', label: 'Owner Name', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'customer_group_name', label: 'Customer Group', required: false },
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
    credit_limit?: string | number | null;
    default_discount_pct?: string | number | null;
    birthday?: string | null;
    total_spent?: string | number | null;
    segment_category?: string | null;
    loyalty_points?: number | null;
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

const segmentColors: Record<string, string> = {
    VIP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'AT-RISK': 'bg-danger-light text-danger-text border-red-200',
    'At-Risk': 'bg-danger-light text-danger-text border-red-200',
    NEW: 'bg-blue-50 text-blue-700 border-blue-200',
    LOYAL: 'bg-amber-50 text-amber-700 border-amber-200',
};

const columnHelper = createColumnHelper<Customer>();

export default function CustomersPage() {
    const { t, locale } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Customer | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [segmentStats, setSegmentStats] = useState<SegmentStats | null>(null);
    const [runningSegmentation, setRunningSegmentation] = useState(false);
    const [evaluating, setEvaluating] = useState(false);
    const [evalMessage, setEvalMessage] = useState('');

    const segmentCardStyle: Record<string, { bg: string; text: string; bar: string; icon: React.ReactNode }> = useMemo(() => ({
        VIP: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', icon: <Crown className="w-5 h-5 text-emerald-500" /> },
        'At-Risk': { bg: 'bg-danger-light border-red-200', text: 'text-danger-text', bar: 'bg-danger', icon: <AlertTriangle className="w-5 h-5 text-danger" /> },
        Regular: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-700', bar: 'bg-gray-400', icon: <UserCheck className="w-5 h-5 text-gray-400" /> },
    }), []);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [segment, setSegment] = useState('');
    const [customerType, setCustomerType] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const {
        items: customers,
        loading,
        serverPagination,
        reload: loadCustomers,
    } = useServerList<Customer>({
        tableId: 'customers',
        fetch: (p) => api.getCustomersPaged({
            search: debouncedSearch || undefined,
            segment: segment || undefined,
            customerType: customerType || undefined,
            ...applyCreatedRangeQuery(createdRange),
            ...p,
        }),
        deps: [debouncedSearch, segment, customerType, createdRange],
    });

    useEffect(() => {
        loadSegmentStats();
    }, []);

    const loadSegmentStats = async () => {
        try {
            const stats = await api.getCustomerSegmentStats();
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

    const handleEvaluateSegments = async () => {
        setEvaluating(true);
        setEvalMessage('');
        try {
            const result = await api.evaluateCustomerSegments();
            setEvalMessage(formatMessage(t.customers.segmentationComplete, { count: String(result.updated) }));
            await loadCustomers();
        } catch (error: any) {
            setEvalMessage(error.message || t.customers.evaluateFailed);
        } finally {
            setEvaluating(false);
        }
    };

    const columns: ColumnDef<Customer, any>[] = useMemo(
        () => [
            columnHelper.accessor('customer_code', {
                header: t.customers.columns.code,
                cell: (info) => (
                    <span className="text-sm font-mono text-gray-500">{info.getValue() || '-'}</span>
                ),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('name', {
                header: t.customers.columns.customer,
                cell: (info) => {
                    const customer = info.row.original;
                    return (
                        <div>
                            <span className="block text-sm font-bold text-gray-900">{customer.name}</span>
                            {customer.phone && <span className="block text-xs text-gray-400">{customer.phone}</span>}
                        </div>
                    );
                },
                size: 190,
            }),
            columnHelper.accessor('owner_name', {
                header: t.customers.columns.ownerName,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-700">{info.getValue() || '-'}</span>
                ),
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('customer_type', {
                header: t.customers.columns.type,
                cell: (info) => {
                    const type = info.getValue() || 'INDIVIDUAL';
                    const classes =
                        type === 'ORGANIZATION'
                            ? 'bg-primary-light text-blue-700 border-primary-border'
                            : 'bg-gray-50 text-gray-700 border-gray-200';

                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${classes}`}>
                            {type}
                        </span>
                    );
                },
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.customerGroup?.name ?? '', {
                id: 'group',
                header: t.customers.columns.group,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-700">{info.getValue() || '-'}</span>
                ),
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.territory?.name ?? '', {
                id: 'territory',
                header: t.customers.columns.territory,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-700">{info.getValue() || '-'}</span>
                ),
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_spent', {
                header: t.customers.columns.totalSpent,
                cell: (info) => (
                    <span className="text-sm font-bold text-blue-600">
                        {formatBDT(Number(info.getValue() || 0))}
                    </span>
                ),
                sortingFn: (a, b) => Number(a.getValue('total_spent') || 0) - Number(b.getValue('total_spent') || 0),
                size: 120,
            }),
            columnHelper.accessor('loyalty_points', {
                header: t.customers.columns.points,
                cell: (info) => {
                    const pts = info.getValue();
                    if (pts == null) return <span className="text-sm text-gray-400">—</span>;
                    return (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-xs font-bold text-purple-700">
                            {Number(pts).toLocaleString()} {t.customers.columns.pointsSuffix}
                        </span>
                    );
                },
                sortingFn: (a, b) => Number(a.getValue('loyalty_points') || 0) - Number(b.getValue('loyalty_points') || 0),
                size: 110,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('segment_category', {
                header: t.customers.columns.segment,
                cell: (info) => {
                    const segment = info.getValue() || 'GENERAL';
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${segmentColors[segment] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {segment}
                        </span>
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
                    <div className="flex items-center justify-end space-x-1 rtl:space-x-reverse">
                        <Link
                            href={`/sales/customers/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                            aria-label={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={() => openEdit(info.row.original)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.edit}
                            aria-label={t.common.edit}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t, locale],
    );

    // Server-side equivalents of the old client-side presets: filtering the loaded rows
    // would only ever narrow the current page, hiding matches on every other page.
    const activePreset = segment === 'VIP' ? 'vip'
        : segment === 'At-Risk' ? 'atRisk'
        : customerType === 'ORGANIZATION' ? 'organizations'
        : '';
    const filterPresets = useMemo(
        () => [
            { key: 'vip', label: t.customers.filters.vip, segment: 'VIP', customerType: '' },
            { key: 'atRisk', label: t.customers.filters.atRisk, segment: 'At-Risk', customerType: '' },
            { key: 'organizations', label: t.customers.filters.organizations, segment: '', customerType: 'ORGANIZATION' },
        ],
        [t],
    );

    const applyPreset = (preset: { key: string; segment: string; customerType: string }) => {
        const clearing = activePreset === preset.key;
        setSegment(clearing ? '' : preset.segment);
        setCustomerType(clearing ? '' : preset.customerType);
    };

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
                            <button
                                onClick={handleRunSegmentation}
                                disabled={runningSegmentation}
                                className="flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50"
                                title={t.customers.runSegmentationTitle}
                            >
                                <RefreshCw className={`w-4 h-4 me-2 ${runningSegmentation ? 'animate-spin' : ''}`} />
                                {runningSegmentation ? t.customers.running : t.customers.runSegmentation}
                            </button>
                            <button
                                onClick={() => setImportOpen(true)}
                                className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center transition-all hover:border-blue-300 hover:text-blue-700"
                            >
                                <Upload className="w-4 h-4 me-1.5" />
                                Import
                            </button>
                            <Button type="button" variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                                {t.customers.newCustomer}
                            </Button>
                        </>
                    }
                />

                {segmentStats && segmentStats.total > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white border border-gray-100 rounded-lg p-5 shadow-sm">
                            <p className="text-xs font-medium text-gray-500 mb-1">{t.customers.totalCustomers}</p>
                            <p className="text-3xl font-bold text-gray-900">{segmentStats.total}</p>
                        </div>
                        {segmentStats.breakdown.map((seg) => {
                            const style = segmentCardStyle[seg.segment] ?? segmentCardStyle['Regular'];
                            return (
                                <div key={seg.segment} className={`border rounded-lg p-5 shadow-sm ${style.bg}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className={`text-[10px] font-semibold ${style.text}`}>{seg.segment}</p>
                                        {style.icon}
                                    </div>
                                    <p className={`text-3xl font-bold ${style.text}`}>{seg.count}</p>
                                    <div className="mt-3 bg-white/60 rounded-full h-1.5 overflow-hidden">
                                        <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${seg.percentage}%` }} />
                                    </div>
                                    <p className={`text-xs font-bold mt-1 ${style.text} opacity-70`}>
                                        {formatMessage(t.customers.percentOfTotal, { percent: String(seg.percentage) })}
                                    </p>
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
                />

                <ImportDialog
                    open={importOpen}
                    onClose={() => setImportOpen(false)}
                    entityLabel="Customers"
                    fields={IMPORT_FIELDS}
                    importFn={(rows, mode) => api.importCustomers(rows, mode)}
                    onSuccess={() => void loadCustomers()}
                />
                {evalMessage && (
                    <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{evalMessage}</div>
                )}

                <div className="bg-white border border-gray-100 rounded-lg p-3 flex flex-wrap gap-2 items-center">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t.customers.searchPlaceholder}
                        className="max-w-xs"
                    />
                    <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                    {filterPresets.map((preset) => (
                        <button
                            key={preset.key}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            className={`min-h-touch px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                activePreset === preset.key
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>

                <DataTable<Customer>
                    tableId="customers"
                    columns={columns}
                    data={customers}
                    title={t.customers.title}
                    isLoading={loading}
                    emptyMessage={t.customers.emptyMessage}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    showSearch={false}
                    serverPagination={serverPagination}
                />
            
        </PageShell>
    );
}