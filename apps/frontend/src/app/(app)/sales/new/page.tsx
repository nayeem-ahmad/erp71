'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Printer, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import CustomerSelection from './components/CustomerSelection';
import ProductSearch from './components/ProductSearch';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import LineItemsTable from './components/LineItemsTable';
import TotalsFooter from './components/TotalsFooter';
import PaymentSection from './components/PaymentSection';
import SalesHeader from './components/SalesHeader';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { printSalesInvoice, PAPER_SIZES, type PaperSize } from '@/lib/sales-invoice-printer';
import { toast } from '@/lib/toast';

export default function NewSalePage() {
    const { t } = useI18n();
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
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [showPaperMenu, setShowPaperMenu] = useState(false);
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const printMenuRef = useRef<HTMLDivElement>(null);
    const [totals, setTotals] = useState({
        subtotal: 0,
        discount: 0,
        discountPercent: 0,
        rounding: 0,
        vat: 0,
        transportCost: 0,
        laborCost: 0,
        total: 0,
    });

    useEffect(() => {
        loadPageData();
    }, []);

    // Close paper size menu when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
                setShowPaperMenu(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        calculateTotals();
    }, [items, totals.discountPercent, totals.transportCost, totals.laborCost]);

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
                date: new Date().toLocaleDateString('en-BD'),
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

    const calculateTotals = () => {
        const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
        const discountAmount = subtotal * (totals.discountPercent / 100);
        const afterDiscount = subtotal - discountAmount;
        const vatAmount = afterDiscount * ((salesSettings?.tenant?.default_vat_rate || 0) / 100);
        const grandTotal = afterDiscount + vatAmount + (totals.transportCost || 0) + (totals.laborCost || 0) + (totals.rounding || 0);

        setTotals((prev) => ({
            ...prev,
            subtotal,
            discount: discountAmount,
            vat: vatAmount,
            total: grandTotal,
        }));
    };

    const handleAddItem = (product: any, quantity = 1) => {
        addItem({
            productId: product.id,
            name: product.name,
            // API serializes Decimal price as a string; coerce to number so
            // cart math and `.toFixed()` downstream work correctly.
            price: Number(product.price),
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity,
            discount: 0,
        });
    };

    const handleVoiceSale = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, item.quantity);
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

        if (Math.abs(balance) > 0.01) {
            errors.push(
                balance > 0
                    ? `Payment amount is ৳${balance.toFixed(2)} short of the total`
                    : `Payment amount exceeds total by ৳${Math.abs(balance).toFixed(2)}`
            );
        }

        if (payments.length === 0) {
            errors.push('Please add at least one payment method');
        }

        return { valid: errors.length === 0, errors };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const validation = validateCheckout();
        if (!validation.valid) {
            toast.error(validation.errors.join('\n'));
            return;
        }

        setSubmitting(true);
        try {
            const saleData = {
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
                payments: payments.map((p) => ({
                    paymentMethod: p.method,
                    amount: p.amount,
                    accountId: p.accountId,
                })),
            };

            const response = await api.createNewSale(saleData);

            // Clear cart and show success
            clearCart();
            toast.success(`Sale created successfully!\nSale #: ${response.serial_number}`);

            // Optionally redirect to sales list or new sale
            // router.push('/sales');
        } catch (error: any) {
            const errorMsg = error.message || 'Failed to create sale';
            console.error('Sale creation error:', error);
            toast.error(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="text-center py-8">Loading...</div>;
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-gray-50 text-sm">
            {/* Top strip: title + sale meta fields, one slim row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Link href="/sales/list" className="text-gray-400 hover:text-gray-700">
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-base font-bold text-gray-900 whitespace-nowrap">New Sale</h1>
                </div>
                <div className="h-5 w-px bg-gray-200 hidden sm:block" />
                <SalesHeader
                    refNumber={refNumber}
                    setRefNumber={setRefNumber}
                    currentUser={currentUser}
                />
            </div>

            {/* Body: left work area + right summary/payment panel. On mobile this
                flows at natural height so the page scrolls; at lg+ it fills the
                viewport and only the item list scrolls. */}
            <div className="flex flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
                {/* Left work area */}
                <div className="flex flex-col lg:flex-1 lg:overflow-hidden p-3 gap-2 min-w-0">
                    <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                        <div className="sm:w-72 flex-shrink-0">
                            <CustomerSelection customer={customer} setCustomer={setCustomer} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <VoiceEntryInput entryType="sale" onResult={handleVoiceSale} inline>
                                <ProductSearch onProductSelect={(product) => handleAddItem(product)} />
                            </VoiceEntryInput>
                        </div>
                    </div>

                    {/* Item list — the only scrolling region on desktop */}
                    <div className="min-h-[240px] lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                        <LineItemsTable items={items} onUpdateItem={updateItem} onRemoveItem={removeItem} />
                    </div>

                    {/* Note */}
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Note (optional)…"
                        className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                    />
                </div>

                {/* Right panel: totals, payment, actions */}
                <div className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l bg-white flex flex-col lg:overflow-hidden">
                    <div className="lg:flex-1 lg:overflow-y-auto p-3 space-y-3">
                        <TotalsFooter
                            totals={totals}
                            onTotalsChange={(newTotals) => setTotals((prev) => ({ ...prev, ...newTotals }))}
                            tenantVatRate={salesSettings?.tenant?.default_vat_rate || 0}
                        />
                        <div className="border-t pt-3">
                            <PaymentSection payments={payments} total={totals.total} onPaymentChange={updatePayment} />
                        </div>
                    </div>

                    {/* Actions pinned to panel bottom. Extra bottom padding on desktop
                        keeps the primary button clear of the floating feedback widget. */}
                    <div className="flex items-center gap-2 p-3 pb-20 lg:pb-16 border-t flex-shrink-0">
                        <Link
                            href="/sales/list"
                            className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                        >
                            Cancel
                        </Link>
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
                            disabled={submitting || items.length === 0}
                            className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                        >
                            {submitting ? 'Creating…' : 'Create Sale'}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    );
}
