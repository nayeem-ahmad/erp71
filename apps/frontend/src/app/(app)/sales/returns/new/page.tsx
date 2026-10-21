'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import TotalsFooter from '../../components/TotalsFooter';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import WarehouseMetaFields from '@/components/document-entry/WarehouseMetaFields';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import {
    applyVoiceEntryReturnQuantities,
    buildVoiceEntryMessages,
    type VoiceEntryResult,
} from '@/lib/voice-entry';
import PaymentSection from '@/components/document-entry/PaymentSection';
import { useNewSaleCart, type LineItem } from '@/lib/hooks/useNewSaleCart';
import { useReturnRefund } from '@/lib/hooks/useReturnRefund';
import { paymentsFromRecords, returnPaymentsPayload } from '@/lib/return-refund-prefill';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import { openSaleLineQty } from '@/lib/open-sale-line';
import {
    filterLines,
    resolveLineEnter,
    returnAllRemaining,
    setSlipQuantity,
    type SlipLine,
    type SlipQuantities,
} from '@/lib/purchase-return-slip';
import { toast } from '@/lib/toast';

/** The server's refusal of a partial refund when no customer's due can take the rest. */
const REFUND_NEEDS_CUSTOMER = "Refund the full amount, or pick the customer's sale";

/** Units of a sale line not already covered by an earlier return or exchange. */
function returnableQty(saleItem: any): number {
    return openSaleLineQty(saleItem);
}

/** One still-returnable sale line, ready to be put on the slip. */
interface ReturnableLine {
    id: string;
    productId: string;
    name: string;
    sku: string;
    remaining: number;
    price: number;
    warehouseId?: string;
}

