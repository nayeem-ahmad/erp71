import { useState, useEffect, useRef } from 'react';
import { Trash2, ChevronDown } from 'lucide-react';
import { api } from '../../../../../lib/api';
import { Payment } from '../../../../../lib/hooks/useNewSaleCart';

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

// Used both as the chip set when no methods are defined, and as the "Other"
// fallback options that can always be added ad-hoc.
const GENERIC_METHODS = [
    { name: 'Cash', type: 'CASH' },
    { name: 'Mobile Wallet', type: 'MOBILE_WALLET' },
    { name: 'Card', type: 'CARD' },
    { name: 'Bank', type: 'BANK' },
];

const canonicalFor = (type: string) => TYPE_TO_CANONICAL[type] ?? 'Cash';

export default function PaymentSection({ payments, total, onPaymentChange }: PaymentSectionProps) {
    const [definedMethods, setDefinedMethods] = useState<DefinedMethod[]>([]);
    const [amount, setAmount] = useState(total);
    const [showOther, setShowOther] = useState(false);
    const otherRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        api.getPaymentMethods()
            .then((data) => setDefinedMethods(data ?? []))
            .catch((err) => console.error('Failed to load payment methods', err));
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (otherRef.current && !otherRef.current.contains(e.target as Node)) {
                setShowOther(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = total - totalPaid;
    const paymentValid = Math.abs(balance) < 0.01;

    // Keep the amount field tracking the outstanding balance as items/payments change.
    useEffect(() => {
        setAmount(Math.max(0, total - payments.reduce((sum, p) => sum + p.amount, 0)));
    }, [total, payments]);

    // Normalize defined methods and generic fallbacks into one pickable shape.
    type PickMethod = { key: string; name: string; type: string; account_id?: string; inactive?: boolean };
    const toPick = (m: DefinedMethod): PickMethod => ({ key: m.id, name: m.name, type: m.type, account_id: m.account_id, inactive: !m.is_active });
    const genericPicks: PickMethod[] = GENERIC_METHODS.map((m) => ({ key: `generic-${m.type}`, name: m.name, type: m.type }));

    const activeMethods = definedMethods.filter((m) => m.is_active).map(toPick);
    const inactiveMethods = definedMethods.filter((m) => !m.is_active).map(toPick);
    // Chips: the tenant's active defined methods, or generic types if none defined.
    const chipMethods: PickMethod[] = activeMethods.length > 0 ? activeMethods : genericPicks;
    // "Other" menu: inactive defined methods plus the generic types.
    const otherMethods: PickMethod[] = [...inactiveMethods, ...genericPicks];

    const addPayment = (method: PickMethod) => {
        if (!amount || amount <= 0) {
            alert('Enter an amount greater than zero');
            return;
        }
        onPaymentChange([
            ...payments,
            { method: canonicalFor(method.type), label: method.name, accountId: method.account_id, amount },
        ]);
        setShowOther(false);
    };

    const handleRemovePayment = (index: number) => {
        onPaymentChange(payments.filter((_, i) => i !== index));
    };

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

            {/* Recorded payments */}
            {payments.length > 0 && (
                <div className="rounded border divide-y">
                    {payments.map((payment, index) => (
                        <div key={index} className="flex justify-between items-center px-2 py-1 text-sm">
                            <span className="min-w-0 truncate font-medium">{payment.label || payment.method}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="font-medium">৳{payment.amount.toFixed(2)}</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemovePayment(index)}
                                    className="text-red-500 hover:text-red-700"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Amount + method picker */}
            <input
                type="number"
                min="0"
                step="0.01"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="Amount"
                className="w-full px-2 py-1.5 border rounded text-sm"
            />

            <div className="flex flex-wrap gap-1.5">
                {chipMethods.map((m) => (
                    <button
                        key={m.key}
                        type="button"
                        onClick={() => addPayment(m)}
                        className="px-2.5 py-1 rounded border bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-600 transition-colors"
                    >
                        {m.name}
                    </button>
                ))}

                {/* Other methods (inactive defined + generic) */}
                <div className="relative" ref={otherRef}>
                    <button
                        type="button"
                        onClick={() => setShowOther((v) => !v)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border bg-white text-sm font-medium text-gray-500 hover:border-blue-500 hover:text-blue-600 transition-colors"
                    >
                        Other
                        <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {showOther && (
                        <div className="absolute right-0 bottom-full mb-1 z-10 bg-white border rounded-lg shadow-lg py-1 min-w-[160px] max-h-56 overflow-y-auto">
                            {otherMethods.map((m) => (
                                <button
                                    key={m.key}
                                    type="button"
                                    onClick={() => addPayment(m)}
                                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                    {m.name}
                                    {m.inactive && <span className="text-gray-400 text-xs ml-1">(inactive)</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
