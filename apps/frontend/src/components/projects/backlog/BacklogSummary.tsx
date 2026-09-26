'use client';

import Link from 'next/link';
import { ListTree } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

interface SummaryEpic {
    status: string;
}

interface SummaryStory {
    status: string;
    story_points?: number | null;
}

/**
 * How much scope a project holds and how much of it is done, on the project
 * page. It replaces the epic and story cards that used to sit there: those were
 * a second, smaller editor for what the Backlog now edits in full, and two
 * editors for the same rows drift apart. This keeps the numbers in view and
 * makes the Backlog one click away.
 */
export default function BacklogSummary({
    projectId,
    epics,
    stories,
}: {
    projectId: string;
    /** Null while loading. */
    epics: SummaryEpic[] | null;
    stories: SummaryStory[] | null;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const loading = epics === null || stories === null;
    const doneStories = (stories ?? []).filter((story) => story.status === 'DONE');
    const points = (stories ?? []).reduce((sum, story) => sum + (story.story_points ?? 0), 0);
    const donePoints = doneStories.reduce((sum, story) => sum + (story.story_points ?? 0), 0);
    const doneEpics = (epics ?? []).filter((epic) => epic.status === 'DONE').length;
    const percent = stories && stories.length > 0 ? Math.round((doneStories.length / stories.length) * 100) : 0;
    const empty = !loading && (epics ?? []).length === 0 && (stories ?? []).length === 0;

    return (
        <section className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                <h2 className="text-sm font-medium">{m.backlog.title}</h2>
                <Link href={routes.projects.backlog(projectId)}>
                    <Button variant="secondary" size="sm" className="min-h-touch md:min-h-0">
                        <ListTree className="h-4 w-4" aria-hidden />
                        {m.backlog.openBacklog}
                    </Button>
                </Link>
            </div>
            {loading ? (
                <p className="p-3 text-sm text-gray-500">{t.common.loading}</p>
            ) : empty ? (
                <p className="p-3 text-sm text-gray-500">{m.backlog.empty}</p>
            ) : (
                <div className="space-y-2 p-3">
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                        <Stat label={m.epics.title} value={fmt(m.backlog.doneOf, { done: doneEpics, total: epics?.length ?? 0 })} />
                        <Stat
                            label={m.stories.title}
                            value={fmt(m.backlog.doneOf, { done: doneStories.length, total: stories?.length ?? 0 })}
                        />
                        <Stat label={m.stories.points} value={fmt(m.backlog.doneOf, { done: donePoints, total: points })} />
                    </dl>
                    <div className="flex items-center gap-2" title={`${percent}%`}>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200" aria-hidden>
                            <span className="block h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                        </span>
                        <span className="text-xs tabular-nums text-gray-500">
                            {fmt(m.backlog.storiesDonePercent, { percent })}
                        </span>
                    </div>
                </div>
            )}
        </section>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="font-medium tabular-nums text-gray-900">{value}</dd>
        </div>
    );
}
