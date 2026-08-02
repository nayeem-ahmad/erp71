'use client';

import { useI18n } from '@/lib/i18n';

/**
 * Approval state of a voucher. Renders nothing for APPROVED (and for the missing
 * value older responses may carry) so a tenant that never turned approval on
 * sees no new column noise — only exceptions are worth a badge.
 */
export function VoucherApprovalBadge({ status }: { status?: string | null }) {
    const { t } = useI18n();
    const copy = t.vouchers.approval;

    if (!status || status === 'APPROVED') {
        return <span className="text-xs text-gray-400">{status ? copy.approved : '—'}</span>;
    }

    const tone = status === 'REJECTED'
        ? 'bg-red-50 text-danger border-red-100'
        : 'bg-amber-50 text-amber-700 border-amber-100';

    return (
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${tone}`}>
            {status === 'REJECTED' ? copy.rejected : copy.pending}
        </span>
    );
}
