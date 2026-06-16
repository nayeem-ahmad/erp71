'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, Printer } from 'lucide-react';
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
        } catch (error) {
            console.error('Failed to load page data', error);
        } finally {
            setLoading(false);
        }
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
                    <button
                        type="button"
                        className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                        <Printer className="w-4 h-4" />
                        Print
                    </button>
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
