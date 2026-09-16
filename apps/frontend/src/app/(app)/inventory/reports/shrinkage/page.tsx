'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { warehouseLabel } from '@/lib/warehouse-label';
import { formatBDT } from '@/lib/format';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';

interface ShrinkageSummaryRow {
    warehouseName: string;
    reasonLabel: string;
    quantity: number;
    value: number;
}

const columnHelper = createColumnHelper<ShrinkageSummaryRow>();

export default function ShrinkageReportPage() {
    const { t } = useI18n();
    const [report, setReport] = useState<any>({ summary: { totalQuantity: 0, totalValue: 0, topReasons: [] }, rows: [], detailRows: [] });
    const [stores, setStores] = useState<any[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    // The report answers one direction at a time. Netting a theft against a
    // miscount would report neither, so there is no "both" option — LOSS is the
    // default because this is the shrinkage report.
    const [direction, setDirection] = useState<'LOSS' | 'FOUND'>('LOSS');
    const [storeId, setStoreId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [reasonId, setReasonId] = useState('');
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    useEffect(() => {
        void Promise.all([loadReport(), loadFilters()]);
    }, []);

    useEffect(() => {
        void loadReport();
    }, [direction, storeId, warehouseId, reasonId, groupId, subgroupId, fromDate, toDate]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getShrinkageSummary({
                direction,
                storeId: storeId || undefined,
                warehouseId: warehouseId || undefined,
                reasonId: reasonId || undefined,
                groupId: groupId || undefined,
                subgroupId: subgroupId || undefined,
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setReport(data);
        } catch (error) {
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
            const [storeData, warehouseData, reasonData, groupData, subgroupData] = await Promise.all([
                api.getStores(),
                api.getInventoryWarehouses(),
                api.getInventoryReasons(),
                api.getProductGroups(),
                api.getProductSubgroups(),
            ]);
            setStores(storeData);
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
    // get from `useWarehouses`. The branch select clears `warehouseId` on the way
    // past: the two filters are AND-ed server-side, so a warehouse left over from
    // another branch would report nothing at all.
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
            columnHelper.accessor('warehouseName', { header: t.inventoryReports.shrinkage.columns.warehouse, size: 220 }),
            columnHelper.accessor('reasonLabel', { header: t.inventoryReports.shrinkage.columns.reason, size: 220 }),
            columnHelper.accessor('quantity', {
                header: isFound
                    ? t.inventoryReports.shrinkage.columns.quantityFound
                    : t.inventoryReports.shrinkage.columns.quantityLost,
                size: 120,
            }),
            columnHelper.accessor('value', {
                header: t.inventoryReports.shrinkage.columns.estimatedValue,
                // Red states a loss. A surplus is not one, and colouring it the
                // same would read as money gone on a number that is money back.
                cell: (info) => (
                    <span className={`text-sm font-bold ${isFound ? 'text-gray-900' : 'text-danger'}`}>
                        {formatBDT(Number(info.getValue()))}
                    </span>
                ),
                size: 150,
            }),
        ],
        [t, isFound],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.inventoryReports.shrinkage.title}
                    subtitle={t.inventoryReports.shrinkage.subtitleTrack}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventoryReports.shrinkage.title,
                        'inventory',
                    )}
                />

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white border border-gray-100 rounded-lg p-4">
                        <div className="text-xs font-medium text-gray-500">
                            {isFound ? t.inventoryReports.shrinkage.totalUnitsFound : t.inventoryReports.shrinkage.totalUnitsLost}
                        </div>
                        <div className="mt-2 text-2xl font-bold text-gray-900">{report.summary?.totalQuantity ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-lg p-4">
                        <div className="text-xs font-medium text-gray-500">
                            {isFound ? t.inventoryReports.shrinkage.estimatedValueFound : t.inventoryReports.shrinkage.estimatedValueLost}
                        </div>
                        <div className={`mt-2 text-2xl font-bold ${isFound ? 'text-gray-900' : 'text-danger'}`}>
                            {formatBDT(Number(report.summary?.totalValue ?? 0))}
                        </div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-lg p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.shrinkage.topDriver}</div>
                        <div className="mt-2 text-lg font-bold text-gray-900">{report.summary?.topReasons?.[0]?.reasonLabel || (isFound ? t.inventoryReports.shrinkage.noFoundLogged : t.inventoryReports.shrinkage.noShrinkageLogged)}</div>
                        <div className="text-sm text-gray-500">{report.summary?.topReasons?.[0]?.warehouseName || t.inventoryReports.shrinkage.allWarehousesLabel}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-lg p-4 grid md:grid-cols-4 gap-3 items-end">
                    <select
                        value={direction}
                        // A reason belongs to one direction only, so a reason
                        // left over from the other side would filter the report
                        // down to nothing.
                        onChange={(e) => { setDirection(e.target.value as 'LOSS' | 'FOUND'); setReasonId(''); }}
                        aria-label={t.inventoryReports.shrinkage.direction}
                        className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                    >
                        <option value="LOSS">{t.inventoryReports.shrinkage.directionLoss}</option>
                        <option value="FOUND">{t.inventoryReports.shrinkage.directionFound}</option>
                    </select>
                    <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setWarehouseId(''); }} aria-label={t.inventoryReports.reorder.allBranches} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.reorder.allBranches}</option>
                        {stores.map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                    </select>
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.reorder.allWarehouses}</option>
                        {visibleWarehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse, visibleWarehouses)}</option>)}
                    </select>
                    <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.shrinkage.allReasons}</option>
                        {visibleReasons.map((reason: any) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                    </select>
                    <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.reorder.allGroups}</option>
                        {groups.map((group: any) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.reorder.allSubgroups}</option>
                        {filteredSubgroups.map((subgroup: any) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                    </select>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                </div>

                <DataTable<ShrinkageSummaryRow>
                    tableId="inventory-shrinkage-report"
                    columns={columns}
                    data={report.rows || []}
                    title={t.inventoryReports.shrinkage.shrinkageSummary}
                    isLoading={loading}
                    emptyMessage={isFound ? t.inventoryReports.shrinkage.emptyFoundMessage : t.inventoryReports.shrinkage.emptyFiltered}
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryReports.shrinkage.searchPlaceholder}
                />
    </PageShell>
    );
}