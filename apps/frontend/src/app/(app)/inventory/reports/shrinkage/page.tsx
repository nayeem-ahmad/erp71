'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Award, Boxes, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import { formatBDT } from '@/lib/format';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';
import { BranchFilter } from '@/components/ui';
import { branchOrEmpty, handleBranchForbidden, useBranchBoundState, useBranchScope } from '@/lib/branch-scope';

interface ShrinkageSummaryRow {
    warehouseName: string;
    reasonLabel: string;
    quantity: number;
    value: number;
}

const columnHelper = createColumnHelper<ShrinkageSummaryRow>();

export default function ShrinkageReportPage() {
    const { t, locale } = useI18n();
    const copy = t.inventoryReports.shrinkage;
    const listUi = t.inventoryReports.listUi;
    const branch = useBranchScope();
    const [report, setReport] = useState<any>({ summary: { totalQuantity: 0, totalValue: 0, topReasons: [] }, rows: [], detailRows: [] });
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    // The report answers one direction at a time. Netting a theft against a
    // miscount would report neither, so there is no "both" option — LOSS is the
    // default because this is the shrinkage report.
    const [direction, setDirection] = useState<'LOSS' | 'FOUND'>('LOSS');
    const [warehouseId, setWarehouseId] = useBranchBoundState(branch.apiStoreId);
    const storeId = branchOrEmpty(branch.apiStoreId);
    const [reasonId, setReasonId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [dateRange, setDateRange] = useState<CreatedRange>({});

    useEffect(() => {
        void loadFilters();
    }, []);

    useEffect(() => {
        if (!branch.ready) return;
        void loadReport();
    }, [branch.ready, branch.apiStoreId, direction, warehouseId, reasonId, groupId, subgroupId, dateRange]);

    const loadReport = async () => {
        setLoading(true);
        try {
            // Shrinkage API expects `from`/`to`; applyCreatedRangeQuery yields createdFrom/createdTo.
            const range = applyCreatedRangeQuery(dateRange);
            const data = await api.getShrinkageSummary({
                direction,
                storeId: branch.apiStoreId,
                warehouseId: warehouseId || undefined,
                reasonId: reasonId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
                from: range.createdFrom,
                to: range.createdTo,
            });
            setReport(data);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load shrinkage report', error);
        } finally {
            setLoading(false);
        }
    };

    // Both reason catalogues in one call: a SHRINKAGE reason can never appear on
    // a FOUND row, so the picker is narrowed client-side as the direction flips
    // rather than refetched.
    const loadFilters = async () => {
        try {
            const [warehouseData, reasonData, groupData, subgroupData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getInventoryReasons(),
                api.getProductGroups(),
                api.getProductSubgroups(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setReasons(reasonData.filter((reason: any) => reason.is_active));
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load shrinkage report filters', error);
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

    const visibleReasons = useMemo(
        () => reasons.filter((reason: any) => reason.type === (direction === 'FOUND' ? 'FOUND' : 'SHRINKAGE')),
        [reasons, direction],
    );

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const isFound = direction === 'FOUND';

    const columns: ColumnDef<ShrinkageSummaryRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('warehouseName', { header: copy.columns.warehouse, size: 220 }),
            columnHelper.accessor('reasonLabel', { header: copy.columns.reason, size: 220 }),
            columnHelper.accessor('quantity', {
                header: isFound ? copy.columns.quantityFound : copy.columns.quantityLost,
                cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
                size: 120,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('value', {
                header: copy.columns.estimatedValue,
                // Red states a loss. A surplus is not one, and colouring it the
                // same would read as money gone on a number that is money back.
                cell: (info) => (
                    <span className={`tabular-nums text-sm font-bold ${isFound ? 'text-gray-900' : 'text-danger'}`}>
                        {formatBDT(Number(info.getValue()), { locale })}
                    </span>
                ),
                size: 150,
                meta: { align: 'end' },
            }),
        ],
        [copy, isFound, locale],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'direction',
                type: 'select',
                label: copy.direction,
                value: direction,
                // A reason belongs to one direction only, so a reason left over
                // from the other side would filter the report down to nothing.
                onChange: (v) => {
                    setDirection((v as 'LOSS' | 'FOUND') ?? 'LOSS');
                    setReasonId('');
                },
                required: true,
                defaultValue: 'LOSS',
                options: [
                    { value: 'LOSS', label: copy.directionLoss },
                    { value: 'FOUND', label: copy.directionFound },
                ],
            },
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
                id: 'reason',
                type: 'select',
                label: copy.columns.reason,
                value: reasonId || null,
                onChange: (v) => setReasonId(v ?? ''),
                options: visibleReasons.map((reason: any) => ({ value: reason.id, label: reason.label })),
            },
            {
                id: 'group',
                type: 'select',
                label: t.inventoryReports.reorder.columns.group,
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
            {
                id: 'period',
                type: 'date-range',
                label: t.common.date,
                value: dateRange,
                onChange: (next) => setDateRange(next ?? {}),
            },
        ],
        [
            t,
            copy,
            direction,
            warehouseId,
            visibleWarehouses,
            reasonId,
            visibleReasons,
            groupId,
            groups,
            subgroupId,
            filteredSubgroups,
            dateRange,
        ],
    );

    const topDriver = report.summary?.topReasons?.[0];
    const stats = useMemo(() => {
        const items: ListStat[] = [
            {
                id: 'totalQuantity',
                icon: <Boxes aria-hidden />,
                label: isFound ? copy.totalUnitsFound : copy.totalUnitsLost,
                value: Number(report.summary?.totalQuantity ?? 0).toLocaleString(locale),
            },
            {
                id: 'totalValue',
                icon: <Wallet aria-hidden />,
                label: isFound ? copy.estimatedValueFound : copy.estimatedValueLost,
                value: formatBDT(Number(report.summary?.totalValue ?? 0), { locale }),
                tone: isFound ? 'default' : 'danger',
            },
            {
                id: 'topDriver',
                icon: <Award aria-hidden />,
                label: copy.topDriver,
                value: topDriver?.reasonLabel || (isFound ? copy.noFoundLogged : copy.noShrinkageLogged),
                hint: topDriver?.warehouseName || copy.allWarehousesLabel,
            },
        ];
        return { items, loading, label: listUi.statsLabel };
    }, [report.summary, topDriver, isFound, loading, locale, copy, listUi]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitleTrack}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.inventory,
                    copy.title,
                    'inventory',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<ShrinkageSummaryRow>
                tableId="inventory-shrinkage-report"
                columns={columns}
                data={report.rows || []}
                title={copy.shrinkageSummary}
                isLoading={loading}
                emptyMessage={isFound ? copy.emptyFoundMessage : copy.emptyFiltered}
                emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
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
