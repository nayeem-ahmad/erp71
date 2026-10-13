'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell, PageHeader, Button } from '@/components/ui';
import TaskCardSkeleton from '@/components/projects/task-card/TaskCardSkeleton';
import TaskUnavailable from '@/components/projects/task-card/TaskUnavailable';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/**
 * `/t/<key>` — the short task link "Copy link" hands out: `app.erp71.com/t/ERP-14`
 * rather than `/projects/tasks/<uuid>`.
 *
 * Resolves the key in the signed-in workspace and *replaces* this history entry
 * with the task's page, so Back returns to wherever the link was opened from
 * instead of bouncing through here. A key whose project code has since changed
 * still resolves (the API reads the code history), and a lower-case key typed
 * by hand matches too. Inside `(app)` so a signed-out visitor goes through
 * login and comes back here.
 */
export default function TaskShortLinkPage() {
    const { key } = useParams<{ key: string }>();
    const router = useRouter();
    const { t } = useI18n();
    const m = t.projects;
    const [failure, setFailure] = useState<'unavailable' | 'failed' | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setFailure(null);
        api.resolveTaskKey(decodeURIComponent(key))
            .then((found) => {
                if (!cancelled) router.replace(routes.projects.taskDetail(found.id));
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                // Same reading as the task page: a 404 or 403 is "not there for
                // you"; anything else is worth another try.
                const status = (error as { status?: unknown } | null)?.status;
                setFailure(status === 404 || status === 403 ? 'unavailable' : 'failed');
            });
        return () => {
            cancelled = true;
        };
    }, [key, router, attempt]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    return (
        <PageShell maxWidth="wide">
            <PageHeader title={m.task.title} />
            {failure ? (
                <TaskUnavailable
                    kind={failure}
                    onRetry={retry}
                    action={
                        <Button type="button" onClick={() => router.push(routes.projects.tasks)}>
                            {m.task.goToTasks}
                        </Button>
                    }
                />
            ) : (
                <TaskCardSkeleton presentation="page" />
            )}
        </PageShell>
    );
}
