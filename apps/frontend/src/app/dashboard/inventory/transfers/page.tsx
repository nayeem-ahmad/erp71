'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, Plus, Truck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../lib/api';
import { PostingBadge } from '@/components/PostingBadge';

interface WarehouseTransfer {
    id: string;
    transfer_number: string;
    status: string;
    created_at: string;
    sent_at?: string | null;
    received_at?: string | null;
    sourceWarehouse?: { id: string; name: string } | null;
    destinationWarehouse?: { id: string; name: string } | null;
    items: Array<{ id: string; product_id: string; quantity_sent: number; quantity_received: number; product?: { name: string } | null }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<WarehouseTransfer>();

export default function InventoryTransfersPage() {
    const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
    const [productId, setProductId] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [form, setForm] = useState<any>({
        sourceWarehouseId: '',
        destinationWarehouseId: '',
        status: 'SENT',
        notes: '',
        items: [{ productId: '', quantity: 1 }],
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        void Promise.all([loadTransfers(), loadOptions()]);
    }, []);

    useEffect(() => {
        void loadTransfers();
    }, [statusFilter, sourceWarehouseId, destinationWarehouseId, productId, fromDate, toDate]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const product = params.get('productId');
        if (product) {
            setProductId(product);
        }
    }, []);

    const loadTransfers = async () => {
        setLoading(true);
        try {
            const data = await api.getWarehouseTransfers({
                status: statusFilter || undefined,
                sourceWarehouseId: sourceWarehouseId || undefined,
                destinationWarehouseId: destinationWarehouseId || undefined,
                productId: productId || undefined,
                from: fromDate || undefined,
                to: toDate || undefined,
            });
            setTransfers(data);
        } catch (error) {
            console.error('Failed to load warehouse transfers', error);
        } finally {
            setLoading(false);
        }
    };

    const loadOptions = async () => {
        try {
            const [warehouseData, productData] = await Promise.all([api.getInventoryWarehouses(), api.getProducts()]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setProducts(productData);
        } catch (error) {
            console.error('Failed to load transfer options', error);
        }
    };

    const handleCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        try {
            await api.createWarehouseTransfer({
                sourceWarehouseId: form.sourceWarehouseId,
                destinationWarehouseId: form.destinationWarehouseId,
                status: form.status,
                notes: form.notes || undefined,
                items: form.items.map((item: any) => ({
                    productId: item.productId,
                    quantity: Number(item.quantity),
                })),
            });
            setMessage('Transfer created.');
            setForm({
                sourceWarehouseId: '',
                destinationWarehouseId: '',
                status: 'SENT',
                notes: '',
                items: [{ productId: '', quantity: 1 }],
            });
            await loadTransfers();
        } catch (error: any) {
            setMessage(error.message || 'Failed to create transfer.');
        }
    };

    const columns: ColumnDef<WarehouseTransfer, any>[] = useMemo(
        () => [
            columnHelper.accessor('transfer_number', {
                header: 'Transfer #',
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.sourceWarehouse?.name || '-', {
                id: 'sourceWarehouse',
                header: 'Source',
                size: 170,
            }),
            columnHelper.accessor((row) => row.destinationWarehouse?.name || '-', {
                id: 'destinationWarehouse',
                header: 'Destination',
                size: 170,
            }),
            columnHelper.accessor('status', {
                header: 'Status',
                cell: (info) => <span className="text-xs font-black uppercase tracking-widest text-blue-700">{info.getValue()}</span>,
                size: 140,
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: 'Products',
                cell: (info) => <span className="text-sm text-gray-600 line-clamp-2">{info.getValue() || '-'}</span>,
                size: 260,
            }),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + (item.quantity_sent - item.quantity_received), 0), {
                id: 'outstanding',
                header: 'Outstanding',
                size: 110,
            }),
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
            columnHelper.display({
                id: 'actions',
                header: 'Actions',
                cell: (info) => (
                    <Link href={`/dashboard/inventory/transfers/${info.row.original.id}`} className="text-sm font-black text-blue-700 hover:text-blue-900">
                        View
                    </Link>
                ),
                size: 100,
            }),
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Warehouse Transfers</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Send stock between warehouses and receive it only when it physically arrives
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700">
                            <option value="">All Statuses</option>
                            <option value="DRAFT">Draft</option>
                            <option value="SENT">Sent</option>
                            <option value="PARTIALLY_RECEIVED">Partially Received</option>
                            <option value="RECEIVED">Received</option>
                        </select>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 grid md:grid-cols-5 gap-3 items-end">
                    <select value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Sources</option>
                        {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Destinations</option>
                        {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">All Products</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                </div>

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Truck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">New Transfer</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Source Warehouse</label>
                            <select required value={form.sourceWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, sourceWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">Select source</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Destination Warehouse</label>
                            <select required value={form.destinationWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, destinationWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">Select destination</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Initial Status</label>
                            <select value={form.status} onChange={(e) => setForm((current: any) => ({ ...current, status: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="SENT">Send Now</option>
                                <option value="DRAFT">Save as Draft</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Notes</label>
                            <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder="Optional" />
                        </div>
                    </div>

                    <div className="space-y-3">
                        {form.items.map((item: any, index: number) => (
                            <div key={index} className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-end">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Product</label>
                                    <select required value={item.productId} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, productId: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                        <option value="">Select product</option>
                                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Quantity</label>
                                    <input type="number" min="1" value={item.quantity} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, quantity: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                                </div>
                                <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: current.items.length === 1 ? current.items : current.items.filter((_: any, lineIndex: number) => lineIndex !== index) }))} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-xl text-sm font-bold">
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: [...current.items, { productId: '', quantity: 1 }] }))} className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center">
                            <Plus className="w-4 h-4 mr-2" /> Add Line
                        </button>
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200">
                            <ArrowRightLeft className="w-4 h-4 mr-2" /> Create Transfer
                        </button>
                    </div>
                </form>

                <DataTable<WarehouseTransfer>
                    tableId="inventory-transfers"
                    columns={columns}
                    data={transfers}
                    title="Warehouse Transfers"
                    isLoading={loading}
                    emptyMessage="No warehouse transfers recorded yet"
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search transfers..."
                />
            </div>
        </div>
    );
}