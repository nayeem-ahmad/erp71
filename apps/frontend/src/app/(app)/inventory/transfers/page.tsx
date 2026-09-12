'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, Plus, ShieldCheck, Truck } from 'lucide-react';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api } from '@/lib/api';
import { PostingBadge } from '@/components/PostingBadge';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useI18n } from '@/lib/i18n';

interface WarehouseTransfer {
    id: string;
    transfer_number: string;
    status: string;
    created_at: string;
    sent_at?: string | null;
    received_at?: string | null;
    is_cross_branch?: boolean;
    source_store_id?: string | null;
    destination_store_id?: string | null;
    sourceWarehouse?: { id: string; name: string; store_id?: string } | null;
    destinationWarehouse?: { id: string; name: string; store_id?: string } | null;
    items: Array<{ id: string; product_id: string; quantity_sent: number; quantity_received: number; product?: { name: string } | null }>;
    posting_status?: string | null;
    voucher_number?: string | null;
}

const columnHelper = createColumnHelper<WarehouseTransfer>();

/**
 * Semantic tones per CLAUDE.md: amber warns (waiting on a person, or a receipt
 * still open), emerald is done, red is refused. Blue stays the in-flight state
 * because it is the one the module's primary action produces.
 */
const STATUS_TONE: Record<string, string> = {
    DRAFT: 'text-gray-600',
    PENDING_APPROVAL: 'text-amber-700',
    SENT: 'text-blue-700',
    PARTIALLY_RECEIVED: 'text-amber-700',
    RECEIVED: 'text-emerald-700',
    REJECTED: 'text-red-700',
};

