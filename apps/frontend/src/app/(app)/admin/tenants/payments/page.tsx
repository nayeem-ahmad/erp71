'use client';

import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import type { TenantRecord } from '@/components/admin/tenants/types';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

type PaymentDirection = 'payment' | 'refund';

export default function AdminTenantPaymentsPage() {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const pm = m.payments;
    const ml = m.ledger;

    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [loadingTenants, setLoadingTenants] = useState(true);
    const [tenantId, setTenantId] = useState('');
    const [direction, setDirection] = useState<PaymentDirection>('payment');
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getAdminTenants({})
            .then((rows) => setTenants(rows))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : m.loadFailed))
            .finally(() => setLoadingTenants(false));
    }, [m.loadFailed]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const handleSubmit = async () => {
        if (!tenantId) {
            setError(pm.tenantRequired);
            return;
        }
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            setError(direction === 'payment' ? ml.paymentModal.amountRequired : ml.refundModal.amountRequired);
            return;
        }

        setSubmitting(true);
        setError('');
        try {
            if (direction === 'payment') {
                await api.recordTenantPayment(tenantId, {
                    amount: parsedAmount,
                    method: method || undefined,
                    notes: notes || undefined,
                });
                showToast(formatMessage(ml.paymentModal.success, { amount: parsedAmount.toFixed(2) }));
            } else {
                await api.recordTenantRefund(tenantId, {
                    amount: parsedAmount,
                    notes: notes || undefined,
                });
                showToast(formatMessage(ml.refundModal.success, { amount: parsedAmount.toFixed(2) }));
            }
            setAmount('');
            setMethod('');
            setNotes('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : (direction === 'payment' ? ml.paymentModal.failed : ml.refundModal.failed));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title={pm.title}
                    subtitle={pm.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.title, href: '/admin/tenants' }],
                        pm.title,
                    )}
                />

                {toast && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4 shrink-0" /> {toast}
                    </div>
                )}

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="rounded-3xl border border-gray-100 bg-white p-6 space-y-5">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{pm.tenantLabel}</label>
                        {loadingTenants ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                            </div>
                        ) : (
                            <select
                                value={tenantId}
                                onChange={(e) => setTenantId(e.target.value)}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                            >
                                <option value="">{pm.tenantPlaceholder}</option>
                                {tenants.map((tenant) => (
                                    <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">{pm.typeLabel}</label>
                        <div className="flex rounded-2xl border border-gray-100 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setDirection('payment')}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition ${direction === 'payment' ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                            >
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                                {pm.receivePayment}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDirection('refund')}
                                className={`flex-1 inline-flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition ${direction === 'refund' ? 'bg-amber-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                            >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                {pm.issueRefund}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">
                            {direction === 'payment' ? ml.paymentModal.amountLabel : ml.refundModal.amountLabel}
                        </label>
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={direction === 'payment' ? ml.paymentModal.amountPlaceholder : ml.refundModal.amountPlaceholder}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                        />
                    </div>

                    {direction === 'payment' && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-500">{ml.paymentModal.methodLabel}</label>
                            <input
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                placeholder={ml.paymentModal.methodPlaceholder}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500">
                            {direction === 'payment' ? ml.paymentModal.notesLabel : ml.refundModal.notesLabel}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={direction === 'payment' ? ml.paymentModal.notesPlaceholder : ml.refundModal.notesPlaceholder}
                            rows={3}
                            className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none resize-none"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={submitting}
                        className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg disabled:opacity-60 ${direction === 'payment' ? 'bg-emerald-600 shadow-emerald-200 hover:bg-emerald-700' : 'bg-amber-600 shadow-amber-200 hover:bg-amber-700'}`}
                    >
                        {submitting
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> {pm.submitting}</>
                            : direction === 'payment' ? pm.submitPayment : pm.submitRefund}
                    </button>
                </div>
            </div>
        </div>
    );
}