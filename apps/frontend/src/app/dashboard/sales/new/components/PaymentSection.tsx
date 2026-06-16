import { useState, useEffect } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { api } from '../../../../../lib/api';
import { Payment } from '../../../../../lib/hooks/useNewSaleCart';

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    onPaymentChange: (payments: Payment[]) => void;
}

const PAYMENT_METHODS = [
    { value: 'Cash', label: 'Cash' },
    { value: 'Mobile Wallet', label: 'Mobile Wallet (bKash/Nagad)' },
    { value: 'Card', label: 'Card' },
    { value: 'Bank', label: 'Bank Transfer' },
];

const ACCOUNT_TYPE_MAP: Record<string, string> = {
    'Cash': 'Cash',
    'Mobile Wallet': 'Wallet',
    'Card': 'Card',
    'Bank': 'Bank',
};

export default function PaymentSection({ payments, total, onPaymentChange }: PaymentSectionProps) {
    const [newPayment, setNewPayment] = useState<Partial<Payment>>({ method: 'Cash', amount: total });
    const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);

    useEffect(() => {
        loadPaymentMethods();
        loadAccounts();
    }, []);

    const loadPaymentMethods = async () => {
        try {
            const data = await api.getPaymentMethods();
            setPaymentMethods(data);
        } catch (error) {
            console.error('Failed to load payment methods', error);
        }
    };

    const loadAccounts = async () => {
        try {
            const data = await api.getAccounts();
            setAccounts(data);
        } catch (error) {
            console.error('Failed to load accounts', error);
        }
    };

    const getFilteredAccounts = (method: string | undefined) => {
        if (!method) return [];
        const accountType = ACCOUNT_TYPE_MAP[method];
        return accounts.filter((a) => a.type.includes(accountType) || a.category === method.toLowerCase());
    };

    const handleAddPayment = () => {
        if (!newPayment.method || !newPayment.amount || newPayment.amount <= 0) {
            alert('Please select a payment method and enter an amount');
            return;
        }

        const updatedPayments = [...payments, newPayment as Payment];
        onPaymentChange(updatedPayments);

        // Calculate remaining amount
        const totalPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
        const remaining = Math.max(0, total - totalPaid);

        setNewPayment({ method: 'Cash', amount: remaining });
    };

    const handleRemovePayment = (index: number) => {
        const updatedPayments = payments.filter((_, i) => i !== index);
        onPaymentChange(updatedPayments);
    };

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = total - totalPaid;
    const paymentValid = Math.abs(balance) < 0.01;

    return (
        <div className="bg-white rounded-lg border p-6 space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="font-semibold text-gray-900">Payment Methods</h3>
                <div className="text-right">
                    <div className="text-sm text-gray-600">Total to Pay: ৳{total.toFixed(2)}</div>
                    <div className="text-sm text-gray-600">Total Paid: ৳{totalPaid.toFixed(2)}</div>
                    <div
                        className={`text-sm font-semibold ${
                            paymentValid ? 'text-green-600' : balance > 0 ? 'text-red-600' : 'text-amber-600'
                        }`}
                    >
                        {paymentValid ? '✓ Balance Settled' : `Remaining: ৳${Math.abs(balance).toFixed(2)}`}
                    </div>
                </div>
            </div>

            {/* Payment List */}
            {payments.length > 0 && (
                <div className="space-y-2 bg-gray-50 p-4 rounded">
                    {payments.map((payment, index) => (
                        <div key={index} className="flex justify-between items-center py-2 border-b last:border-b-0">
                            <div className="text-sm">
                                <span className="font-medium">{payment.method}</span>
                                {payment.accountId && (
                                    <span className="text-gray-600 ml-2">
                                        - {accounts.find((a) => a.id === payment.accountId)?.name}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="font-medium">৳{payment.amount.toFixed(2)}</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemovePayment(index)}
                                    className="text-red-600 hover:bg-red-50 p-1 rounded"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Payment */}
            <div className="border rounded-lg p-4 space-y-4 bg-blue-50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Payment Method
                        </label>
                        <select
                            value={newPayment.method || ''}
                            onChange={(e) =>
                                setNewPayment({ ...newPayment, method: e.target.value, accountId: undefined })
                            }
                            className="w-full px-3 py-2 border rounded text-sm"
                        >
                            <option value="">Select...</option>
                            {PAYMENT_METHODS.map((method) => (
                                <option key={method.value} value={method.value}>
                                    {method.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {newPayment.method && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">
                                Account (Optional)
                            </label>
                            <select
                                value={newPayment.accountId || ''}
                                onChange={(e) =>
                                    setNewPayment({ ...newPayment, accountId: e.target.value || undefined })
                                }
                                className="w-full px-3 py-2 border rounded text-sm"
                                disabled={getFilteredAccounts(newPayment.method).length === 0}
                            >
                                <option value="">-- Select Account --</option>
                                {getFilteredAccounts(newPayment.method).map((account) => (
                                    <option key={account.id} value={account.id}>
                                        {account.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Amount
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={newPayment.amount || ''}
                            onChange={(e) =>
                                setNewPayment({ ...newPayment, amount: parseFloat(e.target.value) || 0 })
                            }
                            placeholder={`Remaining: ৳${balance.toFixed(2)}`}
                            className="w-full px-3 py-2 border rounded text-sm"
                        />
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleAddPayment}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                    <Plus className="w-4 h-4" />
                    Add Payment Method
                </button>
            </div>
        </div>
    );
}
