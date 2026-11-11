'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Mail, Pencil, Printer, Share2 } from 'lucide-react';
import { PageShell, PageHeader, Button, ConfirmDialog, StatusBadge } from '@/components/ui';
import MinutesTable from '@/components/meetings/MinutesTable';
import ShareModal from '@/components/share/ShareModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { notifyMeetingActionsChanged } from '@/hooks/useOverdueMeetingActionsCount';
import type { Meeting, MeetingActionStatus } from '@/components/meetings/types';
import { ACTION_STATUSES } from '@/components/meetings/types';

const STATUS_TONE = {
    DRAFT: 'neutral',
    FINALIZED: 'success',
    CANCELLED: 'danger',
} as const;

export default function MeetingDetailPage() {
    const { t, locale } = useI18n();
    const m = t.meetings;
    const params = useParams();
    const id = String(params.id);
    const [meeting, setMeeting] = useState<Meeting | null>(null);
    const [sharePath, setSharePath] = useState<string | null>(null);
    const [confirmFinalize, setConfirmFinalize] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            setMeeting(await api.getMeeting(id));
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.loadFailed);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const run = async (fn: () => Promise<unknown>, ok: string) => {
        setBusy(true);
        try {
            await fn();
            toast.success(ok);
            await load();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setBusy(false);
            setConfirmFinalize(false);
            setConfirmCancel(false);
        }
    };

    const updateAction = async (actionId: string, status: MeetingActionStatus) => {
        try {
            await api.updateMeetingAction(actionId, { status });
            toast.success(m.statusUpdated);
            notifyMeetingActionsChanged();
            await load();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : m.statusFailed);
        }
    };

    if (!meeting) return null;

    const present = meeting.attendees.filter((row) => row.attended);
    const absent = meeting.attendees.filter((row) => !row.attended);

    return (
        <PageShell>
            <PageHeader
                title={meeting.title}
                subtitle={`${meeting.meeting_number} · ${formatDateTime(meeting.starts_at, locale)}`}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.meetings,
                    meeting.meeting_number,
                    'meetings',
                )}
                actions={
                    <>
                        <StatusBadge tone={STATUS_TONE[meeting.status]}>{m.statuses[meeting.status]}</StatusBadge>
                        {meeting.status === 'DRAFT' ? (
                            <Button onClick={() => setConfirmFinalize(true)} disabled={busy}>{m.finalize}</Button>
                        ) : null}
                        {meeting.status !== 'CANCELLED' ? (
                            <Link href={routes.meetings.edit(meeting.id)}>
                                <Button variant="secondary"><Pencil className="h-4 w-4" /> {m.editMeeting}</Button>
                            </Link>
                        ) : null}
                        <Link href={routes.meetings.print(meeting.id)}>
                            <Button variant="secondary"><Printer className="h-4 w-4" /> {m.printed}</Button>
                        </Link>
                        {meeting.status === 'FINALIZED' ? (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        try {
                                            const result = await api.shareMeeting(meeting.id);
                                            setSharePath((result?.data ?? result).path);
                                        } catch (error: unknown) {
                                            toast.error(error instanceof Error ? error.message : m.shareError);
                                        }
                                    }}
                                >
                                    <Share2 className="h-4 w-4" /> {m.share}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => void run(() => api.emailMeeting(meeting.id, {}), m.emailed)}
                                    disabled={busy}
                                >
                                    <Mail className="h-4 w-4" /> {m.emailMinutes}
                                </Button>
                            </>
                        ) : null}
                        {meeting.status !== 'CANCELLED' ? (
                            <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={busy}>
                                {m.cancelMeeting}
                            </Button>
                        ) : null}
                    </>
                }
            />

            <div className="space-y-4">
                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 text-sm">
                    <p><span className="text-gray-500">{m.fields.type}:</span> {m.types[meeting.type]}</p>
                    {meeting.venue ? <p><span className="text-gray-500">{m.fields.venue}:</span> {meeting.venue}</p> : null}
                    {meeting.organizer ? (
                        <p><span className="text-gray-500">{m.fields.organizer}:</span> {meeting.organizer.name || meeting.organizer.email}</p>
                    ) : null}
                    {meeting.summary ? <p className="mt-2 whitespace-pre-wrap">{meeting.summary}</p> : null}
                    {present.length ? (
                        <p className="mt-2"><span className="text-gray-500">{m.present}:</span> {present.map((row) => `${row.name}${row.role !== 'MEMBER' ? ` (${m.roles[row.role]})` : ''}`).join(', ')}</p>
                    ) : null}
                    {absent.length ? (
                        <p><span className="text-gray-500">{m.absent}:</span> {absent.map((row) => row.name).join(', ')}</p>
                    ) : null}
                </section>

                <MinutesTable
                    discussions={meeting.discussions}
                    labels={{ ...m.table, statuses: m.actionStatuses }}
                />

                <section className="space-y-2">
                    {meeting.discussions.flatMap((discussion) => discussion.actionItems).map((action) => (
                        <div key={action.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-gray-600">{action.description}</span>
                            <select
                                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm"
                                value={action.status}
                                onChange={(e) => action.id && void updateAction(action.id, e.target.value as MeetingActionStatus)}
                            >
                                {ACTION_STATUSES.map((status) => (
                                    <option key={status} value={status}>{m.actionStatuses[status]}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </section>
            </div>

            {sharePath ? (
                <ShareModal
                    subject={formatMessage(m.shareSubject, { number: meeting.meeting_number }, locale)}
                    shortPath={sharePath}
                    showPrintLink
                    onRevoke={() => api.revokeMeetingShare(meeting.id)}
                    onClose={() => setSharePath(null)}
                />
            ) : null}

            <ConfirmDialog
                open={confirmFinalize}
                title={m.finalize}
                prompt={m.finalizeConfirm}
                confirmLabel={m.finalize}
                cancelLabel={m.cancel}
                loading={busy}
                onConfirm={() => void run(() => api.finalizeMeeting(meeting.id), m.finalized)}
                onCancel={() => setConfirmFinalize(false)}
            />
            <ConfirmDialog
                open={confirmCancel}
                title={m.cancelMeeting}
                prompt={m.cancelConfirm}
                confirmLabel={m.cancelMeeting}
                cancelLabel={m.cancel}
                danger
                loading={busy}
                onConfirm={() => void run(() => api.cancelMeeting(meeting.id), m.cancelled)}
                onCancel={() => setConfirmCancel(false)}
            />
        </PageShell>
    );
}
