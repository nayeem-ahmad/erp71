'use client';

import { Suspense, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button, PageHeader, PageShell } from '@/components/ui';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import BacklogWorkspace from '@/components/projects/backlog/BacklogWorkspace';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'project', label: 'Project (code or name)', required: true },
    { key: 'code', label: 'Epic ID', required: false },
    { key: 'title', label: 'Title', required: true },
    { key: 'description', label: 'Description', required: false },
    { key: 'status', label: 'Status (OPEN/IN_PROGRESS/DONE/CANCELLED)', required: false },
    { key: 'priority', label: 'Priority (LOW/MEDIUM/HIGH/URGENT)', required: false },
    { key: 'color', label: 'Colour (GRAY/BLUE/EMERALD/AMBER/RED/PURPLE)', required: false },
    { key: 'startDate', label: 'Start date', required: false },
    { key: 'targetDate', label: 'Target date', required: false },
];

/**
 * Every project's epics on one screen, as the same tree a project's Backlog
 * draws — grouped by project and folded to the epics, each carrying its
 * stories-done rollup, with the stories and tasks under it a click away.
 */
export default function ProjectEpicsPage() {
    const { t } = useI18n();
    const m = t.projects;
    const [importOpen, setImportOpen] = useState(false);

    return (
        <PageShell>
            <Suspense fallback={null}>
                <BacklogWorkspace
                    initialLevel="epics"
                    storageKey="project-backlog-expanded:all:epics"
                    header={({ newEpic, reload }) => (
                        <>
                            <PageHeader
                                title={m.epicList.title}
                                subtitle={m.epicList.subtitle}
                                breadcrumbs={modulePageBreadcrumbs(
                                    t.dashboardHome.breadcrumbHome,
                                    t.sidebar.modules.projects,
                                    m.epicList.title,
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
                                        <Button className="min-h-touch" onClick={newEpic}>
                                            <Plus className="h-4 w-4" />
                                            {m.epics.add}
                                        </Button>
                                    </>
                                }
                            />
                            <ImportDialog
                                open={importOpen}
                                onClose={() => setImportOpen(false)}
                                entityLabel={m.epicList.title}
                                fields={IMPORT_FIELDS}
                                importFn={(rows, mode) => api.importProjectEpics(rows, mode)}
                                onSuccess={() => void reload()}
                            />
                        </>
                    )}
                />
            </Suspense>
        </PageShell>
    );
}
