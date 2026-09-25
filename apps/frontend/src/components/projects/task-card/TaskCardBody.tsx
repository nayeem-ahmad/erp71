'use client';

import { useState } from 'react';
import type { RecordTab, Task } from './model';
import type { TaskCard } from './useTaskCard';
import DetailsCard from './DetailsCard';
import TimeCard from './TimeCard';
import DescriptionSection from './DescriptionSection';
import ChecklistSection from './ChecklistSection';
import SubtasksSection from './SubtasksSection';
import RecordCard from './RecordCard';

export type TaskCardPresentation = 'modal' | 'page';

/**
 * The card's content, with no shell around it — a modal (the default, and how
 * every list and board opens a card) or the page at `/projects/tasks/<id>`.
 *
 * Trello's card, in two columns: the work itself in the wide one, everything
 * that merely describes it beside it. The sidebar sits first in the source so a
 * phone reaches status and assignee before scrolling, and is placed to the
 * right from the breakpoint up.
 *
 * Every section is a white card on the grey canvas. The body was drawn for the
 * modal's white panel, and when the page put it on the canvas as it was, its
 * outlined sections read as a wireframe. The modal's scroller carries the same
 * canvas now, so both presentations look like the same card.
 *
 * What differs by presentation, and only this:
 * - The grid. The page's sidebar is a fixed 20rem from `lg`, where a third of
 *   a wide screen put captions and values three hundred pixels apart; the
 *   modal is one fixed width and keeps its thirds from `md`.
 * - Whether a record tab starts open. The page opens on Comments: it was
 *   navigated to on purpose, and a strip over nothing looked unfinished. The
 *   modal starts closed, because the feed fetches on mount and a card opened
 *   from a board is a peek — three requests, not six.
 */
export function TaskCardBody({
    task,
    card,
    presentation = 'modal',
    recordTab,
    onRecordTabChange,
}: {
    task: Task;
    card: TaskCard;
    presentation?: TaskCardPresentation;
    /** Drives the record tab from outside — the page keeps it in the URL. */
    recordTab?: RecordTab | null;
    onRecordTabChange?: (next: RecordTab | null) => void;
}) {
    const page = presentation === 'page';
    const [ownTab, setOwnTab] = useState<RecordTab | null>(page ? 'comments' : null);
    const tab = recordTab !== undefined ? recordTab : ownTab;
    const setTab = onRecordTabChange ?? setOwnTab;

    return (
        /* `grid-cols-1` is not decoration. Without a base column count only the
           breakpoint's template is declared, so below it the grid falls back to
           a single *implicit* track, and an implicit track is `auto` — it sizes
           to its widest content rather than to the grid. Measured on a phone:
           one 574px track inside a 302px grid, clipping the chips off the right
           edge with no scroll to reach them. */
        <div
            className={`grid grid-cols-1 gap-4 ${
                page ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : 'md:grid-cols-3'
            }`}
        >
            {/* `min-w-0` is load-bearing: a grid item defaults to
                `min-width: auto`, which refuses to shrink below its content. */}
            <aside
                className={`min-w-0 space-y-4 ${
                    page ? 'lg:col-start-2 lg:row-start-1' : 'md:col-start-3 md:row-start-1'
                }`}
            >
                <DetailsCard task={task} card={card} />
                <TimeCard task={task} card={card} />
            </aside>

            <div
                className={`min-w-0 space-y-4 ${
                    page ? 'lg:col-start-1 lg:row-start-1' : 'md:col-span-2 md:col-start-1 md:row-start-1'
                }`}
            >
                <DescriptionSection
                    description={task.description ?? ''}
                    taskId={task.id}
                    onSaved={card.apply}
                />
                <ChecklistSection
                    taskId={task.id}
                    items={task.checklistItems ?? []}
                    onChanged={card.refresh}
                />
                <SubtasksSection task={task} />
                <RecordCard task={task} card={card} value={tab} onChange={setTab} />
            </div>
        </div>
    );
}
