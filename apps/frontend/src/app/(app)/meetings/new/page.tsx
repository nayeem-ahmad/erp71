'use client';

import { PageShell, PageHeader } from '@/components/ui';
import MeetingForm from '@/components/meetings/MeetingForm';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function NewMeetingPage() {
    const { t } = useI18n();
    const m = t.meetings;
    return (
        <PageShell>
            <PageHeader
                title={m.newMeeting}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.meetings,
                    m.newMeeting,
                    'meetings',
                )}
            />
            <MeetingForm mode="create" />
        </PageShell>
    );
}
