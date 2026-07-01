'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
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
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [subgroups, setSubgroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
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
    }, [warehouseId, reasonId, groupId, subgroupId, fromDate, toDate]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const data = await api.getShrinkageSummary({
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

    const loadFilters = async () => {
        try {
            const [warehouseData, reasonData, groupData, subgroupData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getInventoryReasons({ type: 'SHRINKAGE' }),
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

    const filteredSubgroups = useMemo(
        () => subgroups.filter((subgroup: any) => !groupId || subgroup.group_id === groupId),
        [subgroups, groupId],
    );

    const columns: ColumnDef<ShrinkageSummaryRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('warehouseName', { header: t.inventoryReports.shrinkage.columns.warehouse, size: 220 }),
            columnHelper.accessor('reasonLabel', { header: t.inventoryReports.shrinkage.columns.reason, size: 220 }),
            columnHelper.accessor('quantity', { header: t.inventoryReports.shrinkage.columns.quantityLost, size: 120 }),
            columnHelper.accessor('value', {
                header: t.inventoryReports.shrinkage.columns.estimatedValue,
                cell: (info) => <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue()))}</span>,
                size: 150,
            }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventoryReports.shrinkage.title}</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.inventoryReports.shrinkage.subtitleTrack}
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.shrinkage.totalUnitsLost}</div>
                        <div className="mt-2 text-2xl font-black text-gray-900">{report.summary?.totalQuantity ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.shrinkage.estimatedValueLost}</div>
                        <div className="mt-2 text-2xl font-black text-rose-600">{formatBDT(Number(report.summary?.totalValue ?? 0))}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryReports.shrinkage.topDriver}</div>
                        <div className="mt-2 text-lg font-black text-gray-900">{report.summary?.topReasons?.[0]?.reasonLabel || t.inventoryReports.shrinkage.noShrinkageLogged}</div>
                        <div className="text-sm text-gray-500">{report.summary?.topReasons?.[0]?.warehouseName || t.inventoryReports.shrinkage.allWarehousesLabel}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 grid md:grid-cols-6 gap-3 items-end">
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.reorder.allWarehouses}</option>
                        {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryReports.shrinkage.allReasons}</option>
                        {reasons.map((reason: any) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
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
                    emptyMessage={t.inventoryReports.shrinkage.emptyFiltered}
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryReports.shrinkage.searchPlaceholder}
                />
            </div>
        </div>
    );
}