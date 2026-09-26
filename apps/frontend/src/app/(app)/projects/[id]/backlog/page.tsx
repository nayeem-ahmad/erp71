'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, PageHeader, PageShell } from '@/components/ui';
import BacklogWorkspace from '@/components/projects/backlog/BacklogWorkspace';
import { useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * One project's backlog as a tree: epics, the user stories under each, and the
 * tasks under each story, with what is done rolled up at every level and every
 * way to rearrange, edit and bulk-change it. The work is `BacklogWorkspace`;
 * this page is the project's header around it.
 */
export default function ProjectBacklogPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    return (
        <PageShell>
            <Suspense fallback={null}>
                <BacklogWorkspace
                    projectId={projectId}
                    storageKey={`project-backlog-expanded:${projectId}`}
                    header={({ data, newEpic, newStory }) => {
                        const project = data?.project ?? null;
                        return (
                            <PageHeader
                                title={project ? `${project.code} · ${m.backlog.title}` : m.backlog.title}
                                subtitle={m.backlog.subtitle}
                                breadcrumbs={projectChildBreadcrumbs(
                                    t.dashboardHome.breadcrumbHome,
                                    t.sidebar.modules.projects,
                                    project,
                                    m.backlog.title,
                                )}
                                actions={
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="secondary" className="min-h-touch" onClick={newStory}>
                                            <Plus className="h-4 w-4" />
                                            {m.stories.add}
                                        </Button>
                                        <Button className="min-h-touch" onClick={newEpic}>
                                            <Plus className="h-4 w-4" />
                                            {m.epics.add}
                                        </Button>
                                    </div>
                                }
                            />
                        );
                    }}
                />
            </Suspense>
        </PageShell>
    );
}
