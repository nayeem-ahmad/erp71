'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell, PageHeader, Button, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import type { Meeting, MeetingStatus } from '@/components/meetings/types';

const columnHelper = createColumnHelper<Meeting>();
const STATUS_TONE: Record<MeetingStatus, 'neutral' | 'success' | 'danger' | 'info' | 'warning'> = {
    DRAFT: 'neutral',
    FINALIZED: 'success',
    CANCELLED: 'danger',
};

export default function MeetingsPage() {
    const { t, locale } = useI18n();
    const m = t.meetings;
    const [rows, setRows] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [type, setType] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getMeetings({
                status: status || undefined,
                type: type || undefined,
            });
            setRows(Array.isArray(data) ? data : []);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, type]);

    const columns = useMemo(
        () => [
            columnHelper.accessor('meeting_number', {
                header: m.fields.number,
                cell: (info) => (
                    <Link href={routes.meetings.detail(info.row.original.id)} className="text-blue-600 hover:underline">
                        {info.getValue()}
                    </Link>
                ),
            }),
            columnHelper.accessor('title', { header: m.fields.title }),
            columnHelper.accessor('type', {
                header: m.fields.type,
                cell: (info) => m.types[info.getValue()],
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('starts_at', {
                header: m.fields.date,
                cell: (info) => formatDateTime(info.getValue(), locale),
            }),
            columnHelper.accessor((row) => row.organizer?.name || row.organizer?.email || '', {
                id: 'organizer',
                header: m.fields.organizer,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('status', {
                header: m.fields.status,
                cell: (info) => (
                    <StatusBadge tone={STATUS_TONE[info.getValue()]}>{m.statuses[info.getValue()]}</StatusBadge>
                ),
            }),
            columnHelper.accessor('open_action_count', {
                header: m.fields.openActions,
                cell: (info) => info.getValue() ?? 0,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('overdue_action_count', {
                header: m.fields.overdueActions,
                cell: (info) => {
                    const count = info.getValue() ?? 0;
                    return count > 0 ? <span className="text-red-600">{count}</span> : 0;
                },
            }),
        ],
        [locale, m],
    );

    const filters: ListFilter[] = [
        {
            id: 'status',
            type: 'select',
            label: m.fields.status,
            value: status || null,
            onChange: (next) => setStatus(next ?? ''),
            options: (['DRAFT', 'FINALIZED', 'CANCELLED'] as const).map((value) => ({ value, label: m.statuses[value] })),
        },
        {
            id: 'type',
            type: 'select',
            label: m.fields.type,
            value: type || null,
            onChange: (next) => setType(next ?? ''),
            options: (['MANAGEMENT', 'STAFF', 'CLIENT', 'SUPPLIER', 'OTHER'] as const).map((value) => ({ value, label: m.types[value] })),
        },
    ];

    const stats: ListStat[] = [
        { id: 'meetings', label: m.listUi.stats.meetings, value: String(rows.length) },
        { id: 'drafts', label: m.listUi.stats.drafts, value: String(rows.filter((row) => row.status === 'DRAFT').length) },
        { id: 'finalized', label: m.listUi.stats.finalized, value: String(rows.filter((row) => row.status === 'FINALIZED').length) },
        { id: 'overdue', label: m.listUi.stats.overdue, value: String(rows.reduce((sum, row) => sum + (row.overdue_action_count ?? 0), 0)) },
    ];

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.meetings, m.title, 'meetings')}
                actions={
                    <Link href={routes.meetings.new}>
                        <Button>
                            <Plus className="h-4 w-4" /> {m.newMeeting}
                        </Button>
                    </Link>
                }
            />
            <DataTable
                tableId="meetings"
                title={m.title}
                data={rows}
                columns={columns}
                isLoading={loading}
                emptyIcon={<CalendarDays className="h-16 w-16 text-gray-200" />}
                emptyMessage={m.empty}
                searchPlaceholder={m.searchPlaceholder}
                filters={filters}
                stats={stats}
            />
        </PageShell>
    );
}
