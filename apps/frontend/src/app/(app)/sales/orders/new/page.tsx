'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import DocumentEntryLayout from '../../components/DocumentEntryLayout';
import CustomerSelection from '../../components/CustomerSelection';
import ProductSearch from '../../components/ProductSearch';
import LineItemsTable from '../../components/LineItemsTable';
import TotalsFooter from '../../components/TotalsFooter';
import SalesHeader, { MetaField, metaFieldInputClass } from '../../components/SalesHeader';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import { useNewSaleCart } from '@/lib/hooks/useNewSaleCart';
import { toast } from '@/lib/toast';

export default function NewSalesOrderPage() {
    const router = useRouter();
    // No `description` here on purpose: CreateSalesOrderDto has no notes field,
    // so a note box on this screen would be silently dropped on save.
    const {
        items,
        customer,
        setCustomer,
        addItem,
        updateItem,
        removeItem,
        clearCart,
    } = useNewSaleCart();

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    // A sales order stores only a total, so the subtotal is the total. The
    // adjustment rows are hidden for the same reason (see TotalsFooter).
    const totals = useMemo(() => {
        const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
        return {
            subtotal,
            discount: 0,
            discountPercent: 0,
            vat: 0,
            transportCost: 0,
            laborCost: 0,
            rounding: 0,
            total: subtotal,
        };
    }, [items]);

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
            availableQty: options?.availableQty,
        });
    };

    const handleVoiceOrder = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, { quantity: item.quantity });
                added++;
            }
        }
        for (const message of buildVoiceEntryMessages(result, added)) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (items.length === 0) {
            toast.error('Add at least one item to the order');
            return;
        }

        setSubmitting(true);
        try {
            await api.createOrder({
                storeId: localStorage.getItem('store_id') || '',
                customerId: customer?.id,
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    priceAtOrder: item.price,
                })),
                totalAmount: totals.total,
                status: 'DRAFT',
                deliveryDate: deliveryDate || undefined,
            });

            clearCart();
            toast.success('Sales order created');
            router.push(routes.sales.orders);
        } catch (error: any) {
            console.error('Order creation error:', error);
            toast.error(error.message || 'Failed to create order');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <DocumentEntryLayout
            title="New Sales Order"
            backHref={routes.sales.orders}
            onSubmit={handleSubmit}
            metaBar={
                <SalesHeader
                    docLabel="Order #"
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                >
                    <MetaField label="Delivery Date">
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            className={metaFieldInputClass}
                        />
                    </MetaField>
                </SalesHeader>
            }
            customerPicker={<CustomerSelection customer={customer} setCustomer={setCustomer} />}
            picker={
                <VoiceEntryInput entryType="sales_order" onResult={handleVoiceOrder} inline>
                    <ProductSearch onProductSelect={handleAddItem} />
                </VoiceEntryInput>
            }
            table={
                <LineItemsTable
                    items={items}
                    onUpdateItem={updateItem}
                    onRemoveItem={removeItem}
                    showDiscount={false}
                />
            }
            panel={
                <TotalsFooter
                    totals={totals}
                    onTotalsChange={() => {}}
                    tenantVatRate={0}
                    showAdjustments={false}
                />
            }
            actions={
                <>
                    <Link
                        href={routes.sales.orders}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Creating…' : 'Create Order'}
                    </button>
                </>
            }
        />
    );
}
