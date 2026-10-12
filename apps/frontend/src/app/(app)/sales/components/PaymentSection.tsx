import { formatBDT } from '@/lib/format';
import DocumentPaymentSection from '@/components/document-entry/PaymentSection';
import { Payment } from '@/lib/hooks/useNewSaleCart';
import { canKeepDue, creditDueAmount, availableCustomerCredit, saleOverpayment } from '@/lib/customer-credit';

interface PaymentSectionProps {
    payments: Payment[];
    total: number;
    customer?: any;
    /**
     * What the customer owed before this sale — the figure money paid beyond
     * the total settles first. Left out, it is the picked customer's balance.
     */
    previousDue?: number | null;
    /**
     * Say what becomes of money paid beyond the total. On by default; off on a
     * posted sale's edit form, whose payment edits are not re-posted, so
     * promising an advance there would be untrue.
     */
    warnOnOverpayment?: boolean;
    onPaymentChange: (payments: Payment[]) => void;
    readOnly?: boolean;
}

/**
 * The sale screen's tender strip: the shared entry-payment component plus the
 * two rules that are specific to selling — an unpaid balance is only allowed
 * inside the customer's credit limit, and money paid beyond the total is never
 * refused but always explained. The method list, the canonical classification
 * sent to the backend and the generic fallback all live in
 * `@/components/document-entry/PaymentSection`, which purchase entry uses too.
 *
 * It turns the instrument panel on: a shop handed a cheque needs to record the
 * bank, the account, the number and the date on it, and `PaymentRecord` has
 * columns for all of them. (Purchase entry does the same for cheques it writes,
 * into `PurchasePayment`.)
 */
export default function PaymentSection({
    payments,
    total,
    customer,
    previousDue,
    warnOnOverpayment = true,
    onPaymentChange,
    readOnly = false,
}: PaymentSectionProps) {
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = total - totalPaid;
    const creditDue = creditDueAmount(total, totalPaid);
    const keepDueCheck = canKeepDue(customer, creditDue);
    const availableCredit = availableCustomerCredit(customer);

    const overpayment = saleOverpayment(
        total,
        totalPaid,
        customer
            ? { previousDue: previousDue !== undefined ? previousDue : Number(customer.due_balance ?? 0) }
            : null,
    );
    const showOverpayment = !readOnly && warnOnOverpayment && overpayment != null;

    return (
        <div className="space-y-2">
            <DocumentPaymentSection
                payments={payments}
                total={total}
                onPaymentChange={onPaymentChange}
                readOnly={readOnly}
                captureInstrument
                blockedReason={keepDueCheck.allowed ? undefined : keepDueCheck.reason}
                labels={showOverpayment
                    ? { overpaid: overpayment.change > 0 ? 'Change {amount}' : 'On account {amount}' }
                    : undefined}
                hint={
                    balance > 0.01 && customer && availableCredit != null ? (
                        <p className="text-[11px] text-gray-500">
                            Available credit: {formatBDT(availableCredit)}
                        </p>
                    ) : null
                }
            />
            {showOverpayment && <OverpaymentNotice overpayment={overpayment} customerName={customer?.name} />}
        </div>
    );
}

/**
 * Where the excess goes, said before the sale is saved. Settling a previous
 * due is the ordinary case and reads as a plain note; running past it, or
 * taking more than a walk-in owes, is flagged — it is as often a typo as a
 * deposit — but never blocks the sale.
 */
function OverpaymentNotice({
    overpayment,
    customerName,
}: {
    overpayment: NonNullable<ReturnType<typeof saleOverpayment>>;
    customerName?: string;
}) {
    const { change, advance, towardPreviousDue } = overpayment;

    if (change > 0) {
        return (
            <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Paid {formatBDT(change)} more than the total. With no customer selected there is no
                account to keep it on, so it is change to hand back.
            </p>
        );
    }

    if (advance > 0) {
        return (
            <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Paid {formatBDT(advance)} more than this sale
                {towardPreviousDue > 0 ? ' and the previous due' : ''}.{' '}
                {towardPreviousDue > 0 ? `${formatBDT(towardPreviousDue)} settles the previous due; the ` : 'The '}
                {formatBDT(advance)} will be kept as an advance on {customerName || 'the customer'}&apos;s account.
            </p>
        );
    }

    return (
        <p className="text-xs text-gray-600">
            {formatBDT(towardPreviousDue)} goes toward the previous due.
        </p>
    );
}