function NewSalesReturnPageContent() {
    const router = useRouter();
    // Set when the return is started from a sale (the sales list's row menu):
    // that sale is loaded straight away instead of asking for its serial.
    const saleIdParam = useSearchParams().get('saleId');
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
    // Lines that can still go back. The cart holds only the ones on the slip.
    const [catalog, setCatalog] = useState<ReturnableLine[]>([]);
    const [lineQuery, setLineQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [partialDraft, setPartialDraft] = useState<Record<string, string>>({});
    const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Where the goods are put back. Seeded from the sale below rather than from
    // the tenant default, so returning what was sold out of the annex puts it
    // back in the annex — the server applies the same rule, and this makes it
    // visible and overridable before the return is posted.
    const { warehouses, defaultWarehouseId } = useWarehouses();
    const [warehouseId, setWarehouseId] = useState('');
    const [perLineWarehouse, setPerLineWarehouse] = useState(false);
    const entryWarehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name;

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    useEffect(() => {
        setWarehouseId((current) => current || defaultWarehouseId);
    }, [defaultWarehouseId]);

    // The refund opens the way the sale was paid. A sale left with a balance
    // settles against the customer's due first (that part comes off the due
    // instead); a paid one refunds in full. No customer, no due.
    const originalTenders = useMemo(() => paymentsFromRecords(sale?.payments), [sale]);
    const partyDue: number | null = sale?.customer_id ? Number(sale.customer?.due_balance ?? 0) : null;
    const saleBalance = sale
        ? Math.round((Number(sale.total_amount ?? 0) - Number(sale.amount_paid ?? 0)) * 100) / 100
        : 0;

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

    const refund = useReturnRefund({
        context: 'sale_return',
        docKey: sale?.id ?? null,
        total: totals.total,
        partyDue,
        saleBalance,
        originalTenders,
    });
    const refunded = refund.payments.reduce((sum, p) => sum + p.amount, 0);
    // What the tenders leave unrefunded comes off the customer's due, so with
    // no customer the strip must cover the whole total — and never exceed it.
    const refundBalanced = partyDue !== null
        ? refunded - totals.total < 0.01
        : Math.abs(totals.total - refunded) < 0.01;

    const slipLines = useMemo<SlipLine[]>(() => catalog.map((line) => ({
        id: line.id,
        name: line.name,
        sku: line.sku,
        purchased: line.remaining,
        remaining: line.remaining,
        unitCost: line.price,
    })), [catalog]);

    const quantities = useMemo<SlipQuantities>(
        () => Object.fromEntries(items.map((item) => [item.productId, item.quantity])),
        [items],
    );
    const onSlip = new Set(items.map((item) => item.productId));
    const offSlip = slipLines.filter((line) => line.remaining > 0 && !onSlip.has(line.id));
    const billRows = filterLines(offSlip, lineQuery);
    const queryActive = lineQuery.trim().length > 0;
    const highlightedIndex = billRows.length === 0 ? 0 : Math.min(highlight, billRows.length - 1);
    const allOnSlip = slipLines.length > 0 && slipLines.every((line) => quantities[line.id] === line.remaining);

    /** Replace the slip with these quantities. A missing line is not on it. */
    const applyQuantities = (next: SlipQuantities, reason = description) => {
        const lines: LineItem[] = catalog
            .filter((line) => (next[line.id] ?? 0) > 0)
            .map((line) => ({
                // Keyed by sale-item id, not product id: one sale can carry
                // the same product on two lines, and the cart identifies rows
                // by `productId`.
                productId: line.id,
                sourceLineId: line.id,
                name: line.name,
                price: line.price,
                quantity: next[line.id],
                maxQuantity: line.remaining,
                discount: 0,
                warehouseId: line.warehouseId,
            }));
        // loadCart resets the whole cart, so carry the reason across.
        loadCart({ items: lines, description: reason });
    };

    const putOnSlip = (line: SlipLine, quantity: number) => {
        applyQuantities(setSlipQuantity(quantities, line, quantity));
        setPartialDraft((current) => {
            const next = { ...current };
            delete next[line.id];
            return next;
        });
        if (quantity > 0) setPendingFocusId(line.id);
    };

    useEffect(() => {
        if (!pendingFocusId) return;
        const line = catalog.find((entry) => entry.id === pendingFocusId);
        if (!line) return;
        const input = document.querySelector(
            `[aria-label="Qty — ${CSS.escape(line.name)}"]`,
        ) as HTMLInputElement | null;
        if (!input) return;
        input.focus();
        input.select();
        setPendingFocusId(null);
    }, [pendingFocusId, items, catalog]);

    const handleLineSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (billRows.length === 0) return;
            setHighlight((current) => {
                const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
                return (next + billRows.length) % billRows.length;
            });
            return;
        }
        if (event.key !== 'Enter') return;
        // Enter here fills the slip; it must not submit the return.
        event.preventDefault();
        const action = resolveLineEnter(slipLines, quantities, lineQuery, highlightedIndex);
        if (action.type === 'none') return;
        setLineQuery('');
        setHighlight(0);
        if (action.type === 'scan' || action.type === 'add-full') {
            applyQuantities(action.quantities);
        }
        if (action.type === 'add-full' || action.type === 'focus') {
            setPendingFocusId(action.lineId);
        } else {
            searchRef.current?.focus();
        }
    };

    /** Opens the sale with an empty slip. Only lines the user adds go back. */
    const acceptSale = (fullSale: any) => {
        const lines: ReturnableLine[] = (fullSale.items ?? [])
            .map((saleItem: any) => ({
                id: saleItem.id,
                productId: saleItem.product_id || saleItem.product?.id || saleItem.id,
                name: saleItem.product?.name || 'Item',
                sku: saleItem.product?.sku || '',
                remaining: returnableQty(saleItem),
                price: Number(saleItem.price_at_sale),
                warehouseId: saleItem.warehouse_id ?? undefined,
            }))
            .filter((line: ReturnableLine) => line.remaining > 0);

        if (lines.length === 0) {
            toast.error(`Sale ${fullSale.serial_number} has already been fully returned`);
            return;
        }

        setSale(fullSale);
        setCatalog(lines);
        setLineQuery('');
        setHighlight(0);
        setPartialDraft({});
        setSerialNumber(fullSale.serial_number ?? '');
        if (fullSale.warehouse_id) setWarehouseId(fullSale.warehouse_id);
        // Shown rather than hidden behind the switch when the sale really
        // was split: a warehouse steering a line has to be on the line.
        if (lines.some((line) => line.warehouseId)) setPerLineWarehouse(true);
        loadCart({ items: [], description });
    };

    // The sale named in the URL, loaded once on arrival.
    useEffect(() => {
        if (!saleIdParam) return;
        let cancelled = false;
        setSearching(true);
        api.getSale(saleIdParam)
            .then((fullSale) => {
                if (!cancelled) acceptSale(fullSale);
            })
            .catch((error: any) => {
                if (cancelled) return;
                console.error('Sale lookup error:', error);
                toast.error(error?.message || 'Failed to look up the sale');
            })
            .finally(() => {
                if (!cancelled) setSearching(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saleIdParam]);

    const findSale = async () => {
        const serial = serialNumber.trim();
        if (!serial) return;

        setSearching(true);
        try {
            // Server-side search, bounded: the serial is matched exactly below,
            // but `search` also matches reference numbers and customer names, so
            // take a small page rather than assume the first row is the one.
            const page = await api.getSalesList({ search: serial, limit: 20 });
            const found = (page.items ?? []).find((entry: any) => entry.serial_number === serial);
            if (!found) {
                toast.error(`No sale found with serial ${serial}`);
                return;
            }

            // The list payload has no per-item return history; the detail does,
            // and without it the returnable quantities would be wrong.
            acceptSale(await api.getSale(found.id));
        } catch (error: any) {
            console.error('Sale lookup error:', error);
            toast.error(error.message || 'Failed to look up the sale');
        } finally {
            setSearching(false);
        }
    };

    const startOver = () => {
        setSale(null);
        setCatalog([]);
        setLineQuery('');
        setHighlight(0);
        setPartialDraft({});
        setSerialNumber('');
        setWarehouseId(defaultWarehouseId);
        setPerLineWarehouse(false);
        clearCart();
        // Drop the sale from the URL too, or a reload would bring it back.
        if (saleIdParam) router.replace(routes.sales.returnNew);
    };

    const handleVoiceReturn = (result: VoiceEntryResult) => {
        if (!sale) return;

        const lines = catalog.map((line) => ({
            id: line.id,
            productId: line.productId,
            productName: line.name,
        }));

        const { quantities: spoken, unmatched } = applyVoiceEntryReturnQuantities(
            result,
            lines,
            (lineId) => catalog.find((line) => line.id === lineId)?.remaining ?? 0,
        );

        const next: SlipQuantities = { ...quantities };
        for (const [lineId, quantity] of Object.entries(spoken)) {
            const line = slipLines.find((entry) => entry.id === lineId);
            if (!line) continue;
            const updated = setSlipQuantity(next, line, quantity);
            if (updated[lineId] == null) delete next[lineId];
            else next[lineId] = updated[lineId];
        }
        const reason = result.note && !description ? result.note : description;
        applyQuantities(next, reason);
        if (result.note && !description) setDescription(result.note);

        const messages = buildVoiceEntryMessages(
            { ...result, unmatched },
            Object.keys(spoken).length,
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

        if (!refundBalanced) {
            toast.error(
                partyDue === null && refunded < totals.total
                    ? REFUND_NEEDS_CUSTOMER
                    : 'The refund is more than the return total',
            );
            return;
        }

        setSubmitting(true);
        try {
            await api.createReturn({
                storeId: sale.store_id,
                saleId: sale.id,
                warehouseId: warehouseId || undefined,
                items: items.map((item) => ({
                    saleItemId: item.sourceLineId,
                    quantity: item.quantity,
                    // Only sent while the per-line column is showing, so a
                    // hidden override can never post behind the user's back.
                    warehouseId: perLineWarehouse ? item.warehouseId : undefined,
                })),
                reason: description || undefined,
                payments: returnPaymentsPayload(refund.payments),
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
                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
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
                    className="w-full ps-8 pe-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
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
                <DocumentMetaBar
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
                    <WarehouseMetaFields
                        warehouses={warehouses}
                        value={warehouseId}
                        onChange={setWarehouseId}
                        perLine={perLineWarehouse}
                        onPerLineChange={setPerLineWarehouse}
                    />
                </DocumentMetaBar>
            }
            picker={
                <div className="space-y-2">
                    {sale ? (
                        <VoiceEntryInput entryType="sales_return" onResult={handleVoiceReturn} inline>
                            {salePicker}
                        </VoiceEntryInput>
                    ) : (
                        salePicker
                    )}
                    {sale && (
                        <div className="flex items-center gap-2">
                            <input
                                ref={searchRef}
                                type="text"
                                value={lineQuery}
                                onChange={(event) => {
                                    setLineQuery(event.target.value);
                                    setHighlight(0);
                                }}
                                onKeyDown={handleLineSearchKey}
                                placeholder="Search or scan a product on this bill"
                                aria-label="Search or scan a product on this bill"
                                className="flex-1 min-w-0 px-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                type="button"
                                onClick={() => applyQuantities(returnAllRemaining(slipLines, quantities))}
                                disabled={allOnSlip}
                                className="px-3 py-1.5 border rounded text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-transparent whitespace-nowrap"
                            >
                                Return all remaining
                            </button>
                        </div>
                    )}
                </div>
            }
            table={
                <div className="h-full flex flex-col gap-2 min-h-0">
                    {sale && (offSlip.length > 0 || queryActive) && (
                        <div className="flex-shrink-0 rounded border bg-white px-3 py-2 space-y-2">
                            <div>
                                <div className="text-sm font-medium text-gray-800">On this bill</div>
                                <p className="text-xs text-gray-500">Not on this return yet. Add a line, or type a quantity to return part of it.</p>
                            </div>
                            {billRows.length === 0 ? (
                                <p className="text-sm text-gray-500">No returnable line matches</p>
                            ) : (
                                <div className="space-y-1">
                                    {billRows.map((line, index) => (
                                        <div
                                            key={line.id}
                                            className={`flex items-center gap-2 rounded px-2 py-1 ${index === highlightedIndex ? 'bg-blue-50' : ''}`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-gray-900 truncate">{line.name}</div>
                                                <div className="text-xs text-gray-500">{line.remaining} left{line.sku ? ` · ${line.sku}` : ''}</div>
                                            </div>
                                            <input
                                                type="number"
                                                min="1"
                                                max={line.remaining}
                                                value={partialDraft[line.id] ?? ''}
                                                onChange={(event) => setPartialDraft((current) => ({
                                                    ...current,
                                                    [line.id]: event.target.value,
                                                }))}
                                                placeholder="Qty"
                                                aria-label={`Partial quantity — ${line.name}`}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'Enter') return;
                                                    event.preventDefault();
                                                    const typed = partialDraft[line.id]?.trim();
                                                    putOnSlip(line, typed ? Number(typed) : line.remaining);
                                                }}
                                                className="no-spinner w-16 px-1.5 py-1 border rounded text-sm text-center"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const typed = partialDraft[line.id]?.trim();
                                                    putOnSlip(line, typed ? Number(typed) : line.remaining);
                                                }}
                                                aria-label={`${partialDraft[line.id]?.trim() ? 'Add' : 'Add all left'} — ${line.name}`}
                                                className="px-2 py-1 border rounded text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                                            >
                                                {partialDraft[line.id]?.trim() ? 'Add' : 'Add all left'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex-1 min-h-0">
                        <LineItemsTable
                            items={items}
                            onUpdateItem={updateItem}
                            onRemoveItem={removeItem}
                            showDiscount={false}
                            showAvailable={false}
                            readOnlyPrice
                            maxQuantityOf={(item) => item.maxQuantity}
                            emptyMessage={sale
                                ? 'Nothing on this return yet. Search, scan, or pick a line from the bill.'
                                : 'Find a sale by its serial number to load the items you can return.'}
                            warehouses={perLineWarehouse ? warehouses : []}
                            entryWarehouseName={entryWarehouseName}
                        />
                    </div>
                </div>
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
                <>
                    <TotalsFooter
                        totals={totals}
                        onTotalsChange={() => {}}
                        tenantVatRate={0}
                        showAdjustments={false}
                        totalLabel="Refund Total"
                    />
                    {sale && (
                        <div className="border-t pt-3">
                            <PaymentSection
                                key={sale.id}
                                context="sale_return"
                                storeId={sale.store_id}
                                payments={refund.payments}
                                total={totals.total}
                                onPaymentChange={refund.onPaymentChange}
                                onLayoutReady={refund.onLayoutReady}
                                captureInstrument
                                labels={{ title: 'Refund', keepingDue: 'Adjusted against due {amount}' }}
                                blockedReason={partyDue === null ? REFUND_NEEDS_CUSTOMER : undefined}
                            />
                        </div>
                    )}
                </>
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
                        disabled={submitting || items.length === 0 || (!!sale && (!refund.ready || !refundBalanced))}
                        className="flex-1 px-3 py-2 bg-danger text-white rounded hover:bg-red-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? 'Processing…' : 'Create Return'}
                    </button>
                </>
            }
        />
    );
}

export default function NewSalesReturnPage() {
    return (
        <Suspense>
            <NewSalesReturnPageContent />
        </Suspense>
    );
}
