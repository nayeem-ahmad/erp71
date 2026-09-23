import { formatBDT } from '@/lib/format';
import DocumentPaymentSection from '@/components/document-entry/PaymentSection';
import { Payment } from '@/lib/hooks/useNewSaleCart';
import { canKeepDue, creditDueAmount, availableCustomerCredit, keepDueReason } from '@/lib/customer-credit';
import { useI18n } from '@/lib/i18n';

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
 *
 * Sale entry is the screen that takes cheques, so it is the one that turns the
 * instrument panel on: a shop handed a cheque needs to record the bank, the
 * account, the number and the date on it. `PaymentRecord` has columns for all
 * of them; the purchase side has nowhere to put them yet, which is why the
 * shared component keeps the panel opt-in rather than always-on.
 */
export default function PaymentSection({ payments, total, customer, onPaymentChange, readOnly = false }: PaymentSectionProps) {
    const { t, fmt, locale } = useI18n();
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
            locale={locale}
            captureInstrument
            blockedReason={keepDueReason(keepDueCheck, t.sales.entry.credit, fmt)}
            hint={
                balance > 0.01 && customer && availableCredit != null ? (
                    <p className="text-[11px] text-gray-500">
                        {fmt(t.sales.entry.availableCredit, { amount: formatBDT(availableCredit, { locale }) })}
                    </p>
                ) : null
            }
        />
    );
}
