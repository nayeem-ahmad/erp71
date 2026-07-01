'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ReorderRow {
    product: { id: string; name: string; sku?: string | null; group?: { name: string } | null; subgroup?: { name: string } | null };
    onHand: number;
    inTransit: number;
    targetStock: number | null;
    suggestedQuantity: number;
    shortageReason: string;
    configSource: string;
    leadTimeDays?: number | null;
}

const columnHelper = createColumnHelper<ReorderRow>();

export default function ReorderSuggestionsPage() {
    const { t } = useI18n();
    const [rows, setRows] = useState<ReorderRow[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [warehouseId, setWarehouseId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');

    useEffect(() => {
        void Promise.all([loadRows(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadRows();
    }, [warehouseId, groupId, subgroupId]);

    const loadRows = async () => {
        setLoading(true);
        try {
            const data = await api.getReorderSuggestions({
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
            });
            setRows(data);
        } catch (error) {
            console.error('Failed to load reorder suggestions', error);
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
            console.error('Failed to load reorder filters', error);
        }
    };

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<ReorderRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: t.inventoryReports.reorder.columns.product, size: 220 }),
            columnHelper.accessor((row) => row.product.group?.name || t.inventoryReports.reorder.uncategorized, { id: 'group', header: t.inventoryReports.reorder.columns.group, size: 150 }),
            columnHelper.accessor('onHand', { header: t.inventoryReports.reorder.columns.onHand, size: 90 }),
            columnHelper.accessor('inTransit', { header: t.inventoryReports.reorder.columns.inTransit, size: 90 }),
            columnHelper.accessor((row) => row.targetStock ?? '-', { id: 'targetStock', header: t.inventoryReports.reorder.columns.target, size: 90 }),
            columnHelper.accessor('suggestedQuantity', {
                header: t.inventoryReports.reorder.columns.suggestedQty,
                cell: (info) => <span className="text-sm font-black text-rose-600">{info.getValue()}</span>,
                size: 120,
            }),
            columnHelper.accessor('shortageReason', { header: t.inventoryReports.reorder.columns.explanation, size: 320 }),
            columnHelper.accessor('configSource', { header: t.inventoryReports.reorder.columns.policySource, size: 120 }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventoryReports.reorder.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.inventoryReports.reorder.subtitlePrioritize}
                    </p>
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

                <DataTable<ReorderRow>
                    tableId="inventory-reorder-suggestions"
                    columns={columns}
                    data={rows}
                    title={t.inventoryReports.reorder.title}
                    isLoading={loading}
                    emptyMessage={t.inventoryReports.reorder.emptyMessage}
                    emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.common.search + "..."}
                />
            </div>
        </div>
    );
}