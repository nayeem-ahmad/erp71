'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList, Plus, Printer } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { PostingBadge } from '@/components/PostingBadge';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';

interface PurchaseItem {
    id: string;
    quantity: number;
    unit_cost: string | number;
    product?: {
        name: string;
        sku?: string | null;
    };
}

interface Purchase {
    id: string;
    purchase_number: string;
    total_amount: string | number;
    subtotal_amount: string | number;
    created_at: string;
    supplier?: {
        name: string;
    } | null;
    items: PurchaseItem[];
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<Purchase>();

export default function PurchasesPage() {
    const { t, locale } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        loadPurchases();
    }, [createdRange]);

    // Recording a purchase is its own screen now; keep the old ?new=1 deep
    // link (bookmarks, voice navigation) working by forwarding it there.
    useEffect(() => {
        if (searchParams.get('new') === '1') {
            router.replace(routes.purchases.newPurchase);
        }
    }, [router, searchParams]);

    const loadPurchases = async () => {
        setLoading(true);
        try {
            const data = await api.getPurchases(applyCreatedRangeQuery(createdRange));
            setPurchases(data);
        } catch (error) {
            console.error('Failed to load purchases', error);
        } finally {
            setLoading(false);
        }
    };

    const columns: ColumnDef<Purchase, any>[] = useMemo(
        () => [
            columnHelper.accessor('purchase_number', {
                header: t.purchases.columns.purchaseNumber,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>
                ),
                size: 150,
            }),
            columnHelper.accessor((row) => row.supplier?.name ?? t.purchaseShared.unlinked, {
                id: 'supplier',
                header: t.purchases.columns.supplier,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>
                ),
                size: 180,
            }),
            columnHelper.accessor((row) => row.items?.length ?? 0, {
                id: 'item_count',
                header: t.purchases.columns.items,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-700">
                        {formatMessage(t.purchaseShared.itemsCount, { count: info.getValue() })}
                    </span>
                ),
                size: 90,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: t.purchases.columns.products,
                cell: (info) => (
                    <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '-'}</span>
                ),
                size: 320,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('total_amount', {
                header: t.purchases.columns.total,
                cell: (info) => (
                    <span className="text-sm font-bold text-emerald-600">
                        {formatBDT(Number(info.getValue() || 0), { locale })}
                    </span>
                ),
                sortingFn: (a, b) =>
                    Number(a.getValue('total_amount') || 0) - Number(b.getValue('total_amount') || 0),
                size: 120,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.display({
                id: 'posting',
                header: t.purchases.columns.voucher,
                cell: ({ row }) => (
                    <PostingBadge
                        status={row.original.posting_status}
                        voucherNumber={row.original.voucher_number}
                    />
                ),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <Link
                        href={`/purchases/${row.original.id}/invoice`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary-light transition-colors inline-flex"
                        title={t.purchases.printInvoice}
                    >
                        <Printer className="w-4 h-4" />
                    </Link>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 50,
            }),
        ],
        [t, locale],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.purchases.title}
                    subtitle={t.purchases.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.purchase,
                        t.purchases.title,
                        'purchases',
                    )}
                    actions={(
                        <Link
                            href={routes.purchases.newPurchase}
                            className="bg-primary hover:bg-primary-hover text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center transition-colors"
                        >
                            <Plus className="w-4 h-4 me-2" />
                            {t.purchases.recordPurchase}
                        </Link>
                    )}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                </div>

                <DataTable<Purchase>
                    tableId="purchases"
                    columns={columns}
                    data={purchases}
                    title={t.purchases.tableTitle}
                    isLoading={loading}
                    emptyMessage={t.purchases.emptyMessage}
                    emptyIcon={<ClipboardList className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.purchases.searchPlaceholder}
                />
    </PageShell>
    );
}