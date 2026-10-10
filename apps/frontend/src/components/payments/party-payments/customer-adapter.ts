import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { printCustomerPaymentReceipt } from '@/lib/customer-payment-receipt';
import type { PartyOption, PartyPayment, PartyPaymentsAdapter } from './types';

/** Record/update answer with `voucher_number`; the list calls it `accounting_voucher_number`. */
function withVoucher(payment: PartyPayment): PartyPayment {
    return { ...payment, accounting_voucher_number: payment.accounting_voucher_number ?? payment.voucher_number ?? null };
}

export const customerPaymentsAdapter: PartyPaymentsAdapter = {
    kind: 'customer',
    tableId: 'customer-payments',
    partyParam: 'customerId',
    primary: 'receive',
    labels: (t) => {
        const c = t.customerPayments;
        return {
            title: c.title,
            subtitle: c.subtitle,
            listTitle: c.listTitle,
            newPayment: c.newPayment,
            editPayment: c.editPayment,
            viewPayment: c.viewPayment,
            duplicatePayment: c.duplicatePayment,
            duplicateNotice: c.duplicateNotice,
            party: c.columns.customer,
            filterParty: c.filterCustomer,
            allParties: c.allCustomers,
            pickParty: c.pickCustomerOption,
            noParties: c.noCustomers,
            loadingParties: c.loadingCustomers,
            partiesLoadFailed: c.customersLoadFailed,
            retry: c.retry,
            searchPayments: c.searchPayments,
            noPayments: c.noPayments,
            loading: c.loading,
            loadFailed: c.loadFailed,
            saveFailed: c.saveFailed,
            invalidAmount: c.invalidAmount,
            requiredFields: c.requiredFields,
            direction: c.direction,
            receive: c.directionReceive,
            pay: c.directionPay,
            dueBalance: c.dueBalance,
            advanceBalance: c.advanceBalance,
            paymentDate: c.paymentDate,
            dateInFuture: c.dateInFuture,
            serialTaken: c.serialTaken,
            serialAhead: c.serialAhead,
            amount: c.amount,
            amountPlaceholder: c.amountPlaceholder,
            notes: c.notes,
            notesPlaceholder: c.notesPlaceholder,
            paymentUpdated: c.paymentUpdated,
            paymentDeleted: c.paymentDeleted,
            deleteConfirm: c.deleteConfirm,
            deleteFailed: c.deleteFailed,
            printReceipt: c.printReceipt,
            printVoucher: c.printVoucher,
            voucherNumber: c.voucherNumber,
            balanceAfter: c.balanceAfter,
            kpiIn: c.kpiIn,
            kpiOut: c.kpiOut,
            kpiNet: c.kpiNet,
            discount: c.discount,
            columns: c.columns,
        };
    },
    breadcrumbs: (t, title) => modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.sales, title, 'sales'),
    directionOf: (payment) => (payment.type === 'PAYOUT' ? 'pay' : 'receive'),
    partyOf: (payment) => payment.customer ?? null,
    ledgerHref: (partyId) => `/sales/customer-ledger?customerId=${encodeURIComponent(partyId)}`,
    listParties: async () => ((await api.getCustomers()) ?? []) as PartyOption[],
    listPayments: async ({ from, to, partyId, storeId }) => {
        const rows = await api.getCustomerCreditPayments({ from, to, customerId: partyId, storeId });
        return (Array.isArray(rows) ? rows : []) as PartyPayment[];
    },
    nextNumber: (direction) => api.getNextCustomerPaymentNumber(direction),
    record: async (partyId, input) => {
        const { allocations: _ignored, ...rest } = input;
        return withVoucher(await api.recordCreditPayment(partyId, rest));
    },
    update: async (paymentId, input) => withVoucher(await api.updateCustomerCreditPayment(paymentId, input)),
    remove: (paymentId) => api.deleteCustomerCreditPayment(paymentId),
    print: (payment, { businessName, headerConfig, locale, t }) => {
        const copy = t.customerPayments;
        const customer = payment.customer;
        printCustomerPaymentReceipt({
            businessName,
            headerConfig,
            paymentNumber: payment.payment_number ?? payment.id,
            date: formatDateTime(payment.created_at, locale),
            direction: payment.type === 'PAYOUT' ? 'pay' : 'receive',
            customerName: customer?.name ?? '—',
            customerPhone: customer?.phone ?? undefined,
            customerCode: customer?.customer_code ?? undefined,
            amount: Number(payment.amount),
            discount: Number(payment.discount_amount ?? 0),
            balanceAfter: payment.balance_after !== undefined ? Number(payment.balance_after) : undefined,
            notes: payment.notes ?? undefined,
            method: payment.payment_method_name,
            recordedBy: payment.creator?.name,
            voucherNumber: payment.accounting_voucher_number,
            labels: {
                method: t.partyPayments.method,
                moneyReceipt: copy.print.moneyReceipt,
                paymentVoucher: copy.print.paymentVoucher,
                serial: copy.columns.serial,
                date: copy.columns.dateTime,
                customer: copy.columns.customer,
                amount: copy.columns.amount,
                discount: copy.discount.label,
                balanceAfter: copy.balanceAfter,
                notes: copy.columns.notes,
                recordedBy: copy.columns.recordedBy,
                voucher: copy.voucherNumber,
                receiveTitle: copy.print.receiveTitle,
                payTitle: copy.print.payTitle,
                footer: copy.print.footer,
            },
        });
    },
};
