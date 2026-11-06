'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Cpu, FileText, Wallet, XCircle } from 'lucide-react';
import { VoucherType } from '@erp71/shared-types';
import type { ListFilter, ListStat } from '@/components/data-table';
import type { Paginated, VoucherListFilterParams, VoucherListSummary } from '@/lib/api';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { NumberCondition } from '@/lib/number-condition';

type Messages = ReturnType<typeof useI18n>['t'];

export const VOUCHER_TYPES = Object.values(VoucherType);
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const SOURCES = ['manual', 'system'] as const;

/** A voucher type in the reader's language — `cash_payment` → "Cash Payment". */
export function voucherTypeLabel(t: Messages, type: string | null | undefined): string {
    if (!type) return '—';
    const labels = t.accountingShared.voucherTypes as Record<string, string>;
    return labels[type.toUpperCase()] ?? type.replaceAll('_', ' ');
}

export function voucherTypeOptions(t: Messages) {
    return VOUCHER_TYPES.map((value) => ({ value, label: voucherTypeLabel(t, value) }));
}

/** The vouchers endpoint answers `{ data, meta }`; `useServerList` reads `{ items, total }`. */
export function toPaginated<T>(response: {
    data?: T[];
    meta?: { page?: number; limit?: number; total?: number; totalPages?: number };
} | null | undefined): Paginated<T> {
    const items = response?.data ?? [];
    return {
        items,
        total: response?.meta?.total ?? items.length,
        page: response?.meta?.page ?? 1,
        limit: response?.meta?.limit ?? items.length,
        pages: response?.meta?.totalPages ?? 1,
    };
}

/**
 * The filter row shared by the voucher list and the journal: one set of chips
 * whose values go to the server with the page query and the stats strip alike.
 * The date, type, approval and amount chips sit in the row; source and the
 * created date wait behind More.
 */
export function useVoucherListFilters({ initialApprovalStatus = [] }: { initialApprovalStatus?: string[] } = {}) {
    const { t } = useI18n();
    const copy = t.accountingVouchersUi.common;
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [dateRange, setDateRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [types, setTypes] = useState<string[]>([]);
    const [approval, setApproval] = useState<string[]>(initialApprovalStatus);
    const [amount, setAmount] = useState<NumberCondition | null>(null);
    const [source, setSource] = useState<string | null>(null);

    // Typing must not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const filterParams = useMemo<VoucherListFilterParams>(
        () => ({
            search: debouncedSearch || undefined,
            voucherType: types.length ? types.join(',') : undefined,
            // The voucher date is a calendar day; the chip carries no time.
            from: dateRange?.from?.slice(0, 10) || undefined,
            to: dateRange?.to?.slice(0, 10) || undefined,
            ...applyCreatedRangeQuery(createdRange),
            approvalStatus: approval.length ? approval.join(',') : undefined,
            amount,
            source: (source as VoucherListFilterParams['source']) ?? undefined,
        }),
        [debouncedSearch, types, dateRange, createdRange, approval, amount, source],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'date',
                type: 'date-range',
                label: t.accountingShared.date,
                value: dateRange,
                onChange: setDateRange,
                operators: true,
            },
            {
                id: 'voucherType',
                type: 'multi-select',
                label: t.accountingShared.type,
                value: types,
                onChange: setTypes,
                options: voucherTypeOptions(t),
            },
            {
                id: 'approvalStatus',
                type: 'multi-select',
                label: t.vouchers.approval.status,
                value: approval,
                onChange: setApproval,
                options: APPROVAL_STATUSES.map((value) => ({
                    value,
                    label: t.vouchers.approval[value.toLowerCase() as 'pending' | 'approved' | 'rejected'],
                })),
            },
            {
                id: 'amount',
                type: 'number',
                label: t.accountingShared.amount,
                value: amount,
                onChange: setAmount,
                money: true,
            },
            {
                id: 'source',
                type: 'select',
                label: copy.source,
                value: source,
                onChange: setSource,
                options: SOURCES.map((value) => ({ value, label: copy.sources[value] })),
                more: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, copy, dateRange, types, approval, amount, source, createdRange],
    );

    return { search, setSearch, filterParams, filters };
}

/** The strip over every voucher the filters match, from `GET accounting/vouchers/summary`. */
export function useVoucherSummaryStats(summary: VoucherListSummary | null, loading: boolean, label: string) {
    const { t, locale, fmt } = useI18n();
    return useMemo(() => {
        const copy = t.accountingVouchersUi.stats;
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const count = (value: number) => value.toLocaleString(locale);
        const dash = '—';
        const items: ListStat[] = [
            { id: 'count', icon: <FileText aria-hidden />, label: copy.vouchers, value: summary ? count(summary.count) : dash },
            { id: 'total', icon: <Wallet aria-hidden />, label: copy.totalAmount, value: summary ? money(summary.totalAmount) : dash },
            {
                id: 'pending',
                icon: <Clock aria-hidden />,
                label: copy.pending,
                value: summary ? count(summary.pending) : dash,
                tone: summary && summary.pending > 0 ? 'warning' : 'default',
            },
            { id: 'approved', icon: <CheckCircle2 aria-hidden />, label: copy.approved, value: summary ? count(summary.approved) : dash },
            {
                id: 'rejected',
                icon: <XCircle aria-hidden />,
                label: copy.rejected,
                value: summary ? count(summary.rejected) : dash,
                tone: summary && summary.rejected > 0 ? 'danger' : 'default',
            },
            {
                id: 'system',
                icon: <Cpu aria-hidden />,
                label: copy.systemPosted,
                value: summary ? count(summary.systemCount) : dash,
                hint: summary ? fmt(copy.manualCount, { count: count(summary.manualCount) }) : undefined,
            },
        ];
        return { items, loading: loading && !summary, label };
    }, [summary, loading, label, locale, t, fmt]);
}
