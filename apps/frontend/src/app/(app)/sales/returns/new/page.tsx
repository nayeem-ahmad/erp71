'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import DocumentEntryLayout from '../../components/DocumentEntryLayout';
import LineItemsTable from '../../components/LineItemsTable';
import TotalsFooter from '../../components/TotalsFooter';
import SalesHeader, { MetaField, metaFieldInputClass } from '../../components/SalesHeader';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import {
    applyVoiceEntryReturnQuantities,
    buildVoiceEntryMessages,
    type VoiceEntryResult,
} from '@/lib/voice-entry';
import { useNewSaleCart, type LineItem } from '@/lib/hooks/useNewSaleCart';
import { toast } from '@/lib/toast';

/** Units of a sale line not already covered by an earlier return. */
function returnableQty(saleItem: any): number {
    const alreadyReturned = (saleItem.returns ?? []).reduce(
        (sum: number, entry: any) => sum + (entry.quantity ?? 0),
        0,
    );
    return Math.max(0, saleItem.quantity - alreadyReturned);
}

export default function NewSalesReturnPage() {
    const router = useRouter();
    const {
        items,
        description,
        setDescription,
        loadCart,
        updateItem,
        removeItem,
        clearCart,
    } = useNewSaleCart();

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [serialNumber, setSerialNumber] = useState('');
    const [sale, setSale] = useState<any>(null);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

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

    const findSale = async () => {
        const serial = serialNumber.trim();
        if (!serial) return;

        setSearching(true);
        try {
            // TODO: needs a lookup-by-serial endpoint — this pulls the whole
            // sales list to match one row (carried over from IssueReturnModal).
            const allSales = await api.getSales();
            const found = allSales.find((entry: any) => entry.serial_number === serial);
            if (!found) {
                toast.error(`No sale found with serial ${serial}`);
                return;
            }

            // The list payload has no per-item return history; the detail does,
            // and without it the returnable quantities would be wrong.
            const fullSale = await api.getSale(found.id);
            const lines: LineItem[] = (fullSale.items ?? [])
                .map((saleItem: any) => {
                    const max = returnableQty(saleItem);
                    return {
                        // Keyed by sale-item id, not product id: one sale can
                        // carry the same product on two lines, and the cart
                        // identifies rows by `productId`.
                        productId: saleItem.id,
                        sourceLineId: saleItem.id,
                        name: saleItem.product?.name || 'Item',
                        price: Number(saleItem.price_at_sale),
                        quantity: max,
                        maxQuantity: max,
                        discount: 0,
                    };
                })
                .filter((line: LineItem) => (line.maxQuantity ?? 0) > 0);

            if (lines.length === 0) {
                toast.error(`Sale ${serial} has already been fully returned`);
                return;
            }

            setSale(fullSale);
            // loadCart resets the whole cart, so carry over any reason already typed.
            loadCart({ items: lines, description });
        } catch (error: any) {
            console.error('Sale lookup error:', error);
            toast.error(error.message || 'Failed to look up the sale');
        } finally {
            setSearching(false);
        }
    };

    const startOver = () => {
        setSale(null);
        setSerialNumber('');
        clearCart();
    };

    const handleVoiceReturn = (result: VoiceEntryResult) => {
        if (!sale) return;

        const lines = items.map((item) => ({
            id: item.productId,
            productId: item.productId,
            productName: item.name,
        }));

        const { quantities, unmatched } = applyVoiceEntryReturnQuantities(
            result,
            lines,
            (lineId) => items.find((item) => item.productId === lineId)?.maxQuantity ?? 0,
        );

        for (const [lineId, quantity] of Object.entries(quantities)) {
            updateItem(lineId, { quantity });
        }
        if (result.note && !description) setDescription(result.note);

        const messages = buildVoiceEntryMessages(
            { ...result, unmatched },
            Object.keys(quantities).length,
            'Set return qty for',
        );
        for (const message of messages) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!sale || items.length === 0) {
            toast.error('Look up a sale and choose the items to return');
            return;
        }

        setSubmitting(true);
        try {
            await api.createReturn({
                storeId: sale.store_id,
                saleId: sale.id,
                items: items.map((item) => ({
                    saleItemId: item.sourceLineId,
                    quantity: item.quantity,
                })),
                reason: description || undefined,
            });

            clearCart();
            toast.success('Return processed');
            router.push(routes.sales.returns);
        } catch (error: any) {
            console.error('Return creation error:', error);
            toast.error(error.message || 'Failed to process the return');
        } finally {
            setSubmitting(false);
        }
    };

    const salePicker = (
        <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    type="text"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            // Enter here looks the sale up; it must not submit the form.
                            e.preventDefault();
                            findSale();
                        }
                    }}
                    disabled={!!sale}
                    placeholder="Sale serial number — e.g. S-00001"
                    className="w-full pl-8 pr-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
                />
            </div>
            {sale ? (
                <button
                    type="button"
                    onClick={startOver}
                    className="px-3 py-1.5 border rounded text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                >
                    <X className="w-4 h-4" />
                    Change
                </button>
            ) : (
                <button
                    type="button"
                    onClick={findSale}
                    disabled={searching || !serialNumber.trim()}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
                >
                    {searching ? 'Searching…' : 'Find'}
                </button>
            )}
        </div>
    );

    return (
        <DocumentEntryLayout
            title="New Sales Return"
            backHref={routes.sales.returns}
            onSubmit={handleSubmit}
            metaBar={
                <SalesHeader
                    docLabel="Return #"
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                >
                    <MetaField label="Against Sale">
                        <span className={`${metaFieldInputClass} bg-gray-50 text-gray-700 font-medium`}>
                            {sale?.serial_number || '—'}
                        </span>
                    </MetaField>
                </SalesHeader>
            }
            picker={
                sale ? (
                    <VoiceEntryInput entryType="sales_return" onResult={handleVoiceReturn} inline>
                        {salePicker}
                    </VoiceEntryInput>
                ) : (
                    salePicker
                )
            }
            table={
                <LineItemsTable
                    items={items}
                    onUpdateItem={updateItem}
                    onRemoveItem={removeItem}
                    showDiscount={false}
                    showAvailable={false}
                    readOnlyPrice
                    maxQuantityOf={(item) => item.maxQuantity}
                    emptyMessage="Find a sale by its serial number to load the items you can return."
                />
            }
            note={
                <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Reason for return (optional)…"
                    className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                />
            }
            panel={
                <TotalsFooter
                    totals={totals}
                    onTotalsChange={() => {}}
                    tenantVatRate={0}
                    showAdjustments={false}
                    totalLabel="Refund Total"
                />
            }
            actions={
                <>
                    <Link
                        href={routes.sales.returns}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0}
                        className="flex-1 px-3 py-2 bg-danger text-white rounded hover:bg-red-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Processing…' : 'Create Return'}
                    </button>
                </>
            }
        />
    );
}
