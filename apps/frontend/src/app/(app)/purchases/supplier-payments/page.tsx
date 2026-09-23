'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Link2, Loader2, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { usePrintHeader } from '@/lib/print/use-print-header';
import { printSupplierPaymentReceipt } from '@/lib/supplier-payment-receipt';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
    paymentMethodDisplayName,
    usePaymentMethodOptions,
    withRecordedMethod,
} from '@/lib/hooks/usePaymentMethodOptions';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import PaymentMethodField from '@/components/document-entry/PaymentMethodField';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface SupplierOption {
    id: string;
    name: string;
    phone?: string | null;
    due_balance?: number | string;
}

type PaymentDirection = 'pay' | 'receive';

interface SupplierCreditPayment {
    id: string;
    type?: string;
    payment_number?: string | null;
    amount: string | number;
    balance_after?: string | number;
    notes?: string | null;
    payment_method?: string | null;
    created_at: string;
    supplier?: { id: string; name: string; phone?: string | null } | null;
    creator?: { id: string; name: string } | null;
    voucher_id?: string | null;
    accounting_voucher_number?: string | null;
    unapplied_amount?: number;
}

interface OpenBill {
    id: string;
    purchase_number: string;
    total_amount: number;
    paid_amount: number;
    balance_due: number;
    payment_status: string;
}

interface FormErrors {
    supplier?: string;
    amount?: string;
    allocation?: string;
}

const columnHelper = createColumnHelper<SupplierCreditPayment>();

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
    return type === 'PAYOUT' ? 'receive' : 'pay';
}

