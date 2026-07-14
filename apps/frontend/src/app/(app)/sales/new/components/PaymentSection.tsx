import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '@/lib/api';
import { Payment } from '@/lib/hooks/useNewSaleCart';
import { canKeepDue, creditDueAmount, availableCustomerCredit } from '@/lib/customer-credit';

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    customer?: any;
    onPaymentChange: (payments: Payment[]) => void;
}

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
const TYPE_TO_CANONICAL: Record<string, string> = {
    CASH: 'Cash',
    MOBILE_WALLET: 'Mobile Wallet',
    CARD: 'Card',
    BANK: 'Bank',
};

const GENERIC_METHODS = [
    { name: 'Cash', type: 'CASH' },
    { name: 'Mobile Wallet', type: 'MOBILE_WALLET' },
    { name: 'Card', type: 'CARD' },
    { name: 'Bank', type: 'BANK' },
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
        const match = methods.find(
            (m) => m.name === (p.label || p.method) && canonicalFor(m.type) === p.method,
        );
        if (match) next[match.key] = p.amount;
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

export default function PaymentSection({ payments, total, customer, onPaymentChange }: PaymentSectionProps) {
    const [definedMethods, setDefinedMethods] = useState<DefinedMethod[]>([]);
    const [amounts, setAmounts] = useState<Record<string, number>>({});
    const [added, setAdded] = useState<string[]>([]); // ids explicitly added via picker

    useEffect(() => {
        api.getPaymentMethods()
            .then((data) => setDefinedMethods(data ?? []))
            .catch((err) => console.error('Failed to load payment methods', err));
    }, []);

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
    const hasDefined = definedMethods.length > 0;
    const visibleMethods = useMemo(() => {
        if (!hasDefined) return genericPicks; // fresh tenant fallback
        const base = defaultVisible;
        const extra = activeSorted.filter((m) => added.includes(m.key) && !base.some((b) => b.key === m.key));
        return [...base, ...extra];
    }, [hasDefined, defaultVisible, activeSorted, added]);
    const addableMethods = useMemo(
        () => activeSorted.filter((m) => !visibleMethods.some((v) => v.key === m.key)),
        [activeSorted, visibleMethods],
    );
    const allMethods = useMemo(() => (hasDefined ? activeSorted : genericPicks), [hasDefined, activeSorted]);

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
    const creditDue = creditDueAmount(total, totalPaid);
    const keepDueCheck = canKeepDue(customer, creditDue);
    const paymentValid = Math.abs(balance) < 0.01 || keepDueCheck.allowed;
    const availableCredit = availableCustomerCredit(customer);

    const renderMethodRow = (m: PickMethod) => (
        <div key={m.key} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700" title={m.name}>
                {m.name}
                {m.inactive ? <span className="text-gray-400 font-normal text-xs ml-1">(inactive)</span> : null}
            </span>
            <input
                type="number"
                min="0"
                step="0.01"
                value={amounts[m.key] || ''}
                onChange={(e) => updateAmount(m.key, parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                aria-label={`${m.name} amount`}
                className="w-24 flex-shrink-0 px-2 py-1 border rounded text-sm text-right"
            />
        </div>
    );

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment</h3>
                <span
                    className={`text-xs font-semibold ${
                        paymentValid ? 'text-green-600' : balance > 0 ? 'text-red-600' : 'text-amber-600'
                    }`}
                >
                    {Math.abs(balance) < 0.01
                        ? '✓ Settled'
                        : balance > 0
                            ? keepDueCheck.allowed
                                ? `Keeping due ৳${creditDue.toFixed(2)}`
                                : `Due ৳${creditDue.toFixed(2)}`
                            : `Overpaid ৳${Math.abs(balance).toFixed(2)}`}
                </span>
            </div>

            {balance > 0.01 && customer && availableCredit != null && (
                <p className="text-[11px] text-gray-500">
                    Available credit: ৳{availableCredit.toFixed(2)}
                </p>
            )}
            {balance > 0.01 && !keepDueCheck.allowed && keepDueCheck.reason && (
                <p className="text-[11px] text-red-600">{keepDueCheck.reason}</p>
            )}

            <div className="space-y-1.5 rounded border p-2">
                {visibleMethods.map(renderMethodRow)}
            </div>

            {addableMethods.length > 0 && (
                <div>
                    <select
                        aria-label="Add payment method"
                        value=""
                        onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]); }}
                        className="w-full px-2 py-1.5 border rounded text-sm text-gray-600"
                    >
                        <option value="">+ Add method…</option>
                        {addableMethods.map((m) => (
                            <option key={m.key} value={m.key}>{m.name}</option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}