'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PaymentLayoutContext, PaymentLayoutEntry, PaymentLayoutResponse } from '@erp71/shared-types';
import { api, type PaymentMethodRow } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import type { Payment, PaymentInstrument } from '@/lib/hooks/useNewSaleCart';
import { instrumentSummary, paymentInstrumentSummary, pickInstrument } from '@/lib/payment-instrument';
import { Button } from '@/components/ui';
import PaymentLayoutModal, { type PaymentLayoutModalLabels } from './PaymentLayoutModal';
import { canonicalFor, matchPaymentToMethod } from './payment-match';

/**
 * The tender strip shared by sale and purchase entry: one amount box per
 * payment method on the signed-in user's layout for this branch and screen, a
 * picker for the rest the branch offers, and a running "is this settled?"
 * chip.
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
 *
 * Editing a saved document never drops a payment. Besides the layout, the
 * strip shows every method that carries money on the document — hidden from
 * this user, switched off, whatever — and a payment that matches no method at
 * all keeps a row of its own (see `distribute`).
 */

const GENERIC_METHODS = [
    { name: 'Cash', type: 'Cash' },
    { name: 'Mobile Wallet', type: 'Mobile Wallet' },
    { name: 'Card', type: 'Card' },
    { name: 'Bank', type: 'Bank' },
];

/** One row of the strip. */
type PickMethod = {
    key: string;
    name: string;
    type: string;
    /** The tenant's method behind the row; absent on the generic fallback. */
    methodId?: string;
    account_id?: string;
    inactive?: boolean;
    /**
     * A saved payment that matches no method here. Its row edits the amount
     * only, and it is sent back otherwise exactly as saved, so the server
     * reads it the way it always has (by name).
     */
    legacy?: Payment;
};

/** A row as `matchPaymentToMethod` reads it. */
type Candidate = PickMethod & { id: string; is_active: boolean };

const NO_METHODS: PaymentMethodRow[] = [];

const toPick = (m: PaymentMethodRow): PickMethod => ({
    key: m.id,
    name: m.name,
    type: m.type,
    methodId: m.id,
    account_id: m.account_id ?? undefined,
    inactive: !m.is_active,
});

const asCandidate = (m: PickMethod): Candidate => ({ ...m, id: m.key, is_active: !m.inactive });

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

interface Distribution {
    amounts: Record<string, number>;
    instruments: Record<string, PaymentInstrument>;
    /** Keys of the methods that carry money on the document. */
    carried: string[];
    /** Payments that match no method, each with its own row. */
    legacy: { key: string; payment: Payment }[];
}

/**
 * Puts each payment's amount (and cheque details) in its method's box — see
 * `matchPaymentToMethod` for the order. A payment that matches nothing gets a
 * row of its own, keyed by its position, rather than being dropped.
 */
function distribute(pool: Candidate[], payments: Payment[]): Distribution {
    const next: Distribution = { amounts: {}, instruments: {}, carried: [], legacy: [] };
    payments.forEach((p, index) => {
        const match = matchPaymentToMethod(pool, p);
        if (!match) {
            if (p.amount > 0) {
                const key = `legacy-${index}`;
                next.legacy.push({ key, payment: p });
                next.amounts[key] = p.amount;
            }
            return;
        }
        next.amounts[match.key] = (next.amounts[match.key] || 0) + p.amount;
        if (p.amount > 0 && !next.carried.includes(match.key)) next.carried.push(match.key);
        const detail = pickInstrument(p);
        if (Object.keys(detail).length > 0) next.instruments[match.key] = detail;
    });
    return next;
}

function amountsToPayments(
    rows: PickMethod[],
    amounts: Record<string, number>,
    instruments: Record<string, PaymentInstrument>,
): Payment[] {
    return rows
        .filter((m) => (amounts[m.key] || 0) > 0)
        .map((m) => {
            if (m.legacy) return { ...m.legacy, amount: amounts[m.key] };
            const method = canonicalFor(m.type);
            return {
                method,
                label: m.name,
                // The server posts the tender to this method's linked account.
                ...(m.methodId ? { paymentMethodId: m.methodId } : {}),
                accountId: m.account_id,
                amount: amounts[m.key],
                // Only where the tender can have one. A row switched back to cash
                // must not carry a cheque number that is no longer on screen.
                ...(instrumentFieldsFor(method).length > 0 ? instruments[m.key] ?? {} : {}),
            };
        });
}

