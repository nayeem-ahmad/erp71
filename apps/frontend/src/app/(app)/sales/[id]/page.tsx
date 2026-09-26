'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Save, Pencil, X, Copy, Check, Trash2, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate, toDatetimeLocal } from '@/lib/format';
import Link from 'next/link';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { instrumentFromRecord } from '@/lib/payment-instrument';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import SaleEntryLayout, {
    computeSaleTotals,
    EMPTY_ADJUSTMENTS,
    type SaleAdjustments,
} from '../components/SaleEntryLayout';
import { availableQtyOf } from '@/components/document-entry/ProductSearch';
import SalePrintMenu from '../components/SalePrintMenu';
import { toast } from '@/lib/toast';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';
import { useSalePrinting } from '@/lib/hooks/useSalePrinting';

const SALE_STATUSES = ['COMPLETED', 'REFUNDED', 'PARTIAL_REFUND'];

const statusBadgeClass: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REFUNDED: 'bg-red-50 text-red-700 border-red-200',
    PARTIAL_REFUND: 'bg-amber-50 text-amber-700 border-amber-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-300',
};

function SaleDetailPageContent() {
    const { t, locale } = useI18n();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();

    const {
        items,
        customer,
        description,
        payments,
        refNumber,
        setCustomer,
        setDescription,
        setRefNumber,
        addItem,
        updateItem,
        removeItem,
        updatePayment,
        loadCart,
    } = useNewSaleCart();

    const [sale, setSale] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [status, setStatus] = useState('');
    const [saleDate, setSaleDate] = useState('');
    const [adjustments, setAdjustments] = useState<SaleAdjustments>(EMPTY_ADJUSTMENTS);
    const [showCancelModal, setShowCancelModal] = useState(false);

    // Cancelling reverses stock, balances and the ledger, so the action is
    // hidden without CANCEL_ENTRY rather than shown and left to 403. OWNER
    // bypasses the guard server-side and may hold no grant rows at all.
    const { permissions, role } = useTenantPlanFeatures();
    const canCancel = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');

    const isEditMode = searchParams.get('edit') === 'true';
    const isDraft = sale?.status === 'DRAFT';
    const isCancelled = sale?.status === 'CANCELLED';
    const saleId = params.id as string;

    const loadSale = useCallback(async (id: string) => {
        try {
            const data = await api.getSale(id);
            setSale(data);
        } catch (error) {
            console.error('Failed to load sale', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (saleId) loadSale(saleId);
    }, [saleId, loadSale]);

    // Unlike the new-sale screen this seeds from the sale itself: a posted sale
    // already records where its stock came from, and re-resolving the tenant
    // default here is precisely the bug the stored column exists to stop.
    const { warehouses } = useWarehouses();
    const [warehouseId, setWarehouseId] = useState('');
    const [perLineWarehouse, setPerLineWarehouse] = useState(false);

    // Seed the entry form from the loaded sale. A sale stores only its final
    // total, so whatever separates that total from the line subtotal is carried
    // as a single "Adjustment" — the original discount/VAT/transport split is
    // not persisted and must not be invented here.
    useEffect(() => {
        if (!sale) return;

        const cartItems = (sale.items || []).map((item: any) => ({
            productId: item.product_id,
            name: item.product?.name || t.shared.unknown,
            price: parseFloat(item.price_at_sale),
            group: item.product?.group?.name,
            subgroup: item.product?.subgroup?.name,
            quantity: item.quantity,
            discount: 0,
            warehouseId: item.warehouse_id ?? undefined,
        }));

        loadCart({
            items: cartItems,
            customer: sale.customer ? { ...sale.customer, id: sale.customer_id } : null,
            description: sale.note || '',
            refNumber: sale.reference_number || '',
            payments: (sale.payments || []).map((p: any) => ({
                method: p.payment_method,
                amount: parseFloat(p.amount),
                ...instrumentFromRecord(p),
            })),
        });

        const subtotal = cartItems.reduce((sum: number, i: any) => sum + i.quantity * i.price, 0);
        setAdjustments({
            ...EMPTY_ADJUSTMENTS,
            rounding: Number((parseFloat(sale.total_amount) - subtotal).toFixed(2)),
        });
        setStatus(sale.status);
        setSaleDate(toDatetimeLocal(new Date(sale.sale_date ?? sale.created_at)));
        setWarehouseId(sale.warehouse_id ?? '');
        // Shown, not hidden behind the switch, when the sale really is split:
        // a warehouse that steers a line has to be visible on the line.
        setPerLineWarehouse(cartItems.some((item: any) => item.warehouseId));
    }, [sale, loadCart, t]);

    // A stored sale has no recoverable VAT rate — the whole gap between the
    // line subtotal and the invoice total lives in the adjustment row instead.
    const totals = useMemo(() => computeSaleTotals(items, adjustments, 0), [items, adjustments]);

    const handleAddItem = (
        product: any,
        options?: { quantity?: number; price?: number; availableQty?: number },
    ) => {
        addItem({
            productId: product.id,
            name: product.name,
            price: options?.price ?? Number(product.price),
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity: options?.quantity ?? 1,
            discount: 0,
            availableQty: options?.availableQty
                ?? (Array.isArray(product.stocks) ? availableQtyOf(product) : undefined),
        });
    };

    const handleSave = async () => {
        if (!sale || items.length === 0) return;
        setSaving(true);
        try {
            await api.updateSale(sale.id, {
                customerId: customer?.id ?? null,
                status,
                note: description,
                saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
                totalAmount: totals.total,
                warehouseId: warehouseId || undefined,
                items: items.map((i) => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    priceAtSale: i.price,
                    warehouseId: perLineWarehouse ? i.warehouseId : undefined,
                })),
                payments: payments.map((p) => ({
                    paymentMethod: p.method,
                    amount: p.amount,
                    accountId: p.accountId,
                    bankName: p.bankName,
                    bankBranch: p.bankBranch,
                    bankAccountNumber: p.bankAccountNumber,
                    referenceNo: p.referenceNo,
                    instrumentDate: p.instrumentDate,
                })),
            });
            await loadSale(sale.id);
            router.push(`/sales/${sale.id}`);
        } catch (error: any) {
            console.error('Failed to save sale', error);
            toast.error(error?.message || t.shared.errors.saveSale);
        } finally {
            setSaving(false);
        }
    };

    // Post a parked draft for real. The backend re-runs the full sale path
    // (stock, credit, loyalty, accounting) against whatever the draft holds now,
    // so nothing needs to be sent from here.
    const handleCompleteDraft = async () => {
        if (!sale) return;
        setFinalizing(true);
        try {
            await api.finalizeSale(sale.id);
            await loadSale(sale.id);
            toast.success(t.sales.detail.completed);
        } catch (error: any) {
            console.error('Failed to finalize draft', error);
            toast.error(error?.message || t.sales.detail.completeFailed);
        } finally {
            setFinalizing(false);
        }
    };

    const handleDelete = async () => {
        if (!sale) return;
        if (!window.confirm(t.shared.confirm.deleteSale)) return;

        setDeleting(true);
        try {
            await api.deleteSale(sale.id);
            toast.success(t.sales.detail.deleted);
            router.push('/sales/list');
        } catch (error: any) {
            console.error('Failed to delete sale', error);
            toast.error(error?.message || t.shared.errors.deleteSale);
        } finally {
            setDeleting(false);
        }
    };

    const handleCancelEntry = async (note: string) => {
        if (!sale) return;
        await api.cancelSale(sale.id, note);
        setShowCancelModal(false);
        await loadSale(sale.id);
        toast.success(t.entryCancellation.saleCancelled);
    };


    /**
     * What the print menu prints: the sale as it is on screen, not as it was
     * fetched. An operator who has corrected a line and not yet saved expects
     * the copy in their hand to match what they are looking at.
     */
    const resolvePrintable = useCallback(() => {
        if (!sale) return null;
        return {
            id: sale.id,
            serial_number: sale.serial_number,
            reference_number: sale.reference_number,
            created_at: sale.created_at,
            sale_date: sale.sale_date ?? saleDate,
            total_amount: String(totals.total),
            amount_paid: sale.amount_paid,
            note: description || sale.note,
            customer: customer
                ? { name: customer.name, phone: customer.phone, address: customer.address }
                : null,
            items: items.map((i) => ({
                name: i.name,
                quantity: i.quantity,
                price: i.price,
                discount: i.discount || 0,
            })),
            payments: payments.map((p) => ({ method: p.method, amount: p.amount, ...p })),
            previous_due: sale.previous_due ?? null,
        };
    }, [sale, saleDate, totals.total, description, customer, items, payments]);

    const { paperSize, setPaperSize, printInvoice, printChallan, printReceipt } = useSalePrinting({
        resolve: resolvePrintable,
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.shared.loading.sale}</p>
            </div>
        );
    }

    if (!sale) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.shared.notFound.sale}</p>
            </div>
        );
    }

    const statusLabel =
        t.shared.statuses.sale[status as keyof typeof t.shared.statuses.sale] ?? status;

    // The customer's balance today already includes this sale, so a posted
    // sale shows what the server worked back to instead. A draft has posted
    // nothing, and a customer swapped in on the edit form is not the one the
    // server answered for — both fall back to the picked customer's balance.
    const previousDue = !isDraft && customer?.id === sale.customer_id
        ? sale.previous_due ?? null
        : undefined;

    const banner = (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-white px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {t.common.status}
            </span>
            {isEditMode ? (
                <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    aria-label={t.common.status}
                    className="border rounded px-2 py-1 text-sm"
                >
                    {/* A draft can only leave DRAFT via Complete Sale, which runs
                        the real posting path. */}
                    {(isDraft ? ['DRAFT'] : SALE_STATUSES).map((s) => (
                        <option key={s} value={s}>
                            {t.shared.statuses.sale[s as keyof typeof t.shared.statuses.sale] ?? s.replace(/_/g, ' ')}
                        </option>
                    ))}
                </select>
            ) : (
                <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                        statusBadgeClass[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                    }`}
                >
                    {statusLabel}
                </span>
            )}

            {/* Where this invoice came from, when it was raised by "Convert to
                Sale" on a quotation or a sales order. */}
            {sale.quotation && (
                <Link
                    href={`/sales/quotes/${sale.quotation.id}`}
                    className="text-xs font-medium text-blue-600 hover:underline"
                >
                    {formatMessage(t.sales.detail.convertedFrom, { document: sale.quotation.quote_number })}
                </Link>
            )}
            {sale.salesOrder && (
                <Link
                    href={`/sales/orders/${sale.salesOrder.id}`}
                    className="text-xs font-medium text-blue-600 hover:underline"
                >
                    {formatMessage(t.sales.detail.convertedFrom, { document: sale.salesOrder.order_number })}
                </Link>
            )}

            {isDraft && (
                <span className="text-xs text-amber-700">{t.sales.detail.draftBanner}</span>
            )}
            {/* The reason lives on the document, not only in the audit log —
                this line is what a tenant reads months later. */}
            {isCancelled && (
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
                    <Ban className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                        {formatMessage(t.entryCancellation.cancelledOn, {
                            date: formatDate(sale.cancelled_at ?? sale.created_at, locale),
                        })}
                        {sale.cancellation_note ? ` — ${sale.cancellation_note}` : ''}
                    </span>
                </span>
            )}
            {isEditMode && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                    <Pencil className="w-3.5 h-3.5" />
                    {t.shared.editMode.sale}
                </span>
            )}
        </div>
    );

    const duplicateAction = (
        <Link
            href={`/sales/new?duplicate=${sale.id}`}
            className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            title={t.sales.detail.duplicate}
        >
            <Copy className="w-4 h-4" />
            {t.common.duplicate}
        </Link>
    );

    /**
     * Printing lives up in the meta strip, level with the number and date it
     * produces a copy of. The bottom bar keeps the decisions that change the
     * document — save, delete, cancel, complete — which is what it was crowded
     * out of when six print buttons shared it.
     */
    const headerActions = (
        <SalePrintMenu
            saleId={sale.id}
            paperSize={paperSize}
            onPaperSizeChange={setPaperSize}
            onPrintInvoice={(size) => void printInvoice(sale.id, size)}
            onPrintChallan={(size) => void printChallan(sale.id, size)}
            onPrintReceipt={(size) => void printReceipt(sale.id, size)}
        />
    );

    const viewActions = (
        <>
            <Link
                href="/sales/list"
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
            >
                {t.common.back}
            </Link>
            <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 border border-red-200 rounded text-red-600 hover:bg-red-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
            >
                <Trash2 className="w-4 h-4" />
                {deleting ? t.sales.detail.deleting : t.common.delete}
            </button>
            {duplicateAction}
            {isDraft && (
                <button
                    type="button"
                    onClick={handleCompleteDraft}
                    disabled={finalizing}
                    className="px-3 py-2 border border-blue-200 rounded text-blue-700 hover:bg-blue-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
                >
                    <Check className="w-4 h-4" />
                    {finalizing ? t.sales.detail.completing : t.sales.detail.completeSale}
                </button>
            )}
            {canCancel && !isCancelled && (
                <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    className="px-3 py-2 border border-red-200 rounded text-red-600 hover:bg-red-50 text-sm flex items-center gap-1.5"
                >
                    <Ban className="w-4 h-4" />
                    {t.entryCancellation.action}
                </button>
            )}
            {/* A cancelled entry has had every impact reversed; editing it would
                replay stock and postings against a void document, which the API
                refuses. Offer print and duplicate instead. */}
            {!isCancelled && (
                <button
                    type="button"
                    onClick={() => router.push(`/sales/${sale.id}?edit=true`)}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium flex items-center justify-center gap-1.5"
                >
                    <Pencil className="w-4 h-4" />
                    {t.common.edit}
                </button>
            )}
        </>
    );

    const editActions = (
        <>
            <button
                type="button"
                onClick={() => router.push(`/sales/${sale.id}`)}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            >
                <X className="w-4 h-4" />
                {t.common.cancel}
            </button>
            {duplicateAction}
            <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="px-3 py-2 border border-red-200 rounded text-red-600 hover:bg-red-50 disabled:text-gray-400 text-sm flex items-center gap-1.5"
            >
                <Trash2 className="w-4 h-4" />
                {deleting ? t.sales.detail.deleting : t.common.delete}
            </button>
            <button
                type="button"
                onClick={handleSave}
                disabled={saving || deleting || items.length === 0}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium flex items-center justify-center gap-1.5"
            >
                <Save className="w-4 h-4" />
                {saving ? t.sales.detail.saving : t.common.saveChanges}
            </button>
        </>
    );

    return (
        <>
        <SaleEntryLayout
            title={sale.serial_number}
            backHref="/sales/list"
            readOnly={!isEditMode}
            banner={banner}
            serialNumber={sale.serial_number}
            refNumber={refNumber}
            setRefNumber={setRefNumber}
            refReadOnly
            currentUser={null}
            saleDate={saleDate}
            setSaleDate={setSaleDate}
            customer={customer}
            setCustomer={setCustomer}
            previousDue={previousDue}
            items={items}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onAddProduct={handleAddItem}
            description={description}
            setDescription={setDescription}
            totals={totals}
            onTotalsChange={(patch) => setAdjustments((prev) => ({ ...prev, ...patch }))}
            tenantVatRate={0}
            adjustmentLabel="Adjustment"
            payments={payments}
            onPaymentChange={updatePayment}
            warehouses={warehouses}
            warehouseId={warehouseId}
            setWarehouseId={setWarehouseId}
            perLineWarehouse={perLineWarehouse}
            setPerLineWarehouse={setPerLineWarehouse}
            showRateHistory
            actions={isEditMode ? editActions : viewActions}
            headerActions={headerActions}
        />
        {showCancelModal && (
            <CancelEntryModal
                entryLabel={sale.serial_number}
                entryAmount={formatBDT(parseFloat(sale.total_amount), { locale })}
                onConfirm={handleCancelEntry}
                onClose={() => setShowCancelModal(false)}
            />
        )}
        </>
    );
}

export default function SaleDetailPage() {
    return (
        <Suspense>
            <SaleDetailPageContent />
        </Suspense>
    );
}
