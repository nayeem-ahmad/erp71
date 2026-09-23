'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Loader2, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printCustomerPaymentReceipt } from '@/lib/customer-payment-receipt';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
    paymentMethodDisplayName,
    usePaymentMethodOptions,
    withRecordedMethod,
} from '@/lib/hooks/usePaymentMethodOptions';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, Textarea, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import PaymentMethodField from '@/components/document-entry/PaymentMethodField';

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
    balance_after?: string | number;
    notes?: string | null;
    payment_method?: string | null;
    created_at: string;
    customer?: { id: string; name: string; phone: string; customer_code?: string } | null;
    creator?: { id: string; name: string } | null;
    voucher_id?: string | null;
    accounting_voucher_number?: string | null;
}

interface FormErrors {
    customer?: string;
    amount?: string;
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

function CustomerPaymentsContent() {
    const { t, locale } = useI18n();
    const copy = t.customerPayments;
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('MONEY_RECEIPT');
    const searchParams = useSearchParams();
    const preselectedCustomerId = searchParams.get('customerId');
    const { options: methodOptions, defaultMethod, accountIdFor } = usePaymentMethodOptions();

    const [payments, setPayments] = useState<CustomerCreditPayment[]>([]);
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [customerFilter, setCustomerFilter] = useState(preselectedCustomerId ?? '');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);

    const [formCustomerId, setFormCustomerId] = useState('');
    const [formDirection, setFormDirection] = useState<PaymentDirection>('receive');
    const [formAmount, setFormAmount] = useState('');
    const [formNotes, setFormNotes] = useState('');
    // Empty means "the default method" (Cash), resolved at render and submit
    // time so a form opened before the tenant's methods load still picks it.
    const [formMethod, setFormMethod] = useState('');
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    // Set when the create form was opened as a copy of an existing payment;
    // names the source in the modal so a duplicate is never mistaken for it.
    const [duplicatedFrom, setDuplicatedFrom] = useState('');

