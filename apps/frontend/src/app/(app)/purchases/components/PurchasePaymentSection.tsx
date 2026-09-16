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
 */
export default function PurchasePaymentSection({
    payments,
    total,
    onPaymentChange,
    readOnly = false,
}: PurchasePaymentSectionProps) {
    const { t, locale } = useI18n();
    const copy = t.purchaseShared;

    return (
        <DocumentPaymentSection
            payments={payments}
            total={total}
            onPaymentChange={onPaymentChange}
            readOnly={readOnly}
            locale={locale}
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
            }}
        />
    );
}
