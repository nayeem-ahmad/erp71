'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';

interface ShrinkageSummaryRow {
    warehouseName: string;
    reasonLabel: string;
    quantity: number;
    value: number;
}

const columnHelper = createColumnHelper<ShrinkageSummaryRow>();

export default function ShrinkageReportPage() {
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
            columnHelper.accessor('warehouseName', { header: 'Warehouse', size: 220 }),
            columnHelper.accessor('reasonLabel', { header: 'Reason', size: 220 }),
            columnHelper.accessor('quantity', { header: 'Quantity Lost', size: 120 }),
            columnHelper.accessor('value', {
                header: 'Estimated Value',
                cell: (info) => <span className="text-sm font-black text-rose-600">{formatBDT(Number(info.getValue()))}</span>,
                size: 150,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Shrinkage Report</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Track inventory loss by warehouse, reason, and estimated value impact
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Units Lost</div>
                        <div className="mt-2 text-2xl font-black text-gray-900">{report.summary?.totalQuantity ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Estimated Value Lost</div>
                        <div className="mt-2 text-2xl font-black text-rose-600">{formatBDT(Number(report.summary?.totalValue ?? 0))}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Top Driver</div>
                        <div className="mt-2 text-lg font-black text-gray-900">{report.summary?.topReasons?.[0]?.reasonLabel || 'No shrinkage logged'}</div>
                        <div className="text-sm text-gray-500">{report.summary?.topReasons?.[0]?.warehouseName || 'All warehouses'}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 grid md:grid-cols-6 gap-3 items-end">
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Warehouses</option>
                        {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Reasons</option>
                        {reasons.map((reason: any) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                    </select>
                    <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Groups</option>
                        {groups.map((group: any) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Subgroups</option>
                        {filteredSubgroups.map((subgroup: any) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                    </select>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                </div>

                <DataTable<ShrinkageSummaryRow>
                    tableId="inventory-shrinkage-report"
                    columns={columns}
                    data={report.rows || []}
                    title="Shrinkage Summary"
                    isLoading={loading}
                    emptyMessage="No shrinkage records match the current filters"
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search shrinkage summary..."
                />
            </div>
        </div>
    );
}