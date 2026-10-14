'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ClipboardList, Eye } from 'lucide-react';
import { Input, StatusBadge, Switch, type StatusBadgeTone } from '@/components/ui';
import {
    activityDueDay,
    activityKindName,
    activityLabel,
    activityTarget,
    groupActivities,
    type ActivityGroupId,
    type CrmActivityListRow,
} from '@/components/crm/crm-activity-layout';
import { stripedRowClass } from '@/lib/ui/striped-row';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { tenantDateOnly } from '@/lib/created-range';

const statusTone: Record<string, StatusBadgeTone> = {
    PLANNED: 'warning',
    DONE: 'success',
    CANCELLED: 'neutral',
};

export function CrmActivityApproval({
    status,
    approved,
    disabled,
    title,
    label,
    onToggle,
}: {
    status: string;
    approved: boolean;
    disabled: boolean;
    title?: string;
    label: string;
    onToggle: (next: boolean) => void;
}) {
    if (status !== 'PLANNED') return <span className="text-gray-400">—</span>;
    return (
        <Switch
            checked={approved}
            onCheckedChange={onToggle}
            disabled={disabled}
            aria-label={label}
            title={title}
        />
    );
}

export function CrmActivityRowActions({
    href,
    onView,
    viewLabel,
    openLabel,
    dense = false,
}: {
    href: string;
    onView: () => void;
    viewLabel: string;
    openLabel: string;
    /** Desktop rows shrink; a phone keeps the 44px target. */
    dense?: boolean;
}) {
    const box = dense
        ? 'inline-flex h-6 w-6 items-center justify-center text-gray-400 hover:text-blue-600 max-md:min-h-touch max-md:min-w-touch'
        : 'inline-flex min-h-touch items-center text-gray-400 hover:text-blue-600';
    return (
        <div className="flex items-center gap-1">
            <button type="button" onClick={onView} aria-label={viewLabel} title={viewLabel} className={box}>
                <ClipboardList className="h-4 w-4" />
            </button>
            <Link href={href} aria-label={openLabel} title={openLabel} className={box}>
                <Eye className="h-4 w-4" />
            </Link>
        </div>
    );
}

function DueDate({ value, overdue }: { value: string | null; overdue: boolean }) {
    if (!value) return <span className="text-gray-400">—</span>;
    return (
        <span className={`inline-flex items-center gap-1 ${overdue ? 'font-bold text-red-600' : 'text-gray-600'}`}>
            {overdue && <AlertTriangle className="h-3 w-3" />}
            {formatDate(value)}
        </span>
    );
}

/**
 * The activities list read as a day's work: overdue, then today, then later.
 *
 * It is the third layout, not a second table. Search, sort, export and print
 * stay on the table layouts; this one only filters the rows already loaded.
 */
export default function CrmActivityAgenda({
    rows,
    canApprove,
    onToggleApproval,
    onView,
    emptyMessage,
}: {
    rows: CrmActivityListRow[];
    canApprove: boolean;
    onToggleApproval: (id: string, approved: boolean) => void;
    onView: (row: CrmActivityListRow) => void;
    emptyMessage: string;
}) {
    const { t } = useI18n();
    const m = t.crm.activitiesPage;
    const [query, setQuery] = useState('');

    const groups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const matched = needle
            ? rows.filter((row) => {
                const haystack = [
                    activityLabel(row),
                    activityKindName(row),
                    row.lead?.name,
                    row.customer?.name,
                    row.assignee?.name,
                    row.summary,
                ].filter(Boolean).join('\n').toLowerCase();
                return haystack.includes(needle);
            })
            : rows;
        return groupActivities(matched, tenantDateOnly());
    }, [rows, query]);

    const groupLabel: Record<ActivityGroupId, string> = {
        overdue: m.overdue,
        today: m.groups.today,
        later: m.groups.later,
        earlier: m.groups.earlier,
        undated: m.groups.undated,
    };

    const today = tenantDateOnly();

    return (
        <div className="space-y-3">
            <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={m.searchPlaceholder}
                aria-label={m.searchPlaceholder}
                className="w-full max-w-md"
            />

            {groups.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">{emptyMessage}</div>
            ) : groups.map((group) => (
                <section key={group.id} aria-label={groupLabel[group.id]}>
                    <h2 className="mb-1 text-xs font-semibold text-gray-600">
                        {groupLabel[group.id]}{' '}
                        <span className="font-medium text-gray-400">{group.rows.length}</span>
                    </h2>
                    <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
                        {group.rows.map((row) => {
                            const target = activityTarget(row);
                            const kind = activityKindName(row);
                            const dueDay = row.due_at ? activityDueDay(row.due_at) : null;
                            const overdue = row.status === 'PLANNED' && !!dueDay && dueDay < today;
                            return (
                                <div
                                    key={row.id}
                                    className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-100 px-2 py-1 first:border-t-0 md:flex-nowrap ${stripedRowClass}`}
                                >
                                    <div className="w-16 shrink-0 text-xs">
                                        <DueDate value={row.due_at} overdue={overdue} />
                                    </div>
                                    <div className="min-w-0 flex-1 truncate text-[13px]">
                                        <span className="font-medium text-gray-800">{activityLabel(row)}</span>
                                        {kind ? <span className="text-gray-500"> · {kind}</span> : null}
                                    </div>
                                    <div className="w-full truncate text-[13px] sm:w-40 sm:shrink-0">
                                        {target ? (
                                            <Link href={target.href} className="text-blue-600 hover:underline">{target.name}</Link>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </div>
                                    <StatusBadge tone={statusTone[row.status] ?? 'neutral'}>
                                        {m.status[row.status as 'PLANNED' | 'DONE' | 'CANCELLED'] ?? row.status}
                                    </StatusBadge>
                                    <CrmActivityApproval
                                        status={row.status}
                                        approved={row.is_approved}
                                        disabled={!canApprove}
                                        label={m.approveActivity}
                                        title={row.approver ? `${m.columns.approved} — ${row.approver.name}` : undefined}
                                        onToggle={(next) => onToggleApproval(row.id, next)}
                                    />
                                    {target ? (
                                        <CrmActivityRowActions
                                            href={target.href}
                                            onView={() => onView(row)}
                                            viewLabel={m.viewActivities}
                                            openLabel={m.open}
                                            dense
                                        />
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </section>
            ))}
        </div>
    );
}
