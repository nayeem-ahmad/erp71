'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Eye, Loader2, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { printCustomerPaymentReceipt } from '@/lib/customer-payment-receipt';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';

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
    created_at: string;
    customer?: { id: string; name: string; phone: string; customer_code?: string } | null;
    creator?: { id: string; name: string } | null;
    voucher_id?: string | null;
    accounting_voucher_number?: string | null;
}

const columnHelper = createColumnHelper<CustomerCreditPayment>();

function defaultFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

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
    const searchParams = useSearchParams();
    const preselectedCustomerId = searchParams.get('customerId');

    const [payments, setPayments] = useState<CustomerCreditPayment[]>([]);
    const [customers, setCustomers] = useState<CustomerOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [customerFilter, setCustomerFilter] = useState(preselectedCustomerId ?? '');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [formCustomerId, setFormCustomerId] = useState('');
    const [formDirection, setFormDirection] = useState<PaymentDirection>('receive');
    const [formAmount, setFormAmount] = useState('');
    const [formNotes, setFormNotes] = useState('');

    const [viewPayment, setViewPayment] = useState<CustomerCreditPayment | null>(null);
    const [editPayment, setEditPayment] = useState<CustomerCreditPayment | null>(null);
    const [editDirection, setEditDirection] = useState<PaymentDirection>('receive');
    const [editAmount, setEditAmount] = useState('');
    const [editNotes, setEditNotes] = useState('');

    const loadData = async () => {
        setLoading(true);
        try {
            const [paymentsData, customersData] = await Promise.all([
                api.getCustomerCreditPayments({
                    from: fromDate || undefined,
                    to: toDate || undefined,
                    customerId: customerFilter || undefined,
                    limit: 100,
                }),
                api.getCustomers({ limit: 200 }),
            ]);
            setPayments((Array.isArray(paymentsData) ? paymentsData : []) as CustomerCreditPayment[]);
            setCustomers(Array.isArray(customersData) ? customersData : (customersData?.items ?? []));
        } catch (error) {
            console.error('Failed to load customer payments', error);
            setToast({ type: 'error', message: copy.loadFailed });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, customerFilter]);

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
    };

    const selectedFormCustomer = customers.find((c) => c.id === formCustomerId) ?? null;
    const dueBalance = selectedFormCustomer ? Number(selectedFormCustomer.due_balance ?? 0) : 0;

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formCustomerId || !formAmount) {
            setToast({ type: 'error', message: copy.requiredFields });
            return;
        }
        const amt = Number(formAmount);
        if (Number.isNaN(amt) || amt <= 0) {
            setToast({ type: 'error', message: copy.invalidAmount });
            return;
        }
        setSaving(true);
        try {
            await api.recordCreditPayment(formCustomerId, {
                amount: amt,
                direction: formDirection,
                notes: formNotes.trim() || undefined,
            });
            setToast({ type: 'success', message: copy.paymentSaved });
            setShowForm(false);
            resetForm();
            await loadData();
        } catch (error: unknown) {
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
        setEditNotes(payment.notes ?? '');
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editPayment) return;
        const amt = Number(editAmount);
        if (Number.isNaN(amt) || amt <= 0) {
            setToast({ type: 'error', message: copy.invalidAmount });
            return;
        }
        setSaving(true);
        try {
            await api.updateCustomerCreditPayment(editPayment.id, {
                amount: amt,
                direction: editDirection,
                notes: editNotes.trim() || undefined,
            });
            setToast({ type: 'success', message: copy.paymentUpdated });
            setEditPayment(null);
            await loadData();
        } catch (error: unknown) {
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
            await loadData();
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
                receiveTitle: copy.print.receiveTitle,
                payTitle: copy.print.payTitle,
                footer: copy.print.footer,
            },
        });
    }, [businessName, copy, locale]);

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
                        <span className={`text-[10px] font-black uppercase tracking-widest ${isPayout ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {isPayout ? copy.directionPay : copy.directionReceive}
                        </span>
                    );
                },
                size: 110,
            }),
            columnHelper.accessor('created_at', {
                header: copy.columns.dateTime,
                cell: (info) => (
                    <span className="text-sm text-gray-700">{formatDateTime(info.getValue(), locale)}</span>
                ),
                sortingFn: 'datetime',
                size: 150,
            }),
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
                    return (
                        <span className={`text-sm font-black ${isPayout ? 'text-rose-600' : 'text-emerald-600'}`}>
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
                                onClick={() => handlePrint(payment)}
                                className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-50"
                                title={isPayout ? copy.printVoucher : copy.printReceipt}
                            >
                                <Printer className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleDelete(payment)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                                title={t.common.delete}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                size: 130,
            }),
        ],
        [copy, locale, t.common, handlePrint],
    );

    const totalAmount = payments.reduce((sum, p) => {
        const amt = Number(p.amount || 0);
        return sum + (p.type === 'PAYOUT' ? -amt : amt);
    }, 0);

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950 inline-flex items-center gap-2">
                            <Wallet className="w-7 h-7 text-purple-600" />
                            {copy.title}
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {copy.subtitle}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { resetForm(); setShowForm(true); }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#293F75] text-white text-sm font-black hover:bg-[#1f3058]"
                    >
                        <Plus className="w-4 h-4" />
                        {copy.newPayment}
                    </button>
                </div>

                {toast && (
                    <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {toast.message}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                        <p className="text-xs font-medium text-gray-500">{copy.periodTotal}</p>
                        <p className="text-2xl font-black text-emerald-600 mt-1">{formatBDT(totalAmount)}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatMessage(copy.paymentCount, { count: payments.length })}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 sm:col-span-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">{copy.dateFrom}</span>
                                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">{copy.dateTo}</span>
                                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500">{copy.filterCustomer}</span>
                                <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                                    <option value="">{copy.allCustomers}</option>
                                    {customers.map((customer) => (
                                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
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
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleCreate} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">{copy.newPayment}</h2>
                        </div>
                        <div className="p-6 space-y-4">
                            {customers.length === 0 ? (
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
                                    <label className="block space-y-1">
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{copy.selectCustomer}</span>
                                        <select
                                            value={formCustomerId}
                                            onChange={(e) => setFormCustomerId(e.target.value)}
                                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                            required
                                        >
                                            <option value="">{copy.pickCustomerOption}</option>
                                            {customers.map((customer) => (
                                                <option key={customer.id} value={customer.id}>
                                                    {customer.name} ({customer.phone})
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {selectedFormCustomer ? (
                                        <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-3 text-sm">
                                            <span className="text-gray-600">
                                                {dueBalance < 0 ? copy.advanceBalance : copy.dueBalance}:{' '}
                                            </span>
                                            <span className={`font-black ${dueBalance > 0 ? 'text-rose-600' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
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
                                            min="0.01"
                                            step="0.01"
                                            value={formAmount}
                                            onChange={(e) => setFormAmount(e.target.value)}
                                            placeholder={copy.amountPlaceholder}
                                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                            required
                                        />
                                    </label>
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
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.cancel}
                            </button>
                            <button
                                type="submit"
                                disabled={saving || customers.length === 0}
                                className="flex-1 py-3 rounded-2xl font-black bg-[#293F75] text-white hover:bg-[#1f3058] disabled:opacity-50"
                            >
                                {saving ? copy.saving : (formDirection === 'pay' ? copy.confirmPayout : copy.confirmPayment)}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {viewPayment && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="text-xl font-black">{copy.viewPayment}</h2>
                            <span className="text-xs font-mono font-bold text-gray-500">{viewPayment.payment_number}</span>
                        </div>
                        <div className="p-6 space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.direction}</span>
                                <span className={`font-bold ${viewPayment.type === 'PAYOUT' ? 'text-rose-600' : 'text-emerald-700'}`}>
                                    {viewPayment.type === 'PAYOUT' ? copy.directionPay : copy.directionReceive}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.dateTime}</span>
                                <span className="font-medium">{formatDateTime(viewPayment.created_at, locale)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.customer}</span>
                                <span className="font-bold text-right">
                                    {viewPayment.customer?.name}
                                    <span className="block text-xs text-gray-400 font-normal">{viewPayment.customer?.phone}</span>
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.amount}</span>
                                <span className={`font-black ${viewPayment.type === 'PAYOUT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {formatBDT(Number(viewPayment.amount))}
                                </span>
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
                                    <p className="text-gray-700 bg-gray-50 rounded-xl p-3">{viewPayment.notes}</p>
                                </div>
                            )}
                        </div>
                        <div className="p-6 border-t border-gray-100 flex gap-2">
                            <button
                                type="button"
                                onClick={() => handlePrint(viewPayment)}
                                className="flex-1 py-3 rounded-2xl font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 inline-flex items-center justify-center gap-2"
                            >
                                <Printer className="w-4 h-4" />
                                {viewPayment.type === 'PAYOUT' ? copy.printVoucher : copy.printReceipt}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setViewPayment(null); openEdit(viewPayment); }}
                                className="flex-1 py-3 rounded-2xl font-bold text-amber-700 bg-amber-50 hover:bg-amber-100"
                            >
                                {t.common.edit}
                            </button>
                            <button type="button" onClick={() => setViewPayment(null)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.close}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editPayment && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <form onSubmit={handleUpdate} className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-black">{copy.editPayment}</h2>
                            <p className="text-xs text-gray-400 mt-1 font-mono">{editPayment.payment_number}</p>
                        </div>
                        <div className="p-6 space-y-4">
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
                                    min="0.01"
                                    step="0.01"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm"
                                    required
                                />
                            </label>
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
                        <div className="p-6 border-t border-gray-100 flex gap-3">
                            <button type="button" onClick={() => setEditPayment(null)} className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-50">
                                {t.common.cancel}
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex-1 py-3 rounded-2xl font-black bg-[#293F75] text-white hover:bg-[#1f3058] disabled:opacity-50"
                            >
                                {saving ? copy.saving : t.common.saveChanges}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
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