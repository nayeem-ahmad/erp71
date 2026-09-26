'use client';

import { Suspense, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button, PageHeader, PageShell } from '@/components/ui';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import BacklogWorkspace from '@/components/projects/backlog/BacklogWorkspace';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * The columns an import file may carry. The project is named by code or name,
 * as in the task import; the ID is optional, and a blank one is numbered after
 * the project code.
 */
const IMPORT_FIELDS: ImportField[] = [
    { key: 'project', label: 'Project (code or name)', required: true },
    { key: 'code', label: 'Story ID', required: false },
    { key: 'epic', label: 'Epic (ID or title, same project)', required: false },
    { key: 'title', label: 'Title', required: true },
    { key: 'asA', label: 'As a', required: false },
    { key: 'iWant', label: 'I want', required: false },
    { key: 'soThat', label: 'So that', required: false },
    { key: 'acceptanceCriteria', label: 'Acceptance criteria', required: false },
    { key: 'status', label: 'Status (BACKLOG/READY/IN_PROGRESS/DONE)', required: false },
    { key: 'priority', label: 'Priority (LOW/MEDIUM/HIGH/URGENT)', required: false },
    { key: 'storyPoints', label: 'Story points', required: false },
];

/**
 * Every project's user stories on one screen, as the same tree a project's
 * Backlog draws — grouped by project, opened to the stories, with each story's
 * tasks one click away. Stories are written, moved, re-sized and bulk-changed
 * here exactly as on the project's own Backlog; the spreadsheet import is the
 * one thing only this screen has.
 */
export default function ProjectStoriesPage() {
    const { t } = useI18n();
    const m = t.projects;
    const [importOpen, setImportOpen] = useState(false);

    return (
        <PageShell>
            <Suspense fallback={null}>
                <BacklogWorkspace
                    initialLevel="stories"
                    storageKey="project-backlog-expanded:all:stories"
                    header={({ newStory, reload }) => (
                        <>
                            <PageHeader
                                title={m.storyList.title}
                                subtitle={m.storyList.subtitle}
                                breadcrumbs={modulePageBreadcrumbs(
                                    t.dashboardHome.breadcrumbHome,
                                    t.sidebar.modules.projects,
                                    m.storyList.title,
                                    'projects',
                                )}
                                actions={
                                    <>
                                        <Button
                                            variant="secondary"
                                            className="min-h-touch"
                                            onClick={() => setImportOpen(true)}
                                        >
                                            <Upload className="h-4 w-4" />
                                            {t.common.import}
                                        </Button>
                                        <Button className="min-h-touch" onClick={newStory}>
                                            <Plus className="h-4 w-4" />
                                            {m.stories.add}
                                        </Button>
                                    </>
                                }
                            />
                            <ImportDialog
                                open={importOpen}
                                onClose={() => setImportOpen(false)}
                                entityLabel={m.storyList.title}
                                fields={IMPORT_FIELDS}
                                importFn={(rows, mode) => api.importProjectStories(rows, mode)}
                                onSuccess={() => void reload()}
                            />
                        </>
                    )}
                />
            </Suspense>
        </PageShell>
    );
}
