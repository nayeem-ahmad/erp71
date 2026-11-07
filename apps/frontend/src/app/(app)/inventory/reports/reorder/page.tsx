'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Package, PackageX, TrendingUp } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { BranchFilter } from '@/components/ui';
import { branchOrEmpty, handleBranchForbidden, useBranchBoundState, useBranchScope } from '@/lib/branch-scope';

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
    const { t, locale } = useI18n();
    const copy = t.inventoryReports.reorder;
    const listUi = t.inventoryReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<ReorderRow[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [warehouseId, setWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const storeId = branchOrEmpty(branch.apiStoreId);
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');

    useEffect(() => {
        void loadFilters();
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadRows();
    }, [branch.ready, branch.apiStoreId, warehouseId, groupId, subgroupId]);

    const loadRows = async () => {
        setLoading(true);
        try {
            const data = await api.getReorderSuggestions({
                storeId: branch.apiStoreId,
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
            });
            setRows(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
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

    // A warehouse belongs to exactly one branch, so picking a branch narrows the
    // warehouse picker to that branch's own — the same scoping the entry screens
    // get from `useWarehouses` — and "All branches" offers every warehouse. The
    // branch filter clears `warehouseId` on the way past (`useBranchBoundState`).
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
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: copy.columns.product, size: 220 }),
            columnHelper.accessor((row) => row.product.group?.name || copy.uncategorized, { id: 'group', header: copy.columns.group, size: 150 }),
            columnHelper.accessor('onHand', {
                header: copy.columns.onHand,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('inTransit', {
                header: copy.columns.inTransit,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor((row) => row.targetStock ?? '-', {
                id: 'targetStock',
                header: copy.columns.target,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('suggestedQuantity', {
                header: copy.columns.suggestedQty,
                cell: (info) => <span className="tabular-nums text-sm font-bold text-danger">{info.getValue()}</span>,
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('shortageReason', { header: copy.columns.explanation, size: 320 }),
            columnHelper.accessor('configSource', { header: copy.columns.policySource, size: 120 }),
        ],
        [copy],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'warehouse',
                type: 'select',
                label: t.inventoryLedger.warehouseLabel,
                value: warehouseId || null,
                onChange: (v) => setWarehouseId(v ?? ''),
                options: visibleWarehouses.map((warehouse: any) => ({
                    value: warehouse.id,
                    label: warehouseLabel(warehouse, visibleWarehouses),
                })),
            },
            {
                id: 'group',
                type: 'select',
                label: copy.columns.group,
                value: groupId || null,
                onChange: (v) => {
                    setGroupId(v ?? '');
                    setSubgroupId('');
                },
                options: groups.map((group: any) => ({ value: group.id, label: group.name })),
            },
            {
                id: 'subgroup',
                type: 'select',
                label: t.inventory.columns.subgroup,
                value: subgroupId || null,
                onChange: (v) => setSubgroupId(v ?? ''),
                options: filteredSubgroups.map((subgroup: any) => ({ value: subgroup.id, label: subgroup.name })),
                more: true,
            },
        ],
        [t, copy, warehouseId, visibleWarehouses, groupId, groups, subgroupId, filteredSubgroups],
    );

    const stats = useMemo(() => {
        const suggestedUnits = rows.reduce((sum, row) => sum + Number(row.suggestedQuantity || 0), 0);
        const outOfStock = rows.filter((row) => Number(row.onHand || 0) === 0).length;
        const items: ListStat[] = [
            {
                id: 'suggestions',
                icon: <TrendingUp aria-hidden />,
                label: listUi.suggestionCount,
                value: rows.length.toLocaleString(locale),
            },
            {
                id: 'units',
                icon: <Package aria-hidden />,
                label: listUi.suggestedUnits,
                value: suggestedUnits.toLocaleString(locale),
            },
            {
                id: 'outOfStock',
                icon: <PackageX aria-hidden />,
                label: listUi.outOfStock,
                value: outOfStock.toLocaleString(locale),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [rows, loading, locale, listUi]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitlePrioritize}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    copy.title,
                    'inventory',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<ReorderRow>
                tableId="inventory-reorder-suggestions"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.emptyMessage}
                emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.common.search + '...'}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
