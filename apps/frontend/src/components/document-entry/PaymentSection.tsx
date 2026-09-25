'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import type { Payment, PaymentInstrument } from '@/lib/hooks/useNewSaleCart';
import { instrumentSummary, paymentInstrumentSummary, pickInstrument } from '@/lib/payment-instrument';

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

interface InstrumentField {
    key: keyof PaymentInstrument;
    /** Which label on `PaymentSectionLabels` names this box for this tender. */
    label: keyof PaymentSectionLabels;
    type?: 'date';
}

/**
 * What is worth recording about each tender, which is not the same set for all
 * of them: a cheque needs the bank it is drawn on and the account behind it, a
 * card needs its issuer and approval code, a wallet needs the number the money
 * came from and its transaction id. Cash needs none, which is also what tells
 * the strip not to offer the panel at all.
 */
const INSTRUMENT_FIELDS: Record<string, InstrumentField[]> = {
    Bank: [
        { key: 'bankName', label: 'instrumentBank' },
        { key: 'bankBranch', label: 'instrumentBranch' },
        { key: 'bankAccountNumber', label: 'instrumentAccountNumber' },
        { key: 'referenceNo', label: 'instrumentChequeNo' },
        { key: 'instrumentDate', label: 'instrumentChequeDate', type: 'date' },
    ],
    Card: [
        { key: 'bankName', label: 'instrumentIssuer' },
        { key: 'referenceNo', label: 'instrumentApprovalNo' },
        { key: 'instrumentDate', label: 'instrumentPaymentDate', type: 'date' },
    ],
    'Mobile Wallet': [
        { key: 'bankAccountNumber', label: 'instrumentWalletNumber' },
        { key: 'referenceNo', label: 'instrumentTransactionId' },
        { key: 'instrumentDate', label: 'instrumentPaymentDate', type: 'date' },
    ],
};

const instrumentFieldsFor = (canonical: string): InstrumentField[] => INSTRUMENT_FIELDS[canonical] ?? [];

/**
 * Prefer the exact defined method (name + classification). A payment reloaded
 * from a saved document carries only the canonical method string, so fall back
 * to the first method of that classification — otherwise an amount taken via
 * "bKash" would come back blank on the edit form.
 */
function matchMethod(methods: PickMethod[], p: Payment): PickMethod | undefined {
    return methods.find((m) => m.name === (p.label || p.method) && canonicalFor(m.type) === p.method)
        ?? methods.find((m) => canonicalFor(m.type) === p.method);
}

function paymentsToAmounts(methods: PickMethod[], payments: Payment[]): Record<string, number> {
    const next: Record<string, number> = {};
    for (const p of payments) {
        const match = matchMethod(methods, p);
        if (match) next[match.key] = (next[match.key] || 0) + p.amount;
    }
    return next;
}

function paymentsToInstruments(methods: PickMethod[], payments: Payment[]): Record<string, PaymentInstrument> {
    const next: Record<string, PaymentInstrument> = {};
    for (const p of payments) {
        const match = matchMethod(methods, p);
        if (!match) continue;
        const detail = pickInstrument(p);
        if (Object.keys(detail).length > 0) next[match.key] = detail;
    }
    return next;
}

