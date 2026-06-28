'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { routes } from '@/lib/routes';

interface Customer {
    id: string;
    name: string;
    phone: string;
    customer_code?: string | null;
    segment_category?: string | null;
    last_contacted_at?: string | null;
    created_at: string;
}

const columnHelper = createColumnHelper<Customer>();

export default function CrmCustomersPage() {
    const { t } = useI18n();
    const m = t.crm.leads.customers;
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);

    const loadCustomers = async () => {
        setLoading(true);
        try {
            const data = await api.getCustomers({ limit: 100 });
            setCustomers(Array.isArray(data) ? data : (data?.items ?? data));
        } catch (error) {
            console.error('Failed to load customers', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCustomers();
    }, []);

    const columns: ColumnDef<Customer, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.customers.columns.customer,
                cell: (info) => (
                    <Link
                        href={routes.sales.customerDetail(info.row.original.id)}
                        className="font-semibold text-gray-900 hover:text-blue-600"
                    >
                        {info.getValue()}
                    </Link>
                ),
            }),
            columnHelper.accessor('phone', { header: 'Phone' }),
            columnHelper.accessor('segment_category', {
                header: t.customers.columns.segment,
                cell: (info) => info.getValue() ?? '—',
            }),
            columnHelper.accessor('last_contacted_at', {
                header: t.crm.leads.columns.lastContact,
                cell: (info) => info.getValue() ? formatDate(info.getValue() as string) : '—',
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: (info) => (
                    <Link
                        href={routes.sales.customerDetail(info.row.original.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {m.openInSales}
                    </Link>
                ),
            }),
        ],
        [t, m.openInSales],
    );

    return (
        <div className="p-6 w-full">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Users className="w-7 h-7 text-blue-600" />
                        {m.title}
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">{m.subtitle}</p>
                </div>
                <button
                    onClick={loadCustomers}
                    className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                    <RefreshCw className="w-4 h-4" /> Refresh
                </button>
            </div>

            <DataTable<Customer>
                tableId="crm-customers"
                title={m.title}
                data={customers}
                columns={columns}
                isLoading={loading}
                emptyMessage={t.customers.emptyMessage}
            />
        </div>
    );
}