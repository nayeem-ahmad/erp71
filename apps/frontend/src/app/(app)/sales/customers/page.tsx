'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye, RefreshCw, Crown, AlertTriangle, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import AddCustomerModal from './AddCustomerModal';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';

interface Customer {
    id: string;
    name: string;
    phone: string;
    customer_code?: string | null;
    customer_type?: string | null;
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
    'AT-RISK': 'bg-rose-50 text-rose-700 border-rose-200',
    'At-Risk': 'bg-rose-50 text-rose-700 border-rose-200',
    NEW: 'bg-blue-50 text-blue-700 border-blue-200',
    LOYAL: 'bg-amber-50 text-amber-700 border-amber-200',
};

const columnHelper = createColumnHelper<Customer>();

export default function CustomersPage() {
    const { t } = useI18n();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [segmentStats, setSegmentStats] = useState<SegmentStats | null>(null);
    const [runningSegmentation, setRunningSegmentation] = useState(false);
    const [evaluating, setEvaluating] = useState(false);
    const [evalMessage, setEvalMessage] = useState('');

    const segmentCardStyle: Record<string, { bg: string; text: string; bar: string; icon: React.ReactNode }> = useMemo(() => ({
        VIP: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-500', icon: <Crown className="w-5 h-5 text-emerald-500" /> },
        'At-Risk': { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700', bar: 'bg-rose-500', icon: <AlertTriangle className="w-5 h-5 text-rose-500" /> },
        Regular: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-700', bar: 'bg-gray-400', icon: <UserCheck className="w-5 h-5 text-gray-400" /> },
    }), []);

    useEffect(() => {
        loadCustomers();
        loadSegmentStats();
    }, []);

    const loadCustomers = async () => {
        try {
            const data = await api.getCustomers();
            setCustomers(Array.isArray(data) ? data : (data?.items ?? data));
        } catch (error) {
            console.error('Failed to load customers', error);
        } finally {
            setLoading(false);
        }
    };

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

    const handleAddCustomer = async (data: any) => {
        await api.createCustomer(data);
        loadCustomers();
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
                            <span className="block text-sm font-black text-gray-900">{customer.name}</span>
                            <span className="block text-xs text-gray-400">{customer.phone}</span>
                        </div>
                    );
                },
                size: 190,
            }),
            columnHelper.accessor('customer_type', {
                header: t.customers.columns.type,
                cell: (info) => {
                    const type = info.getValue() || 'INDIVIDUAL';
                    const classes =
                        type === 'ORGANIZATION'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : 'bg-gray-50 text-gray-700 border-gray-200';

                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${classes}`}>
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
                    <span className="text-sm font-black text-blue-600">
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
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${segmentColors[segment] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {segment}
                        </span>
                    );
                },
                size: 130,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('created_at', {
                header: t.customers.columns.registered,
                cell: (info) => (
                    <span className="text-sm text-gray-600">
                        {formatDate(info.getValue())}
                    </span>
                ),
                sortingFn: 'datetime',
                size: 130,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end space-x-1">
                        <Link
                            href={`/sales/customers/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                    </div>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.customers.filters.vip, filters: [{ id: 'segment_category', value: 'VIP' }] },
            { label: t.customers.filters.atRisk, filters: [{ id: 'segment_category', value: 'At-Risk' }] },
            { label: t.customers.filters.organizations, filters: [{ id: 'customer_type', value: 'ORGANIZATION' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-4 md:p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">{t.customers.title}</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            {t.customers.subtitle}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <button
                            onClick={handleRunSegmentation}
                            disabled={runningSegmentation}
                            className="flex items-center px-4 py-2.5 rounded-xl font-bold text-sm border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50"
                            title={t.customers.runSegmentationTitle}
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${runningSegmentation ? 'animate-spin' : ''}`} />
                            {runningSegmentation ? t.customers.running : t.customers.runSegmentation}
                        </button>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            {t.customers.newCustomer}
                        </button>
                    </div>
                </div>

                {segmentStats && segmentStats.total > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{t.customers.totalCustomers}</p>
                            <p className="text-3xl font-black text-gray-900">{segmentStats.total}</p>
                        </div>
                        {segmentStats.breakdown.map((seg) => {
                            const style = segmentCardStyle[seg.segment] ?? segmentCardStyle['Regular'];
                            return (
                                <div key={seg.segment} className={`border rounded-2xl p-5 shadow-sm ${style.bg}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className={`text-[10px] font-black uppercase tracking-widest ${style.text}`}>{seg.segment}</p>
                                        {style.icon}
                                    </div>
                                    <p className={`text-3xl font-black ${style.text}`}>{seg.count}</p>
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

                <AddCustomerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAdd={handleAddCustomer} />
                {evalMessage && (
                    <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{evalMessage}</div>
                )}

                <DataTable<Customer>
                    tableId="customers"
                    columns={columns}
                    data={customers}
                    title={t.customers.title}
                    isLoading={loading}
                    emptyMessage={t.customers.emptyMessage}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.customers.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}