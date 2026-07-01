'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Plus } from 'lucide-react';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import { DataTable } from '@/components/data-table';
import { STOCK_TAKES_FIELD_HELP, STOCK_TAKES_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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
    const { t } = useI18n();
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
            setMessage(t.inventoryStockTakes.sessionCreated);
            setForm({ warehouseId: '', notes: '', startImmediately: true });
            await loadSessions();
        } catch (error: any) {
            setMessage(error.message || t.inventoryStockTakes.createFailed);
        }
    };

    const columns: ColumnDef<StockTakeSession, any>[] = useMemo(
        () => [
            columnHelper.accessor('session_number', { header: t.inventoryStockTakes.columns.sessionNumber, size: 150 }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', { id: 'warehouse', header: t.inventoryStockTakes.columns.warehouse, size: 180 }),
            columnHelper.accessor('status', { header: t.inventoryStockTakes.columns.status, size: 140 }),
            columnHelper.accessor((row) => `${row.summary?.countedLines ?? 0}/${row.summary?.totalLines ?? 0}`, { id: 'progress', header: t.inventoryStockTakes.columns.progress, size: 120 }),
            columnHelper.accessor((row) => row.summary?.discrepantLines ?? 0, { id: 'discrepancies', header: t.inventoryStockTakes.columns.discrepancies, size: 120 }),
            columnHelper.accessor('created_at', {
                header: t.inventoryStockTakes.columns.created,
                cell: (info) => new Date(info.getValue()).toLocaleString(),
                size: 170,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.inventoryStockTakes.columns.actions,
                cell: (info) => <Link href={`/inventory/stock-takes/${info.row.original.id}`} className="text-sm font-black text-blue-700 hover:text-blue-900">{t.inventoryStockTakes.columns.open}</Link>,
                size: 100,
            }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950 inline-flex items-center gap-2">
                        {t.inventoryStockTakes.title}
                        <HelpTooltip text={STOCK_TAKES_FIELD_HELP.page} wide />
                    </h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {t.inventoryStockTakes.subtitle}
                    </p>
                </div>

                <ContextualHelpPanel {...STOCK_TAKES_HELP} />

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">{t.inventoryStockTakes.newSession}</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-3 gap-4">
                        <label className="space-y-1">
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400 inline-flex items-center gap-1.5">
                                {t.inventoryStockTakes.warehouse}
                                <HelpTooltip text={STOCK_TAKES_FIELD_HELP.warehouse} side="top" />
                            </span>
                            <select required value={form.warehouseId} onChange={(e) => setForm((current: any) => ({ ...current, warehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">{t.inventoryStockTakes.selectWarehouse}</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                            </select>
                        </label>
                        <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium self-end" placeholder={t.inventoryStockTakes.sessionNotes} />
                        <label className="flex items-center gap-2 text-sm font-bold text-gray-700 px-2 self-end">
                            <input type="checkbox" checked={form.startImmediately} onChange={(e) => setForm((current: any) => ({ ...current, startImmediately: e.target.checked }))} />
                            <span className="inline-flex items-center gap-1.5">
                                {t.inventoryStockTakes.startImmediately}
                                <HelpTooltip text={STOCK_TAKES_FIELD_HELP.startImmediately} side="top" />
                            </span>
                        </label>
                    </div>
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200">
                        <Plus className="w-4 h-4 mr-2" /> {t.inventoryStockTakes.createSession}
                    </button>
                </form>

                <DataTable<StockTakeSession>
                    tableId="inventory-stock-takes"
                    columns={columns}
                    data={sessions}
                    title={t.inventoryStockTakes.sessionsTitle}
                    isLoading={loading}
                    emptyMessage={t.inventoryStockTakes.emptyMessage}
                    emptyIcon={<ClipboardCheck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryStockTakes.searchPlaceholder}
                />
            </div>
        </div>
    );
}