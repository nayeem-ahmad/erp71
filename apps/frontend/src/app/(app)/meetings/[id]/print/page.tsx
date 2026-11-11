'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui';
import MinutesTable from '@/components/meetings/MinutesTable';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { useBranding } from '@/lib/branding';
import type { Meeting } from '@/components/meetings/types';

export default function MeetingPrintPage() {
    const { t, locale } = useI18n();
    const m = t.meetings;
    const { logoUrl, businessName } = useBranding();
    const params = useParams();
    const id = String(params.id);
    const [meeting, setMeeting] = useState<Meeting | null>(null);

    useEffect(() => {
        api.getMeeting(id).then(setMeeting).catch(() => setMeeting(null));
    }, [id]);

    useEffect(() => {
        if (meeting) {
            const timer = window.setTimeout(() => window.print(), 300);
            return () => window.clearTimeout(timer);
        }
    }, [meeting]);

    if (!meeting) return null;

    const chair = meeting.attendees.find((row) => row.role === 'CHAIR');
    const minuteTaker = meeting.attendees.find((row) => row.role === 'MINUTE_TAKER');
    const present = meeting.attendees.filter((row) => row.attended);
    const absent = meeting.attendees.filter((row) => !row.attended);

    return (
        <div className="mx-auto max-w-[210mm] bg-white p-8 text-gray-900 print:p-0">
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    thead { display: table-header-group; }
                    tr { break-inside: avoid; }
                    @page { size: A4; margin: 14mm; }
                }
            `}</style>
            {meeting.status === 'DRAFT' ? (
                <div className="pointer-events-none fixed inset-0 flex items-center justify-center opacity-10 print:opacity-15">
                    <span className="rotate-[-24deg] text-8xl font-semibold tracking-widest text-gray-700">{m.draftWatermark}</span>
                </div>
            ) : null}

            <div className="no-print mb-4 flex justify-end">
                <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {m.printed}</Button>
            </div>

            <header className="mb-6 flex items-start justify-between gap-4 border-b border-gray-200 pb-4">
                <div>
                    {businessName ? <p className="text-sm font-medium text-gray-700">{businessName}</p> : null}
                    <h1 className="text-xl font-semibold">{meeting.title}</h1>
                    <p className="text-sm text-gray-600">
                        {meeting.meeting_number} · {m.types[meeting.type]} · {formatDateTime(meeting.starts_at, locale)}
                        {meeting.venue ? ` · ${meeting.venue}` : ''}
                    </p>
                </div>
                {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-12 w-auto" />
                ) : null}
            </header>

            <section className="mb-4 text-sm">
                {present.length ? <p><strong>{m.present}:</strong> {present.map((row) => `${row.name}${row.role !== 'MEMBER' ? ` (${m.roles[row.role]})` : ''}`).join(', ')}</p> : null}
                {absent.length ? <p><strong>{m.absent}:</strong> {absent.map((row) => row.name).join(', ')}</p> : null}
            </section>

            <MinutesTable discussions={meeting.discussions} labels={{ ...m.table, statuses: m.actionStatuses }} />

            <section className="mt-16 grid grid-cols-2 gap-12 text-sm">
                <div>
                    <div className="h-12 border-b border-gray-400" />
                    <p className="mt-1">{m.signatureChair}{chair ? ` — ${chair.name}` : ''}</p>
                </div>
                <div>
                    <div className="h-12 border-b border-gray-400" />
                    <p className="mt-1">{m.signatureMinuteTaker}{minuteTaker ? ` — ${minuteTaker.name}` : ''}</p>
                </div>
            </section>

            {meeting.finalized_at ? (
                <p className="mt-8 text-xs text-gray-500">
                    {formatMessage(m.finalizedOn, {
                        date: formatDateTime(meeting.finalized_at, locale),
                        name: meeting.organizer?.name || meeting.organizer?.email || '',
                    }, locale)}
                </p>
            ) : null}
        </div>
    );
}
