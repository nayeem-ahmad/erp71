'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { availableQtyOf, stockByWarehouseOf } from '@/components/document-entry/ProductSearch';
import { lastRateFrom, loadRateHistory } from '@/components/document-entry/RateHistory';
import type { PartyOption } from '@/components/document-entry/PartySearchSelect';
import type { LineItem, Payment } from '@/lib/hooks/useNewSaleCart';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import { instrumentFromRecord, pickInstrument } from '@/lib/payment-instrument';
import type { NewSupplierDraft } from './SupplierSelection';
import {
    computePurchaseTotals,
    EMPTY_PURCHASE_ADJUSTMENTS,
    type PurchaseAdjustments,
} from './PurchaseTotals';

/** The parts of a loaded purchase copied onto the form. */
export interface PurchaseLoadOptions {
    /**
     * Bring the tender across too. An edit shows what was paid with the bill;
     * a duplicate is a new purchase, and the cash for it has not moved.
     */
    withPayments: boolean;
}

/**
 * The state behind the purchase entry screen, shared by recording a purchase
 * and by viewing or editing one, so the two cannot drift apart in how a line
 * is costed, what a bill adds up to, or what is posted.
 */
export function usePurchaseEntry({ seedDefaultWarehouse }: { seedDefaultWarehouse: boolean }) {
    const [items, setItems] = useState<LineItem[]>([]);
    const [supplier, setSupplier] = useState<PartyOption | null>(null);
    const [supplierDraft, setSupplierDraft] = useState<NewSupplierDraft | null>(null);
    const [draftNameInvalid, setDraftNameInvalid] = useState(false);
    const [adjustments, setAdjustments] = useState<PurchaseAdjustments>(EMPTY_PURCHASE_ADJUSTMENTS);
    const [notes, setNotes] = useState('');
    // What is being handed over at the counter. Empty is the old behaviour and
    // still the common one — the whole bill goes on the supplier's account.
    const [payments, setPayments] = useState<Payment[]>([]);

    // Where the goods are received. On a new purchase `defaultWarehouseId` is
    // what the server would have chosen anyway, so the strip shows the truth
    // from the first render instead of a blank that quietly resolves on save.
    // A recorded purchase already says where its goods went, and re-resolving
    // the default there is the bug the stored column exists to stop.
    const { warehouses, defaultWarehouseId } = useWarehouses('purchase');
    const [warehouseId, setWarehouseId] = useState('');
    const [perLineWarehouse, setPerLineWarehouse] = useState(false);
    useEffect(() => {
        if (seedDefaultWarehouse) setWarehouseId((current) => current || defaultWarehouseId);
    }, [seedDefaultWarehouse, defaultWarehouseId]);

    const totals = useMemo(() => computePurchaseTotals(items, adjustments), [items, adjustments]);
    const amountPaid = useMemo(
        () => payments.reduce((sum, payment) => sum + payment.amount, 0),
        [payments],
    );
    const overpaid = amountPaid - totals.total > 0.005;

    const addProduct = useCallback(
        (
            product: any,
            options?: { quantity?: number; price?: number; availableQty?: number },
        ) => {
            // Callers pass the cost; the selling price is never a stand-in for it.
            const unitCost = options?.price ?? 0;
            setItems((prev) => {
                const existing = prev.find((item) => item.productId === product.id);
                if (existing) {
                    return prev.map((item) =>
                        item.productId === product.id
                            ? { ...item, quantity: item.quantity + (options?.quantity ?? 1) }
                            : item,
                    );
                }
                return [
                    ...prev,
                    {
                        productId: product.id,
                        name: product.name,
                        // The API serializes Decimal as a string; coerce so the
                        // line maths and the posted payload are both numbers.
                        price: Number.isFinite(unitCost) ? unitCost : 0,
                        group: product.group?.name,
                        subgroup: product.subgroup?.name,
                        quantity: options?.quantity ?? 1,
                        discount: 0,
                        unitType: product.unit_type ?? 'none',
                        // Voice-matched products come without stock rows — leave
                        // availableQty undefined rather than claiming zero stock.
                        availableQty: options?.availableQty
                            ?? (Array.isArray(product.stocks) ? availableQtyOf(product) : undefined),
                        // Kept per warehouse so the line's figure follows the
                        // warehouse picker after it is added.
                        stockByWarehouse: stockByWarehouseOf(product),
                    },
                ];
            });
        },
        [],
    );

    /**
     * For paths that add a product without a price of their own (voice entry,
     * "purchase this product" from the product page): look the last cost up
     * first. Zero when it has never been bought, which the line shows plainly.
     */
    const addProductAtLastCost = useCallback(
        async (product: any, options?: { quantity?: number }) => {
            const history = await loadRateHistory(product.id, 'purchase', supplier?.id).catch(() => null);
            addProduct(product, { ...options, price: lastRateFrom(history) ?? 0 });
        },
        [addProduct, supplier?.id],
    );

    const updateItem = useCallback((productId: string, updates: Partial<LineItem>) =>
        setItems((prev) =>
            prev.map((item) => (item.productId === productId ? { ...item, ...updates } : item)),
        ), []);

    const removeItem = useCallback((productId: string) =>
        setItems((prev) => prev.filter((item) => item.productId !== productId)), []);

    /** Put a recorded purchase on the form: supplier, lines, charges and warehouse. */
    const loadPurchase = useCallback((purchase: any, { withPayments }: PurchaseLoadOptions) => {
        setItems((purchase.items ?? []).map((item: any) => ({
            productId: item.product_id ?? item.product?.id ?? '',
            name: item.product?.name ?? '',
            price: Number(item.unit_cost ?? 0),
            group: item.product?.group?.name,
            subgroup: item.product?.subgroup?.name,
            quantity: Number(item.quantity ?? 0),
            discount: 0,
            unitType: item.product?.unit_type ?? 'none',
            // The purchase payload carries no stock rows, so leave
            // availability unknown rather than claiming zero.
            availableQty: undefined,
            warehouseId: item.warehouse_id ?? undefined,
        })));
        setSupplier(purchase.supplier
            ? { ...purchase.supplier, id: purchase.supplier_id ?? purchase.supplier.id }
            : null);
        setSupplierDraft(null);
        setAdjustments({
            taxAmount: Number(purchase.tax_amount ?? 0),
            discountAmount: Number(purchase.discount_amount ?? 0),
            freightAmount: Number(purchase.freight_amount ?? 0),
        });
        setNotes(purchase.notes ?? '');
        setPayments(withPayments ? paymentsFromPurchase(purchase) : []);
        if (purchase.warehouse_id) setWarehouseId(purchase.warehouse_id);
        // Shown, not hidden behind the switch, when the bill really is split:
        // a warehouse that steers a line has to be visible on the line.
        setPerLineWarehouse((purchase.items ?? []).some((item: any) => item.warehouse_id));
    }, []);

    /**
     * Check the form before posting it. Returns the message to show, or null
     * when the bill can go. A tender larger than the bill would leave the
     * supplier holding an advance this screen has no way to record, and the
     * service rejects it anyway.
     */
    const validate = useCallback((messages: {
        noLines: string;
        supplierNameRequired: string;
        paymentExceedsTotal: string;
    }): string | null => {
        if (items.length === 0) return messages.noLines;
        if (supplierDraft && !supplierDraft.name.trim()) {
            setDraftNameInvalid(true);
            return messages.supplierNameRequired;
        }
        setDraftNameInvalid(false);
        if (overpaid) return messages.paymentExceedsTotal;
        return null;
    }, [items.length, supplierDraft, overpaid]);

    /** The bill as the API takes it, for recording or for saving an edit. */
    const billPayload = useCallback(() => ({
        supplierId: supplierDraft ? undefined : supplier?.id,
        newSupplier: supplierDraft
            ? {
                  name: supplierDraft.name,
                  phone: supplierDraft.phone || undefined,
                  email: supplierDraft.email || undefined,
                  address: supplierDraft.address || undefined,
              }
            : undefined,
        warehouseId: warehouseId || undefined,
        items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.price,
            // Only sent while the per-line column is showing: a line keeps its
            // override in state when the column is hidden, and posting one the
            // user cannot see would be a trap.
            warehouseId: perLineWarehouse ? item.warehouseId : undefined,
        })),
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        freightAmount: totals.freightAmount,
        notes: notes || undefined,
        payments: payments.length
            ? payments.map((payment) => ({
                  paymentMethod: payment.method,
                  amount: payment.amount,
                  accountId: payment.accountId,
                  // The cheque / transfer details typed against this tender —
                  // only the boxes that were filled in.
                  ...pickInstrument(payment),
              }))
            : undefined,
    }), [supplier, supplierDraft, warehouseId, items, perLineWarehouse, totals, notes, payments]);

    return {
        items,
        supplier,
        setSupplier,
        supplierDraft,
        setSupplierDraft,
        draftNameInvalid,
        setAdjustments,
        notes,
        setNotes,
        payments,
        setPayments,
        warehouses,
        warehouseId,
        setWarehouseId,
        perLineWarehouse,
        setPerLineWarehouse,
        totals,
        amountPaid,
        overpaid,
        addProduct,
        addProductAtLastCost,
        updateItem,
        removeItem,
        loadPurchase,
        validate,
        billPayload,
    };
}

/**
 * What was paid with a recorded bill, as tender rows. An imported bill has no
 * rows of its own — what was paid with the goods went out as cash — so it is
 * shown as one cash tender for that amount, or saving the edit unchanged would
 * read as taking the payment away.
 */
export function paymentsFromPurchase(purchase: any): Payment[] {
    const rows = purchase.payments ?? [];
    if (rows.length > 0) {
        return rows.map((payment: any) => ({
            method: payment.payment_method,
            amount: Number(payment.amount ?? 0),
            ...instrumentFromRecord(payment),
        }));
    }
    const entryPaid = Number(purchase.entry_paid_amount ?? 0);
    return entryPaid > 0.005 ? [{ method: 'Cash', amount: entryPaid }] : [];
}
