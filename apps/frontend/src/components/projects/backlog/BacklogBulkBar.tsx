'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, ConfirmDialog } from '@/components/ui';
import ChipPopover, { type ChipOption } from '@/components/projects/ChipPopover';
import { EPIC_STATUSES } from '@/components/projects/EpicFormModal';
import { useI18n } from '@/lib/i18n';
import type { ItemKind } from './backlog-rows';
import type { ColumnOption, MemberOption } from './use-backlog-options';

export interface SelectedItem {
    kind: ItemKind;
    id: string;
    projectId: string;
}

export type BulkAction =
    | { action: 'priority'; value: string }
    | { action: 'status'; value: string }
    | { action: 'move'; value: string | null }
    | { action: 'assignee'; value: string | null }
    | { action: 'delete' };

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const STORY_STATUSES = ['BACKLOG', 'READY', 'IN_PROGRESS', 'DONE'] as const;

/**
 * What can be done to the current selection, shown only while there is one.
 *
 * Priority and delete work on any mix. Status, "Move to" and assignee only
 * appear when the selection is one kind in one project, because each needs a
 * list that only makes sense there — an epic status is not a story status,
 * and a board column belongs to one project's board.
 */
export default function BacklogBulkBar({
    items,
    busy,
    onRun,
    onClear,
    moveTargets,
    columnsOf,
    membersOf,
    wantOptions,
}: {
    items: SelectedItem[];
    busy: boolean;
    onRun: (action: BulkAction) => void;
    onClear: () => void;
    /** The parents a story (epics) or task (stories) can move to, in a project. */
    moveTargets: (kind: 'story' | 'task', projectId: string) => ChipOption[];
    columnsOf: (projectId: string) => ColumnOption[] | null;
    membersOf: (projectId: string) => MemberOption[] | null;
    wantOptions: (projectId: string, what: 'columns' | 'members') => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const [confirming, setConfirming] = useState(false);
    if (items.length === 0) return null;

    const kinds = new Set(items.map((item) => item.kind));
    const projects = new Set(items.map((item) => item.projectId));
    const kind = kinds.size === 1 ? [...kinds][0] : null;
    const projectId = projects.size === 1 ? [...projects][0] : null;

    let statusOptions: ChipOption[] | null = null;
    if (kind === 'epic') statusOptions = EPIC_STATUSES.map((value) => ({ value, label: m.epics.statuses[value] }));
    else if (kind === 'story') statusOptions = STORY_STATUSES.map((value) => ({ value, label: m.stories.statuses[value] }));
    else if (kind === 'task' && projectId) {
        statusOptions = (columnsOf(projectId) ?? []).map((column) => ({ value: column.id, label: column.name }));
    }

    const members = kind === 'task' && projectId ? membersOf(projectId) : null;

    return (
        <div
            role="region"
            aria-label={m.backlog.bulkRegion}
            className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
        >
            <span className="font-medium text-blue-900">{fmt(m.backlog.selectedCount, { count: items.length })}</span>

            <ChipPopover
                label={m.backlog.bulkPriority}
                value=""
                display={m.backlog.bulkPriority}
                disabled={busy}
                options={PRIORITIES.map((value) => ({ value, label: m.priority[value] }))}
                onPick={(value) => value && onRun({ action: 'priority', value })}
            />

            {statusOptions ? (
                <ChipPopover
                    label={m.backlog.bulkStatus}
                    value=""
                    display={m.backlog.bulkStatus}
                    disabled={busy}
                    options={statusOptions}
                    note={kind === 'task' ? t.common.loading : undefined}
                    onOpen={() => kind === 'task' && projectId && wantOptions(projectId, 'columns')}
                    footer={kind === 'story' ? m.stories.statusDerived : undefined}
                    onPick={(value) => value && onRun({ action: 'status', value })}
                />
            ) : null}

            {(kind === 'story' || kind === 'task') && projectId ? (
                <ChipPopover
                    label={m.backlog.moveTo}
                    value=""
                    display={m.backlog.moveTo}
                    disabled={busy}
                    filterable
                    options={moveTargets(kind, projectId)}
                    emptyLabel={kind === 'story' ? m.backlog.noEpic : m.backlog.noStory}
                    onPick={(value) => onRun({ action: 'move', value: value || null })}
                />
            ) : null}

            {kind === 'task' && projectId ? (
                <ChipPopover
                    label={m.backlog.bulkAssignee}
                    value=""
                    display={m.backlog.bulkAssignee}
                    disabled={busy}
                    filterable
                    options={members ?? []}
                    note={members === null ? t.common.loading : m.backlog.noTeam}
                    emptyLabel={m.backlog.unassigned}
                    onOpen={() => wantOptions(projectId, 'members')}
                    onPick={(value) => onRun({ action: 'assignee', value: value || null })}
                />
            ) : null}

            {!kind || !projectId ? <span className="text-xs text-blue-900/70">{m.backlog.mixedSelection}</span> : null}

            <div className="ms-auto flex items-center gap-2">
                <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {m.backlog.bulkDelete}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
                    <X className="h-4 w-4" aria-hidden />
                    {m.backlog.clearSelection}
                </Button>
            </div>

            {confirming ? (
                <ConfirmDialog
                    open
                    title={m.backlog.bulkDelete}
                    prompt={fmt(m.backlog.bulkDeletePrompt, { count: items.length })}
                    confirmLabel={m.backlog.bulkDelete}
                    cancelLabel={t.common.cancel}
                    danger
                    onConfirm={() => {
                        setConfirming(false);
                        onRun({ action: 'delete' });
                    }}
                    onCancel={() => setConfirming(false)}
                />
            ) : null}
        </div>
    );
}
