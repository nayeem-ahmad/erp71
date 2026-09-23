import { useState, useCallback } from 'react';

export interface LineItem {
    productId: string;
    name: string;
    price: number;
    group?: string;
    subgroup?: string;
    quantity: number;
    discount: number;
    /** Stock on hand when the product was picked — shown for reference only. */
    availableQty?: number;
    /**
     * The product's unit type (`kg_g`, `dozen_pcs`, …). Only documents that opt
     * into compound quantity entry read it; everything else counts in the base
     * unit as before.
     */
    unitType?: string;
    /**
     * Id of the line this one derives from, where the document is built from
     * another (a sales return carries the originating sale_item id here).
     */
    sourceLineId?: string;
    /** Upper bound on quantity, e.g. units of a sale line not yet returned. */
    maxQuantity?: number;
    /**
     * Warehouse override for this line. Undefined — the normal case — means the
     * line follows whatever warehouse the document itself is posting to, and
     * nothing is stored against the line.
     */
    warehouseId?: string;
    /**
     * The product's own VAT rate, where it has one. Undefined or null falls
     * back to the workspace default, exactly as the server resolves it — only
     * used to show the VAT a sale's total already contains.
     */
    vatRate?: number | null;
}

/** Money to the paisa — the same rounding the server applies to a sale line. */
const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * A line's unit price after its "Disc %", to the paisa. This is what the
 * server stores as `price_at_sale` (see `sale-line-pricing.ts` in the backend,
 * which rounds identically), so it is also what every total on the entry
 * screen is built from — the screen never shows one price and posts another.
 */
export function netUnitPrice(item: Pick<LineItem, 'price' | 'discount'>): number {
    const percent = Math.min(Math.max(item.discount || 0, 0), 100);
    if (percent === 0) return item.price;
    return roundMoney(item.price * (1 - percent / 100));
}

/** What a line bills: quantity at its net unit price. */
export function lineNetTotal(item: Pick<LineItem, 'price' | 'discount' | 'quantity'>): number {
    return item.quantity * netUnitPrice(item);
}

/** The taka a line's "Disc %" takes off — what the printed invoice shows. */
export function lineDiscountAmount(item: Pick<LineItem, 'price' | 'discount' | 'quantity'>): number {
    return roundMoney(item.quantity * item.price - lineNetTotal(item));
}

/**
 * What a non-cash payment actually arrived on. A cheque is the case that needs
 * it: a shop handed one has to be able to say afterwards which bank it is drawn
 * on, out of whose account, what number is written on it and what date it
 * carries — post-dated cheques are an ordinary way to be paid here, so that
 * date is routinely later than the sale's.
 *
 * A transfer, a card and a wallet fill the same fields; only the entry form's
 * labels change. All empty on cash.
 */
export interface PaymentInstrument {
    /** The bank a cheque is drawn on, or the card's issuer. */
    bankName?: string;
    bankBranch?: string;
    /** The account or wallet number the money came out of, as written. */
    bankAccountNumber?: string;
    /** Cheque number, wallet transaction id, or card approval code. */
    referenceNo?: string;
    /** `YYYY-MM-DD` — the date on the instrument, not the sale's. */
    instrumentDate?: string;
}

export interface Payment extends PaymentInstrument {
    // `method` is the canonical, accounting-classifiable string (e.g. "Cash",
    // "Mobile Wallet", "Card", "Bank") sent to the backend. `label` is the
    // friendly display name of the chosen defined method (e.g. "bKash").
    method: string;
    label?: string;
    amount: number;
    accountId?: string;
}

export function useNewSaleCart() {
    const [items, setItems] = useState<LineItem[]>([]);
    const [customer, setCustomer] = useState<any>(null);
    const [description, setDescription] = useState('');
    const [refNumber, setRefNumber] = useState('');
    const [payments, setPayments] = useState<Payment[]>([]);

    const addItem = useCallback((item: LineItem) => {
        setItems((prev) => {
            const existing = prev.find((i) => i.productId === item.productId);
            if (existing) {
                return prev.map((i) =>
                    i.productId === item.productId ? { ...i, quantity: i.quantity + item.quantity } : i
                );
            }
            return [...prev, item];
        });
    }, []);

    const updateItem = useCallback((productId: string, updates: Partial<LineItem>) => {
        setItems((prev) =>
            prev.map((item) =>
                item.productId === productId ? { ...item, ...updates } : item
            )
        );
    }, []);

    const removeItem = useCallback((productId: string) => {
        setItems((prev) => prev.filter((item) => item.productId !== productId));
    }, []);

    const updatePayment = useCallback((payments: Payment[]) => {
        setPayments(payments);
    }, []);

    /** Replace the whole cart at once — used to seed it from an existing sale. */
    const loadCart = useCallback((next: {
        items: LineItem[];
        customer?: any;
        description?: string;
        refNumber?: string;
        payments?: Payment[];
    }) => {
        setItems(next.items);
        setCustomer(next.customer ?? null);
        setDescription(next.description ?? '');
        setRefNumber(next.refNumber ?? '');
        setPayments(next.payments ?? []);
    }, []);

    const clearCart = useCallback(() => {
        setItems([]);
        setCustomer(null);
        setDescription('');
        setRefNumber('');
        setPayments([]);
    }, []);

    return {
        items,
        customer,
        description,
        refNumber,
        payments,
        setCustomer,
        setDescription,
        setRefNumber,
        addItem,
        updateItem,
        removeItem,
        updatePayment,
        loadCart,
        clearCart,
    };
}
