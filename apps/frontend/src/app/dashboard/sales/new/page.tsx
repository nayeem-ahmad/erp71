'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Printer, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import CustomerSelection from './components/CustomerSelection';
import ProductSearch from './components/ProductSearch';
import LineItemsTable from './components/LineItemsTable';
import TotalsFooter from './components/TotalsFooter';
import PaymentSection from './components/PaymentSection';
import SalesHeader from './components/SalesHeader';
import { useNewSaleCart } from '../../../../lib/hooks/useNewSaleCart';
import { printSalesInvoice, type PaperSize } from '@/lib/sales-invoice-printer';

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

    const handleAddItem = (product: any) => {
        addItem({
            productId: product.id,
            name: product.name,
            price: product.price,
            group: product.group?.name,
            subgroup: product.subgroup?.name,
            quantity: 1,
            discount: 0,
        });
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
            alert(validation.errors.join('\n'));
            return;
        }

        setSubmitting(true);
        try {
            const saleData = {
                storeId: currentUser?.store_id,
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
            alert(`Sale created successfully!\nSale #: ${response.serial_number}`);

            // Optionally redirect to sales list or new sale
            // router.push('/dashboard/sales');
        } catch (error: any) {
            const errorMsg = error.message || 'Failed to create sale';
            console.error('Sale creation error:', error);
            alert(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="text-center py-8">Loading...</div>;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard/sales" className="text-gray-500 hover:text-gray-700">
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-900">New Sale</h1>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Sales Header Section */}
                <SalesHeader
                    refNumber={refNumber}
                    setRefNumber={setRefNumber}
                    currentUser={currentUser}
                />

                {/* Customer & Description Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        <CustomerSelection customer={customer} setCustomer={setCustomer} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Description (Optional)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add notes about this sale..."
                            rows={4}
                            className="w-full border rounded-lg p-3 text-sm"
                        />
                    </div>
                </div>

                {/* Product Search */}
                <ProductSearch onProductSelect={handleAddItem} />

                {/* Line Items Table */}
                <LineItemsTable items={items} onUpdateItem={updateItem} onRemoveItem={removeItem} />

                {/* Totals Section */}
                <TotalsFooter
                    totals={totals}
                    onTotalsChange={(newTotals) => setTotals((prev) => ({ ...prev, ...newTotals }))}
                    tenantVatRate={salesSettings?.tenant?.default_vat_rate || 0}
                />

                {/* Payment Section */}
                <PaymentSection payments={payments} total={totals.total} onPaymentChange={updatePayment} />

                {/* Actions */}
                <div className="flex gap-4 justify-end">
                    <Link
                        href="/dashboard/sales"
                        className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </Link>
                    {/* Print button with paper-size dropdown */}
                    <div className="relative" ref={printMenuRef}>
                        <div className="flex items-center border rounded-lg overflow-hidden">
                            <button
                                type="button"
                                onClick={() => handlePrint()}
                                className="px-4 py-2 text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                                <Printer className="w-4 h-4" />
                                Print ({paperSize})
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowPaperMenu((v) => !v)}
                                className="px-2 py-2 border-l text-gray-500 hover:bg-gray-50"
                                title="Choose paper size"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>
                        {showPaperMenu && (
                            <div className="absolute right-0 bottom-full mb-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                                <p className="px-3 py-1 text-xs font-bold text-gray-400 uppercase tracking-wider">Paper Size</p>
                                {(['A4', 'Letter', 'Thermal80', 'Thermal58'] as PaperSize[]).map((size) => (
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
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                    >
                        {submitting ? 'Creating...' : 'Create Sale'}
                    </button>
                </div>
            </form>
        </div>
    );
}
