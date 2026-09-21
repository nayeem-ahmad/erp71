'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Warehouse } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import { formatBDT } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatMessage, useI18n } from '@/lib/i18n';

type CostBasis = 'WEIGHTED_AVERAGE' | 'LATEST_COST' | 'UNCOSTED';

interface StockOnHandRow {
    product: {
        id: string;
        name: string;
        sku?: string | null;
        brand?: { id: string; name: string } | null;
        group?: { id: string; name: string } | null;
        subgroup?: { id: string; name: string } | null;
    };
    quantityByWarehouse: Record<string, number>;
    totalQuantity: number;
    averageUnitCost: number | null;
    costBasis: CostBasis;
    totalStockValue: number;
}

interface WarehouseColumn {
    id: string;
    name: string;
    code: string;
    /**
     * False for a warehouse that has been closed but still holds stock. It keeps
     * its column — the units are still the shop's — and says so in the header
     * rather than disappearing along with everything it holds.
     */
    is_active: boolean;
    quantity: number;
    stockValue: number;
}

interface StockOnHandSummary {
    totalQuantity: number;
    totalStockValue: number;
    productCount: number;
    uncostedProductCount: number;
    uncostedQuantity: number;
}

const columnHelper = createColumnHelper<StockOnHandRow>();

export default function StockOnHandPage() {
    const { t } = useI18n();
    const [rows, setRows] = useState<StockOnHandRow[]>([]);
    const [warehouseColumns, setWarehouseColumns] = useState<WarehouseColumn[]>([]);
    // The warehouses the report itself has columns for, as of the last read that
    // was not narrowed to one. Wider than the active list below, because a
    // closed warehouse still holding stock stays in the report — and a column
    // nobody can filter down to is a column half missing.
    const [reportedWarehouseIds, setReportedWarehouseIds] = useState<string[]>([]);
    const [summary, setSummary] = useState<StockOnHandSummary | null>(null);
    const [stores, setStores] = useState<any[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [brands, setBrands] = useState<any[]>([]);
    const [storeId, setStoreId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [brandId, setBrandId] = useState('');
    const [includeZeroStock, setIncludeZeroStock] = useState(false);
    const [loading, setLoading] = useState(true);
    // A failed read used to leave the table empty and silent, which reads
    // exactly like "this shop holds no stock" — the one answer the report must
    // never give by accident.
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void Promise.all([loadReport(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadReport();
    }, [storeId, warehouseId, groupId, subgroupId, brandId, includeZeroStock]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getStockOnHand({
                storeId: storeId || undefined,
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
                brandId: brandId || undefined,
                includeZeroStock: includeZeroStock || undefined,
            });
            setSummary(data.summary);
            setWarehouseColumns(data.warehouses);
            setRows(data.rows);
            // Only an unfiltered read says which warehouses there are to choose
            // from: narrowing to one returns one column, which is not a list.
            if (!warehouseId) setReportedWarehouseIds(data.warehouses.map((warehouse: WarehouseColumn) => warehouse.id));
            setError(null);
        } catch (error) {
            console.error('Failed to load stock on hand report', error);
            setSummary(null);
            setRows([]);
            setWarehouseColumns([]);
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    };

    const loadFilters = async () => {
        try {
            const [storeData, warehouseData, groupData, subgroupData, brandData] = await Promise.all([
                api.getStores(),
                api.getInventoryWarehouses(),
                api.getProductGroups(),
                api.getProductSubgroups(),
                api.getBrands(),
            ]);
            setStores(storeData);
            // Kept whole rather than narrowed to the active ones here: which
            // warehouses this report can speak for is the report's answer (see
            // `visibleWarehouses`), and the full list is also what names the
            // branch behind each column.
            setWarehouses(warehouseData);
            setGroups(groupData);
            setSubgroups(subgroupData);
            setBrands(brandData);
        } catch (error) {
            console.error('Failed to load stock on hand filters', error);
        }
    };

    // A warehouse belongs to exactly one branch, so picking a branch narrows the
    // warehouse picker to that branch's own — the same scoping the entry screens
    // get from `useWarehouses`. The branch select clears `warehouseId` on the way
    // past: the two filters are AND-ed server-side, so a warehouse left over from
    // another branch would report nothing at all.
    //
    // A closed warehouse is offered only while the report still counts it, which
    // is exactly while it still holds something. Unlike the entry screens, this
    // one is not choosing where to post stock — it is choosing which of its own
    // columns to look at.
    const visibleWarehouses = useMemo(
        () =>
            warehouses.filter(
                (warehouse: any) =>
                    (!storeId || warehouse.store_id === storeId) &&
                    (warehouse.is_active || reportedWarehouseIds.includes(warehouse.id)),
            ),
        [warehouses, storeId, reportedWarehouseIds],
    );

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<StockOnHandRow, any>[] = useMemo(() => {
        const strings = t.inventoryReports.stockOnHand;

        // The report's own columns carry no branch, so borrow it from the filter
        // list — the same warehouses, loaded from /inventory/warehouses — which
        // is what lets two branches' identically named locations be told apart.
        const labelled = warehouseColumns.map((warehouse) => ({
            ...warehouse,
            store: warehouses.find((row) => row.id === warehouse.id)?.store ?? null,
        }));

        // One quantity column per warehouse, in the order the backend returned
        // them (default warehouse first, then alphabetical, closed ones last).
        // Beyond the first two they collapse on mobile so the table still fits
        // at 360px.
        const perWarehouse = labelled.map((warehouse, index) => {
            const label = warehouseLabel(warehouse, labelled);
            return columnHelper.accessor((row) => row.quantityByWarehouse[warehouse.id] ?? 0, {
                id: `warehouse:${warehouse.id}`,
                // A plain string rather than a styled node, because this header
                // is also what the CSV, Excel and PDF exports print — a closed
                // warehouse has to say so there too. Tested with `=== false`
                // rather than for truthiness: a frontend deployed ahead of the
                // backend gets a payload without the flag at all, and marking
                // every warehouse closed would be worse than marking none.
                header: warehouse.is_active === false ? formatMessage(strings.closedWarehouse, { warehouse: label }) : label,
                size: 110,
                meta: { hideOnMobile: index > 1 },
            });
        });

        return [
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: strings.columns.product, size: 220 }),
            columnHelper.accessor((row) => row.product.sku || '-', {
                id: 'sku',
                header: strings.columns.sku,
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.product.group?.name || strings.uncategorized, {
                id: 'group',
                header: strings.columns.group,
                size: 150,
                meta: { hideOnMobile: true },
            }),
            ...perWarehouse,
            columnHelper.accessor('totalQuantity', {
                header: strings.columns.totalQuantity,
                cell: (info) => <span className="text-sm font-semibold">{info.getValue()}</span>,
                size: 100,
            }),
            columnHelper.accessor((row) => row.averageUnitCost ?? '', {
                id: 'averageUnitCost',
                header: strings.columns.avgUnitCost,
                cell: (info) => {
                    const value = info.row.original.averageUnitCost;
                    return value == null ? <span className="text-xs text-gray-400">-</span> : formatBDT(value);
                },
                size: 120,
            }),
            columnHelper.accessor('costBasis', {
                header: strings.columns.costBasis,
                cell: (info) => (
                    <span className={info.getValue() === 'UNCOSTED' ? 'text-xs text-amber-600' : 'text-xs text-gray-500'}>
                        {strings.costBasis[info.getValue() as CostBasis]}
                    </span>
                ),
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('totalStockValue', {
                header: strings.columns.totalValue,
                cell: (info) => <span className="text-sm font-bold text-blue-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 130,
            }),
        ];
    }, [t, warehouseColumns, warehouses]);

    const strings = t.inventoryReports.stockOnHand;

    // Stock is counted per warehouse, so a scope with none of them has nothing
    // to report on — a different answer from "these shelves are bare", and the
    // one a shop that has not set a warehouse up needs to read.
    const emptyMessage = error
        ? strings.loadErrorEmpty
        : warehouseColumns.length === 0
            ? strings.noWarehouses
            : strings.emptyMessage;

    return (
        <PageShell>
            <PageHeader
                title={strings.title}
                subtitle={strings.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    strings.title,
                    'inventory',
                )}
            />

            <div className="grid md:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-100 rounded-lg p-5">
                    <div className="text-xs font-medium text-gray-500">{strings.totalStockValue}</div>
                    <div className="text-2xl font-bold text-blue-700 mt-2">{formatBDT(Number(summary?.totalStockValue || 0))}</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-5">
                    <div className="text-xs font-medium text-gray-500">{strings.totalQuantity}</div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">{summary?.totalQuantity ?? 0}</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-5">
                    <div className="text-xs font-medium text-gray-500">{strings.productsInStock}</div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">{summary?.productCount ?? 0}</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-5">
                    <div className="text-xs font-medium text-gray-500">{strings.warehousesCounted}</div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">{warehouseColumns.length}</div>
                </div>
            </div>

            {/* A read that failed is not an empty shop. Saying which is the
                difference between "you hold nothing" and "we could not ask". */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                    {formatMessage(strings.loadError, { message: error })}
                </div>
            )}

            {/* Stock with no cost on file is valued at zero, so the totals above
                understate reality. Saying so beats letting the number pass as
                complete. */}
            {summary && summary.uncostedProductCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    {formatMessage(strings.uncostedWarning, {
                        count: summary.uncostedProductCount,
                        quantity: summary.uncostedQuantity,
                    })}
                </div>
            )}

            <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-center">
                <select
                    value={storeId}
                    onChange={(e) => { setStoreId(e.target.value); setWarehouseId(''); }}
                    aria-label={strings.allBranches}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allBranches}</option>
                    {stores.map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
                <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    aria-label={strings.allWarehouses}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allWarehouses}</option>
                    {visibleWarehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse, visibleWarehouses)}</option>)}
                </select>
                <select
                    value={groupId}
                    onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }}
                    aria-label={strings.allGroups}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allGroups}</option>
                    {groups.map((group: any) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <select
                    value={subgroupId}
                    onChange={(e) => setSubgroupId(e.target.value)}
                    aria-label={strings.allSubgroups}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allSubgroups}</option>
                    {filteredSubgroups.map((subgroup: any) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                </select>
                <select
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    aria-label={strings.allBrands}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allBrands}</option>
                    {brands.map((brand: any) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-600 min-h-touch">
                    <input
                        type="checkbox"
                        checked={includeZeroStock}
                        onChange={(e) => setIncludeZeroStock(e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                    />
                    {strings.showZeroStock}
                </label>
            </div>

            <DataTable<StockOnHandRow>
                tableId="inventory-stock-on-hand"
                columns={columns}
                data={rows}
                title={strings.title}
                isLoading={loading}
                emptyMessage={emptyMessage}
                emptyIcon={<Warehouse className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={strings.searchPlaceholder}
            />

            <p className="text-xs text-gray-500">{strings.valuationBasisNote}</p>
        </PageShell>
    );
}
