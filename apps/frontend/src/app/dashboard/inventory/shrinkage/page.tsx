'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../lib/api';
import { PostingBadge } from '@/components/PostingBadge';

interface ShrinkageRecord {
    id: string;
    reference_number: string;
    created_at: string;
    warehouse?: { name: string } | null;
    reason?: { label: string } | null;
    items: Array<{ id: string; quantity: number }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<ShrinkageRecord>();

export default function InventoryShrinkagePage() {
    const [records, setRecords] = useState<ShrinkageRecord[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [form, setForm] = useState<any>({
        warehouseId: '',
        reasonId: '',
        notes: '',
        items: [{ productId: '', quantity: 1 }],
    });

    useEffect(() => {
        void Promise.all([loadRecords(), loadOptions()]);
    }, []);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const data = await api.getInventoryShrinkage();
            setRecords(data);
        } catch (error) {
            console.error('Failed to load shrinkage records', error);
        } finally {
            setLoading(false);
        }
    };

    const loadOptions = async () => {
        try {
            const [warehouseData, reasonData, productData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getInventoryReasons({ type: 'SHRINKAGE' }),
                api.getProducts(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setReasons(reasonData.filter((reason: any) => reason.is_active));
            setProducts(productData);
        } catch (error) {
            console.error('Failed to load shrinkage options', error);
        }
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        try {
            await api.createInventoryShrinkage({
                warehouseId: form.warehouseId,
                reasonId: form.reasonId,
                notes: form.notes || undefined,
                items: form.items.map((item: any) => ({ productId: item.productId, quantity: Number(item.quantity) })),
            });
            setMessage('Shrinkage posted.');
            setForm({ warehouseId: '', reasonId: '', notes: '', items: [{ productId: '', quantity: 1 }] });
            await loadRecords();
        } catch (error: any) {
            setMessage(error.message || 'Failed to post shrinkage.');
        }
    };

    const columns: ColumnDef<ShrinkageRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('reference_number', { header: 'Reference', size: 150 }),
            columnHelper.accessor((row) => row.warehouse?.name || '-', { id: 'warehouse', header: 'Warehouse', size: 180 }),
            columnHelper.accessor((row) => row.reason?.label || '-', { id: 'reason', header: 'Reason', size: 170 }),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + item.quantity, 0), { id: 'quantity', header: 'Total Qty', size: 110 }),
            columnHelper.accessor('created_at', {
                header: 'Created',
                cell: (info) => new Date(info.getValue()).toLocaleString(),
                size: 170,
            }),
            columnHelper.display({
                id: 'posting',
                header: 'Voucher',
                cell: ({ row }) => (
                    <PostingBadge
                        status={row.original.posting_status}
                        voucherNumber={row.original.voucher_number}
                    />
                ),
                size: 120,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Inventory Shrinkage</h1>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                        Record damaged, lost, or stolen stock separately from sales and returns
                    </p>
                </div>

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-rose-600" />
                        <h2 className="font-black text-lg">New Shrinkage Entry</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-3 gap-4">
                        <select required value={form.warehouseId} onChange={(e) => setForm((current: any) => ({ ...current, warehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="">Select warehouse</option>
                            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                        </select>
                        <select required value={form.reasonId} onChange={(e) => setForm((current: any) => ({ ...current, reasonId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="">Select reason</option>
                            {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                        </select>
                        <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder="Notes" />
                    </div>
                    <div className="space-y-3">
                        {form.items.map((item: any, index: number) => (
                            <div key={index} className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-end">
                                <select required value={item.productId} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, productId: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                    <option value="">Select product</option>
                                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                                </select>
                                <input type="number" min="1" value={item.quantity} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, quantity: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                                <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: current.items.length === 1 ? current.items : current.items.filter((_: any, lineIndex: number) => lineIndex !== index) }))} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-xl text-sm font-bold">Remove</button>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: [...current.items, { productId: '', quantity: 1 }] }))} className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center">
                            <Plus className="w-4 h-4 mr-2" /> Add Line
                        </button>
                        <button type="submit" className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-rose-200">Post Shrinkage</button>
                    </div>
                </form>

                <DataTable<ShrinkageRecord>
                    tableId="inventory-shrinkage"
                    columns={columns}
                    data={records}
                    title="Inventory Shrinkage"
                    isLoading={loading}
                    emptyMessage="No shrinkage records yet"
                    emptyIcon={<AlertTriangle className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search shrinkage records..."
                />
            </div>
        </div>
    );
}