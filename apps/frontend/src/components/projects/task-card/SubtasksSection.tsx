'use client';

import Link from 'next/link';
import { CompactSection } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { taskKeyOf, type Task } from './model';
import StatusDot from './StatusDot';

/**
 * The subtasks a task already has, read-only.
 *
 * Subtasks on the card are still Phase 3E, postponed on request on 2026-08-03 —
 * there is no way to add one from here, and this does not add one. But
 * `findOne` has always returned them with their columns, and a parent whose
 * card never mentioned its children left them findable only by searching. So
 * they are listed, each linking to its own page, and nothing is drawn at all
 * for a task that has none.
 */
export default function SubtasksSection({ task }: { task: Task }) {
    const { t } = useI18n();
    const m = t.projects;
    const subtasks = task.subtasks ?? [];
    if (subtasks.length === 0) return null;

    const done = subtasks.filter((sub) => sub.status?.category === 'DONE').length;

    return (
        <CompactSection
            titleStyle="heading"
            title={
                <>
                    {m.task.subtasks}
                    <span className="ms-2 text-xs font-normal text-gray-500">
                        {done === subtasks.length
                            ? m.checklist.allDone
                            : m.checklist.progress
                                  .replace('{done}', String(done))
                                  .replace('{total}', String(subtasks.length))}
                    </span>
                </>
            }
        >
            <ul className="-mx-2 space-y-0.5">
                {subtasks.map((sub) => {
                    const key = taskKeyOf(sub.reference, task.project);
                    const finished = sub.status?.category === 'DONE';
                    return (
                        <li key={sub.id}>
                            <Link
                                href={routes.projects.taskDetail(sub.id)}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-gray-50 max-md:min-h-touch"
                            >
                                <StatusDot category={sub.status?.category} />
                                {key && (
                                    <span className="shrink-0 text-xs font-medium tabular-nums text-gray-500">
                                        {key}
                                    </span>
                                )}
                                <span
                                    className={`min-w-0 flex-1 truncate ${
                                        finished ? 'text-gray-400 line-through' : 'text-gray-900'
                                    }`}
                                >
                                    {sub.title}
                                </span>
                                {sub.status && (
                                    <span className="shrink-0 text-xs text-gray-500">{sub.status.name}</span>
                                )}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </CompactSection>
    );
}
