'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Loader2, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api, ApiError } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printCustomerPaymentReceipt } from '@/lib/customer-payment-receipt';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { isoToTenantLocal, tenantLocalToIso } from '@/lib/schedule-time';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import { PaymentDiscountField, paymentDiscountError } from '@/components/payments/PaymentDiscountField';
import {
    PaymentSerialDateFields,
    isFutureLocal,
    nowLocal,
    useNextPaymentNumber,
} from '@/components/payments/PaymentSerialDateFields';

interface CustomerOption {
    id: string;
    name: string;
    phone: string;
    customer_code?: string;
    due_balance?: number | string;
}

type PaymentDirection = 'receive' | 'pay';

interface CustomerCreditPayment {
    id: string;
    type?: string;
    payment_number?: string | null;
    amount: string | number;
    /** Settled with the money; only ever set on a receipt. */
    discount_amount?: string | number;
    balance_after?: string | number;
    notes?: string | null;
    created_at: string;
    customer?: { id: string; name: string; phone: string; customer_code?: string } | null;
    creator?: { id: string; name: string } | null;
    voucher_id?: string | null;
    accounting_voucher_number?: string | null;
    discount_voucher_number?: string | null;
}

const columnHelper = createColumnHelper<CustomerCreditPayment>();

function formatDateTime(value: string, locale: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const dateLocale = locale === 'bn' ? 'bn-BD' : locale === 'ms' ? 'ms-MY' : 'en-GB';
    return d.toLocaleString(dateLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function directionFromType(type?: string): PaymentDirection {
    return type === 'PAYOUT' ? 'pay' : 'receive';
}

function discountOf(payment: CustomerCreditPayment): number {
    return Number(payment.discount_amount ?? 0);
}

/** A form value as a non-negative number, or NaN when it is not one. */
function parseNonNegative(value: string): number {
    if (value.trim() === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

function CustomerPaymentsContent() {
    const { t, locale } = useI18n();
    const copy = t.customerPayments;
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('MONEY_RECEIPT');
    const searchParams = useSearchParams();
    const preselectedCustomerId = searchParams.get('customerId');

    const [payments, setPayments] = useState<CustomerCreditPayment[]>([]);
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    // Tracked apart from the payments' `loading`: the full customer list takes
    // several requests on a large shop, and the form must not read "still
    // loading" or "failed" as "this shop has no customers".
    const [customersStatus, setCustomersStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [customerFilter, setCustomerFilter] = useState(preselectedCustomerId ?? '');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [formCustomerId, setFormCustomerId] = useState('');
    const [formDirection, setFormDirection] = useState<PaymentDirection>('receive');
    const [formAmount, setFormAmount] = useState('');
    const [formDiscount, setFormDiscount] = useState('');
    const [formNotes, setFormNotes] = useState('');
    // Empty means "now": the picker shows the current time and nothing is
    // sent, so the server stamps the moment of saving rather than the minute
    // the form was opened. Only a time the operator picked goes over the wire.
    const [formDate, setFormDate] = useState('');
    // null until the operator types: the field then shows the next number in
    // the series, and the server allocates it at save time. Typed (even
    // blank), it is theirs; blank still means "number it for me".
    const [formSerial, setFormSerial] = useState<string | null>(null);
    const [formSerialError, setFormSerialError] = useState<string | null>(null);
    // Set when the create form was opened as a copy of an existing payment;
    // names the source in the modal so a duplicate is never mistaken for it.
    const [duplicatedFrom, setDuplicatedFrom] = useState('');

    const [viewPayment, setViewPayment] = useState<CustomerCreditPayment | null>(null);
    const [editPayment, setEditPayment] = useState<CustomerCreditPayment | null>(null);
    const [editDirection, setEditDirection] = useState<PaymentDirection>('receive');
    const [editAmount, setEditAmount] = useState('');
    const [editDiscount, setEditDiscount] = useState('');
    const [editNotes, setEditNotes] = useState('');
    // Empty means "unchanged", as with the create form's date.
    const [editDate, setEditDate] = useState('');
    // null means "unchanged", as with the create form's serial.
    const [editSerial, setEditSerial] = useState<string | null>(null);
    const [editSerialError, setEditSerialError] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const paymentsData = await api.getCustomerCreditPayments({
                from: applyCreatedRangeQuery(createdRange).createdFrom,
                to: applyCreatedRangeQuery(createdRange).createdTo,
                customerId: customerFilter || undefined,
            });
            setPayments((Array.isArray(paymentsData) ? paymentsData : []) as CustomerCreditPayment[]);
        } catch (error) {
            console.error('Failed to load customer payments', error);
            setToast({ type: 'error', message: copy.loadFailed });
        } finally {
            setLoading(false);
        }
    };

    // The customer list does not depend on the payment filters, so it loads
    // once, on its own — a failed payments fetch can no longer empty the picker.
    const loadCustomers = useCallback(async () => {
        setCustomersStatus('loading');
        try {
            const customersData = await api.getCustomers();
            setCustomers(customersData ?? []);
            setCustomersStatus('ready');
        } catch (error) {
            console.error('Failed to load customers', error);
            setCustomersStatus('error');
        }
    }, []);

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createdRange, customerFilter]);

    useEffect(() => {
        void loadCustomers();
    }, [loadCustomers]);

    useEffect(() => {
        if (preselectedCustomerId) {
            setCustomerFilter(preselectedCustomerId);
            setFormCustomerId(preselectedCustomerId);
        }
    }, [preselectedCustomerId]);

    useEffect(() => {
        if (searchParams.get('new') === '1') {
            setShowForm(true);
        }
    }, [searchParams]);

    const resetForm = () => {
        const initialCustomerId = preselectedCustomerId ?? customers[0]?.id ?? '';
        setFormCustomerId(initialCustomerId);
        setFormDirection('receive');
        setFormAmount('');
        setFormDiscount('');
        setFormNotes('');
        setFormDate('');
        setFormSerial(null);
        setFormSerialError(null);
        setDuplicatedFrom('');
    };

    /**
     * Open the create form prefilled from an existing payment. It is the create
     * path, not an update: nothing is written until the operator saves, and the
     * copy gets its own payment number and its own accounting entry.
     */
    const openDuplicate = (payment: CustomerCreditPayment) => {
        setViewPayment(null);
        setEditPayment(null);
        setFormCustomerId(payment.customer?.id ?? '');
        setFormDirection(directionFromType(payment.type));
        setFormAmount(String(payment.amount));
        // Not copied: a discount settles one particular remainder, and the
        // copy will be settling a different one.
        setFormDiscount('');
        setFormNotes(payment.notes ?? '');
        // Not copied either: the copy is a new payment, taken now, under the
        // next serial.
        setFormDate('');
        setFormSerial(null);
        setFormSerialError(null);
        setDuplicatedFrom(payment.payment_number ?? '');
        setShowForm(true);
    };

    const { preview: serialPreview, refresh: refreshSerialPreview } = useNextPaymentNumber(
        showForm,
        formDirection,
        api.getNextCustomerPaymentNumber,
    );

    const selectedFormCustomer = customers.find((c) => c.id === formCustomerId) ?? null;
    const dueBalance = selectedFormCustomer ? Number(selectedFormCustomer.due_balance ?? 0) : 0;

    const formDiscountApplies = formDirection === 'receive';
    const formDiscountError = formDiscountApplies && selectedFormCustomer
        ? paymentDiscountError(dueBalance, formAmount, formDiscount, copy.discount.tooLarge)
        : null;
    const formDateError = isFutureLocal(formDate) ? copy.dateInFuture : null;

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formCustomerId || formAmount === '') {
            setToast({ type: 'error', message: copy.requiredFields });
            return;
        }
        const amt = parseNonNegative(formAmount);
        const discount = formDiscountApplies ? parseNonNegative(formDiscount) : 0;
        if (Number.isNaN(amt) || Number.isNaN(discount)) {
            setToast({ type: 'error', message: copy.invalidAmount });
            return;
        }
        if (amt + discount <= 0 || (!formDiscountApplies && amt <= 0)) {
            setToast({ type: 'error', message: formDiscountApplies ? copy.discount.amountOrDiscount : copy.invalidAmount });
            return;
        }
        if (formDiscountError || formDateError) return;
        setSaving(true);
        try {
            await api.recordCreditPayment(formCustomerId, {
                amount: amt,
                discount: discount > 0 ? discount : undefined,
                direction: formDirection,
                notes: formNotes.trim() || undefined,
                date: tenantLocalToIso(formDate) ?? undefined,
                paymentNumber: formSerial?.trim() || undefined,
            });
            setToast({ type: 'success', message: copy.paymentSaved });
            setShowForm(false);
            resetForm();
            // The payment is already saved; refresh the list behind the closed form
            // rather than keeping Save busy until every page has been re-fetched.
            void loadData();
        } catch (error: unknown) {
            // A serial past the series' next number would skip every number between;
            // the server refuses it, and it belongs under the field like a taken one.
            if (error instanceof ApiError && error.code === 'SERIAL_AHEAD_OF_SERIES') {
                setFormSerialError(formatMessage(copy.serialAhead, { serial: formSerial?.trim() || serialPreview }));
                return;
            }
            if (error instanceof ApiError && error.status === 409) {
                setFormSerialError(formatMessage(copy.serialTaken, { serial: formSerial?.trim() || serialPreview }));
                refreshSerialPreview();
                return;
            }
            setToast({
                type: 'error',
                message: error instanceof Error ? error.message : copy.saveFailed,
            });
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (payment: CustomerCreditPayment) => {
        setEditPayment(payment);
        setEditDirection(directionFromType(payment.type));
        setEditAmount(String(payment.amount));
        setEditDiscount(discountOf(payment) > 0 ? String(discountOf(payment)) : '');
        setEditNotes(payment.notes ?? '');
        setEditDate('');
        setEditSerial(null);
        setEditSerialError(null);
    };

    const editDiscountApplies = editDirection === 'receive';
    // The due the edited payment settles against: today's due with this
    // payment taken back out.
    const editDueBefore = (() => {
        if (!editPayment) return null;
        const customer = customers.find((c) => c.id === editPayment.customer?.id);
        if (!customer) return null;
        const settled = Number(editPayment.amount) + discountOf(editPayment);
        return Number(customer.due_balance ?? 0) + (editPayment.type === 'PAYOUT' ? -Number(editPayment.amount) : settled);
    })();
    const editDiscountError = editDiscountApplies
        ? paymentDiscountError(editDueBefore, editAmount, editDiscount, copy.discount.tooLarge)
        : null;
    const editDateError = isFutureLocal(editDate) ? copy.dateInFuture : null;

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editPayment) return;
        const amt = parseNonNegative(editAmount);
        const discount = editDiscountApplies ? parseNonNegative(editDiscount) : 0;
        if (Number.isNaN(amt) || Number.isNaN(discount)) {
            setToast({ type: 'error', message: copy.invalidAmount });
            return;
        }
        if (amt + discount <= 0 || (!editDiscountApplies && amt <= 0)) {
            setToast({ type: 'error', message: editDiscountApplies ? copy.discount.amountOrDiscount : copy.invalidAmount });
            return;
        }
        if (editDiscountError || editDateError) return;
        setSaving(true);
        try {
            await api.updateCustomerCreditPayment(editPayment.id, {
                amount: amt,
                discount,
                direction: editDirection,
                notes: editNotes.trim() || undefined,
                date: tenantLocalToIso(editDate) ?? undefined,
                paymentNumber: editSerial?.trim() || undefined,
            });
            setToast({ type: 'success', message: copy.paymentUpdated });
            setEditPayment(null);
            void loadData();
        } catch (error: unknown) {
            // A serial past the series' next number would skip every number between;
            // the server refuses it, and it belongs under the field like a taken one.
            if (error instanceof ApiError && error.code === 'SERIAL_AHEAD_OF_SERIES') {
                setEditSerialError(formatMessage(copy.serialAhead, { serial: editSerial?.trim() ?? '' }));
                return;
            }
            if (error instanceof ApiError && error.status === 409) {
                setEditSerialError(formatMessage(copy.serialTaken, { serial: editSerial?.trim() ?? '' }));
                return;
            }
            setToast({
                type: 'error',
                message: error instanceof Error ? error.message : copy.saveFailed,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (payment: CustomerCreditPayment) => {
        if (!globalThis.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteCustomerCreditPayment(payment.id);
            setToast({ type: 'success', message: copy.paymentDeleted });
            if (viewPayment?.id === payment.id) setViewPayment(null);
            if (editPayment?.id === payment.id) setEditPayment(null);
            void loadData();
        } catch (error: unknown) {
            setToast({
                type: 'error',
                message: error instanceof Error ? error.message : copy.deleteFailed,
            });
        }
    };

    const handlePrint = useCallback((payment: CustomerCreditPayment) => {
        const direction = directionFromType(payment.type);
        printCustomerPaymentReceipt({
            businessName: businessName ?? undefined,
            headerConfig: printHeader.headerConfig,
            paymentNumber: payment.payment_number ?? payment.id,
            date: formatDateTime(payment.created_at, locale),
            direction,
            customerName: payment.customer?.name ?? '—',
            customerPhone: payment.customer?.phone,
            customerCode: payment.customer?.customer_code,
            amount: Number(payment.amount),
            discount: discountOf(payment),
            balanceAfter: payment.balance_after !== undefined ? Number(payment.balance_after) : undefined,
            notes: payment.notes ?? undefined,
            recordedBy: payment.creator?.name,
            voucherNumber: payment.accounting_voucher_number,
            labels: {
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
    }, [businessName, printHeader, copy, locale]);

    const columns: ColumnDef<CustomerCreditPayment, unknown>[] = useMemo(
        () => [
            columnHelper.accessor('payment_number', {
                header: copy.columns.serial,
                cell: (info) => (
                    <span className="text-xs font-mono font-bold text-gray-700">{info.getValue() || '—'}</span>
                ),
                size: 110,
            }),
            columnHelper.accessor('type', {
                header: copy.columns.direction,
                cell: (info) => {
                    const isPayout = info.getValue() === 'PAYOUT';
                    return (
                        <span className={`text-[10px] font-semibold ${isPayout ? 'text-danger' : 'text-emerald-700'}`}>
                            {isPayout ? copy.directionPay : copy.directionReceive}
                        </span>
                    );
                },
                size: 110,
            }),
            // A payment can be backdated, so this is when the money changed
            // hands rather than when the row was keyed in.
            createdAtColumn(columnHelper, { header: copy.columns.dateTime, locale }),
            columnHelper.accessor((row) => row.customer?.name ?? '—', {
                id: 'customer',
                header: copy.columns.customer,
                cell: (info) => {
                    const customer = info.row.original.customer;
                    return (
                        <div>
                            <span className="block text-sm font-bold text-gray-800">{customer?.name ?? '—'}</span>
                            <span className="block text-xs text-gray-400">{customer?.phone ?? ''}</span>
                        </div>
                    );
                },
                size: 180,
            }),
            columnHelper.accessor((row) => row.creator?.name ?? '—', {
                id: 'recordedBy',
                header: copy.columns.recordedBy,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 140,
            }),
            columnHelper.accessor('amount', {
                header: copy.columns.amount,
                cell: (info) => {
                    const isPayout = info.row.original.type === 'PAYOUT';
                    const discount = discountOf(info.row.original);
                    return (
                        <div>
                            <span className={`text-sm font-bold ${isPayout ? 'text-danger' : 'text-emerald-600'}`}>
                                {isPayout ? '−' : '+'}{formatBDT(Number(info.getValue()))}
                            </span>
                            {discount > 0 ? (
                                <span className="block text-xs text-gray-500">
                                    {copy.discount.label}: {formatBDT(discount)}
                                </span>
                            ) : null}
                        </div>
                    );
                },
                sortingFn: (a, b) => Number(a.getValue('amount')) - Number(b.getValue('amount')),
                size: 120,
            }),
            columnHelper.accessor('notes', {
                header: copy.columns.notes,
                cell: (info) => <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>,
                size: 160,
            }),
            columnHelper.display({
                id: 'actions',
                header: copy.columns.actions,
                cell: ({ row }) => {
                    const payment = row.original;
                    const isPayout = payment.type === 'PAYOUT';
                    return (
                        <div className="flex items-center gap-0.5">
                            <button
                                type="button"
                                onClick={() => setViewPayment(payment)}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => openEdit(payment)}
                                className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50"
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => openDuplicate(payment)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                                title={t.common.duplicate}
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handlePrint(payment)}
                                className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50"
                                title={isPayout ? copy.printVoucher : copy.printReceipt}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDelete(payment)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                size: 160,
            }),
        ],
        [copy, locale, t.common, handlePrint],
    );

    const totalAmount = payments.reduce((sum, p) => {
        const amt = Number(p.amount || 0);
        return sum + (p.type === 'PAYOUT' ? -amt : amt);
    }, 0);

    return (
        <PageShell>
                <PageHeader
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Wallet className="w-7 h-7 text-purple-600" />
                            {copy.title}
                        </span>
                    }
                    subtitle={copy.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        copy.title,
                        'sales',
                    )}
                    actions={
                        <button
                            type="button"
                            onClick={() => { resetForm(); setShowForm(true); }}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover"
                        >
                            <Plus className="w-4 h-4" />
                            {copy.newPayment}
                        </button>
                    }
                />

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-danger-light text-danger-text border border-red-200'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <p className="text-xs font-medium text-gray-500">{copy.periodTotal}</p>
                        <p className="text-2xl font-bold text-emerald-600 mt-1">{formatBDT(totalAmount)}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatMessage(copy.paymentCount, { count: payments.length })}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 sm:col-span-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1 sm:col-span-2">
                                <span className="text-xs font-medium text-gray-500">{copy.columns.dateTime}</span>
                                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                            </div>
                            <div className="space-y-1">
                                <IdSearchSelect
                                    items={customers}
                                    value={customerFilter}
                                    onChange={setCustomerFilter}
                                    loading={customersStatus === 'loading'}
                                    label={copy.filterCustomer}
                                    placeholder={copy.allCustomers}
                                    emptyLabel={copy.noCustomers}
                                    noMatchLabel={copy.noCustomers}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin me-2" />
                        {copy.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="customer-payments"
                        title={copy.listTitle}
                        data={payments}
                        columns={columns}
                        searchPlaceholder={copy.searchPayments}
                        emptyMessage={copy.noPayments}
                    />
                )}
            

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleCreate} className="flex flex-col overflow-hidden">
                        <ModalHeader
                            title={duplicatedFrom ? copy.duplicatePayment : copy.newPayment}
                            subtitle={duplicatedFrom || undefined}
                            onClose={() => setShowForm(false)}
                        />
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <PaymentSerialDateFields
                                idPrefix="customer-payment"
                                serial={formSerial ?? serialPreview}
                                serialPlaceholder={serialPreview}
                                onSerialChange={(value) => { setFormSerial(value); setFormSerialError(null); }}
                                serialError={formSerialError}
                                date={formDate || nowLocal()}
                                onDateChange={setFormDate}
                                dateError={formDateError}
                                labels={{ serial: copy.columns.serial, date: copy.paymentDate }}
                            />
                            {duplicatedFrom ? (
                                <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                                    {copy.duplicateNotice.replace('{paymentNumber}', duplicatedFrom)}
                                </p>
                            ) : null}
                            {customersStatus === 'loading' ? (
                                <p className="flex items-center text-sm text-gray-500 p-3">
                                    <Loader2 className="w-4 h-4 animate-spin me-2" />
                                    {copy.loadingCustomers}
                                </p>
                            ) : customersStatus === 'error' ? (
                                <Alert tone="danger">
                                    <span>{copy.customersLoadFailed}</span>
                                    <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void loadCustomers()}>
                                        {copy.retry}
                                    </Button>
                                </Alert>
                            ) : customers.length === 0 ? (
                                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                    {copy.noCustomers}
                                </p>
                            ) : (
                                <>
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.direction}</span>
                                        <select
                                            value={formDirection}
                                            onChange={(e) => setFormDirection(e.target.value as PaymentDirection)}
                                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                        >
                                            <option value="receive">{copy.directionReceive}</option>
                                            <option value="pay">{copy.directionPay}</option>
                                        </select>
                                    </label>
                                    <IdSearchSelect
                                        items={customers}
                                        value={formCustomerId}
                                        onChange={setFormCustomerId}
                                        label={copy.selectCustomer}
                                        placeholder={copy.pickCustomerOption}
                                        emptyLabel={copy.noCustomers}
                                        noMatchLabel={copy.noCustomers}
                                    />
                                    {selectedFormCustomer ? (
                                        <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-3 text-sm">
                                            <span className="text-gray-600">
                                                {dueBalance < 0 ? copy.advanceBalance : copy.dueBalance}:{' '}
                                            </span>
                                            <span className={`font-bold ${dueBalance > 0 ? 'text-danger' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                                {formatBDT(Math.abs(dueBalance))}
                                            </span>
                                            {formDirection === 'receive' ? (
                                                <p className="mt-1 text-xs text-gray-500">{copy.receiveHint}</p>
                                            ) : (
                                                <p className="mt-1 text-xs text-gray-500">{copy.payHint}</p>
                                            )}
                                        </div>
                                    ) : null}
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.amount}</span>
                                        <input
                                            type="number"
                                            min={formDiscountApplies ? '0' : '0.01'}
                                            step="0.01"
                                            value={formAmount}
                                            onChange={(e) => setFormAmount(e.target.value)}
                                            placeholder={copy.amountPlaceholder}
                                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                            required
                                        />
                                    </label>
                                    {formDiscountApplies ? (
                                        <PaymentDiscountField
                                            id="customer-payment-discount"
                                            value={formDiscount}
                                            onChange={setFormDiscount}
                                            amount={formAmount}
                                            dueBefore={selectedFormCustomer ? dueBalance : null}
                                            labels={copy.discount}
                                        />
                                    ) : null}
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.notes}</span>
                                        <textarea
                                            value={formNotes}
                                            onChange={(e) => setFormNotes(e.target.value)}
                                            rows={2}
                                            placeholder={copy.notesPlaceholder}
                                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                        />
                                    </label>
                                </>
                            )}
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" size="md" className="flex-1 justify-center" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                size="md"
                                className="flex-1 justify-center"
                                disabled={customers.length === 0}
                                loading={saving}
                            >
                                {saving ? copy.saving : (formDirection === 'pay' ? copy.confirmPayout : copy.confirmPayment)}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            {viewPayment && (
                <ModalShell size="sm" onBackdropClick={() => setViewPayment(null)}>
                    <ModalHeader
                        title={copy.viewPayment}
                        subtitle={viewPayment.payment_number}
                        onClose={() => setViewPayment(null)}
                    />
                        <div className="p-6 space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.direction}</span>
                                <span className={`font-bold ${viewPayment.type === 'PAYOUT' ? 'text-danger' : 'text-emerald-700'}`}>
                                    {viewPayment.type === 'PAYOUT' ? copy.directionPay : copy.directionReceive}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.dateTime}</span>
                                <span className="font-medium">{formatDateTime(viewPayment.created_at, locale)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.customer}</span>
                                <span className="font-bold text-end">
                                    {viewPayment.customer?.name}
                                    <span className="block text-xs text-gray-400 font-normal">{viewPayment.customer?.phone}</span>
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.amount}</span>
                                <span className={`font-bold ${viewPayment.type === 'PAYOUT' ? 'text-danger' : 'text-emerald-600'}`}>
                                    {formatBDT(Number(viewPayment.amount))}
                                </span>
                            </div>
                            {discountOf(viewPayment) > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">{copy.discount.label}</span>
                                    <span className="font-medium">{formatBDT(discountOf(viewPayment))}</span>
                                </div>
                            )}
                            {viewPayment.balance_after !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">{copy.balanceAfter}</span>
                                    <span className="font-medium">{formatBDT(Number(viewPayment.balance_after))}</span>
                                </div>
                            )}
                            {viewPayment.accounting_voucher_number && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">{copy.voucherNumber}</span>
                                    <span className="font-mono text-xs">{viewPayment.accounting_voucher_number}</span>
                                </div>
                            )}
                            {viewPayment.discount_voucher_number && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">{copy.discount.voucher}</span>
                                    <span className="font-mono text-xs">{viewPayment.discount_voucher_number}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.recordedBy}</span>
                                <span>{viewPayment.creator?.name ?? '—'}</span>
                            </div>
                            {viewPayment.notes && (
                                <div>
                                    <span className="text-gray-500 block mb-1">{copy.columns.notes}</span>
                                    <p className="text-gray-700 bg-gray-50 rounded-xl p-3">{viewPayment.notes}</p>
                                </div>
                            )}
                        </div>
                        <ModalFooter>
                            <Button
                                type="button"
                                variant="secondary"
                                size="md"
                                className="flex-1 justify-center"
                                icon={<Printer className="w-4 h-4" />}
                                onClick={() => handlePrint(viewPayment)}
                            >
                                {viewPayment.type === 'PAYOUT' ? copy.printVoucher : copy.printReceipt}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="md"
                                className="flex-1 justify-center"
                                onClick={() => { setViewPayment(null); openEdit(viewPayment); }}
                            >
                                {t.common.edit}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="md"
                                className="flex-1 justify-center"
                                icon={<Copy className="w-4 h-4" />}
                                onClick={() => openDuplicate(viewPayment)}
                            >
                                {t.common.duplicate}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="md"
                                className="flex-1 justify-center"
                                onClick={() => setViewPayment(null)}
                            >
                                {t.common.close}
                            </Button>
                        </ModalFooter>
                </ModalShell>
            )}

            {editPayment && (
                <ModalShell size="sm" onBackdropClick={() => setEditPayment(null)}>
                    <form onSubmit={handleUpdate} className="flex flex-col overflow-hidden">
                        <ModalHeader
                            title={copy.editPayment}
                            subtitle={editPayment.payment_number}
                            onClose={() => setEditPayment(null)}
                        />
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <PaymentSerialDateFields
                                idPrefix="customer-payment-edit"
                                serial={editSerial ?? editPayment.payment_number ?? ''}
                                serialPlaceholder={editPayment.payment_number ?? undefined}
                                onSerialChange={(value) => { setEditSerial(value); setEditSerialError(null); }}
                                serialError={editSerialError}
                                date={editDate || isoToTenantLocal(editPayment.created_at)}
                                onDateChange={setEditDate}
                                dateError={editDateError}
                                labels={{ serial: copy.columns.serial, date: copy.paymentDate }}
                            />
                            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
                                <span className="text-gray-500">{copy.columns.customer}: </span>
                                <span className="font-bold">{editPayment.customer?.name}</span>
                                <span className="block text-xs text-gray-400">{editPayment.customer?.phone}</span>
                            </div>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.direction}</span>
                                <select
                                    value={editDirection}
                                    onChange={(e) => setEditDirection(e.target.value as PaymentDirection)}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                >
                                    <option value="receive">{copy.directionReceive}</option>
                                    <option value="pay">{copy.directionPay}</option>
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.amount}</span>
                                <input
                                    type="number"
                                    min={editDiscountApplies ? '0' : '0.01'}
                                    step="0.01"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                    required
                                />
                            </label>
                            {editDiscountApplies ? (
                                <PaymentDiscountField
                                    id="customer-payment-edit-discount"
                                    value={editDiscount}
                                    onChange={setEditDiscount}
                                    amount={editAmount}
                                    dueBefore={editDueBefore}
                                    labels={copy.discount}
                                />
                            ) : null}
                            <label className="block space-y-1">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.notes}</span>
                                <textarea
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    rows={2}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                />
                            </label>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" size="md" className="flex-1 justify-center" onClick={() => setEditPayment(null)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="md"
                                className="flex-1 justify-center"
                                icon={<Copy className="w-4 h-4" />}
                                onClick={() => openDuplicate(editPayment)}
                            >
                                {t.common.duplicate}
                            </Button>
                            <Button type="submit" variant="primary" size="md" className="flex-1 justify-center" loading={saving}>
                                {saving ? copy.saving : t.common.saveChanges}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}

export default function CustomerPaymentsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.customerPayments.loading}</div>}>
            <CustomerPaymentsContent />
        </Suspense>
    );
}