function amountsToPayments(
    methods: PickMethod[],
    amounts: Record<string, number>,
    instruments: Record<string, PaymentInstrument>,
): Payment[] {
    return methods
        .filter((m) => (amounts[m.key] || 0) > 0)
        .map((m) => ({
            method: canonicalFor(m.type),
            label: m.name,
            accountId: m.account_id,
            amount: amounts[m.key],
            // Only where the tender can have one. A row switched back to cash
            // must not carry a cheque number that is no longer on screen.
            ...(instrumentFieldsFor(canonicalFor(m.type)).length > 0 ? instruments[m.key] ?? {} : {}),
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

    // The cheque / transfer details panel, only rendered when the caller opts
    // into `captureInstrument`. Which boxes it shows, and so which of these
    // name them, follows the tender — see INSTRUMENT_FIELDS above.
    /** Opens the panel on a bank tender — the cheque case. */
    instrumentToggle: string;
    /** Opens it on a card or wallet, which have no cheque to name. */
    instrumentToggleAlt: string;
    instrumentBank: string;
    instrumentBranch: string;
    instrumentAccountNumber: string;
    instrumentIssuer: string;
    instrumentWalletNumber: string;
    instrumentChequeNo: string;
    instrumentChequeDate: string;
    instrumentApprovalNo: string;
    instrumentTransactionId: string;
    instrumentPaymentDate: string;
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
    instrumentToggle: '+ Bank / cheque details',
    instrumentToggleAlt: '+ Payment details',
    instrumentBank: 'Bank',
    instrumentBranch: 'Branch',
    instrumentAccountNumber: 'A/C number',
    instrumentIssuer: 'Card issuer',
    instrumentWalletNumber: 'Wallet number',
    instrumentChequeNo: 'Cheque / ref. no.',
    instrumentChequeDate: 'Cheque date',
    instrumentApprovalNo: 'Approval / ref. no.',
    instrumentTransactionId: 'Transaction ID',
    instrumentPaymentDate: 'Payment date',
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
    /**
     * Offer the bank / cheque / transaction details panel on every non-cash
     * tender. Opt-in because the details have to reach a table that stores
     * them, and a screen whose document has none would silently drop whatever
     * was typed. Sale entry stores them on `PaymentRecord`, purchase entry on
     * `PurchasePayment`, so both turn it on.
     */
    captureInstrument?: boolean;
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
    captureInstrument = false,
}: PaymentSectionProps) {
    const [definedMethods, setDefinedMethods] = useState<DefinedMethod[]>([]);
    const [amounts, setAmounts] = useState<Record<string, number>>({});
    const [instruments, setInstruments] = useState<Record<string, PaymentInstrument>>({});
    const [openInstruments, setOpenInstruments] = useState<string[]>([]); // keys whose panel is expanded
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

    // The last array this strip emitted, so the effect below can tell the
    // parent echoing our own change back from the parent handing us a
    // different document. Emptiness alone cannot: a shop with one payment
    // method sends no payments both when the cart is cleared and when the
    // operator empties the amount box to retype a figure.
    const lastEmitted = useRef<Payment[] | null>(null);

    const emitPayments = useCallback(
        (nextAmounts: Record<string, number>, nextInstruments: Record<string, PaymentInstrument>) => {
            const next = amountsToPayments(allMethods, nextAmounts, nextInstruments);
            lastEmitted.current = next;
            onPaymentChange(next);
        },
        [allMethods, onPaymentChange],
    );

    // Reconcile local inputs when payments reset (e.g. after checkout) or methods load.
    useEffect(() => {
        setAmounts(paymentsToAmounts(allMethods, payments));

        const next = paymentsToInstruments(allMethods, payments);
        const echo = lastEmitted.current === payments;
        // Our own change coming back keeps whatever is being typed, so an
        // amount cleared for a keystroke does not take the cheque entered
        // against it. Anything else — a cart cleared after checkout, a saved
        // sale loaded for editing — replaces the panel outright.
        setInstruments((prev) => (echo ? { ...prev, ...next } : next));
        if (!echo) setOpenInstruments((open) => (open.length > 0 ? [] : open));
    }, [payments, allMethods]);

    const updateAmount = (key: string, value: number) => {
        const nextAmounts = { ...amounts, [key]: value };
        setAmounts(nextAmounts);
        emitPayments(nextAmounts, instruments);
    };

    const updateInstrument = (key: string, field: keyof PaymentInstrument, value: string) => {
        const nextInstruments = { ...instruments, [key]: { ...instruments[key], [field]: value } };
        setInstruments(nextInstruments);
        emitPayments(amounts, nextInstruments);
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

    const toggleInstrument = (key: string) =>
        setOpenInstruments((open) => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]));

    const renderMethodRow = (m: PickMethod) => {
        const canonical = canonicalFor(m.type);
        const fields = captureInstrument ? instrumentFieldsFor(canonical) : [];
        const detail = instruments[m.key];
        const summary = instrumentSummary(detail);
        const expanded = openInstruments.includes(m.key);
        // Offered once money has actually come in on this tender — a cheque
        // number without an amount beside it records nothing, and four empty
        // panels down a shop's method list is noise on every sale. Once it is
        // open, or something has been typed into it, it stays put: emptying the
        // amount box to retype it must not pull the panel out from under the
        // cursor.
        const offerInstrument = fields.length > 0
            && ((amounts[m.key] || 0) > 0 || expanded || Object.keys(detail ?? {}).length > 0);

        return (
            <div key={m.key} className="space-y-1.5">
                <div className="flex items-center gap-2">
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

                {offerInstrument && (
                    <>
                        <button
                            type="button"
                            onClick={() => toggleInstrument(m.key)}
                            aria-expanded={expanded}
                            className="block w-full text-start text-xs text-blue-600 hover:underline max-md:min-h-touch"
                        >
                            {summary || (canonical === 'Bank' ? copy.instrumentToggle : copy.instrumentToggleAlt)}
                        </button>
                        {expanded && (
                            <div className="grid gap-2 rounded border border-gray-200 bg-gray-50 p-2 sm:grid-cols-2">
                                {fields.map((field) => (
                                    <label key={field.key} className="block text-[11px] text-gray-500">
                                        {copy[field.label]}
                                        <input
                                            type={field.type ?? 'text'}
                                            value={detail?.[field.key] ?? ''}
                                            onChange={(e) => updateInstrument(m.key, field.key, e.target.value)}
                                            aria-label={`${m.name} ${copy[field.label]}`}
                                            className="mt-0.5 w-full rounded border px-2 py-1 text-sm text-gray-900 max-md:min-h-touch"
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

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
                {readOnly && payments.map((p, i) => {
                    const summary = paymentInstrumentSummary(p);
                    return (
                        <div key={`${p.label || p.method}-${i}`}>
                            <div className="flex items-center gap-2">
                                <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">
                                    {p.label || p.method}
                                </span>
                                <span className="text-sm text-gray-900">{money(p.amount)}</span>
                            </div>
                            {summary && <p className="text-[11px] text-gray-500">{summary}</p>}
                        </div>
                    );
                })}
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
