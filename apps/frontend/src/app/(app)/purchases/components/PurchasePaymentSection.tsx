'use client';

import DocumentPaymentSection from '@/components/document-entry/PaymentSection';
import type { Payment } from '@/lib/hooks/useNewSaleCart';
import { useI18n } from '@/lib/i18n';

interface PurchasePaymentSectionProps {
    payments: Payment[];
    total: number;
    onPaymentChange: (payments: Payment[]) => void;
    readOnly?: boolean;
}

/**
 * The purchase screen's tender strip — the same shared component the sale
 * screen uses, worded for money going out.
 *
 * No credit check on this side: whatever is left unpaid is simply what the
 * supplier is still owed, and every shopkeeper is allowed to owe their
 * supplier. (The one limit is the other way round — paying more than the bill
 * is rejected, on the entry form and again in the service.)
 *
 * Like the sale screen, it offers the cheque / transfer details panel on every
 * non-cash tender: a shop paying a supplier by cheque needs the bank, the
 * account, the number and the date on it afterwards just as much as one being
 * paid by one. They are stored per tender on the bill's `PurchasePayment` rows.
 */
export default function PurchasePaymentSection({
    payments,
    total,
    onPaymentChange,
    readOnly = false,
}: PurchasePaymentSectionProps) {
    const { t, locale } = useI18n();
    const copy = t.purchaseShared;
    const instrument = copy.paymentInstrument;

    return (
        <DocumentPaymentSection
            payments={payments}
            total={total}
            onPaymentChange={onPaymentChange}
            readOnly={readOnly}
            locale={locale}
            captureInstrument
            labels={{
                title: copy.payment,
                settled: copy.paymentSettled,
                due: copy.supplierDue,
                keepingDue: copy.supplierDue,
                overpaid: copy.paymentOverpaid,
                amount: copy.paymentAmountLabel,
                inactive: copy.paymentMethodInactive,
                addMethod: copy.addPaymentMethodOption,
                addMethodAria: copy.addPaymentMethod,
                noPayments: copy.noPaymentsRecorded,
                instrumentToggle: instrument.toggle,
                instrumentToggleAlt: instrument.toggleAlt,
                instrumentBank: instrument.bank,
                instrumentBranch: instrument.branch,
                instrumentAccountNumber: instrument.accountNumber,
                instrumentIssuer: instrument.issuer,
                instrumentWalletNumber: instrument.walletNumber,
                instrumentChequeNo: instrument.chequeNo,
                instrumentChequeDate: instrument.chequeDate,
                instrumentApprovalNo: instrument.approvalNo,
                instrumentTransactionId: instrument.transactionId,
                instrumentPaymentDate: instrument.paymentDate,
            }}
        />
    );
}
