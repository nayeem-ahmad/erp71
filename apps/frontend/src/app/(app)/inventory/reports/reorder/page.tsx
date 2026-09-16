'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
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
    const [stores, setStores] = useState<any[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [storeId, setStoreId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');

    useEffect(() => {
        void Promise.all([loadRows(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadRows();
    }, [storeId, warehouseId, groupId, subgroupId]);

    const loadRows = async () => {
        setLoading(true);
        try {
            const data = await api.getReorderSuggestions({
                storeId: storeId || undefined,
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
            const [storeData, warehouseData, groupData, subgroupData] = await Promise.all([
                api.getStores(),
                api.getInventoryWarehouses(),
                api.getProductGroups(),
                api.getProductSubgroups(),
            ]);
            setStores(storeData);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load reorder filters', error);
        }
    };

    // A warehouse belongs to exactly one branch, so picking a branch narrows the
    // warehouse picker to that branch's own — the same scoping the entry screens
    // get from `useWarehouses`. The branch select clears `warehouseId` on the way
    // past: the two filters are AND-ed server-side, so a warehouse left over from
    // another branch would report nothing at all.
    const visibleWarehouses = useMemo(
        () => warehouses.filter((warehouse: any) => !storeId || warehouse.store_id === storeId),
        [warehouses, storeId],
    );

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
                cell: (info) => <span className="text-sm font-bold text-danger">{info.getValue()}</span>,
                size: 120,
            }),
            columnHelper.accessor('shortageReason', { header: t.inventoryReports.reorder.columns.explanation, size: 320 }),
            columnHelper.accessor('configSource', { header: t.inventoryReports.reorder.columns.policySource, size: 120 }),
        ],
        [t],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.inventoryReports.reorder.title}
                    subtitle={t.inventoryReports.reorder.subtitlePrioritize}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventoryReports.reorder.title,
                        'inventory',
                    )}
                />

                <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                    <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setWarehouseId(''); }} aria-label={t.inventoryReports.reorder.allBranches} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">{t.inventoryReports.reorder.allBranches}</option>
                        {stores.map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                    </select>
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">{t.inventoryReports.reorder.allWarehouses}</option>
                        {visibleWarehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse, visibleWarehouses)}</option>)}
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
    </PageShell>
    );
}