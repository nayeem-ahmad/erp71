'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

/**
 * The payment methods a customer or supplier payment can be recorded against —
 * the same list the sale and purchase screens offer (Settings → Payment
 * Methods), so a shop that takes bKash at the till can say it took bKash when
 * the customer settles their due.
 *
 * The backend resolves the ledger account from the method's name, so `name` is
 * what gets submitted; `accountId` rides along when the method is linked to an
 * account, and that is the account the posting uses.
 */

export type PaymentMethodTypeKey = 'cash' | 'mobileWallet' | 'card' | 'bank';

export type PaymentMethodTypeLabels = Record<PaymentMethodTypeKey, string>;

export interface PaymentMethodOption {
    name: string;
    type: string;
    accountId?: string;
}

interface DefinedMethod {
    name: string;
    type: string;
    account_id?: string | null;
    is_active: boolean;
    sort_order?: number;
}

/** Offered when the tenant has no active method, as the sale screen does. */
const GENERIC_OPTIONS: PaymentMethodOption[] = [
    { name: 'Cash', type: 'Cash' },
    { name: 'Mobile Wallet', type: 'Mobile Wallet' },
    { name: 'Card', type: 'Card' },
    { name: 'Bank', type: 'Bank' },
];

const GENERIC_KEYS: Record<string, PaymentMethodTypeKey> = {
    cash: 'cash',
    mobilewallet: 'mobileWallet',
    card: 'card',
    bank: 'bank',
};

const normalize = (value: string) => value.toLowerCase().replace(/[_\s]+/g, '');

/** Maps a stored method type ('Mobile Wallet', legacy 'MOBILE_WALLET') to its catalog key. */
export function paymentMethodTypeKey(type: string): PaymentMethodTypeKey {
    return GENERIC_KEYS[normalize(type)] ?? 'cash';
}

/**
 * What to show for a method name. A tenant's own names ("bKash", "City Bank
 * A/C") are data and shown as typed; the four generic names — which every
 * tenant is seeded with and which the fallback list submits — are translated,
 * so a Bangla screen does not say "Cash".
 */
export function paymentMethodDisplayName(name: string, labels: PaymentMethodTypeLabels): string {
    const key = GENERIC_KEYS[normalize(name)];
    return key ? labels[key] : name;
}

/**
 * Keeps a method a payment was recorded with on the list even after the tenant
 * deactivated or renamed it, so opening that payment to edit it shows what it
 * says rather than silently switching it to another method.
 */
export function withRecordedMethod(options: PaymentMethodOption[], recorded?: string | null): PaymentMethodOption[] {
    if (!recorded || options.some((o) => o.name === recorded)) return options;
    return [...options, { name: recorded, type: '' }];
}

export function usePaymentMethodOptions() {
    const [defined, setDefined] = useState<DefinedMethod[]>([]);

    useEffect(() => {
        let cancelled = false;
        Promise.resolve(api.getPaymentMethods())
            .then((data: DefinedMethod[] | null) => { if (!cancelled) setDefined(Array.isArray(data) ? data : []); })
            .catch((err: unknown) => console.error('Failed to load payment methods', err));
        return () => { cancelled = true; };
    }, []);

    const options = useMemo<PaymentMethodOption[]>(() => {
        const active = defined
            .filter((m) => m.is_active)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((m) => ({ name: m.name, type: m.type, accountId: m.account_id ?? undefined }));
        // Same rule as the sale screen: no *usable* method means the generic
        // set, so an all-inactive tenant can still record a payment.
        return active.length > 0 ? active : GENERIC_OPTIONS;
    }, [defined]);

    // Cash unless the tenant has none — the common case at a Bangladeshi
    // counter, and what every payment posted to before methods were recorded.
    const defaultMethod = useMemo(
        () => options.find((o) => normalize(o.type) === 'cash')?.name
            ?? options[0]?.name
            ?? 'Cash',
        [options],
    );

    /** The linked ledger account for a method name, if the tenant set one. */
    const accountIdFor = (name: string) => options.find((o) => o.name === name)?.accountId;

    return { options, defaultMethod, accountIdFor };
}
