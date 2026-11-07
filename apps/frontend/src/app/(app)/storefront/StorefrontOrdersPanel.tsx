'use client';

import { useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { fetchWithAuth, type Paginated } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Alert } from '@/components/ui';
import { DataTable } from '@/components/data-table';
import { useServerList } from '@/hooks/useServerList';
import { STOREFRONT_ORDER_STATUSES, storefrontOrderRef } from '@erp71/shared-types';

interface StorefrontOrder {
    id: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    totalAmount: string | number;
    status: string;
    notes: string | null;
    deliveryAddress: string | null;
    deliveryArea: string | null;
    created_at: string;
    items: {
        id: string;
        quantity: number;
        priceAtOrder: string | number;
        product: { id: string; name: string };
    }[];
}

/** The storefront's queue pages 20 at a time unless the viewer picked otherwise. */
const PAGE_SIZE = 20;

const columnHelper = createColumnHelper<StorefrontOrder>();

interface StorefrontOrdersPanelProps {
    /** The page's branch filter: a branch id, `all`, or undefined for the server's default. */
    storeId?: string;
    /**
     * The picked branch is a shop, not the storefront's: web orders all belong
     * to the online branch, so the panel says where they are instead of
     * showing an empty table.
     */
    onShopBranch?: boolean;
}

export default function StorefrontOrdersPanel({ storeId, onShopBranch = false }: StorefrontOrdersPanelProps) {
    const { t, locale } = useI18n();
    const m = t.storefront.dashboard.orders;
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    // `/storefront/orders` pages and scopes to a branch; it takes no sort or
    // search, so the table offers neither.
    const { items: orders, loading, serverPagination, reload } = useServerList<StorefrontOrder>({
        tableId: 'storefront-orders',
        initialPageSize: PAGE_SIZE,
        deps: [storeId],
        enabled: !onShopBranch,
        fetch: ({ page, limit }) => {
            const branchQuery = storeId ? `&storeId=${encodeURIComponent(storeId)}` : '';
            return fetchWithAuth(`/storefront/orders?page=${page}&limit=${limit}${branchQuery}`) as Promise<Paginated<StorefrontOrder>>;
        },
    });

    const handleStatusChange = async (orderId: string, newStatus: string) => {
        setUpdatingId(orderId);
        try {
            await fetchWithAuth(`/storefront/orders/${orderId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            await reload();
        } catch (err: any) {
            toast.error(err?.message || m.updateFailed);
        } finally {
            setUpdatingId(null);
        }
    };

    const columns: ColumnDef<StorefrontOrder, any>[] = useMemo(
        () => ([
            columnHelper.accessor('id', {
                header: m.columns.orderId,
                cell: (info) => (
                    <span className="font-mono text-xs text-gray-500" title={info.getValue()}>
                        #{storefrontOrderRef(info.getValue())}
                    </span>
                ),
                size: 110,
            }),
            columnHelper.accessor('customerName', {
                header: m.columns.customer,
                cell: (info) => {
                    const order = info.row.original;
                    return (
                        <div>
                            <div>{order.customerName}</div>
                            <div className="text-xs text-gray-500">{order.customerPhone || order.customerEmail}</div>
                        </div>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor((row) => [row.deliveryAddress, row.deliveryArea].filter(Boolean).join(', '), {
                id: 'deliverTo',
                header: m.deliverTo,
                cell: (info) => {
                    const notes = info.row.original.notes;
                    if (!info.getValue() && !notes) return <span className="text-gray-400">—</span>;
                    return (
                        <div>
                            {info.getValue() ? <div>{info.getValue()}</div> : null}
                            {notes ? (
                                <div className="text-xs text-gray-500">
                                    {m.notes}: {notes}
                                </div>
                            ) : null}
                        </div>
                    );
                },
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.items.length, {
                id: 'items',
                header: m.columns.items,
                cell: (info) => (
                    <div className="space-y-0.5 text-xs">
                        {info.row.original.items.map((item) => (
                            <div key={item.id}>{`${item.product.name} × ${item.quantity}`}</div>
                        ))}
                    </div>
                ),
                size: 180,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('totalAmount', {
                header: m.columns.total,
                cell: (info) => formatBDT(Number(info.getValue()), { locale }),
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('created_at', {
                header: m.columns.date,
                cell: (info) => formatDate(info.getValue(), locale),
                size: 110,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('status', {
                header: m.columns.status,
                // Changed in place: the storefront's queue is worked from here.
                cell: (info) => {
                    const order = info.row.original;
                    return (
                        <select
                            value={order.status}
                            disabled={updatingId === order.id}
                            aria-label={m.columns.status}
                            onChange={(e) => void handleStatusChange(order.id, e.target.value)}
                            className="min-h-touch md:min-h-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                        >
                            {STOREFRONT_ORDER_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                    {m.status[status.toLowerCase() as keyof typeof m.status]}
                                </option>
                            ))}
                        </select>
                    );
                },
                size: 140,
            }),
        ] as ColumnDef<StorefrontOrder, any>[]).map((column) => ({ ...column, enableSorting: false, enableColumnFilter: false })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [m, locale, updatingId],
    );

    if (onShopBranch) {
        return <Alert tone="info">{t.branchParties.onlineOrdersElsewhere}</Alert>;
    }

    return (
        <DataTable<StorefrontOrder>
            tableId="storefront-orders"
            columns={columns}
            data={orders}
            title={m.title}
            isLoading={loading}
            emptyMessage={m.emptyTitle}
            emptyIcon={<ShoppingBag className="w-16 h-16 text-gray-200" />}
            showSearch={false}
            enableColumnFilters={false}
            viewOptions
            serverPagination={serverPagination}
        />
    );
}
