'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Calculator } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';

interface ValuationRow {
    product: { id: string; name: string; group?: { name: string } | null; subgroup?: { name: string } | null };
    quantity: number;
    unitValue: number;
    stockValue: number;
}

const columnHelper = createColumnHelper<ValuationRow>();

export default function InventoryValuationPage() {
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
            columnHelper.accessor((row) => row.product.name, { id: 'product', header: 'Product', size: 220 }),
            columnHelper.accessor((row) => row.product.group?.name || 'Uncategorized', { id: 'group', header: 'Group', size: 160 }),
            columnHelper.accessor('quantity', { header: 'Quantity', size: 100 }),
            columnHelper.accessor('unitValue', {
                header: 'Unit Value',
                cell: (info) => formatBDT(Number(info.getValue() || 0)),
                size: 110,
            }),
            columnHelper.accessor('stockValue', {
                header: 'Stock Value',
                cell: (info) => <span className="text-sm font-black text-blue-600">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 130,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Inventory Valuation</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Measure on-hand stock value across products, categories, and warehouses
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Stock Value</div>
                        <div className="text-2xl font-black text-blue-700 mt-2">{formatBDT(Number(summary?.totalStockValue || 0))}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Quantity</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.totalQuantity ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Products With Stock</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{summary?.productCount ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Average Unit Value</div>
                        <div className="text-2xl font-black text-gray-900 mt-2">{formatBDT(Number(summary?.averageUnitValue || 0))}</div>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">All Warehouses</option>
                        {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSubgroupId(''); }} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">All Groups</option>
                        {groups.map((group: any) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <select value={subgroupId} onChange={(e) => setSubgroupId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium min-w-[220px]">
                        <option value="">All Subgroups</option>
                        {filteredSubgroups.map((subgroup: any) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                    </select>
                </div>

                <DataTable<ValuationRow>
                    tableId="inventory-valuation"
                    columns={columns}
                    data={rows}
                    title="Inventory Valuation"
                    isLoading={loading}
                    emptyMessage="No inventory valuation data available"
                    emptyIcon={<Calculator className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search inventory valuation..."
                />
            </div>
        </div>
    );
}