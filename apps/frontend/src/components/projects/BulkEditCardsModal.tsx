'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '../ModalShell';
import { Button, Field, Input, Select } from '@/components/ui';
import { api, type BulkTaskChanges } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { labelClass, type BoardSprint, type ProjectLabel } from './board-tasks';
import type { ProjectMeta } from './use-project-meta';

/** The "clear it" choice in the sprint and assignee selects; `''` is "leave it". */
const NONE = 'none';
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;

type DueMode = '' | 'set' | 'clear';

/**
 * One change set over the cards picked out on a board.
 *
 * Every field opens on "Leave unchanged" and only the ones moved off it are
 * sent, so editing the sprint of five cards from three projects cannot quietly
 * reset their assignees to whatever the first card held. Labels are added and
 * removed rather than replaced for the same reason: a selection rarely shares
 * one label set, and "tag these Blocked" must not strip what else each carries.
 *
 * The dialog only gathers the change. The board sends it, in one request, and
 * reports what the server could and could not apply.
 */
export default function BulkEditCardsModal({
    count,
    projectIds,
    projects,
    labels,
    assignees,
    projectMeta,
    busy,
    onSubmit,
    onClose,
}: {
    count: number;
    /** The projects the selected cards come from, whose teams the assignee picker offers. */
    projectIds: string[];
    projects: { id: string; code: string; name: string }[];
    labels: ProjectLabel[];
    /** Whoever holds a card on the board now — `user:<id>` / `employee:<id>` keys. */
    assignees: { key: string; label: string }[];
    /** The board's roster cache, so a team read here is not read again by the composer. */
    projectMeta: {
        load: (projectId: string) => Promise<ProjectMeta>;
        peek: (projectId: string) => ProjectMeta | undefined;
    };
    busy: boolean;
    onSubmit: (changes: BulkTaskChanges) => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects.boards;
    const f = t.projects.board.filters;
    const id = useId();

    const [projectId, setProjectId] = useState('');
    const [sprintId, setSprintId] = useState('');
    const [assignee, setAssignee] = useState('');
    const [priority, setPriority] = useState('');
    const [dueMode, setDueMode] = useState<DueMode>('');
    const [dueDate, setDueDate] = useState('');
    const [adding, setAdding] = useState<string[]>([]);
    const [removing, setRemoving] = useState<string[]>([]);
    const [sprints, setSprints] = useState<BoardSprint[]>([]);

    // Every open sprint in the workspace, not just the ones on the board:
    // moving cards into next sprint is the usual reason to reach for this.
    // A failure only empties the list — "No sprint" still works.
    useEffect(() => {
        api.getSprints()
            .then((list: unknown) =>
                setSprints(
                    (Array.isArray(list) ? (list as BoardSprint[]) : []).filter(
                        (sprint) => sprint.status !== 'COMPLETED',
                    ),
                ),
            )
            .catch(() => setSprints([]));
    }, []);

    // The teams of the projects the cards are in, and of the project they are
    // moving to. Cached by the board, so reopening the dialog reads nothing.
    const rosterIds = useMemo(
        () => [...new Set([...projectIds, ...(projectId ? [projectId] : [])])],
        [projectIds, projectId],
    );
    // Keyed off `load`, which is stable; the object around it is new every render.
    const { load } = projectMeta;
    useEffect(() => {
        for (const rosterId of rosterIds) void load(rosterId);
    }, [rosterIds, load]);

    const assigneeOptions = (() => {
        const byKey = new Map(assignees.map((option) => [option.key, option.label]));
        for (const rosterId of rosterIds) {
            for (const member of projectMeta.peek(rosterId)?.assignees ?? []) {
                byKey.set(member.value, member.label);
            }
        }
        return [...byKey.entries()]
            .map(([key, label]) => ({ key, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    })();

    const changes: BulkTaskChanges = {
        ...(projectId ? { projectId } : {}),
        ...(sprintId ? { sprintId: sprintId === NONE ? null : sprintId } : {}),
        ...(assignee ? { assignee: assignee === NONE ? null : assignee } : {}),
        ...(priority ? { priority } : {}),
        ...(dueMode === 'clear' ? { dueDate: null } : {}),
        ...(dueMode === 'set' && dueDate ? { dueDate } : {}),
        ...(adding.length > 0 ? { addLabelIds: adding } : {}),
        ...(removing.length > 0 ? { removeLabelIds: removing } : {}),
    };
    const changed = Object.keys(changes).length > 0;

    /** A label is added or removed, never both: picking it on one side takes it off the other. */
    const toggleLabel = (labelId: string, side: 'add' | 'remove') => {
        const [mine, setMine, setOther] =
            side === 'add' ? [adding, setAdding, setRemoving] : [removing, setRemoving, setAdding];
        if (mine.includes(labelId)) {
            setMine(mine.filter((other) => other !== labelId));
            return;
        }
        setMine([...mine, labelId]);
        setOther((other) => other.filter((otherId) => otherId !== labelId));
    };

    const labelGroup = (side: 'add' | 'remove', name: string, picked: string[]) => (
        <Field label={name}>
            <div role="group" aria-label={name} className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                    const on = picked.includes(label.id);
                    return (
                        <button
                            key={label.id}
                            type="button"
                            aria-pressed={on}
                            disabled={busy}
                            onClick={() => toggleLabel(label.id, side)}
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium max-md:min-h-touch ${labelClass(label.color)} ${
                                on ? 'ring-2 ring-blue-600 ring-offset-1' : 'opacity-70 hover:opacity-100'
                            }`}
                        >
                            {on && <Check aria-hidden className="h-3 w-3" />}
                            {label.name}
                        </button>
                    );
                })}
            </div>
        </Field>
    );

    return (
        <ModalShell size="sm" onBackdropClick={busy ? undefined : onClose} dismissOnBackdrop={!changed}>
            <ModalHeader
                title={count === 1 ? m.bulkEditTitleOne : m.bulkEditTitle.replace('{count}', String(count))}
                subtitle={m.bulkEditHint}
                onClose={busy ? undefined : onClose}
            />
            <div className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2">
                <Field
                    label={m.bulkProject}
                    htmlFor={`${id}-project`}
                    hint={projectId ? m.bulkProjectHint : undefined}
                    className="sm:col-span-2"
                >
                    <Select
                        id={`${id}-project`}
                        value={projectId}
                        disabled={busy}
                        onChange={(e) => setProjectId(e.target.value)}
                    >
                        <option value="">{m.bulkLeave}</option>
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.code} · {project.name}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={m.bulkSprint} htmlFor={`${id}-sprint`}>
                    <Select
                        id={`${id}-sprint`}
                        value={sprintId}
                        disabled={busy}
                        onChange={(e) => setSprintId(e.target.value)}
                    >
                        <option value="">{m.bulkLeave}</option>
                        <option value={NONE}>{m.bulkNoSprint}</option>
                        {sprints.map((sprint) => (
                            <option key={sprint.id} value={sprint.id}>
                                {sprint.status === 'ACTIVE'
                                    ? f.sprintActive.replace('{name}', sprint.name)
                                    : sprint.name}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={m.bulkAssignee} htmlFor={`${id}-assignee`}>
                    <Select
                        id={`${id}-assignee`}
                        value={assignee}
                        disabled={busy}
                        onChange={(e) => setAssignee(e.target.value)}
                    >
                        <option value="">{m.bulkLeave}</option>
                        <option value={NONE}>{m.bulkUnassigned}</option>
                        {assigneeOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={m.bulkPriority} htmlFor={`${id}-priority`}>
                    <Select
                        id={`${id}-priority`}
                        value={priority}
                        disabled={busy}
                        onChange={(e) => setPriority(e.target.value)}
                    >
                        <option value="">{m.bulkLeave}</option>
                        {PRIORITIES.map((value) => (
                            <option key={value} value={value}>
                                {t.projects.priority[value]}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={m.bulkDue} htmlFor={`${id}-due`}>
                    <Select
                        id={`${id}-due`}
                        value={dueMode}
                        disabled={busy}
                        onChange={(e) => setDueMode(e.target.value as DueMode)}
                    >
                        <option value="">{m.bulkLeave}</option>
                        <option value="set">{m.bulkDueSet}</option>
                        <option value="clear">{m.bulkDueClear}</option>
                    </Select>
                </Field>

                {dueMode === 'set' && (
                    <Field label={m.bulkDueDate} htmlFor={`${id}-due-date`} className="sm:col-start-2">
                        <Input
                            id={`${id}-due-date`}
                            type="date"
                            value={dueDate}
                            disabled={busy}
                            onChange={(e) => setDueDate(e.target.value)}
                        />
                    </Field>
                )}

                {labels.length > 0 && (
                    <div className="space-y-3 sm:col-span-2">
                        {labelGroup('add', m.bulkAddLabels, adding)}
                        {labelGroup('remove', m.bulkRemoveLabels, removing)}
                    </div>
                )}
            </div>
            <ModalFooter>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {t.common.cancel}
                </Button>
                <Button onClick={() => onSubmit(changes)} loading={busy} disabled={busy || !changed}>
                    {count === 1 ? m.bulkApplyOne : m.bulkApply.replace('{count}', String(count))}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
