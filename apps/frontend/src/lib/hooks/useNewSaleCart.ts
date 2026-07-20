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
     * Id of the line this one derives from, where the document is built from
     * another (a sales return carries the originating sale_item id here).
     */
    sourceLineId?: string;
    /** Upper bound on quantity, e.g. units of a sale line not yet returned. */
    maxQuantity?: number;
}

export interface Payment {
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
