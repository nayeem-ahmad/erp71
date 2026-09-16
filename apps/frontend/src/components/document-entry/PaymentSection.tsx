'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import type { Payment } from '@/lib/hooks/useNewSaleCart';

/**
 * The tender strip shared by sale and purchase entry: one amount box per
 * payment method the tenant put on the entry form, a picker for the rest, and a
 * running "is this settled?" chip.
 *
 * It was the sale screen's own component until purchase entry needed the same
 * thing — a shopkeeper paying a supplier in cash at the counter is the same
 * gesture as a customer paying at the till, and the method list, the canonical
 * classification and the generic fallback all have to agree between the two or
 * the accounting behind them diverges.
 *
 * What differs between the two screens is only wording and whether an unpaid
 * balance is permitted, so both arrive as props: a sale can be blocked by the
 * customer's credit limit, whereas a purchase balance is simply what the
 * supplier is still owed.
 */

interface DefinedMethod {
    id: string;
    name: string;
    type: string;
    account_id?: string;
    is_active: boolean;
    sort_order?: number;
    show_on_entry: boolean;
}

// Backend classifies a payment for accounting by substring-matching the method
// string (bank/card/wallet/credit → "bank", else "cash"). Keep the submitted
// `method` canonical so accounting posting stays correct regardless of the
// friendly name the tenant gave a defined method.
// Keyed by the `type` values actually stored on PaymentMethod, which are the
// backend PaymentMethodType enum values ('Cash' | 'Mobile Wallet' | 'Card' |
// 'Bank'). Legacy uppercase keys are kept so rows written before the settings
// form was aligned to the enum still classify correctly.
const TYPE_TO_CANONICAL: Record<string, string> = {
    'Cash': 'Cash',
    'Mobile Wallet': 'Mobile Wallet',
    'Card': 'Card',
    'Bank': 'Bank',
    CASH: 'Cash',
    MOBILE_WALLET: 'Mobile Wallet',
    CARD: 'Card',
    BANK: 'Bank',
};

const GENERIC_METHODS = [
    { name: 'Cash', type: 'Cash' },
    { name: 'Mobile Wallet', type: 'Mobile Wallet' },
    { name: 'Card', type: 'Card' },
    { name: 'Bank', type: 'Bank' },
];

const canonicalFor = (type: string) => TYPE_TO_CANONICAL[type] ?? 'Cash';

type PickMethod = { key: string; name: string; type: string; account_id?: string; inactive?: boolean };

const toPick = (m: DefinedMethod): PickMethod => ({
    key: m.id,
    name: m.name,
    type: m.type,
    account_id: m.account_id,
    inactive: !m.is_active,
});

const genericPicks: PickMethod[] = GENERIC_METHODS.map((m) => ({
    key: `generic-${m.type}`,
    name: m.name,
    type: m.type,
}));

function paymentsToAmounts(methods: PickMethod[], payments: Payment[]): Record<string, number> {
    const next: Record<string, number> = {};
    for (const p of payments) {
        // Prefer the exact defined method (name + classification). A payment
        // reloaded from a saved document carries only the canonical method
        // string, so fall back to the first method of that classification —
        // otherwise an amount taken via "bKash" would come back blank on the
        // edit form.
        const match =
            methods.find((m) => m.name === (p.label || p.method) && canonicalFor(m.type) === p.method)
            ?? methods.find((m) => canonicalFor(m.type) === p.method);
        if (match) next[match.key] = (next[match.key] || 0) + p.amount;
    }
    return next;
}

function amountsToPayments(methods: PickMethod[], amounts: Record<string, number>): Payment[] {
    return methods
        .filter((m) => (amounts[m.key] || 0) > 0)
        .map((m) => ({
            method: canonicalFor(m.type),
            label: m.name,
            accountId: m.account_id,
            amount: amounts[m.key],
        }));
}

/** Every string the strip renders. `{amount}` / `{method}` are substituted. */
export interface PaymentSectionLabels {
    title: string;
    settled: string;
    /** Balance left unpaid when that is NOT permitted — shown in red. */
    due: string;
    /** Balance left unpaid when that is permitted (customer credit, supplier payable). */
    keepingDue: string;
    overpaid: string;
    /** Accessible name of one method's amount box. */
    amount: string;
    inactive: string;
    addMethod: string;
    addMethodAria: string;
    noPayments: string;
}

export const DEFAULT_PAYMENT_SECTION_LABELS: PaymentSectionLabels = {
    title: 'Payment',
    settled: '✓ Settled',
    due: 'Due {amount}',
    keepingDue: 'Keeping due {amount}',
    overpaid: 'Overpaid {amount}',
    amount: '{method} amount',
    inactive: '(inactive)',
    addMethod: '+ Add method…',
    addMethodAria: 'Add payment method',
    noPayments: 'No payments recorded.',
};

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    onPaymentChange: (payments: Payment[]) => void;
    readOnly?: boolean;
    labels?: Partial<PaymentSectionLabels>;
    /** Locale for money formatting — the caller's `useI18n().locale`. */
    locale?: string;
    /**
     * Why the unpaid balance may not stand (the sale screen's credit limit).
     * Leave it unset when a balance is always acceptable, as a supplier payable
     * is.
     */
    blockedReason?: string;
    /** An extra line under the header, e.g. the customer's remaining credit. */
    hint?: ReactNode;
}

