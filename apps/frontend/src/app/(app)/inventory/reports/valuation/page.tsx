'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Boxes, Calculator, Package, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import { formatBDT } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { BranchFilter } from '@/components/ui';
import { branchOrEmpty, handleBranchForbidden, useBranchBoundState, useBranchScope } from '@/lib/branch-scope';

interface ValuationRow {
    product: { id: string; name: string; group?: { name: string } | null; subgroup?: { name: string } | null };
    quantity: number;
    unitValue: number;
    stockValue: number;
}

const columnHelper = createColumnHelper<ValuationRow>();

export default function InventoryValuationPage() {
    const { t, locale } = useI18n();
    const copy = t.inventoryReports.valuation;
    const listUi = t.inventoryReports.listUi;
    const branch = useBranchScope();
    const [rows, setRows] = useState<ValuationRow[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [warehouseId, setWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const storeId = branchOrEmpty(branch.apiStoreId);
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadFilters();
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadReport();
    }, [branch.ready, branch.apiStoreId, warehouseId, groupId, subgroupId]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryValuation({
                storeId: branch.apiStoreId,
                warehouseId: warehouseId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
            });
            setSummary(data.summary);
            setRows(data.rows);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
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

    const columns: ColumnDef<ValuationRow, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: copy.columns.product, size: 220 }),
            columnHelper.accessor((row) => row.product.group?.name || t.inventoryReports.reorder.uncategorized, {
                id: 'group',
                header: copy.columns.group,
                size: 160,
            }),
            columnHelper.accessor('quantity', {
                header: copy.columns.quantity,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 100,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('unitValue', {
                header: copy.columns.unitValue,
                cell: (info) => <span className="tabular-nums">{formatBDT(Number(info.getValue() || 0), { locale })}</span>,
                size: 110,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('stockValue', {
                header: copy.columns.stockValue,
                cell: (info) => (
                    <span className="tabular-nums text-sm font-bold text-blue-600">
                        {formatBDT(Number(info.getValue() || 0), { locale })}
                    </span>
                ),
                size: 130,
                meta: { align: 'end' },
            }),
        ],
        [copy, t.inventoryReports.reorder.uncategorized, locale],
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
        const items: ListStat[] = [
            {
                id: 'totalValue',
                icon: <Wallet aria-hidden />,
                label: copy.totalValue,
                value: formatBDT(Number(summary?.totalStockValue || 0), { locale }),
            },
            {
                id: 'totalQuantity',
                icon: <Boxes aria-hidden />,
                label: copy.totalQuantity,
                value: Number(summary?.totalQuantity ?? 0).toLocaleString(locale),
            },
            {
                id: 'productsWithStock',
                icon: <Package aria-hidden />,
                label: copy.productsWithStock,
                value: Number(summary?.productCount ?? 0).toLocaleString(locale),
            },
            {
                id: 'averageUnitValue',
                icon: <Calculator aria-hidden />,
                label: copy.averageUnitValue,
                value: formatBDT(Number(summary?.averageUnitValue || 0), { locale }),
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [summary, loading, locale, copy, listUi]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitleMeasure}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    copy.title,
                    'inventory',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<ValuationRow>
                tableId="inventory-valuation"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.emptyValuation}
                emptyIcon={<Calculator className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />
        </PageShell>
    );
}
