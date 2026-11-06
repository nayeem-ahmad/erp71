'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { StatusBadge, buttonClassName, type StatusBadgeTone } from '@/components/ui';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { routes } from '@/lib/routes';

export interface SaleReturnSummary {
    id: string;
    return_number: string;
    total_refund: string | number;
    reason?: string | null;
    status?: string | null;
    created_at: string;
    _count?: { items?: number };
}

const statusTones: Record<string, StatusBadgeTone> = {
    COMPLETED: 'success',
    PENDING: 'warning',
    CANCELLED: 'neutral',
};

/**
 * The sales returns raised against one list row. Opened from the return icon
 * beside the serial — the list already carries these summaries, so nothing
 * else is fetched.
 */
export default function SaleReturnsModal({
    serialNumber,
    returns,
    onClose,
}: {
    serialNumber: string;
    returns: SaleReturnSummary[];
    onClose: () => void;
}) {
    const { t, locale } = useI18n();
    const copy = t.sales.list.returnsModal;
    const columns = t.returns.columns;

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader
                title={formatMessage(copy.title, { serial: serialNumber })}
                onClose={onClose}
                closeLabel={t.common.close}
            />
            <div className="overflow-y-auto p-4">
                {returns.length === 0 ? (
                    <p className="text-sm text-gray-500">{copy.empty}</p>
                ) : (
                    <ul className="space-y-2">
                        {returns.map((ret) => {
                            const status = ret.status ?? 'COMPLETED';
                            const itemCount = ret._count?.items ?? 0;
                            return (
                                <li
                                    key={ret.id}
                                    className="rounded-lg border border-gray-100 p-3"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Link
                                                    href={routes.sales.returnDetail(ret.id)}
                                                    className="text-sm font-medium text-blue-600 hover:underline"
                                                >
                                                    {ret.return_number}
                                                </Link>
                                                <StatusBadge tone={statusTones[status] ?? 'neutral'}>
                                                    {t.shared.statuses.return[
                                                        status as keyof typeof t.shared.statuses.return
                                                    ] ?? status}
                                                </StatusBadge>
                                            </div>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {formatDateTime(ret.created_at, locale)}
                                                {itemCount > 0
                                                    ? ` · ${formatMessage(t.shared.itemsCount, { count: itemCount })}`
                                                    : null}
                                            </p>
                                            {ret.reason ? (
                                                <p className="mt-1 text-xs text-gray-600">
                                                    <span className="font-medium text-gray-500">
                                                        {copy.reason}:{' '}
                                                    </span>
                                                    {ret.reason}
                                                </p>
                                            ) : null}
                                        </div>
                                        <div className="shrink-0 text-end">
                                            <div className="text-xs text-gray-500">{columns.refundAmount}</div>
                                            <div className="text-sm font-semibold text-gray-900">
                                                {formatBDT(Number(ret.total_refund), { locale })}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-2">
                                        <Link
                                            href={routes.sales.returnDetail(ret.id)}
                                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                                        >
                                            {copy.openReturn}
                                            <ExternalLink className="h-3 w-3" aria-hidden />
                                        </Link>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <ModalFooter>
                <button type="button" onClick={onClose} className={buttonClassName({ variant: 'secondary' })}>
                    {t.common.close}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}
