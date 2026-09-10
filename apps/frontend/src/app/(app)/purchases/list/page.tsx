'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ban, ClipboardList, Copy, Plus, Printer } from 'lucide-react';
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
import { toast } from '@/lib/toast';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';

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
    status?: string;
    cancellation_note?: string | null;
    supplier?: {
        name: string;
    } | null;
    items: PurchaseItem[];
    posting_status?: string | null;
    voucher_number?: string | null;
}

const statusColors: Record<string, string> = {
    RECORDED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    // Grey rather than red: a cancelled entry is void, not an error.
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-300',
};

const columnHelper = createColumnHelper<Purchase>();

export default function PurchasesPage() {
    const { t, locale } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);

    // Cancelling reverses stock, the payable and the ledger, so the action is
    // hidden without CANCEL_ENTRY rather than shown and left to 403. OWNER
    // bypasses the guard server-side and may hold no grant rows at all.
    const { permissions, role } = useTenantPlanFeatures();
    const canCancel = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');

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

    const handleCancel = async (purchase: Purchase, note: string) => {
        await api.cancelPurchase(purchase.id, note);
        setCancelTarget(null);
        await loadPurchases();
        toast.success(t.entryCancellation.purchaseCancelled);
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
            columnHelper.accessor((row) => row.status ?? 'RECORDED', {
                id: 'status',
                header: t.purchases.columns.status,
                cell: (info) => {
                    const status = info.getValue() as string;
                    return (
                        <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                                statusColors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                            title={info.row.original.cancellation_note ?? undefined}
                        >
                            {t.purchases.statuses[status as keyof typeof t.purchases.statuses] ?? status}
                        </span>
                    );
                },
                size: 110,
            }),
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
                    <div className="flex items-center gap-0.5">
                        <Link
                            href={`/purchases/${row.original.id}/invoice`}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary-light transition-colors inline-flex"
                            title={t.purchases.printInvoice}
                        >
                            <Printer className="w-4 h-4" />
                        </Link>
                        <Link
                            href={`/purchases/new?duplicate=${row.original.id}`}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors inline-flex"
                            title={t.purchases.duplicate}
                        >
                            <Copy className="w-4 h-4" />
                        </Link>
                        {canCancel && (row.original.status ?? 'RECORDED') !== 'CANCELLED' && (
                            <button
                                type="button"
                                onClick={() => setCancelTarget(row.original)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors inline-flex"
                                title={t.entryCancellation.action}
                            >
                                <Ban className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, locale, canCancel],
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

                {cancelTarget && (
                    <CancelEntryModal
                        entryLabel={cancelTarget.purchase_number}
                        entryAmount={formatBDT(Number(cancelTarget.total_amount || 0), { locale })}
                        onConfirm={(note) => handleCancel(cancelTarget, note)}
                        onClose={() => setCancelTarget(null)}
                    />
                )}
    </PageShell>
    );
}