export default function InventoryTransfersPage() {
    const { t } = useI18n();
    const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
    const [warehouses, setWarehouses] = useState<any[]>([]);
    const [stores, setStores] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [sourceWarehouseId, setSourceWarehouseId] = useState('');
    const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
    const [productId, setProductId] = useState('');
    const [scopeFilter, setScopeFilter] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
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
    }, [statusFilter, sourceWarehouseId, destinationWarehouseId, productId, scopeFilter, createdRange]);

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
                isCrossBranch: scopeFilter === '' ? undefined : scopeFilter === 'cross',
                from: applyCreatedRangeQuery(createdRange).createdFrom,
                to: applyCreatedRangeQuery(createdRange).createdTo,
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
            const [warehouseData, productData, storeData] = await Promise.all([
                api.getInventoryWarehouses(),
                api.getProducts(),
                api.getStores(),
            ]);
            setWarehouses(warehouseData.filter((warehouse: any) => warehouse.is_active));
            setProducts(productData);
            setStores(Array.isArray(storeData) ? storeData : []);
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

    const storeNames = useMemo(
        () => new Map<string, string>(stores.map((store: any) => [store.id, store.name])),
        [stores],
    );

    /**
     * Warehouses grouped under the branch that owns them — the picker is where a
     * cross-branch transfer is chosen, so the branch has to be visible at the
     * moment of choosing rather than discovered afterwards.
     *
     * A single-branch shop is deliberately left ungrouped: an `<optgroup>` around
     * every warehouse in the only branch there is adds a label and no
     * information.
     */
    const warehouseGroups = useMemo(() => {
        const groups = new Map<string, { label: string; warehouses: any[] }>();
        for (const warehouse of warehouses) {
            const storeId = warehouse.store_id ?? '';
            if (!groups.has(storeId)) {
                groups.set(storeId, {
                    label: storeNames.get(storeId) ?? t.inventoryTransfers.unknownBranch,
                    warehouses: [],
                });
            }
            groups.get(storeId)!.warehouses.push(warehouse);
        }
        return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
    }, [warehouses, storeNames, t]);

    const warehouseOptions = useMemo(() => (
        warehouseGroups.length > 1
            ? warehouseGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                    {group.warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </optgroup>
            ))
            : warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)
    ), [warehouseGroups, warehouses]);

    /**
     * Whether the pair currently chosen in the form crosses branches. Computed
     * from the same two `store_id`s the backend compares, so the warning the user
     * sees and the rule the server applies cannot disagree.
     */
    const formCrossesBranches = useMemo(() => {
        const source = warehouses.find((warehouse) => warehouse.id === form.sourceWarehouseId);
        const destination = warehouses.find((warehouse) => warehouse.id === form.destinationWarehouseId);
        return Boolean(source && destination && source.store_id !== destination.store_id);
    }, [warehouses, form.sourceWarehouseId, form.destinationWarehouseId]);

    const statusLabels: Record<string, string> = useMemo(() => ({
        DRAFT: t.inventoryTransfers.statuses.draft,
        PENDING_APPROVAL: t.inventoryTransfers.statuses.pendingApproval,
        SENT: t.inventoryTransfers.statuses.sent,
        PARTIALLY_RECEIVED: t.inventoryTransfers.statuses.partiallyReceived,
        RECEIVED: t.inventoryTransfers.statuses.received,
        REJECTED: t.inventoryTransfers.statuses.rejected,
    }), [t]);

    const columns: ColumnDef<WarehouseTransfer, any>[] = useMemo(
        () => [
            columnHelper.accessor('transfer_number', {
                header: t.inventoryTransfers.columns.transferNumber,
                cell: (info) => <span className="text-sm font-bold text-gray-900">{info.getValue()}</span>,
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
                cell: (info) => (
                    <span className={`text-xs font-semibold ${STATUS_TONE[info.getValue()] ?? 'text-gray-600'}`}>
                        {statusLabels[info.getValue()] ?? info.getValue()}
                    </span>
                ),
                size: 150,
            }),
            columnHelper.display({
                id: 'scope',
                header: t.inventoryTransfers.columns.branch,
                cell: ({ row }) => {
                    const source = storeNames.get(row.original.source_store_id ?? row.original.sourceWarehouse?.store_id ?? '');
                    const destination = storeNames.get(row.original.destination_store_id ?? row.original.destinationWarehouse?.store_id ?? '');
                    if (!row.original.is_cross_branch) {
                        return <span className="text-sm text-gray-600">{source ?? t.inventoryTransfers.withinBranch}</span>;
                    }
                    return (
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            {/* Arrow flipped for RTL the way the DataTable scroll hint does
                                it — see docs/rtl-guidelines.md. */}
                            {source ?? '?'}
                            <span className="mx-1 rtl:hidden">→</span>
                            <span className="mx-1 hidden rtl:inline">←</span>
                            {destination ?? '?'}
                        </span>
                    );
                },
                meta: { hideOnMobile: true },
                size: 180,
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
            createdAtColumn(columnHelper, { header: t.common.createdAt }),
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
                    <Link href={`/inventory/transfers/${info.row.original.id}`} className="text-sm font-bold text-blue-700 hover:text-blue-900">
                        {t.common.view}
                    </Link>
                ),
                size: 100,
            }),
        ],
        [t, statusLabels, storeNames],
    );

    return (
        <PageShell>
                <PageHeader
                    title={t.inventoryTransfers.title}
                    subtitle={t.inventoryTransfers.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        t.inventoryTransfers.title,
                        'inventory',
                    )}
                    actions={(
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700">
                            <option value="">{t.inventoryTransfers.allStatuses}</option>
                            <option value="DRAFT">{t.inventoryTransfers.statuses.draft}</option>
                            <option value="PENDING_APPROVAL">{t.inventoryTransfers.statuses.pendingApproval}</option>
                            <option value="SENT">{t.inventoryTransfers.statuses.sent}</option>
                            <option value="PARTIALLY_RECEIVED">{t.inventoryTransfers.statuses.partiallyReceived}</option>
                            <option value="RECEIVED">{t.inventoryTransfers.statuses.received}</option>
                            <option value="REJECTED">{t.inventoryTransfers.statuses.rejected}</option>
                        </select>
                    )}
                />

                <div className="bg-white border border-gray-100 rounded-lg p-4 grid md:grid-cols-5 gap-3 items-end">
                    <select value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allSources}</option>
                        {warehouseOptions}
                    </select>
                    <select value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allDestinations}</option>
                        {warehouseOptions}
                    </select>
                    <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                        <option value="">{t.inventoryTransfers.allProducts}</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                    {/* Only a multi-branch tenant has a scope to filter by. */}
                    {warehouseGroups.length > 1 ? (
                        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                            <option value="">{t.inventoryTransfers.allScopes}</option>
                            <option value="cross">{t.inventoryTransfers.crossBranchOnly}</option>
                            <option value="within">{t.inventoryTransfers.withinBranchOnly}</option>
                        </select>
                    ) : null}
                    <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                </div>

                <form onSubmit={handleCreate} className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Truck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-bold text-lg">{t.inventoryTransfers.newTransfer}</h2>
                    </div>
                    {message ? <div className="text-sm font-bold text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{message}</div> : null}
                    <div className="grid md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.inventoryTransfers.sourceWarehouse}</label>
                            <select required value={form.sourceWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, sourceWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">{t.inventoryTransfers.selectSource}</option>
                                {warehouseOptions}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.inventoryTransfers.destinationWarehouse}</label>
                            <select required value={form.destinationWarehouseId} onChange={(e) => setForm((current: any) => ({ ...current, destinationWarehouseId: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="">{t.inventoryTransfers.selectDestination}</option>
                                {warehouseOptions}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.inventoryTransfers.initialStatus}</label>
                            <select value={form.status} onChange={(e) => setForm((current: any) => ({ ...current, status: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                <option value="SENT">{t.inventoryTransfers.sendNow}</option>
                                <option value="DRAFT">{t.inventoryTransfers.saveAsDraft}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.common.notes}</label>
                            <input value={form.notes} onChange={(e) => setForm((current: any) => ({ ...current, notes: e.target.value }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium" placeholder={t.common.optional} />
                        </div>
                    </div>

                    {formCrossesBranches ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{t.inventoryTransfers.crossBranchNotice}</span>
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        {form.items.map((item: any, index: number) => (
                            <div key={index} className="grid md:grid-cols-[1fr_160px_120px] gap-3 items-end">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.common.product}</label>
                                    <select required value={item.productId} onChange={(e) => setForm((current: any) => ({ ...current, items: current.items.map((line: any, lineIndex: number) => lineIndex === index ? { ...line, productId: e.target.value } : line) }))} className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium">
                                        <option value="">{t.inventoryTransfers.selectProduct}</option>
                                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5 ms-1">{t.common.quantity}</label>
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
                            <Plus className="w-4 h-4 me-2" /> {t.inventoryTransfers.addLine}
                        </button>
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-sm">
                            <ArrowRightLeft className="w-4 h-4 me-2" /> {t.inventoryTransfers.createTransfer}
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
    </PageShell>
    );
}