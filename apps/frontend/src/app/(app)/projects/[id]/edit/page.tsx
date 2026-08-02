'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageShell, PageHeader } from '@/components/ui';
import ProjectForm, { toFormValues, type ProjectFormValues } from '@/components/projects/ProjectForm';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

interface ProjectSummary {
    id: string;
    code: string;
    name: string;
}

export default function EditProjectPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [project, setProject] = useState<ProjectSummary | null>(null);
    const [initial, setInitial] = useState<ProjectFormValues | null>(null);

    useEffect(() => {
        api.getProject(projectId)
            .then((res: unknown) => {
                setProject(res as ProjectSummary);
                setInitial(toFormValues(res as Record<string, unknown>));
            })
            .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : m.loadFailed),
            );
    }, [projectId, m.loadFailed]);

    return (
        <PageShell>
            <PageHeader
                title={m.editProject}
                subtitle={project ? `${project.code} · ${project.name}` : m.subtitle}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    project,
                    m.editProject,
                )}
            />
            {initial ? (
                <ProjectForm mode="edit" projectId={projectId} initial={initial} />
            ) : (
                <p className="text-sm text-gray-500">{t.common.loading}</p>
            )}
        </PageShell>
    );
}