/** Every string the strip renders. `{amount}` / `{method}` are substituted. */
export interface PaymentSectionLabels extends PaymentLayoutModalLabels {
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
    /** The strip's button that opens the layout editor. */
    customise: string;

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
    customise: 'Customise',
    customiseTitle: 'Payment methods on this screen',
    resetLayout: 'Reset to default',
    saveLayout: 'Save',
    cancelLayout: 'Cancel',
    moveUp: 'Move {method} up',
    moveDown: 'Move {method} down',
    showMethod: 'Show {method}',
    layoutSaveFailed: 'Could not save the payment layout',
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
    /** Which screen's layout to show — each user arranges each screen apart. */
    context: PaymentLayoutContext;
    /**
     * The document's branch: the header branch on a new document, the
     * document's own on an edit. Only the methods offered there are shown.
     */
    storeId: string;
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
    context,
    storeId,
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
    // Each answer remembers what it was asked for, so one that lands after the
    // branch or screen changed is never shown for the new one. A failed
    // request settles as empty, so the other answer is still used.
    const [layoutState, setLayoutState] = useState<{
        key: string;
        layout: PaymentLayoutResponse<PaymentMethodRow> | null;
    } | null>(null);
    const [listState, setListState] = useState<{ storeId: string; methods: PaymentMethodRow[] } | null>(null);
    const [amounts, setAmounts] = useState<Record<string, number>>({});
    const [instruments, setInstruments] = useState<Record<string, PaymentInstrument>>({});
    const [openInstruments, setOpenInstruments] = useState<string[]>([]); // keys whose panel is expanded
    const [added, setAdded] = useState<string[]>([]); // ids explicitly added via picker
    const [carried, setCarried] = useState<string[]>([]); // ids that carry money on the document
    const [legacy, setLegacy] = useState<Distribution['legacy']>([]);
    const [customising, setCustomising] = useState(false);

    const copy = useMemo(() => ({ ...DEFAULT_PAYMENT_SECTION_LABELS, ...labels }), [labels]);

    const layoutKey = `${storeId}:${context}`;
    useEffect(() => {
        // Read-only renders the recorded payments verbatim — no picker to fill.
        // Without a branch there is no layout to ask for; the strip falls back
        // to the generic methods.
        if (readOnly || !storeId) return;
        let current = true;
        const key = `${storeId}:${context}`;
        api.getPaymentLayout(storeId, context)
            .catch((err) => {
                console.error('Failed to load the payment layout', err);
                return null;
            })
            .then((layout) => { if (current) setLayoutState({ key, layout: layout ?? null }); });
        // The branch's whole list, switched-off methods included: a saved
        // payment on one of those still has to find its row.
        api.getPaymentMethods(undefined, storeId)
            .catch((err) => {
                console.error('Failed to load payment methods', err);
                return [];
            })
            .then((methods) => {
                if (current) setListState({ storeId, methods: Array.isArray(methods) ? methods : [] });
            });
        return () => { current = false; };
    }, [readOnly, storeId, context]);

    // Laid out once both answers are in, so a saved payment moves from the
    // generic boxes to its own method's box in one step rather than two.
    const ready = layoutState?.key === layoutKey && listState?.storeId === storeId;
    const visible = (ready && layoutState.layout?.visible) || NO_METHODS;
    const available = (ready && layoutState.layout?.available) || NO_METHODS;
    const branchMethods = ready ? listState.methods : NO_METHODS;
    // Until then the boxes are the generic ones, and a figure typed into one
    // would go out under the generic name, taking a saved payment off its
    // method. They are shown, but locked. Once loading has finished with no
    // active method, the generic boxes are the strip and take input.
    const loading = !readOnly && !!storeId && !ready;

    // What the Customise modal edits: the branch's methods with the user's
    // shown ones first, in order, and the tucked-away ones after.
    const layoutMethods = useMemo(() => {
        const shown = new Set(visible.map((m) => m.id));
        return [...visible, ...available.filter((m) => !shown.has(m.id))];
    }, [visible, available]);
    const hiddenIds = useMemo(() => {
        const shown = new Set(visible.map((m) => m.id));
        return available.filter((m) => !shown.has(m.id)).map((m) => m.id);
    }, [visible, available]);
    const canCustomise = !readOnly && !!storeId && ready && layoutMethods.length > 0;

    // The answer replaces the layout as a whole, keyed like the one it
    // supersedes; the typed amounts live in their own state, keyed by method,
    // so they carry over to wherever their row lands.
    // An answer that lands after the branch or screen changed must not
    // overwrite the new one's layout.
    const applyLayout = (key: string, layout: PaymentLayoutResponse<PaymentMethodRow>) =>
        setLayoutState((prev) => (prev && prev.key !== key ? prev : { key, layout }));
    const saveLayout = async (entry: PaymentLayoutEntry) => {
        const key = layoutKey;
        applyLayout(key, await api.savePaymentLayout(storeId, context, entry));
    };
    const resetLayout = async () => {
        const key = layoutKey;
        applyLayout(key, await api.resetPaymentLayout(storeId, context));
    };

    // Fall back to generic methods whenever the branch offers no *usable*
    // (active) method — not only when none are defined — so an all-inactive
    // tenant can still take payment.
    const hasUsableMethods = available.length > 0;
    const baseRows = useMemo(
        () => (hasUsableMethods ? visible.map(toPick) : genericPicks),
        [hasUsableMethods, visible],
    );
    // What a saved payment can match: what the branch offers first (so a guess
    // by type lands on a method it still takes), then its switched-off ones.
    const pool = useMemo(() => {
        const offered = hasUsableMethods ? available.map(toPick) : genericPicks;
        const offeredKeys = new Set(offered.map((m) => m.key));
        const others = branchMethods
            .filter((m) => !offeredKeys.has(m.id))
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(toPick);
        return [...offered, ...others].map(asCandidate);
    }, [hasUsableMethods, available, branchMethods]);

