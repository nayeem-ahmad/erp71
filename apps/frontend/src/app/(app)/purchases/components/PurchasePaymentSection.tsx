'use client';

import type { PaymentLayoutContext } from '@erp71/shared-types';
import DocumentPaymentSection, { type PaymentSectionLabels } from '@/components/document-entry/PaymentSection';
import type { PaymentMethodRow } from '@/lib/api';
import type { Payment } from '@/lib/hooks/useNewSaleCart';
import { useI18n } from '@/lib/i18n';

interface PurchasePaymentSectionProps {
    /** Which of the user's layouts to show (see the shared strip). */
    context: PaymentLayoutContext;
    /** The bill's branch — the methods offered there are the ones shown. */
    storeId: string;
    payments: Payment[];
    total: number;
    onPaymentChange: (payments: Payment[]) => void;
    readOnly?: boolean;
    /** Wording for a screen with its own idea of the unpaid rest, e.g. a purchase return. */
    labels?: Partial<PaymentSectionLabels>;
    /** Why the unpaid rest may not stand (a return with no supplier); see the shared strip. */
    blockedReason?: string;
    /** See the shared strip: told which methods this user sees, once the layout lands. */
    onLayoutReady?: (visible: PaymentMethodRow[], available: PaymentMethodRow[]) => void;
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
    context,
    storeId,
    payments,
    total,
    onPaymentChange,
    readOnly = false,
    labels,
    blockedReason,
    onLayoutReady,
}: PurchasePaymentSectionProps) {
    const { t, locale } = useI18n();
    const copy = t.purchaseShared;
    const instrument = copy.paymentInstrument;
    const layout = copy.paymentLayout;

    return (
        <DocumentPaymentSection
            context={context}
            storeId={storeId}
            payments={payments}
            total={total}
            onPaymentChange={onPaymentChange}
            readOnly={readOnly}
            locale={locale}
            captureInstrument
            blockedReason={blockedReason}
            onLayoutReady={onLayoutReady}
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
                customise: layout.customise,
                customiseTitle: layout.title,
                resetLayout: layout.reset,
                saveLayout: layout.save,
                cancelLayout: layout.cancel,
                moveUp: layout.moveUp,
                moveDown: layout.moveDown,
                showMethod: layout.showMethod,
                layoutSaveFailed: layout.saveFailed,
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
                ...labels,
            }}
        />
    );
}
