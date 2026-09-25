'use client';

import type { ReactNode } from 'react';
import { SearchX, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

/**
 * What the card says when its task will not load — in place of the "Loading…"
 * it used to show for ever.
 *
 * `unavailable` is a 404 or a 403: the task was deleted, or it sits in a
 * private project the reader is not on. The API cannot say which without
 * leaking that a hidden task exists, so the message covers both. `failed` is
 * anything else — a dropped connection, a 500 — and is worth another try.
 */
export default function TaskUnavailable({
    kind,
    onRetry,
    action,
}: {
    kind: 'unavailable' | 'failed';
    onRetry: () => void;
    /** Where to go instead, for an unavailable task — the page offers the task list. */
    action?: ReactNode;
}) {
    const { t } = useI18n();
    const m = t.projects.task;
    const Icon = kind === 'unavailable' ? SearchX : WifiOff;

    return (
        <section
            role="alert"
            className={`${compactDensity.card} flex flex-col items-center gap-2 py-10 text-center`}
        >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
                <Icon className="h-5 w-5 text-gray-500" aria-hidden />
            </span>
            <h2 className="mt-1 text-sm font-semibold text-gray-900">
                {kind === 'unavailable' ? m.unavailableTitle : m.loadFailed}
            </h2>
            {kind === 'unavailable' && (
                <p className="max-w-sm text-sm text-gray-500">{m.unavailableBody}</p>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
                {kind === 'failed' ? (
                    <Button type="button" onClick={onRetry}>
                        {t.common.refresh}
                    </Button>
                ) : (
                    action
                )}
            </div>
        </section>
    );
}