export default function PaymentSection({
    payments,
    total,
    onPaymentChange,
    readOnly = false,
    labels,
    locale,
    blockedReason,
    hint,
}: PaymentSectionProps) {
    const [definedMethods, setDefinedMethods] = useState<DefinedMethod[]>([]);
    const [amounts, setAmounts] = useState<Record<string, number>>({});
    const [added, setAdded] = useState<string[]>([]); // ids explicitly added via picker

    const copy = useMemo(() => ({ ...DEFAULT_PAYMENT_SECTION_LABELS, ...labels }), [labels]);

    useEffect(() => {
        // Read-only renders the recorded payments verbatim — no picker to fill.
        if (readOnly) return;
        api.getPaymentMethods()
            .then((data) => setDefinedMethods(data ?? []))
            .catch((err) => console.error('Failed to load payment methods', err));
    }, [readOnly]);

    const activeSorted = useMemo(
        () => definedMethods
            .filter((m) => m.is_active)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(toPick),
        [definedMethods],
    );
    const defaultVisible = useMemo(
        () => definedMethods
            .filter((m) => m.is_active && m.show_on_entry)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(toPick),
        [definedMethods],
    );
    // Fall back to generic methods whenever there are no *usable* (active) methods —
    // not only when zero are defined — so an all-inactive tenant can still take payment.
    const hasUsableMethods = activeSorted.length > 0;
    const visibleMethods = useMemo(() => {
        if (!hasUsableMethods) return genericPicks; // no active methods → generic fallback
        const base = defaultVisible;
        const extra = activeSorted.filter((m) => added.includes(m.key) && !base.some((b) => b.key === m.key));
        return [...base, ...extra];
    }, [hasUsableMethods, defaultVisible, activeSorted, added]);
    const addableMethods = useMemo(
        () => activeSorted.filter((m) => !visibleMethods.some((v) => v.key === m.key)),
        [activeSorted, visibleMethods],
    );
    const allMethods = useMemo(() => (hasUsableMethods ? activeSorted : genericPicks), [hasUsableMethods, activeSorted]);

    const emitPayments = useCallback(
        (nextAmounts: Record<string, number>) => {
            onPaymentChange(amountsToPayments(allMethods, nextAmounts));
        },
        [allMethods, onPaymentChange],
    );

    // Reconcile local amount inputs when payments reset (e.g. after checkout) or methods load.
    useEffect(() => {
        setAmounts(paymentsToAmounts(allMethods, payments));
    }, [payments, allMethods]);

    const updateAmount = (key: string, value: number) => {
        const nextAmounts = { ...amounts, [key]: value };
        setAmounts(nextAmounts);
        emitPayments(nextAmounts);
    };

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = total - totalPaid;
    const unpaid = Math.max(0, balance);
    const balanceAllowed = !blockedReason;
    const paymentValid = Math.abs(balance) < 0.01 || balanceAllowed;
    const money = (value: number) => formatBDT(value, { locale });

    const statusText = Math.abs(balance) < 0.01
        ? copy.settled
        : balance > 0
            ? (balanceAllowed ? copy.keepingDue : copy.due).replace('{amount}', money(unpaid))
            : copy.overpaid.replace('{amount}', money(Math.abs(balance)));

    const renderMethodRow = (m: PickMethod) => (
        <div key={m.key} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700" title={m.name}>
                {m.name}
                {m.inactive ? <span className="text-gray-400 font-normal text-xs ms-1">{copy.inactive}</span> : null}
            </span>
            <input
                type="number"
                min="0"
                step="0.01"
                value={amounts[m.key] || ''}
                onChange={(e) => updateAmount(m.key, parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                aria-label={copy.amount.replace('{method}', m.name)}
                className="w-24 flex-shrink-0 px-2 py-1 border rounded text-sm text-end"
            />
        </div>
    );

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{copy.title}</h3>
                <span
                    className={`text-xs font-semibold ${
                        paymentValid ? 'text-emerald-600' : balance > 0 ? 'text-red-600' : 'text-amber-600'
                    }`}
                >
                    {statusText}
                </span>
            </div>

            {balance > 0.01 && hint}
            {balance > 0.01 && blockedReason && (
                <p className="text-[11px] text-red-600">{blockedReason}</p>
            )}

            <div className="space-y-1.5 rounded border p-2">
                {!readOnly && visibleMethods.map(renderMethodRow)}
                {readOnly && payments.length === 0 && (
                    <p className="text-sm text-gray-400">{copy.noPayments}</p>
                )}
                {readOnly && payments.map((p, i) => (
                    <div key={`${p.label || p.method}-${i}`} className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">
                            {p.label || p.method}
                        </span>
                        <span className="text-sm text-gray-900">{money(p.amount)}</span>
                    </div>
                ))}
            </div>

            {!readOnly && addableMethods.length > 0 && (
                <div>
                    <select
                        aria-label={copy.addMethodAria}
                        value=""
                        onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]); }}
                        className="w-full px-2 py-1.5 border rounded text-sm text-gray-600"
                    >
                        <option value="">{copy.addMethod}</option>
                        {addableMethods.map((m) => (
                            <option key={m.key} value={m.key}>{m.name}</option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}
