'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Plus } from 'lucide-react';
import { HelpTooltip } from '@/components/HelpTooltip';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../lib/api';

interface StockTakeSession {
    id: string;
    session_number: string;
    status: string;
    created_at: string;
    warehouse?: { name: string } | null;
    summary?: { countedLines: number; totalLines: number; discrepantLines: number };
}

const columnHelper = createColumnHelper<StockTakeSession>();

export default function StockTakesPage() {
    const [sessions, setSessions] = useState<StockTakeSession[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<any>({ warehouseId: '', notes: '', startImmediately: true });
    const [message, setMessage] = useState('');

    useEffect(() => {
        void Promise.all([loadSessions(), loadWarehouses()]);
    }, []);

    const loadSessions = async () => {
        setLoading(true);
        try {
            const data = await api.getStockTakes();
            setSessions(data);
        } catch (error) {
            console.error('Failed to load stock takes', error);
        } finally {
            setLoading(false);
        }
    };

    const loadWarehouses = async () => {
        try {
            const data = await api.getInventoryWarehouses();
            setWarehouses(data.filter((warehouse: any) => warehouse.is_active));
        } catch (error) {
            console.error('Failed to load warehouses', error);
        }
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        try {
            await api.createStockTake(form);
            setMessage('Stock-take session created.');
            setForm({ warehouseId: '', notes: '', startImmediately: true });
            await loadSessions();
        } catch (error: any) {
            setMessage(error.message || 'Failed to create stock-take session.');
        }
    };

    const columns: ColumnDef<StockTakeSession, any>[] = useMemo(
        () => [
            columnHelper.accessor('session_number', { header: 'Session #', size: 150 }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', { id: 'warehouse', header: 'Warehouse', size: 180 }),
            columnHelper.accessor('status', { header: 'Status', size: 140 }),
            columnHelper.accessor((row) => `${row.summary?.countedLines ?? 0}/${row.summary?.totalLines ?? 0}`, { id: 'progress', header: 'Progress', size: 120 }),
            columnHelper.accessor((row) => row.summary?.discrepantLines ?? 0, { id: 'discrepancies', header: 'Discrepancies', size: 120 }),
            columnHelper.accessor('created_at', {
                header: 'Created',
                cell: (info) => new Date(info.getValue()).toLocaleString(),
                size: 170,
            }),
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => <Link href={`/dashboard/inventory/stock-takes/${info.row.original.id}`} className="text-sm font-black text-blue-700 hover:text-blue-900">Open</Link>,
                size: 100,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight inline-flex items-center gap-2">Stock Takes <HelpTooltip text="A stock take reconciles your recorded inventory against a physical count. Discrepancies create adjustment entries. Freeze stock movements before starting." /></h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Open warehouse counting sessions, capture discrepancies, and post reconciliations
                    </p>
                </div>

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">New Stock-Take Session</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-3 gap-4">
                        <select required value={form.warehouseId} onChange={(e) => setForm((current: any) => ({ ...current, warehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="">Select warehouse</option>
                            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                        </select>
                        <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder="Session notes" />
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 px-2">
                            <input type="checkbox" checked={form.startImmediately} onChange={(e) => setForm((current: any) => ({ ...current, startImmediately: e.target.checked }))} />
                            Start counting immediately
                        </label>
                    </div>
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200">
                        <Plus className="w-4 h-4 mr-2" /> Create Session
                    </button>
                </form>

                <DataTable<StockTakeSession>
                    tableId="inventory-stock-takes"
                    columns={columns}
                    data={sessions}
                    title="Stock-Take Sessions"
                    isLoading={loading}
                    emptyMessage="No stock-take sessions recorded yet"
                    emptyIcon={<ClipboardCheck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search stock takes..."
                />
            </div>
        </div>
    );
}