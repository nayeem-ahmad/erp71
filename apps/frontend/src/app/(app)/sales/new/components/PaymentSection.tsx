import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Payment } from '@/lib/hooks/useNewSaleCart';

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    onPaymentChange: (payments: Payment[]) => void;
}

interface DefinedMethod {
    id: string;
    name: string;
    type: string;
    account_id?: string;
    is_active: boolean;
    sort_order?: number;
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

export default function PaymentSection({ payments, total, onPaymentChange }: PaymentSectionProps) {
    const [definedMethods, setDefinedMethods] = useState<DefinedMethod[]>([]);
    const [amounts, setAmounts] = useState<Record<string, number>>({});
    const [showOther, setShowOther] = useState(false);

    useEffect(() => {
        api.getPaymentMethods()
            .then((data) => setDefinedMethods(data ?? []))
            .catch((err) => console.error('Failed to load payment methods', err));
    }, []);

    const activeMethods = useMemo(
        () => definedMethods.filter((m) => m.is_active).map(toPick),
        [definedMethods],
    );
    const inactiveMethods = useMemo(
        () => definedMethods.filter((m) => !m.is_active).map(toPick),
        [definedMethods],
    );

    const visibleMethods = useMemo(
        () => (activeMethods.length > 0 ? activeMethods : genericPicks),
        [activeMethods],
    );
    const otherMethods = useMemo(
        () => (activeMethods.length > 0 ? [...inactiveMethods, ...genericPicks] : []),
        [activeMethods, inactiveMethods],
    );
    const allMethods = useMemo(
        () => [...visibleMethods, ...otherMethods],
        [visibleMethods, otherMethods],
    );

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
    const paymentValid = Math.abs(balance) < 0.01;

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
                    {paymentValid ? '✓ Settled' : `Due ৳${Math.abs(balance).toFixed(2)}`}
                </span>
            </div>

            <div className="space-y-1.5 rounded border p-2">
                {visibleMethods.map(renderMethodRow)}
            </div>

            {otherMethods.length > 0 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowOther((v) => !v)}
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 transition-colors"
                    >
                        Other methods
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOther ? 'rotate-180' : ''}`} />
                    </button>
                    {showOther && (
                        <div className="mt-1.5 space-y-1.5 rounded border p-2">
                            {otherMethods.map(renderMethodRow)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}