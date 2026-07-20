'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Printer, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toDatetimeLocal } from '@/lib/format';
import { availableQtyOf } from '../components/ProductSearch';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import SaleEntryLayout, {
    computeSaleTotals,
    EMPTY_ADJUSTMENTS,
    type SaleAdjustments,
} from '../components/SaleEntryLayout';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { printSalesInvoice, PAPER_SIZES, type PaperSize } from '@/lib/sales-invoice-printer';
import { toast } from '@/lib/toast';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { canKeepDue, creditDueAmount } from '@/lib/customer-credit';

export default function NewSalePage() {
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
        clearCart,
    } = useNewSaleCart();

    const [salesSettings, setSalesSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [showPaperMenu, setShowPaperMenu] = useState(false);
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [saleDate, setSaleDate] = useState<string>(() => toDatetimeLocal(new Date()));
    const printMenuRef = useRef<HTMLDivElement>(null);
    const [adjustments, setAdjustments] = useState<SaleAdjustments>(EMPTY_ADJUSTMENTS);

    useEffect(() => {
        loadPageData();
    }, []);

    const isInsidePrintMenu = useCallback(
        (target: Node) => !!printMenuRef.current?.contains(target),
        [],
    );
    useDismissOnClickOutside(showPaperMenu, isInsidePrintMenu, () => setShowPaperMenu(false));

    const vatRate = salesSettings?.tenant?.default_vat_rate || 0;
    const totals = useMemo(
        () => computeSaleTotals(items, adjustments, vatRate),
        [items, adjustments, vatRate],
    );

    const loadPageData = async () => {
        try {
            const [settings, user] = await Promise.all([
                api.getSalesSettings(),
                api.getCurrentUser(),
            ]);
            setSalesSettings(settings);
            setCurrentUser(user);
            // Use default paper size from settings if available
            if (settings?.default_paper_size) {
                setPaperSize(settings.default_paper_size as PaperSize);
            }
        } catch (error) {
            console.error('Failed to load page data', error);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = (size?: PaperSize) => {
        const selectedSize = size ?? paperSize;
        setShowPaperMenu(false);
        printSalesInvoice(
            {
                referenceNumber: refNumber || '—',
                date: new Date(saleDate).toLocaleDateString('en-BD'),
                companyName: currentUser?.store?.name || salesSettings?.tenant?.business_name,
                customerName: customer?.name,
                customerPhone: customer?.phone,
                items: items.map((item) => ({
                    name: item.name,
                    quantity: item.quantity,
                    unitPrice: item.price,
                    discount: item.discount || 0,
                })),
                payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
                subtotal: totals.subtotal,
                discountAmount: totals.discount > 0 ? totals.discount : undefined,
                discountPercent: totals.discountPercent > 0 ? totals.discountPercent : undefined,
                vat: totals.vat > 0 ? totals.vat : undefined,
                transportCost: totals.transportCost > 0 ? totals.transportCost : undefined,
                laborCost: totals.laborCost > 0 ? totals.laborCost : undefined,
                rounding: totals.rounding || undefined,
                total: totals.total,
                note: description || undefined,
            },
            selectedSize,
        );
    };

    const handleAddItem = (
        product: any,
        options?: { quantity?: number; price?: number; availableQty?: number },
    ) => {
        addItem({
            productId: product.id,
            name: product.name,
            // API serializes Decimal price as a string; coerce to number so
            // cart math and `.toFixed()` downstream work correctly.
            price: options?.price ?? Number(product.price),
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity: options?.quantity ?? 1,
            discount: 0,
            // Voice-entry products come without stock rows — leave availableQty
            // undefined there rather than claiming zero stock.
            availableQty: options?.availableQty
                ?? (Array.isArray(product.stocks) ? availableQtyOf(product) : undefined),
        });
    };

    const handleVoiceSale = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, { quantity: item.quantity });
                added++;
            }
        }

        if (result.note && !description) {
            setDescription(result.note);
        }

        const messages = buildVoiceEntryMessages(result, added);
        for (const message of messages) {
            if (message.startsWith('Could not find')) {
                toast.info(message);
            } else {
                toast.success(message);
            }
        }
    };

    const validateCheckout = (): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (items.length === 0) {
            errors.push('Please add at least one item to the sale');
        }

        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const balance = totals.total - totalPaid;
        const creditDue = creditDueAmount(totals.total, totalPaid);
        const keepDueCheck = canKeepDue(customer, creditDue);

        if (balance < -0.01) {
            errors.push(`Payment amount exceeds total by ৳${Math.abs(balance).toFixed(2)}`);
        } else if (creditDue > 0.01 && !keepDueCheck.allowed) {
            errors.push(keepDueCheck.reason ?? `Payment amount is ৳${creditDue.toFixed(2)} short of the total`);
        } else if (creditDue <= 0.01 && payments.length === 0) {
            errors.push('Please add at least one payment method');
        }

        return { valid: errors.length === 0, errors };
    };

    const buildSaleData = (isDraft: boolean) => ({
        // The active branch/store is persisted in localStorage and sent
        // as x-store-id on every request; the sale body needs the same id.
        // (Owners have no currentUser.store_id, so don't rely on it.)
        storeId: localStorage.getItem('store_id') || '',
        referenceNumber: refNumber || undefined,
        customerId: customer?.id,
        items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            priceAtSale: item.price,
        })),
        totalAmount: totals.total,
        amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
        discountAmount: totals.discount > 0 ? totals.discount : undefined,
        note: description || undefined,
        saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
        payments: payments.map((p) => ({
            paymentMethod: p.method,
            amount: p.amount,
            accountId: p.accountId,
        })),
        ...(isDraft ? { isDraft: true } : {}),
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const validation = validateCheckout();
        if (!validation.valid) {
            toast.error(validation.errors.join('\n'));
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.createNewSale(buildSaleData(false));

            // Clear cart and show success
            clearCart();
            setAdjustments(EMPTY_ADJUSTMENTS);
            toast.success(`Sale created successfully!\nSale #: ${response.serial_number}`);
        } catch (error: any) {
            const errorMsg = error.message || 'Failed to create sale';
            console.error('Sale creation error:', error);
            toast.error(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    // A draft is parked as-is: no stock, payment or credit validation runs, and
    // the backend posts nothing. Only "has at least one item" is required.
    const handleSaveDraft = async () => {
        if (items.length === 0) {
            toast.error('Add at least one item before saving a draft');
            return;
        }

        setSavingDraft(true);
        try {
            const response = await api.createNewSale(buildSaleData(true));
            clearCart();
            setAdjustments(EMPTY_ADJUSTMENTS);
            toast.success(`Draft saved.\nRef: ${response.reference_number || response.serial_number}`);
        } catch (error: any) {
            console.error('Draft save error:', error);
            toast.error(error.message || 'Failed to save draft');
        } finally {
            setSavingDraft(false);
        }
    };

    if (loading) {
        return <div className="text-center py-8">Loading...</div>;
    }

    return (
        <SaleEntryLayout
            title="New Sale"
            backHref="/sales/list"
            refNumber={refNumber}
            setRefNumber={setRefNumber}
            currentUser={currentUser}
            saleDate={saleDate}
            setSaleDate={setSaleDate}
            customer={customer}
            setCustomer={setCustomer}
            items={items}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onAddProduct={handleAddItem}
            onVoiceResult={handleVoiceSale}
            description={description}
            setDescription={setDescription}
            totals={totals}
            onTotalsChange={(patch) => setAdjustments((prev) => ({ ...prev, ...patch }))}
            tenantVatRate={vatRate}
            payments={payments}
            onPaymentChange={updatePayment}
            onSubmit={handleSubmit}
            actions={
                <>
                    <Link
                        href="/sales/list"
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="button"
                        onClick={handleSaveDraft}
                        disabled={savingDraft || submitting || items.length === 0}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 disabled:text-gray-400 text-sm"
                        title="Save without posting stock, payment or accounting entries"
                    >
                        {savingDraft ? 'Saving…' : 'Save Draft'}
                    </button>
                    {/* Print button with paper-size dropdown */}
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
                    <button
                        type="submit"
                        disabled={submitting || savingDraft || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Creating…' : 'Create Sale'}
                    </button>
                </>
            }
        />
    );
}
