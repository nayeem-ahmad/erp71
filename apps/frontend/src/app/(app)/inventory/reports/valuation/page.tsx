'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';

interface ValuationRow {
    product: { id: string; name: string; group?: { name: string } | null; subgroup?: { name: string } | null };
    quantity: number;
    unitValue: number;
    stockValue: number;
}

const columnHelper = createColumnHelper<ValuationRow>();

export default function InventoryValuationPage() {
    const { t } = useI18n();
    const [rows, setRows] = useState<ValuationRow[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [warehouseId, setWarehouseId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void Promise.all([loadReport(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadReport();
    }, [warehouseId, groupId, subgroupId]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryValuation({
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            console.error('Failed to load valuation report', error);
        } finally {
            setLoading(false);
        }
    };

    const loadFilters = async () => {
        try {
            const [warehouseData, groupData, subgroupData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getProductGroups(),
                api.getProductSubgroups(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load valuation filters', error);
        }
    };

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<ValuationRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: t.inventoryReports.valuation.columns.product, size: 220 }),
            columnHelper.accessor((row) => row.product.group?.name || t.inventoryReports.reorder.uncategorized, { id: 'group', header: t.inventoryReports.valuation.columns.group, size: 160 }),
            columnHelper.accessor('quantity', { header: t.inventoryReports.valuation.columns.quantity, size: 100 }),
            columnHelper.accessor('unitValue', {
                header: t.inventoryReports.valuation.columns.unitValue,
                cell: (info) => formatBDT(Number(info.getValue() || 0)),
                size: 110,
            }),
            columnHelper.accessor('stockValue', {
                header: t.inventoryReports.valuation.columns.stockValue,
                cell: (info) => <span className="text-sm font-black text-blue-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 130,
            }),
        ],
        [t],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.inventoryReports.valuation.title}
                    subtitle={t.inventoryReports.valuation.subtitleMeasure}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventoryReports.valuation.title,
                        'inventory',
                    )}
                />

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.valuation.totalValue}</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">{formatBDT(Number(summary?.totalStockValue || 0))}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.valuation.totalQuantity}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.totalQuantity ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.valuation.productsWithStock}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.productCount ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.valuation.averageUnitValue}</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{formatBDT(Number(summary?.averageUnitValue || 0))}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">{t.inventoryReports.reorder.allWarehouses}</option>
                        {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">{t.inventoryReports.reorder.allGroups}</option>
                        {groups.map((group: any) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">{t.inventoryReports.reorder.allSubgroups}</option>
                        {filteredSubgroups.map((subgroup: any) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                    </select>
                </div>

                <DataTable<ValuationRow>
                    tableId="inventory-valuation"
                    columns={columns}
                    data={rows}
                    title={t.inventoryReports.valuation.title}
                    isLoading={loading}
                    emptyMessage={t.inventoryReports.valuation.emptyValuation}
                    emptyIcon={<Calculator className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryReports.valuation.searchPlaceholder}
                />
    </PageShell>
    );
}