import { useState, useCallback } from 'react';

export interface LineItem {
    productId: string;
    name: string;
    price: number;
    group?: string;
    subgroup?: string;
    quantity: number;
    discount: number;
}

export interface Payment {
    method: string;
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
        clearCart,
    };
}
