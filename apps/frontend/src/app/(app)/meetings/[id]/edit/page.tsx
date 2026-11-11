'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageShell, PageHeader } from '@/components/ui';
import MeetingForm from '@/components/meetings/MeetingForm';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import type { Meeting } from '@/components/meetings/types';

export default function EditMeetingPage() {
    const { t } = useI18n();
    const m = t.meetings;
    const params = useParams();
    const id = String(params.id);
    const [meeting, setMeeting] = useState<Meeting | null>(null);

    useEffect(() => {
        api.getMeeting(id)
            .then(setMeeting)
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : m.loadFailed));
    }, [id, m.loadFailed]);

    return (
        <PageShell>
            <PageHeader
                title={m.editMeeting}
                subtitle={meeting?.meeting_number}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.meetings,
                    m.editMeeting,
                    'meetings',
                )}
            />
            {meeting ? <MeetingForm mode="edit" meeting={meeting} /> : null}
        </PageShell>
    );
}
