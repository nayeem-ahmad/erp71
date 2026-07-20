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

export default function NewQuotationPage() {
    const router = useRouter();
    const {
        items,
        customer,
        description,
        setCustomer,
        setDescription,
        addItem,
        updateItem,
        removeItem,
        clearCart,
    } = useNewSaleCart();

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [validUntil, setValidUntil] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    // A quotation stores only a total, so the subtotal is the total. The
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

    const handleVoiceQuote = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                handleAddItem(item.product, { quantity: item.quantity });
                added++;
            }
        }
        if (result.note && !description) setDescription(result.note);

        for (const message of buildVoiceEntryMessages(result, added)) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (items.length === 0) {
            toast.error('Add at least one item to the quotation');
            return;
        }

        setSubmitting(true);
        try {
            await api.createQuotation({
                storeId: localStorage.getItem('store_id') || '',
                customerId: customer?.id,
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.price,
                })),
                totalAmount: totals.total,
                validUntil: validUntil || undefined,
                notes: description || undefined,
            });

            clearCart();
            toast.success('Quotation created');
            router.push(routes.sales.quotes);
        } catch (error: any) {
            console.error('Quotation creation error:', error);
            toast.error(error.message || 'Failed to create quotation');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <DocumentEntryLayout
            title="New Quotation"
            backHref={routes.sales.quotes}
            onSubmit={handleSubmit}
            metaBar={
                <SalesHeader
                    docLabel="Quotation #"
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                >
                    <MetaField label="Valid Until">
                        <input
                            type="date"
                            value={validUntil}
                            onChange={(e) => setValidUntil(e.target.value)}
                            className={metaFieldInputClass}
                        />
                    </MetaField>
                </SalesHeader>
            }
            customerPicker={<CustomerSelection customer={customer} setCustomer={setCustomer} />}
            picker={
                <VoiceEntryInput entryType="sales_quote" onResult={handleVoiceQuote} inline>
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
            note={
                <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Notes (optional)…"
                    className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
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
                        href={routes.sales.quotes}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Creating…' : 'Create Quotation'}
                    </button>
                </>
            }
        />
    );
}
