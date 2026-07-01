'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BookOpen, RefreshCw } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface LedgerRow {
    id: string;
    movement_type: string;
    quantity_delta: number;
    balance_after?: number | null;
    reference_type?: string | null;
    reference_id?: string | null;
    created_at: string;
    product?: { id: string; name: string; sku?: string | null } | null;
    warehouse?: { id: string; name: string } | null;
}

const columnHelper = createColumnHelper<LedgerRow>();

export default function InventoryLedgerPage() {
    const { t } = useI18n();
    const [rows, setRows] = useState<LedgerRow[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [warehouseId, setWarehouseId] = useState('');
    const [movementType, setMovementType] = useState('');

    useEffect(() => {
        void Promise.all([loadLedger(), loadWarehouses()]);
    }, []);

    useEffect(() => {
        void loadLedger();
    }, [warehouseId, movementType]);

    const loadLedger = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryLedger({ warehouseId: warehouseId || undefined, movementType: movementType || undefined });
            setRows(data);
        } catch (error) {
            console.error('Failed to load inventory ledger', error);
        } finally {
            setLoading(false);
        }
    };

    const loadWarehouses = async () => {
        try {
            const data = await api.getInventoryWarehouses();
            setWarehouses(data);
        } catch (error) {
            console.error('Failed to load warehouses', error);
        }
    };

    const columns: ColumnDef<LedgerRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('created_at', {
                header: t.inventoryLedger.columns.timestamp,
                cell: (info) => new Date(info.getValue()).toLocaleString(),
                size: 170,
            }),
            columnHelper.accessor((row) => row.product?.name || '-', {
                id: 'product',
                header: t.inventoryLedger.columns.product,
                size: 220,
            }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', {
                id: 'warehouse',
                header: t.inventoryLedger.columns.warehouse,
                size: 160,
            }),
            columnHelper.accessor('movement_type', {
                header: t.inventoryLedger.columns.movement,
                size: 160,
            }),
            columnHelper.accessor('quantity_delta', {
                header: t.inventoryLedger.columns.delta,
                cell: (info) => {
                    const value = Number(info.getValue() || 0);
                    return <span className={value >= 0 ? 'text-emerald-600 font-black' : 'text-rose-600 font-black'}>{value}</span>;
                },
                size: 80,
            }),
            columnHelper.accessor('balance_after', {
                header: t.inventoryLedger.columns.balance,
                cell: (info) => <span className="font-bold">{info.getValue() ?? '-'}</span>,
                size: 90,
            }),
            columnHelper.accessor((row) => row.reference_type && row.reference_id ? `${row.reference_type} • ${row.reference_id}` : '-', {
                id: 'reference',
                header: t.inventoryLedger.columns.reference,
                size: 220,
            }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventoryLedger.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.inventoryLedger.subtitle}
                        </p>
                    </div>
                    <button onClick={() => void loadLedger()} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center">
                        <RefreshCw className="w-4 h-4 mr-2" /> {t.common.refresh}
                    </button>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-wrap gap-3 items-end">
                    <div className="min-w-[220px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventoryLedger.warehouseLabel}</label>
                        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="">{t.inventoryLedger.allWarehouses}</option>
                            {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="min-w-[220px]">
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventoryLedger.movementType}</label>
                        <input value={movementType} onChange={(e) => setMovementType(e.target.value)} placeholder={t.inventoryLedger.movementPlaceholder} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    </div>
                </div>

                <DataTable<LedgerRow>
                    tableId="inventory-ledger"
                    columns={columns}
                    data={rows}
                    title={t.inventoryLedger.stockLedger}
                    isLoading={loading}
                    emptyMessage={t.inventoryLedger.emptyMessage}
                    emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryLedger.searchPlaceholder}
                />
            </div>
        </div>
    );
}