function SupplierPaymentsContent() {
    const { t, locale } = useI18n();
    const copy = t.supplierPayments;
    const { businessName } = useBranding();
    const printHeader = usePrintHeader('MONEY_RECEIPT');
    const searchParams = useSearchParams();
    const preselectedSupplierId = searchParams.get('supplierId');
    const { options: methodOptions, defaultMethod, accountIdFor } = usePaymentMethodOptions();

    const [payments, setPayments] = useState<SupplierCreditPayment[]>([]);
    const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [supplierFilter, setSupplierFilter] = useState(preselectedSupplierId ?? '');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);

    const [formSupplierId, setFormSupplierId] = useState('');
    const [formDirection, setFormDirection] = useState<PaymentDirection>('pay');
    const [formAmount, setFormAmount] = useState('');
    const [formNotes, setFormNotes] = useState('');
    // Empty means "the default method" (Cash), resolved at render and submit
    // time so a form opened before the tenant's methods load still picks it.
    const [formMethod, setFormMethod] = useState('');
    const [formErrors, setFormErrors] = useState<FormErrors>({});
    const [openBills, setOpenBills] = useState<OpenBill[]>([]);
    const [billAllocations, setBillAllocations] = useState<Record<string, string>>({});
    // Set when the create form was opened as a copy of an existing payment;
    // names the source in the modal so a duplicate is never mistaken for it.
    const [duplicatedFrom, setDuplicatedFrom] = useState('');

    const [allocatingPayment, setAllocatingPayment] = useState<SupplierCreditPayment | null>(null);
    const [allocateBills, setAllocateBills] = useState<OpenBill[]>([]);
    const [allocateAmounts, setAllocateAmounts] = useState<Record<string, string>>({});
    const [allocating, setAllocating] = useState(false);
    const [allocateError, setAllocateError] = useState('');

    const [viewPayment, setViewPayment] = useState<SupplierCreditPayment | null>(null);
    const [editPayment, setEditPayment] = useState<SupplierCreditPayment | null>(null);
    const [editDirection, setEditDirection] = useState<PaymentDirection>('pay');
    const [editAmount, setEditAmount] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editMethod, setEditMethod] = useState('');
    const [editAmountError, setEditAmountError] = useState('');

    const methodName = (name?: string | null) => (name ? paymentMethodDisplayName(name, copy.methodTypes) : '—');

    const loadData = async () => {
        setLoading(true);
        try {
            const [paymentsData, suppliersData] = await Promise.all([
                api.getSupplierCreditPayments({
                    from: applyCreatedRangeQuery(createdRange).createdFrom,
                    to: applyCreatedRangeQuery(createdRange).createdTo,
                    supplierId: supplierFilter || undefined,
                }),
                api.getSuppliers(),
            ]);
            setPayments((Array.isArray(paymentsData) ? paymentsData : []) as SupplierCreditPayment[]);
            setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
        } catch (error) {
            console.error('Failed to load supplier payments', error);
            toast.error(copy.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createdRange, supplierFilter]);

    useEffect(() => {
        if (preselectedSupplierId) {
            setSupplierFilter(preselectedSupplierId);
            setFormSupplierId(preselectedSupplierId);
        }
    }, [preselectedSupplierId]);

    useEffect(() => {
        if (searchParams.get('new') === '1') {
            setShowForm(true);
        }
    }, [searchParams]);

    const resetForm = () => {
        const initialSupplierId = preselectedSupplierId ?? suppliers[0]?.id ?? '';
        setFormSupplierId(initialSupplierId);
        setFormDirection('pay');
        setFormAmount('');
        setFormNotes('');
        setFormMethod('');
        setFormErrors({});
        setBillAllocations({});
        setDuplicatedFrom('');
    };

    /**
     * Open the create form prefilled from an existing payment. Bill allocations
     * are deliberately left empty: they point at specific open bills that the
     * original already settled, so the copy picks its own from a fresh list.
     */
    const openDuplicate = (payment: SupplierCreditPayment) => {
        setViewPayment(null);
        setEditPayment(null);
        setFormSupplierId(payment.supplier?.id ?? '');
        setFormDirection(directionFromType(payment.type));
        setFormAmount(String(payment.amount));
        setFormNotes(payment.notes ?? '');
        setFormMethod(payment.payment_method ?? '');
        setFormErrors({});
        setBillAllocations({});
        setDuplicatedFrom(payment.payment_number ?? '');
        setShowForm(true);
    };

    const selectedFormSupplier = suppliers.find((s) => s.id === formSupplierId) ?? null;
    const dueBalance = selectedFormSupplier ? Number(selectedFormSupplier.due_balance ?? 0) : 0;

    useEffect(() => {
        if (!showForm || formDirection !== 'pay' || !formSupplierId) {
            setOpenBills([]);
            return;
        }
        let cancelled = false;
        api.getSupplierBillingSummary(formSupplierId)
            .then((data: any) => { if (!cancelled) setOpenBills(data?.open_bills ?? []); })
            .catch(() => { if (!cancelled) setOpenBills([]); });
        return () => { cancelled = true; };
    }, [showForm, formDirection, formSupplierId]);

    const totalBillAllocated = Object.values(billAllocations).reduce((sum, v) => sum + (Number(v) || 0), 0);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = Number(formAmount);
        const errors: FormErrors = {};
        if (!formSupplierId) errors.supplier = copy.supplierRequired;
        if (!formAmount || Number.isNaN(amt) || amt <= 0) errors.amount = copy.invalidAmount;
        else if (totalBillAllocated - amt > 0.005) errors.allocation = copy.allocation.exceedsAmount;
        setFormErrors(errors);
        if (errors.supplier || errors.amount || errors.allocation) return;
        const method = formMethod || defaultMethod;
        const allocations = Object.entries(billAllocations)
            .map(([purchaseId, value]) => ({ purchaseId, amount: Number(value) || 0 }))
            .filter((a) => a.amount > 0);
        setSaving(true);
        try {
            await api.recordSupplierCreditPayment(formSupplierId, {
                amount: amt,
                direction: formDirection,
                notes: formNotes.trim() || undefined,
                paymentMethod: method,
                accountId: accountIdFor(method),
                allocations: allocations.length > 0 ? allocations : undefined,
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

    const openEdit = (payment: SupplierCreditPayment) => {
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
            await api.updateSupplierCreditPayment(editPayment.id, {
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

    const handleDelete = async (payment: SupplierCreditPayment) => {
        if (!globalThis.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteSupplierCreditPayment(payment.id);
            toast.success(copy.paymentDeleted);
            if (viewPayment?.id === payment.id) setViewPayment(null);
            if (editPayment?.id === payment.id) setEditPayment(null);
            await loadData();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : copy.deleteFailed);
        }
    };

    const openAllocateModal = async (payment: SupplierCreditPayment) => {
        setAllocatingPayment(payment);
        setAllocateAmounts({});
        setAllocateError('');
        try {
            const data: any = await api.getSupplierBillingSummary(payment.supplier?.id ?? '');
            setAllocateBills(data?.open_bills ?? []);
        } catch {
            setAllocateBills([]);
        }
    };

    const handleAllocateSubmit = async () => {
        if (!allocatingPayment) return;
        const allocations = Object.entries(allocateAmounts)
            .map(([purchaseId, value]) => ({ purchaseId, amount: Number(value) || 0 }))
            .filter((a) => a.amount > 0);
        if (allocations.length === 0) {
            setAllocateError(copy.allocation.exceedsAmount);
            return;
        }
        setAllocating(true);
        setAllocateError('');
        try {
            await api.allocateSupplierPayment(allocatingPayment.id, allocations);
            toast.success(copy.allocation.allocateSuccess);
            setAllocatingPayment(null);
            await loadData();
        } catch (error: unknown) {
            setAllocateError(error instanceof Error ? error.message : copy.allocation.allocateFailed);
        } finally {
            setAllocating(false);
        }
    };

    const handlePrint = useCallback((payment: SupplierCreditPayment) => {
        const direction = directionFromType(payment.type);
        printSupplierPaymentReceipt({
            businessName: businessName ?? undefined,
            headerConfig: printHeader.headerConfig,
            paymentNumber: payment.payment_number ?? payment.id,
            date: formatDateTime(payment.created_at, locale),
            direction,
            supplierName: payment.supplier?.name ?? '—',
            supplierPhone: payment.supplier?.phone ?? undefined,
            amount: Number(payment.amount),
            balanceAfter: payment.balance_after !== undefined ? Number(payment.balance_after) : undefined,
            notes: payment.notes ?? undefined,
            recordedBy: payment.creator?.name,
            paymentMethod: payment.payment_method
                ? paymentMethodDisplayName(payment.payment_method, copy.methodTypes)
                : undefined,
            labels: {
                moneyReceipt: copy.print.moneyReceipt,
                paymentVoucher: copy.print.paymentVoucher,
                serial: copy.columns.serial,
                date: copy.columns.dateTime,
                supplier: copy.columns.supplier,
                amount: copy.columns.amount,
                balanceAfter: copy.balanceAfter,
                notes: copy.columns.notes,
                recordedBy: copy.columns.recordedBy,
                method: copy.paymentMethod,
                receiveTitle: copy.print.receiveTitle,
                payTitle: copy.print.payTitle,
                footer: copy.print.footer,
            },
        });
    }, [businessName, printHeader, copy, locale]);

    const columns: ColumnDef<SupplierCreditPayment, unknown>[] = useMemo(
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
                    const isPayment = info.getValue() === 'PAYMENT';
                    return (
                        <span className={`text-[10px] font-semibold ${isPayment ? 'text-danger' : 'text-emerald-700'}`}>
                            {isPayment ? copy.directionPay : copy.directionReceive}
                        </span>
                    );
                },
                size: 110,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale }),
            columnHelper.accessor((row) => row.supplier?.name ?? '—', {
                id: 'supplier',
                header: copy.columns.supplier,
                cell: (info) => {
                    const supplier = info.row.original.supplier;
                    return (
                        <div>
                            <span className="block text-sm font-bold text-gray-800">{supplier?.name ?? '—'}</span>
                            <span className="block text-xs text-gray-400">{supplier?.phone ?? ''}</span>
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
                    const isPayment = info.row.original.type === 'PAYMENT';
                    return (
                        <span className={`text-sm font-bold ${isPayment ? 'text-danger' : 'text-emerald-600'}`}>
                            {isPayment ? '−' : '+'}{formatBDT(Number(info.getValue()))}
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
                    const isPayment = payment.type === 'PAYMENT';
                    const hasUnapplied = isPayment && (payment.unapplied_amount ?? 0) > 0.005;
                    return (
                        <div className="flex items-center gap-0.5">
                            {hasUnapplied && (
                                <button
                                    type="button"
                                    onClick={() => void openAllocateModal(payment)}
                                    className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 max-md:min-h-touch"
                                    title={copy.allocation.allocateAction}
                                >
                                    <Link2 className="w-4 h-4" />
                                </button>
                            )}
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
                                title={isPayment ? copy.printVoucher : copy.printReceipt}
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
        [copy, locale, t.common, handlePrint, openAllocateModal],
    );

    const totalAmount = payments.reduce((sum, p) => {
        const amt = Number(p.amount || 0);
        return sum + (p.type === 'PAYMENT' ? -amt : amt);
    }, 0);

    return (
        <PageShell>
                <PageHeader
                    title={copy.title}
                    subtitle={copy.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.purchase,
                        copy.title,
                        'purchases',
                    )}
                    actions={(
                        <Button
                            type="button"
                            size="md"
                            icon={<Plus className="w-4 h-4" />}
                            onClick={() => { resetForm(); setShowForm(true); }}
                        >
                            {copy.newPayment}
                        </Button>
                    )}
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
                            <Field label={copy.filterSupplier} htmlFor="supplier-payments-filter">
                                <Select
                                    id="supplier-payments-filter"
                                    value={supplierFilter}
                                    onChange={(e) => setSupplierFilter(e.target.value)}
                                >
                                    <option value="">{copy.allSuppliers}</option>
                                    {suppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
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
                        tableId="supplier-payments"
                        title={copy.listTitle}
                        data={payments}
                        columns={columns}
                        searchPlaceholder={copy.searchPayments}
                        emptyMessage={copy.noPayments}
                    />
                )}

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleCreate} noValidate className="flex min-h-0 flex-1 flex-col">
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
                            {suppliers.length === 0 ? (
                                <Alert tone="warning">{copy.noSuppliers}</Alert>
                            ) : (
                                <>
                                    <Field label={copy.direction} htmlFor="supplier-payment-direction">
                                        <Select
                                            id="supplier-payment-direction"
                                            value={formDirection}
                                            onChange={(e) => setFormDirection(e.target.value as PaymentDirection)}
                                        >
                                            <option value="pay">{copy.directionPay}</option>
                                            <option value="receive">{copy.directionReceive}</option>
                                        </Select>
                                    </Field>
                                    <Field
                                        label={copy.selectSupplier}
                                        htmlFor="supplier-payment-supplier"
                                        required
                                        error={formErrors.supplier}
                                    >
                                        <Select
                                            id="supplier-payment-supplier"
                                            value={formSupplierId}
                                            onChange={(e) => {
                                                setFormSupplierId(e.target.value);
                                                setFormErrors((prev) => ({ ...prev, supplier: undefined }));
                                            }}
                                            error={!!formErrors.supplier}
                                        >
                                            <option value="">{copy.pickSupplierOption}</option>
                                            {suppliers.map((supplier) => (
                                                <option key={supplier.id} value={supplier.id}>
                                                    {supplier.name}{supplier.phone ? ` (${supplier.phone})` : ''}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    {selectedFormSupplier ? (
                                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                            <span className="text-gray-600">
                                                {dueBalance < 0 ? copy.advanceBalance : copy.dueBalance}:{' '}
                                            </span>
                                            <span className={`font-bold ${dueBalance > 0 ? 'text-danger' : dueBalance < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>
                                                {formatBDT(Math.abs(dueBalance))}
                                            </span>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {formDirection === 'pay' ? copy.payHint : copy.receiveHint}
                                            </p>
                                        </div>
                                    ) : null}
                                    <Field label={copy.amount} htmlFor="supplier-payment-amount" required error={formErrors.amount}>
                                        <Input
                                            id="supplier-payment-amount"
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={formAmount}
                                            onChange={(e) => {
                                                setFormAmount(e.target.value);
                                                setFormErrors((prev) => ({ ...prev, amount: undefined, allocation: undefined }));
                                            }}
                                            placeholder={copy.amountPlaceholder}
                                            error={!!formErrors.amount}
                                        />
                                    </Field>
                                    <PaymentMethodField
                                        id="supplier-payment-method"
                                        label={copy.paymentMethod}
                                        hint={copy.paymentMethodHint}
                                        value={formMethod || defaultMethod}
                                        onChange={setFormMethod}
                                        options={withRecordedMethod(methodOptions, formMethod)}
                                        typeLabels={copy.methodTypes}
                                    />
                                    <Field label={copy.notes} htmlFor="supplier-payment-notes">
                                        <Textarea
                                            id="supplier-payment-notes"
                                            value={formNotes}
                                            onChange={(e) => setFormNotes(e.target.value)}
                                            rows={2}
                                            placeholder={copy.notesPlaceholder}
                                        />
                                    </Field>
                                    {formDirection === 'pay' && openBills.length > 0 && (
                                        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                            <div>
                                                <p className="text-xs font-medium text-gray-600">{copy.allocation.sectionTitle}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">{copy.allocation.sectionHint}</p>
                                            </div>
                                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                                {openBills.map((bill) => (
                                                    <div key={bill.id} className="flex items-center justify-between gap-2 text-xs">
                                                        <span className="font-mono font-bold text-gray-700">{bill.purchase_number}</span>
                                                        <span className="text-gray-500">{formatBDT(bill.balance_due)}</span>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            max={bill.balance_due}
                                                            step="0.01"
                                                            value={billAllocations[bill.id] ?? ''}
                                                            onChange={(e) => {
                                                                setBillAllocations((prev) => ({ ...prev, [bill.id]: e.target.value }));
                                                                setFormErrors((prev) => ({ ...prev, allocation: undefined }));
                                                            }}
                                                            aria-label={`${copy.allocation.allocateColumn} ${bill.purchase_number}`}
                                                            className="w-24"
                                                            placeholder="0.00"
                                                            error={!!formErrors.allocation}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                            {formErrors.allocation ? (
                                                <p role="alert" className="text-xs text-danger">{formErrors.allocation}</p>
                                            ) : (
                                                <p className={`text-xs ${totalBillAllocated - (Number(formAmount) || 0) > 0.005 ? 'text-danger font-bold' : 'text-gray-400'}`}>
                                                    {formatMessage(copy.allocation.remainingToAllocate, {
                                                        amount: formatBDT(Math.max(0, (Number(formAmount) || 0) - totalBillAllocated)),
                                                    })}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                type="submit"
                                disabled={saving || suppliers.length === 0}
                                loading={saving}
                            >
                                {formDirection === 'pay' ? copy.confirmPayment : copy.confirmPayout}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            {allocatingPayment && (
                <ModalShell size="sm" onBackdropClick={() => setAllocatingPayment(null)}>
                    <ModalHeader
                        title={copy.allocation.allocateModalTitle}
                        subtitle={allocatingPayment.supplier?.name}
                        onClose={() => setAllocatingPayment(null)}
                    />
                    <div className="p-4 space-y-3 overflow-y-auto">
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm flex justify-between">
                                <span className="text-gray-600">{copy.allocation.unappliedAmount}</span>
                                <span className="font-bold text-gray-900">
                                    {formatBDT(allocatingPayment.unapplied_amount ?? 0)}
                                </span>
                            </div>
                            {allocateBills.length === 0 ? (
                                <p className="text-sm text-gray-500">{copy.allocation.noOpenBills}</p>
                            ) : (
                                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                                    {allocateBills.map((bill) => (
                                        <div key={bill.id} className="flex items-center justify-between gap-2 text-sm">
                                            <span className="font-mono font-bold text-gray-700">{bill.purchase_number}</span>
                                            <span className="text-gray-500 text-xs">{formatBDT(bill.balance_due)}</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                max={bill.balance_due}
                                                step="0.01"
                                                value={allocateAmounts[bill.id] ?? ''}
                                                onChange={(e) => setAllocateAmounts((prev) => ({ ...prev, [bill.id]: e.target.value }))}
                                                aria-label={`${copy.allocation.allocateColumn} ${bill.purchase_number}`}
                                                className="w-28"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            {allocateError && <Alert tone="danger">{allocateError}</Alert>}
                    </div>
                    <ModalFooter>
                        <Button type="button" variant="secondary" onClick={() => setAllocatingPayment(null)}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void handleAllocateSubmit()}
                            disabled={allocating || allocateBills.length === 0}
                            loading={allocating}
                        >
                            {copy.allocation.allocateSubmit}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {viewPayment && (
                <ModalShell size="sm" onBackdropClick={() => setViewPayment(null)}>
                    <ModalHeader
                        title={copy.viewPayment}
                        subtitle={viewPayment.payment_number}
                        onClose={() => setViewPayment(null)}
                    />
                    <div className="p-4 space-y-3 text-sm overflow-y-auto">
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.direction}</span>
                                <span className={`font-bold ${viewPayment.type === 'PAYMENT' ? 'text-danger' : 'text-emerald-700'}`}>
                                    {viewPayment.type === 'PAYMENT' ? copy.directionPay : copy.directionReceive}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.dateTime}</span>
                                <span className="font-medium">{formatDateTime(viewPayment.created_at, locale)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.supplier}</span>
                                <span className="font-bold text-end">
                                    {viewPayment.supplier?.name}
                                    <span className="block text-xs text-gray-400 font-normal">{viewPayment.supplier?.phone}</span>
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">{copy.columns.amount}</span>
                                <span className={`font-bold ${viewPayment.type === 'PAYMENT' ? 'text-danger' : 'text-emerald-600'}`}>
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
                            onClick={() => handlePrint(viewPayment)}
                            icon={<Printer className="w-4 h-4" />}
                        >
                            {viewPayment.type === 'PAYMENT' ? copy.printVoucher : copy.printReceipt}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => { setViewPayment(null); openEdit(viewPayment); }}
                        >
                            {t.common.edit}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            icon={<Copy className="w-4 h-4" />}
                            onClick={() => openDuplicate(viewPayment)}
                        >
                            {t.common.duplicate}
                        </Button>
                        <Button type="button" onClick={() => setViewPayment(null)}>
                            {t.common.close}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {editPayment && (
                <ModalShell size="sm" onBackdropClick={() => setEditPayment(null)}>
                    <form onSubmit={handleUpdate} noValidate className="flex min-h-0 flex-1 flex-col">
                        <ModalHeader
                            title={copy.editPayment}
                            subtitle={editPayment.payment_number}
                            onClose={() => setEditPayment(null)}
                        />
                        <div className="p-4 space-y-3 overflow-y-auto">
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                                <span className="text-gray-500">{copy.columns.supplier}: </span>
                                <span className="font-bold">{editPayment.supplier?.name}</span>
                                <span className="block text-xs text-gray-400">{editPayment.supplier?.phone}</span>
                            </div>
                            <Field label={copy.direction} htmlFor="supplier-payment-edit-direction">
                                <Select
                                    id="supplier-payment-edit-direction"
                                    value={editDirection}
                                    onChange={(e) => setEditDirection(e.target.value as PaymentDirection)}
                                >
                                    <option value="pay">{copy.directionPay}</option>
                                    <option value="receive">{copy.directionReceive}</option>
                                </Select>
                            </Field>
                            <Field label={copy.amount} htmlFor="supplier-payment-edit-amount" required error={editAmountError || undefined}>
                                <Input
                                    id="supplier-payment-edit-amount"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={editAmount}
                                    onChange={(e) => { setEditAmount(e.target.value); setEditAmountError(''); }}
                                    error={!!editAmountError}
                                />
                            </Field>
                            <PaymentMethodField
                                id="supplier-payment-edit-method"
                                label={copy.paymentMethod}
                                hint={copy.paymentMethodHint}
                                value={editMethod || defaultMethod}
                                onChange={setEditMethod}
                                options={withRecordedMethod(methodOptions, editPayment.payment_method)}
                                typeLabels={copy.methodTypes}
                            />
                            <Field label={copy.notes} htmlFor="supplier-payment-edit-notes">
                                <Textarea
                                    id="supplier-payment-edit-notes"
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    rows={2}
                                />
                            </Field>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="secondary" onClick={() => setEditPayment(null)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                icon={<Copy className="w-4 h-4" />}
                                onClick={() => openDuplicate(editPayment)}
                            >
                                {t.common.duplicate}
                            </Button>
                            <Button type="submit" disabled={saving} loading={saving}>
                                {t.common.saveChanges}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}

export default function SupplierPaymentsPage() {
    const { t } = useI18n();
    return (
        <Suspense fallback={<div className="p-8 text-sm text-gray-500">{t.supplierPayments.loading}</div>}>
            <SupplierPaymentsContent />
        </Suspense>
    );
}