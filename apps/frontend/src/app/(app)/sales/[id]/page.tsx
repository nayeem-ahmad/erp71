'use client';

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Printer, Save, Pencil, X, Download, Check, Trash2, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { toDatetimeLocal } from '@/lib/format';
import { printPOSReceipt } from '@/lib/pos-receipt-printer';
import { printSalesInvoice, PAPER_SIZES, type PaperSize } from '@/lib/sales-invoice-printer';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import SaleEntryLayout, {
    computeSaleTotals,
    EMPTY_ADJUSTMENTS,
    type SaleAdjustments,
} from '../components/SaleEntryLayout';
import { availableQtyOf } from '../components/ProductSearch';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { toast } from '@/lib/toast';

const SALE_STATUSES = ['COMPLETED', 'REFUNDED', 'PARTIAL_REFUND'];

const statusBadgeClass: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REFUNDED: 'bg-red-50 text-red-700 border-red-200',
    PARTIAL_REFUND: 'bg-amber-50 text-amber-700 border-amber-200',
};

function SaleDetailPageContent() {
    const { t } = useI18n();
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
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [showPaperMenu, setShowPaperMenu] = useState(false);
    const printMenuRef = useRef<HTMLDivElement>(null);

    const isEditMode = searchParams.get('edit') === 'true';
    const isDraft = sale?.status === 'DRAFT';
    const saleId = params.id as string;

    const isInsidePrintMenu = useCallback(
        (target: Node) => !!printMenuRef.current?.contains(target),
        [],
    );
    useDismissOnClickOutside(showPaperMenu, isInsidePrintMenu, () => setShowPaperMenu(false));

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
        }));

        loadCart({
            items: cartItems,
            customer: sale.customer ? { ...sale.customer, id: sale.customer_id } : null,
            description: sale.note || '',
            refNumber: sale.reference_number || '',
            payments: (sale.payments || []).map((p: any) => ({
                method: p.payment_method,
                amount: parseFloat(p.amount),
            })),
        });

        const subtotal = cartItems.reduce((sum: number, i: any) => sum + i.quantity * i.price, 0);
        setAdjustments({
            ...EMPTY_ADJUSTMENTS,
            rounding: Number((parseFloat(sale.total_amount) - subtotal).toFixed(2)),
        });
        setStatus(sale.status);
        setSaleDate(toDatetimeLocal(new Date(sale.sale_date ?? sale.created_at)));
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
                items: items.map((i) => ({
                    productId: i.productId,
                    quantity: i.quantity,
                    priceAtSale: i.price,
                })),
                payments: payments.map((p) => ({
                    paymentMethod: p.method,
                    amount: p.amount,
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

    const handlePOSPrint = async () => {
        if (!sale) return;
        await printPOSReceipt({
            invoiceId: sale.id,
            serialNumber: sale.serial_number,
            date: new Date(sale.sale_date ?? sale.created_at).toLocaleString(),
            customerName: sale.customer?.name,
            items: items.map((i) => ({
                name: i.name,
                quantity: i.quantity,
                unitPrice: i.price,
            })),
            payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
            subtotal: totals.subtotal,
            tax: 0,
            total: totals.total,
            amountPaid: parseFloat(sale.amount_paid),
            note: sale.note,
        });
    };

    const handlePrint = (size?: PaperSize) => {
        if (!sale) return;
        const selectedSize = size ?? paperSize;
        setShowPaperMenu(false);
        printSalesInvoice(
            {
                referenceNumber: sale.reference_number || sale.serial_number,
                date: new Date(sale.sale_date ?? sale.created_at).toLocaleDateString('en-BD'),
                customerName: customer?.name,
                customerPhone: customer?.phone,
                items: items.map((i) => ({
                    name: i.name,
                    quantity: i.quantity,
                    unitPrice: i.price,
                    discount: i.discount || 0,
                })),
                payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
                subtotal: totals.subtotal,
                rounding: totals.rounding || undefined,
                total: totals.total,
                note: description || undefined,
            },
            selectedSize,
        );
    };

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

            {isDraft && (
                <span className="text-xs text-amber-700">{t.sales.detail.draftBanner}</span>
            )}
            {isEditMode && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                    <Pencil className="w-3.5 h-3.5" />
                    {t.shared.editMode.sale}
                </span>
            )}
        </div>
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
            <button
                type="button"
                onClick={handlePOSPrint}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            >
                <Printer className="w-4 h-4" />
                {t.sales.detail.posReceipt}
            </button>
            <div className="relative" ref={printMenuRef}>
                <div className="flex items-center border rounded overflow-hidden">
                    <button
                        type="button"
                        onClick={() => handlePrint()}
                        className="px-3 py-2 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 text-sm"
                    >
                        <Printer className="w-4 h-4" />
                        {paperSize}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowPaperMenu((v) => !v)}
                        className="px-1.5 py-2 border-l text-gray-500 hover:bg-gray-50"
                        title="Choose paper size"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                </div>
                {showPaperMenu && (
                    <div className="absolute right-0 bottom-full mb-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                        <p className="px-3 py-1 text-xs font-bold text-gray-400 uppercase tracking-wider">Paper Size</p>
                        {PAPER_SIZES.map((size) => (
                            <button
                                key={size}
                                type="button"
                                onClick={() => { setPaperSize(size); handlePrint(size); }}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${paperSize === size ? 'font-bold text-blue-600' : 'text-gray-700'}`}
                            >
                                {size === 'Thermal80' ? '80mm Thermal' : size === 'Thermal58' ? '58mm Thermal' : size}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <Link
                href={`/sales/${sale.id}/invoice`}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            >
                <Download className="w-4 h-4" />
                {t.sales.detail.invoicePdf}
            </Link>
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
            <button
                type="button"
                onClick={() => router.push(`/sales/${sale.id}?edit=true`)}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium flex items-center justify-center gap-1.5"
            >
                <Pencil className="w-4 h-4" />
                {t.common.edit}
            </button>
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
            actions={isEditMode ? editActions : viewActions}
        />
    );
}

export default function SaleDetailPage() {
    return (
        <Suspense>
            <SaleDetailPageContent />
        </Suspense>
    );
}
