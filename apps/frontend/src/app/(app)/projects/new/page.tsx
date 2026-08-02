'use client';

import { PageShell, PageHeader } from '@/components/ui';
import ProjectForm from '@/components/projects/ProjectForm';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function NewProjectPage() {
    const { t } = useI18n();
    const m = t.projects;

    return (
        <PageShell>
            <PageHeader
                title={m.newProject}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    m.newProject,
                    'projects',
                )}
            />
            <ProjectForm mode="create" />
        </PageShell>
    );
}
