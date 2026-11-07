'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BookOpen, RefreshCw } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { BranchFilter } from '@/components/ui';
import { branchOrEmpty, useBranchBoundState, useBranchForbiddenReset, useBranchScope } from '@/lib/branch-scope';
import { warehouseLabel } from '@/lib/warehouse-label';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { useServerList } from '@/hooks/useServerList';

interface LedgerRow {
    id: string;
    movement_type: string;
    quantity_delta: number;
    balance_after?: number | null;
    reference_type?: string | null;
    reference_id?: string | null;
    created_at: string;
    product?: { id: string; name: string; sku?: string | null } | null;
    warehouse?: { id: string; name: string } | null;
}

/**
 * Known movement types written by the backend. The ledger filter is a select of
 * these rather than free text — new types still appear in the table; they just
 * are not in the chip until listed here.
 */
const MOVEMENT_TYPES = [
    'PURCHASE',
    'PURCHASE_RECEIPT',
    'PURCHASE_RETURN',
    'PURCHASE_CANCELLED',
    'PURCHASE_EDIT',
    'SALE',
    'SALE_EDIT',
    'SALE_CANCELLED',
    'SALES_RETURN',
    'SALES_ORDER_DELIVERY',
    'EXCHANGE_IN',
    'EXCHANGE_OUT',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'WAREHOUSE_TRANSFER',
    'INITIAL_STOCK',
    'STOCK_TAKE',
    'STOCK_TAKE_ADJUSTMENT',
    'SHRINKAGE',
    'STOCK_FOUND',
    'MANUFACTURING_OUTPUT',
    'MANUFACTURING_CONSUMPTION',
    'MANUFACTURING_WASTAGE',
] as const;

/** `PURCHASE_RECEIPT` → `Purchase Receipt`. */
function humanizeMovementType(value: string): string {
    return value
        .split('_')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

const columnHelper = createColumnHelper<LedgerRow>();

export default function InventoryLedgerPage() {
    const { t, locale } = useI18n();
    const listUi = t.inventoryReports.listUi;
    const branch = useBranchScope();
    const [warehouses, setWarehouses] = useState<any[]>([]);
    // A warehouse belongs to one branch: the picker offers the chosen branch's
    // own (every one under "All branches") and is cleared when the branch changes.
    const [warehouseId, setWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const [movementType, setMovementType] = useState('');

    const {
        items: rows,
        loading,
        error: ledgerError,
        serverPagination,
        reload: loadLedger,
    } = useServerList<LedgerRow>({
        tableId: 'inventory-ledger',
        fetch: (p) => api.getInventoryLedger({
            warehouseId: warehouseId || undefined,
            movementType: movementType || undefined,
            storeId: branch.apiStoreId,
            ...p,
        }),
        deps: [warehouseId, movementType, branch.apiStoreId],
        enabled: branch.ready,
        columnFilters: false,
    });
    useBranchForbiddenReset(ledgerError, branch, t.dashboardLayout.branchFilterForbidden);

    const filterBranchId = branchOrEmpty(branch.apiStoreId);
    const filterWarehouses = useMemo(
        () => (filterBranchId ? warehouses.filter((warehouse: any) => warehouse.store_id === filterBranchId) : warehouses),
        [warehouses, filterBranchId],
    );

    useEffect(() => {
        void loadWarehouses();
    }, []);

    const loadWarehouses = async () => {
        try {
            const data = await api.getInventoryWarehouses();
            setWarehouses(data);
        } catch (error) {
            console.error('Failed to load warehouses', error);
        }
    };

    const columns: ColumnDef<LedgerRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('created_at', {
                header: t.inventoryLedger.columns.timestamp,
                // A timestamp: no typed text the server could match it against.
                enableColumnFilter: false,
                cell: (info) => formatDateTime(info.getValue()),
                size: 170,
            }),
            columnHelper.accessor((row) => row.product?.name || '-', {
                id: 'product',
                header: t.inventoryLedger.columns.product,
                size: 220,
            }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', {
                id: 'warehouse',
                header: t.inventoryLedger.columns.warehouse,
                size: 160,
            }),
            columnHelper.accessor('movement_type', {
                header: t.inventoryLedger.columns.movement,
                cell: (info) => humanizeMovementType(String(info.getValue() || '')),
                size: 160,
            }),
            columnHelper.accessor('quantity_delta', {
                header: t.inventoryLedger.columns.delta,
                cell: (info) => {
                    const value = Number(info.getValue() || 0);
                    return (
                        <span className={`tabular-nums ${value >= 0 ? 'text-emerald-600 font-bold' : 'text-danger font-bold'}`}>
                            {value}
                        </span>
                    );
                },
                size: 80,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('balance_after', {
                header: t.inventoryLedger.columns.balance,
                cell: (info) => <span className="tabular-nums font-bold">{info.getValue() ?? '-'}</span>,
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.reference_type && row.reference_id ? `${row.reference_type} • ${row.reference_id}` : '-', {
                id: 'reference',
                header: t.inventoryLedger.columns.reference,
                size: 220,
            }),
        ],
        [t],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'warehouse',
                type: 'select',
                label: t.inventoryLedger.warehouseLabel,
                value: warehouseId || null,
                onChange: (v) => setWarehouseId(v ?? ''),
                options: filterWarehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouseLabel(warehouse, filterWarehouses),
                })),
            },
            {
                id: 'movementType',
                type: 'select',
                label: t.inventoryLedger.movementType,
                value: movementType || null,
                onChange: (v) => setMovementType(v ?? ''),
                options: MOVEMENT_TYPES.map((value) => ({
                    value,
                    label: humanizeMovementType(value),
                })),
                searchable: true,
            },
        ],
        [t, warehouseId, filterWarehouses, movementType],
    );

    const stats = useMemo(() => {
        const items: ListStat[] = [
            {
                id: 'movements',
                icon: <BookOpen aria-hidden />,
                label: listUi.movementCount,
                value: Number(serverPagination?.total ?? 0).toLocaleString(locale),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [serverPagination?.total, loading, locale, listUi]);

    return (
        <PageShell>
            <PageHeader
                title={t.inventoryLedger.title}
                subtitle={t.inventoryLedger.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    t.inventoryLedger.title,
                    'inventory',
                )}
                actions={(
                    <>
                        <BranchFilter scope={branch} />
                        <button onClick={() => void loadLedger()} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center">
                            <RefreshCw className="w-4 h-4 me-2" /> {t.common.refresh}
                        </button>
                    </>
                )}
            />

            <DataTable<LedgerRow>
                tableId="inventory-ledger"
                columns={columns}
                data={rows}
                title={t.inventoryLedger.stockLedger}
                isLoading={loading}
                emptyMessage={t.inventoryLedger.emptyMessage}
                emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                showSearch={false}
                serverPagination={serverPagination}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