    const rows = useMemo(() => {
        const shown = new Set(baseRows.map((m) => m.key));
        const extra = pool.filter((m) => !shown.has(m.key) && (carried.includes(m.key) || added.includes(m.key)));
        const unmatched: PickMethod[] = legacy.map(({ key, payment }) => ({
            key,
            name: payment.label || payment.method,
            type: payment.method,
            legacy: payment,
        }));
        return [...baseRows, ...extra, ...unmatched];
    }, [baseRows, pool, carried, added, legacy]);
    const addableMethods = useMemo(
        () => available.filter((m) => !rows.some((r) => r.key === m.id)).map(toPick),
        [available, rows],
    );

    // The last array this strip emitted, so the effect below can tell the
    // parent echoing our own change back from the parent handing us a
    // different document. Emptiness alone cannot: a shop with one payment
    // method sends no payments both when the cart is cleared and when the
    // operator empties the amount box to retype a figure.
    const lastEmitted = useRef<Payment[] | null>(null);
    // The match list the boxes were last filled from.
    const reconciledPool = useRef<Candidate[] | null>(null);

    const emitPayments = useCallback(
        (nextAmounts: Record<string, number>, nextInstruments: Record<string, PaymentInstrument>) => {
            const next = amountsToPayments(rows, nextAmounts, nextInstruments);
            lastEmitted.current = next;
            onPaymentChange(next);
        },
        [rows, onPaymentChange],
    );

    // Reconcile local inputs when payments reset (e.g. after checkout) or methods load.
    useEffect(() => {
        const echo = lastEmitted.current === payments;
        const poolChanged = reconciledPool.current !== pool;
        reconciledPool.current = pool;
        // Our own change coming back: the boxes already show it. Reading it
        // again would drop the row of an amount just emptied to retype it.
        if (echo && !poolChanged) return;

        const next = distribute(pool, payments);
        setAmounts(next.amounts);
        setLegacy(next.legacy);
        // Our own payments re-read against methods that just loaded keep
        // whatever is being typed, so an amount cleared for a keystroke does
        // not take the cheque entered against it, nor its row. Anything else —
        // a cart cleared after checkout, a saved sale loaded for editing —
        // replaces the strip outright.
        setInstruments((prev) => (echo ? { ...prev, ...next.instruments } : next.instruments));
        setCarried((prev) => (echo ? [...new Set([...prev, ...next.carried])] : next.carried));
        if (!echo) setOpenInstruments((open) => (open.length > 0 ? [] : open));
    }, [payments, pool]);

    const updateAmount = (key: string, value: number) => {
        if (loading) return;
        const nextAmounts = { ...amounts, [key]: value };
        setAmounts(nextAmounts);
        emitPayments(nextAmounts, instruments);
    };

    const updateInstrument = (key: string, field: keyof PaymentInstrument, value: string) => {
        if (loading) return;
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
        // An unmatched payment's details travel with it untouched.
        const fields = captureInstrument && !m.legacy ? instrumentFieldsFor(canonical) : [];
        const legacySummary = m.legacy ? paymentInstrumentSummary(m.legacy) : '';
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
                        disabled={loading}
                        placeholder="0.00"
                        aria-label={copy.amount.replace('{method}', m.name)}
                        className="w-24 flex-shrink-0 px-2 py-1 border rounded text-sm text-end disabled:bg-gray-50"
                    />
                </div>
                {legacySummary && <p className="text-[11px] text-gray-500">{legacySummary}</p>}

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
                                            disabled={loading}
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
                <div className="flex items-center gap-2">
                    {canCustomise && (
                        <Button variant="ghost" onClick={() => setCustomising(true)}>
                            {copy.customise}
                        </Button>
                    )}
                    <span
                        className={`text-xs font-semibold ${
                            paymentValid ? 'text-emerald-600' : balance > 0 ? 'text-red-600' : 'text-amber-600'
                        }`}
                    >
                        {statusText}
                    </span>
                </div>
            </div>

            {balance > 0.01 && hint}
            {balance > 0.01 && blockedReason && (
                <p className="text-[11px] text-red-600">{blockedReason}</p>
            )}

            <div className="space-y-1.5 rounded border p-2">
                {!readOnly && rows.map(renderMethodRow)}
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
                        disabled={loading}
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

            {customising && canCustomise && (
                <PaymentLayoutModal
                    methods={layoutMethods}
                    hiddenIds={hiddenIds}
                    onSave={saveLayout}
                    onReset={resetLayout}
                    onClose={() => setCustomising(false)}
                    labels={copy}
                />
            )}
        </div>
    );
}
