import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { printSupplierPaymentReceipt } from '@/lib/supplier-payment-receipt';
import type { OpenBill, PartyOption, PartyPayment, PartyPaymentsAdapter } from './types';

function withVoucher(payment: PartyPayment): PartyPayment {
    return { ...payment, accounting_voucher_number: payment.accounting_voucher_number ?? payment.voucher_number ?? null };
}

export const supplierPaymentsAdapter: PartyPaymentsAdapter = {
    kind: 'supplier',
    tableId: 'supplier-payments',
    partyParam: 'supplierId',
    primary: 'pay',
    labels: (t) => {
        const c = t.supplierPayments;
        return {
            title: c.title,
            subtitle: c.subtitle,
            listTitle: c.listTitle,
            newPayment: c.newPayment,
            editPayment: c.editPayment,
            viewPayment: c.viewPayment,
            duplicatePayment: c.duplicatePayment,
            duplicateNotice: c.duplicateNotice,
            party: c.columns.supplier,
            filterParty: c.filterSupplier,
            allParties: c.allSuppliers,
            pickParty: c.pickSupplierOption,
            noParties: c.noSuppliers,
            loadingParties: c.loadingSuppliers,
            partiesLoadFailed: c.suppliersLoadFailed,
            retry: t.customerPayments.retry,
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
            allocation: c.allocation,
        };
    },
    breadcrumbs: (t, title) => modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.purchase, title, 'purchases'),
    // A supplier PAYMENT is money we paid; a PAYOUT is money they sent back.
    directionOf: (payment) => (payment.type === 'PAYOUT' ? 'receive' : 'pay'),
    partyOf: (payment) => payment.supplier ?? null,
    ledgerHref: (partyId) => `/purchases/supplier-ledger?supplierId=${encodeURIComponent(partyId)}`,
    listParties: async () => {
        const rows = await api.getSuppliers();
        return (Array.isArray(rows) ? rows : []) as PartyOption[];
    },
    listPayments: async ({ from, to, partyId }) => {
        const rows = await api.getSupplierCreditPayments({ from, to, supplierId: partyId });
        return (Array.isArray(rows) ? rows : []) as PartyPayment[];
    },
    nextNumber: (direction) => api.getNextSupplierPaymentNumber(direction),
    record: async (partyId, input) => withVoucher(await api.recordSupplierCreditPayment(partyId, input)),
    update: async (paymentId, input) => withVoucher(await api.updateSupplierCreditPayment(paymentId, input)),
    remove: (paymentId) => api.deleteSupplierCreditPayment(paymentId),
    openBills: async (partyId) => {
        const summary = await api.getSupplierBillingSummary(partyId);
        return ((summary as { open_bills?: OpenBill[] } | null)?.open_bills ?? []);
    },
    allocate: (paymentId, allocations) => api.allocateSupplierPayment(paymentId, allocations),
    print: (payment, { businessName, headerConfig, locale, t }) => {
        const copy = t.supplierPayments;
        const supplier = payment.supplier;
        printSupplierPaymentReceipt({
            businessName,
            headerConfig,
            paymentNumber: payment.payment_number ?? payment.id,
            date: formatDateTime(payment.created_at, locale),
            direction: payment.type === 'PAYOUT' ? 'receive' : 'pay',
            supplierName: supplier?.name ?? '—',
            supplierPhone: supplier?.phone ?? undefined,
            amount: Number(payment.amount),
            discount: Number(payment.discount_amount ?? 0),
            balanceAfter: payment.balance_after !== undefined ? Number(payment.balance_after) : undefined,
            notes: payment.notes ?? undefined,
            method: payment.payment_method_name,
            recordedBy: payment.creator?.name,
            labels: {
                method: t.partyPayments.method,
                moneyReceipt: copy.print.moneyReceipt,
                paymentVoucher: copy.print.paymentVoucher,
                serial: copy.columns.serial,
                date: copy.columns.dateTime,
                supplier: copy.columns.supplier,
                amount: copy.columns.amount,
                discount: copy.discount.label,
                balanceAfter: copy.balanceAfter,
                notes: copy.columns.notes,
                recordedBy: copy.columns.recordedBy,
                receiveTitle: copy.print.receiveTitle,
                payTitle: copy.print.payTitle,
                footer: copy.print.footer,
            },
        });
    },
};
