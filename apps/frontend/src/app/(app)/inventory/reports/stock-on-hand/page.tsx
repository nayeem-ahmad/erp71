'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Warehouse } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
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
    const [summary, setSummary] = useState<StockOnHandSummary | null>(null);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [brands, setBrands] = useState<any[]>([]);
    const [warehouseId, setWarehouseId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [brandId, setBrandId] = useState('');
    const [includeZeroStock, setIncludeZeroStock] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void Promise.all([loadReport(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadReport();
    }, [warehouseId, groupId, subgroupId, brandId, includeZeroStock]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getStockOnHand({
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
                brandId: brandId || undefined,
                includeZeroStock: includeZeroStock || undefined,
            });
            setSummary(data.summary);
            setWarehouseColumns(data.warehouses);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load stock on hand report', error);
        } finally {
            setLoading(false);
        }
    };

    const loadFilters = async () => {
        try {
            const [warehouseData, groupData, subgroupData, brandData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getProductGroups(),
                api.getProductSubgroups(),
                api.getBrands(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setGroups(groupData);
            setSubgroups(subgroupData);
            setBrands(brandData);
        } catch (error) {
            console.error('Failed to load stock on hand filters', error);
        }
    };

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<StockOnHandRow, any>[] = useMemo(() => {
        const strings = t.inventoryReports.stockOnHand;

        // One quantity column per warehouse, in the order the backend returned
        // them (default warehouse first, then alphabetical). Beyond the first
        // two they collapse on mobile so the table still fits at 360px.
        const perWarehouse = warehouseColumns.map((warehouse, index) =>
            columnHelper.accessor((row) => row.quantityByWarehouse[warehouse.id] ?? 0, {
                id: `warehouse:${warehouse.id}`,
                header: warehouse.name,
                size: 110,
                meta: { hideOnMobile: index > 1 },
            }),
        );

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
    }, [t, warehouseColumns]);

    const strings = t.inventoryReports.stockOnHand;

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
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    aria-label={strings.allWarehouses}
                    className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[200px] min-h-touch"
                >
                    <option value="">{strings.allWarehouses}</option>
                    {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
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
                emptyMessage={strings.emptyMessage}
                emptyIcon={<Warehouse className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={strings.searchPlaceholder}
            />

            <p className="text-xs text-gray-500">{strings.valuationBasisNote}</p>
        </PageShell>
    );
}