    const [viewPayment, setViewPayment] = useState<CustomerCreditPayment | null>(null);
    const [editPayment, setEditPayment] = useState<CustomerCreditPayment | null>(null);
    const [editDirection, setEditDirection] = useState<PaymentDirection>('receive');
    const [editAmount, setEditAmount] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editMethod, setEditMethod] = useState('');
    const [editAmountError, setEditAmountError] = useState('');

    const methodName = (name?: string | null) => (name ? paymentMethodDisplayName(name, copy.methodTypes) : '—');

    const loadData = async () => {
        setLoading(true);
        try {
            const [paymentsData, customersData] = await Promise.all([
                api.getCustomerCreditPayments({
                    from: applyCreatedRangeQuery(createdRange).createdFrom,
                    to: applyCreatedRangeQuery(createdRange).createdTo,
                    customerId: customerFilter || undefined,
                }),
                api.getCustomers(),
            ]);
            setPayments((Array.isArray(paymentsData) ? paymentsData : []) as CustomerCreditPayment[]);
            setCustomers(customersData ?? []);
        } catch (error) {
            console.error('Failed to load customer payments', error);
            toast.error(copy.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createdRange, customerFilter]);

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
        setFormNotes('');
        setFormMethod('');
        setFormErrors({});
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
        setFormNotes(payment.notes ?? '');
        setFormMethod(payment.payment_method ?? '');
        setFormErrors({});
        setDuplicatedFrom(payment.payment_number ?? '');
        setShowForm(true);
    };

    const selectedFormCustomer = customers.find((c) => c.id === formCustomerId) ?? null;
    const dueBalance = selectedFormCustomer ? Number(selectedFormCustomer.due_balance ?? 0) : 0;

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = Number(formAmount);
        const errors: FormErrors = {};
        if (!formCustomerId) errors.customer = copy.customerRequired;
        if (!formAmount || Number.isNaN(amt) || amt <= 0) errors.amount = copy.invalidAmount;
        setFormErrors(errors);
        if (errors.customer || errors.amount) return;

        const method = formMethod || defaultMethod;
        setSaving(true);
        try {
            await api.recordCreditPayment(formCustomerId, {
                amount: amt,
                direction: formDirection,
                notes: formNotes.trim() || undefined,
                paymentMethod: method,
                accountId: accountIdFor(method),
            });
            toast.success(copy.paymentSaved);
            setShowForm(false);
            resetForm();
            await loadData();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (payment: CustomerCreditPayment) => {
        setEditPayment(payment);
        setEditDirection(directionFromType(payment.type));
        setEditAmount(String(payment.amount));
        setEditNotes(payment.notes ?? '');
        setEditMethod(payment.payment_method ?? '');
        setEditAmountError('');
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editPayment) return;
        const amt = Number(editAmount);
        if (Number.isNaN(amt) || amt <= 0) {
            setEditAmountError(copy.invalidAmount);
            return;
        }
        setEditAmountError('');
        // Only send a method the operator actually changed: left alone, the
        // payment keeps the method — and the account — it was recorded with,
        // even if the tenant has since renamed or retired that method.
        const method = editMethod || defaultMethod;
        const methodChanged = method !== (editPayment.payment_method ?? defaultMethod);
        setSaving(true);
        try {
            await api.updateCustomerCreditPayment(editPayment.id, {
                amount: amt,
                direction: editDirection,
                notes: editNotes.trim() || undefined,
                ...(methodChanged ? { paymentMethod: method, accountId: accountIdFor(method) } : {}),
            });
            toast.success(copy.paymentUpdated);
            setEditPayment(null);
            await loadData();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (payment: CustomerCreditPayment) => {
        if (!globalThis.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteCustomerCreditPayment(payment.id);
            toast.success(copy.paymentDeleted);
            if (viewPayment?.id === payment.id) setViewPayment(null);
            if (editPayment?.id === payment.id) setEditPayment(null);
            await loadData();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : copy.deleteFailed);
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
            balanceAfter: payment.balance_after !== undefined ? Number(payment.balance_after) : undefined,
            notes: payment.notes ?? undefined,
            recordedBy: payment.creator?.name,
            voucherNumber: payment.accounting_voucher_number,
            paymentMethod: payment.payment_method
                ? paymentMethodDisplayName(payment.payment_method, copy.methodTypes)
                : undefined,
            labels: {
                moneyReceipt: copy.print.moneyReceipt,
                paymentVoucher: copy.print.paymentVoucher,
                serial: copy.columns.serial,
                date: copy.columns.dateTime,
                customer: copy.columns.customer,
                amount: copy.columns.amount,
                balanceAfter: copy.balanceAfter,
                notes: copy.columns.notes,
                recordedBy: copy.columns.recordedBy,
                voucher: copy.voucherNumber,
                method: copy.paymentMethod,
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
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
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
            columnHelper.accessor((row) => methodName(row.payment_method), {
                id: 'method',
                header: copy.columns.method,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.creator?.name ?? '—', {
                id: 'recordedBy',
                header: copy.columns.recordedBy,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('amount', {
                header: copy.columns.amount,
                cell: (info) => {
                    const isPayout = info.row.original.type === 'PAYOUT';
                    return (
                        <span className={`text-sm font-bold ${isPayout ? 'text-danger' : 'text-emerald-600'}`}>
                            {isPayout ? '−' : '+'}{formatBDT(Number(info.getValue()))}
                        </span>
                    );
                },
                sortingFn: (a, b) => Number(a.getValue('amount')) - Number(b.getValue('amount')),
                size: 120,
            }),
            columnHelper.accessor('notes', {
                header: copy.columns.notes,
                cell: (info) => <span className="text-sm text-gray-500 line-clamp-2">{info.getValue() || '—'}</span>,
                size: 160,
                meta: { hideOnMobile: true },
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
                                className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 max-md:min-h-touch"
                                title={t.common.view}
                            >
                                <Eye className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => openEdit(payment)}
                                className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 max-md:min-h-touch"
                                title={t.common.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => openDuplicate(payment)}
                                className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 max-md:min-h-touch"
                                title={t.common.duplicate}
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => handlePrint(payment)}
                                className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 max-md:min-h-touch"
                                title={isPayout ? copy.printVoucher : copy.printReceipt}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDelete(payment)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-danger hover:bg-red-50 max-md:min-h-touch"
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                            <Wallet className="w-6 h-6 text-blue-600" />
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
                        <Button
                            type="button"
                            size="md"
                            icon={<Plus className="w-4 h-4" />}
                            onClick={() => { resetForm(); setShowForm(true); }}
                        >
                            {copy.newPayment}
                        </Button>
                    }
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <p className="text-xs font-medium text-gray-500">{copy.periodTotal}</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{formatBDT(totalAmount)}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatMessage(copy.paymentCount, { count: payments.length })}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 sm:col-span-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1 sm:col-span-2">
                                <span className="text-xs font-medium text-gray-500">{t.common.createdAt}</span>
                                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
                            </div>
                            <Field label={copy.filterCustomer} htmlFor="customer-payments-filter">
                                <Select
                                    id="customer-payments-filter"
                                    value={customerFilter}
                                    onChange={(e) => setCustomerFilter(e.target.value)}
                                >
                                    <option value="">{copy.allCustomers}</option>
                                    {customers.map((customer) => (
                                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                                    ))}
                                </Select>
                            </Field>
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
                    <form onSubmit={handleCreate} noValidate className="flex flex-col overflow-hidden">
                        <ModalHeader
                            title={duplicatedFrom ? copy.duplicatePayment : copy.newPayment}
                            subtitle={duplicatedFrom || undefined}
                            onClose={() => setShowForm(false)}
                        />
                        <div className="p-4 space-y-3 overflow-y-auto">
                            {duplicatedFrom ? (
                                <Alert tone="info">
                                    {copy.duplicateNotice.replace('{paymentNumber}', duplicatedFrom)}
                                </Alert>
                            ) : null}
                            {customers.length === 0 ? (
                                <Alert tone="warning">{copy.noCustomers}</Alert>
                            ) : (
                                <>
                                    <Field label={copy.direction} htmlFor="customer-payment-direction">
                                        <Select
                                            id="customer-payment-direction"
                                            value={formDirection}
                                            onChange={(e) => setFormDirection(e.target.value as PaymentDirection)}
                                        >
                                            <option value="receive">{copy.directionReceive}</option>
                                            <option value="pay">{copy.directionPay}</option>
                                        </Select>
                                    </Field>
                                    <Field
                                        label={copy.selectCustomer}
                                        htmlFor="customer-payment-customer"
                                        required
                                        error={formErrors.customer}
                                    >
                                        <Select
                                            id="customer-payment-customer"
                                            value={formCustomerId}
                                            onChange={(e) => {
                                                setFormCustomerId(e.target.value);
                                                setFormErrors((prev) => ({ ...prev, customer: undefined }));
                                            }}
                                            error={!!formErrors.customer}
                                        >
                                            <option value="">{copy.pickCustomerOption}</option>
                                            {customers.map((customer) => (
                                                <option key={customer.id} value={customer.id}>
                                                    {customer.name} ({customer.phone})
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    {selectedFormCustomer ? (
                                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                            <span className="text-gray-600">
                                                {dueBalance < 0 ? copy.advanceBalance : copy.dueBalance}:{' '}
                                            </span>
                                            <span className={`font-bold ${dueBalance > 0 ? 'text-danger' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                                {formatBDT(Math.abs(dueBalance))}
                                            </span>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {formDirection === 'receive' ? copy.receiveHint : copy.payHint}
                                            </p>
                                        </div>
                                    ) : null}
                                    <Field label={copy.amount} htmlFor="customer-payment-amount" required error={formErrors.amount}>
                                        <Input
                                            id="customer-payment-amount"
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={formAmount}
                                            onChange={(e) => {
                                                setFormAmount(e.target.value);
                                                setFormErrors((prev) => ({ ...prev, amount: undefined }));
                                            }}
                                            placeholder={copy.amountPlaceholder}
                                            error={!!formErrors.amount}
                                        />
                                    </Field>
                                    <PaymentMethodField
                                        id="customer-payment-method"
                                        label={copy.paymentMethod}
                                        hint={copy.paymentMethodHint}
                                        value={formMethod || defaultMethod}
                                        onChange={setFormMethod}
                                        options={withRecordedMethod(methodOptions, formMethod)}
                                        typeLabels={copy.methodTypes}
                                    />
                                    <Field label={copy.notes} htmlFor="customer-payment-notes">
                                        <Textarea
                                            id="customer-payment-notes"
                                            value={formNotes}
                                            onChange={(e) => setFormNotes(e.target.value)}
                                            rows={2}
                                            placeholder={copy.notesPlaceholder}
                                        />
                                    </Field>
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
                        <div className="p-4 space-y-3 text-sm">
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
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.paymentMethod}</span>
                                <span className="font-medium">{methodName(viewPayment.payment_method)}</span>
                            </div>
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
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.recordedBy}</span>
                                <span>{viewPayment.creator?.name ?? '—'}</span>
                            </div>
                            {viewPayment.notes && (
                                <div>
                                    <span className="text-gray-500 block mb-1">{copy.columns.notes}</span>
                                    <p className="text-gray-700 bg-gray-50 rounded-lg p-3">{viewPayment.notes}</p>
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
                    <form onSubmit={handleUpdate} noValidate className="flex flex-col overflow-hidden">
                        <ModalHeader
                            title={copy.editPayment}
                            subtitle={editPayment.payment_number}
                            onClose={() => setEditPayment(null)}
                        />
                        <div className="p-4 space-y-3 overflow-y-auto">
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                <span className="text-gray-500">{copy.columns.customer}: </span>
                                <span className="font-bold">{editPayment.customer?.name}</span>
                                <span className="block text-xs text-gray-400">{editPayment.customer?.phone}</span>
                            </div>
                            <Field label={copy.direction} htmlFor="customer-payment-edit-direction">
                                <Select
                                    id="customer-payment-edit-direction"
                                    value={editDirection}
                                    onChange={(e) => setEditDirection(e.target.value as PaymentDirection)}
                                >
                                    <option value="receive">{copy.directionReceive}</option>
                                    <option value="pay">{copy.directionPay}</option>
                                </Select>
                            </Field>
                            <Field label={copy.amount} htmlFor="customer-payment-edit-amount" required error={editAmountError || undefined}>
                                <Input
                                    id="customer-payment-edit-amount"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={editAmount}
                                    onChange={(e) => { setEditAmount(e.target.value); setEditAmountError(''); }}
                                    error={!!editAmountError}
                                />
                            </Field>
                            <PaymentMethodField
                                id="customer-payment-edit-method"
                                label={copy.paymentMethod}
                                hint={copy.paymentMethodHint}
                                value={editMethod || defaultMethod}
                                onChange={setEditMethod}
                                options={withRecordedMethod(methodOptions, editPayment.payment_method)}
                                typeLabels={copy.methodTypes}
                            />
                            <Field label={copy.notes} htmlFor="customer-payment-edit-notes">
                                <Textarea
                                    id="customer-payment-edit-notes"
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    rows={2}
                                />
                            </Field>
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
