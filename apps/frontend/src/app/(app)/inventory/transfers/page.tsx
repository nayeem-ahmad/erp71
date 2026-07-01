'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, Plus, Truck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { PostingBadge } from '@/components/PostingBadge';
import { useI18n } from '@/lib/i18n';

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
    const { t } = useI18n();
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
            setMessage(t.inventoryTransfers.transferCreated);
            setForm({
                sourceWarehouseId: '',
                destinationWarehouseId: '',
                status: 'SENT',
                notes: '',
                items: [{ productId: '', quantity: 1 }],
            });
            await loadTransfers();
        } catch (error: any) {
            setMessage(error.message || t.inventoryTransfers.createFailed);
        }
    };

    const columns: ColumnDef<WarehouseTransfer, any>[] = useMemo(
        () => [
            columnHelper.accessor('transfer_number', {
                header: t.inventoryTransfers.columns.transferNumber,
                cell: (info) => <span className="text-sm font-black text-gray-900">{info.getValue()}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.sourceWarehouse?.name || '-', {
                id: 'sourceWarehouse',
                header: t.inventoryTransfers.columns.source,
                size: 170,
            }),
            columnHelper.accessor((row) => row.destinationWarehouse?.name || '-', {
                id: 'destinationWarehouse',
                header: t.inventoryTransfers.columns.destination,
                size: 170,
            }),
            columnHelper.accessor('status', {
                header: t.common.status,
                cell: (info) => <span className="text-xs font-black uppercase tracking-widest text-blue-700">{info.getValue()}</span>,
                size: 140,
            }),
            columnHelper.accessor((row) => row.items.map((item) => item.product?.name).filter(Boolean).join(', '), {
                id: 'products',
                header: t.nav.products,
                cell: (info) => <span className="text-sm text-gray-600 line-clamp-2">{info.getValue() || '-'}</span>,
                size: 260,
            }),
            columnHelper.accessor((row) => row.items.reduce((sum, item) => sum + (item.quantity_sent - item.quantity_received), 0), {
                id: 'outstanding',
                header: t.inventoryTransfers.columns.outstanding,
                size: 110,
            }),
            columnHelper.accessor('created_at', {
                header: t.inventoryTransfers.columns.created,
                cell: (info) => new Date(info.getValue()).toLocaleString(),
                size: 170,
            }),
            columnHelper.display({
                id: 'posting',
                header: t.inventoryTransfers.columns.voucher,
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
                header: t.common.actions,
                cell: (info) => (
                    <Link href={`/inventory/transfers/${info.row.original.id}`} className="text-sm font-black text-blue-700 hover:text-blue-900">
                        {t.common.view}
                    </Link>
                ),
                size: 100,
            }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.inventoryTransfers.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.inventoryTransfers.subtitle}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700">
                            <option value="">{t.inventoryTransfers.allStatuses}</option>
                            <option value="DRAFT">{t.inventoryTransfers.statuses.draft}</option>
                            <option value="SENT">{t.inventoryTransfers.statuses.sent}</option>
                            <option value="PARTIALLY_RECEIVED">{t.inventoryTransfers.statuses.partiallyReceived}</option>
                            <option value="RECEIVED">{t.inventoryTransfers.statuses.received}</option>
                        </select>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 grid md:grid-cols-5 gap-3 items-end">
                    <select value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allSources}</option>
                        {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allDestinations}</option>
                        {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                    <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allProducts}</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                </div>

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Truck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-black text-lg">{t.inventoryTransfers.newTransfer}</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventoryTransfers.sourceWarehouse}</label>
                            <select required value={form.sourceWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, sourceWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">{t.inventoryTransfers.selectSource}</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventoryTransfers.destinationWarehouse}</label>
                            <select required value={form.destinationWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, destinationWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">{t.inventoryTransfers.selectDestination}</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.inventoryTransfers.initialStatus}</label>
                            <select value={form.status} onChange={(e) => setForm((current: any) => ({ ...current, status: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="SENT">{t.inventoryTransfers.sendNow}</option>
                                <option value="DRAFT">{t.inventoryTransfers.saveAsDraft}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.common.notes}</label>
                            <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.common.optional} />
                        </div>
                    </div>

                    <div className="space-y-3">
                        {form.items.map((item: any, index: number) => (
                            <div key={index} className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-end">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.common.product}</label>
                                    <select required value={item.productId} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, productId: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                        <option value="">{t.inventoryTransfers.selectProduct}</option>
                                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">{t.common.quantity}</label>
                                    <input type="number" min="1" value={item.quantity} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, quantity: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" />
                                </div>
                                <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: current.items.length === 1 ? current.items : current.items.filter((_: any, lineIndex: number) => lineIndex !== index) }))} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-xl text-sm font-bold">
                                    {t.inventoryShrinkage.remove}
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setForm((current: any) => ({ ...current, items: [...current.items, { productId: '', quantity: 1 }] }))} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center">
                            <Plus className="w-4 h-4 mr-2" /> {t.inventoryTransfers.addLine}
                        </button>
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200">
                            <ArrowRightLeft className="w-4 h-4 mr-2" /> {t.inventoryTransfers.createTransfer}
                        </button>
                    </div>
                </form>

                <DataTable<WarehouseTransfer>
                    tableId="inventory-transfers"
                    columns={columns}
                    data={transfers}
                    title={t.inventoryTransfers.title}
                    isLoading={loading}
                    emptyMessage={t.inventoryTransfers.emptyMessage}
                    emptyIcon={<Truck className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.inventoryTransfers.searchPlaceholder}
                />
            </div>
        </div>
    );
}