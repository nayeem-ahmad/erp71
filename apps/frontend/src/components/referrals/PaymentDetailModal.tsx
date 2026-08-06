'use client';

import { X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import type { RefereePayment } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';

export type PaymentDetailLabels = {
    title: string;
    business: string;
    commission: string;
    signedUp: string;
    none: string;
    close: string;
};

export default function PaymentDetailModal({
    payment,
    labels,
    onClose,
}: {
    payment: RefereePayment;
    labels: PaymentDetailLabels;
    onClose: () => void;
}) {
    const commissions = payment.commissions ?? [];

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">{labels.title}</h2>
                    <p className="text-xs text-gray-500">
                        {formatDate(payment.paid_at)} · {formatBDT(payment.amount)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={labels.close}
                    className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="overflow-y-auto p-4">
                {commissions.length === 0 ? (
                    <p className="text-xs text-gray-500">{labels.none}</p>
                ) : (
                    <ul className="space-y-2">
                        <li className="flex items-center justify-between px-3 text-xs font-medium text-gray-500">
                            <span>{labels.business}</span>
                            <span>{labels.commission}</span>
                        </li>
                        {commissions.map((commission) => (
                            <li
                                key={commission.id}
                                className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-900">
                                        {commission.tenant?.name ?? commission.tenant_id}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {labels.signedUp}: {formatDate(commission.signed_up_at)}
                                    </p>
                                </div>
                                <p className="text-sm font-semibold text-emerald-700">
                                    {commission.commission_amount !== null
                                        ? formatBDT(Number(commission.commission_amount))
                                        : '—'}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ModalShell>
    );
}
