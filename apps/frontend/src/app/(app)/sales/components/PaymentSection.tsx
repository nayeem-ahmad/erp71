import { formatBDT } from '@/lib/format';
import DocumentPaymentSection from '@/components/document-entry/PaymentSection';
import { Payment } from '@/lib/hooks/useNewSaleCart';
import { canKeepDue, creditDueAmount, availableCustomerCredit } from '@/lib/customer-credit';

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    customer?: any;
    onPaymentChange: (payments: Payment[]) => void;
    readOnly?: boolean;
}

/**
 * The sale screen's tender strip: the shared entry-payment component plus the
 * one rule that is specific to selling — an unpaid balance is only allowed
 * inside the customer's credit limit. The method list, the canonical
 * classification sent to the backend and the generic fallback all live in
 * `@/components/document-entry/PaymentSection`, which purchase entry uses too.
 */
export default function PaymentSection({ payments, total, customer, onPaymentChange, readOnly = false }: PaymentSectionProps) {
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = total - totalPaid;
    const creditDue = creditDueAmount(total, totalPaid);
    const keepDueCheck = canKeepDue(customer, creditDue);
    const availableCredit = availableCustomerCredit(customer);

    return (
        <DocumentPaymentSection
            payments={payments}
            total={total}
            onPaymentChange={onPaymentChange}
            readOnly={readOnly}
            blockedReason={keepDueCheck.allowed ? undefined : keepDueCheck.reason}
            hint={
                balance > 0.01 && customer && availableCredit != null ? (
                    <p className="text-[11px] text-gray-500">
                        Available credit: {formatBDT(availableCredit)}
                    </p>
                ) : null
            }
        />
    );
}
