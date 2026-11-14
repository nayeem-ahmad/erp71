'use client';

import { useMemo, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import FilterBar, { type ResolvedListFilter } from '@/components/data-table/FilterBar';
import { Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { tenantDateOnly } from '@/lib/created-range';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { assigneeOptions, laneKeyOf, NO_LANE } from './sprint-table';
import { columnKeyOf, type SprintCardTask } from './sprint-cards';
import {
    DUE_PRESETS,
    PRIORITIES,
    TIME_FLAGS,
    UPDATED_PRESETS,
    filterSprintTasks,
    matchesDuePreset,
    matchesTimeFlag,
    matchesUpdatedPreset,
    type DuePreset,
    type SprintFilterState,
    type TimeFlag,
    type UpdatedPreset,
} from './sprint-filters';

const CATEGORY_RANK: Record<string, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

/**
 * Search plus the sprint's filters on one line, the same bar a sales list uses:
 * the few people reach for sit as chips, the rest behind More, and a narrow
 * window moves the trailing chips into More rather than wrapping the row.
 * On a phone the row scrolls if the search, More and the view controls still
 * do not fit.
 */
export default function SprintFilterRow({
    tasks,
    userId,
    filters,
    onChange,
    children,
}: {
    tasks: SprintCardTask[];
    userId: string | null;
    filters: SprintFilterState;
    onChange: (update: SprintFilterState | ((prev: SprintFilterState) => SprintFilterState)) => void;
    children?: ReactNode;
}) {
    const { t } = useI18n();
    const copy = t.projects.sprint.filters;
    const today = tenantDateOnly();
    const ctx = useMemo(() => ({ today, userId }), [today, userId]);

    const patch = (partial: Partial<SprintFilterState>) => onChange((prev) => ({ ...prev, ...partial }));

    const listFilters = useMemo<ResolvedListFilter[]>(() => {
        const count = (dimension: Parameters<typeof filterSprintTasks>[3], pick: (task: SprintCardTask) => boolean) =>
            filterSprintTasks(tasks, filters, ctx, dimension).filter(pick).length;

        const holders = assigneeOptions(tasks).filter((option) => option.key !== NO_LANE);
        const assigneeOptionsWithMe = [
            { value: 'me', label: copy.me },
            ...holders.map((option) => ({ value: option.key, label: option.label ?? copy.unassigned })),
            { value: 'unassigned', label: copy.unassigned },
        ].map((option) => ({
            ...option,
            count: count('assignee', (task) => {
                const key = laneKeyOf(task, 'assignee');
                if (option.value === 'me') return userId != null && key === `user:${userId}`;
                if (option.value === 'unassigned') return key === NO_LANE;
                return key === option.value;
            }),
        }));

        const statuses = new Map<string, { name: string; category: string }>();
        const labels = new Map<string, string>();
        for (const task of tasks) {
            if (task.status) {
                const key = columnKeyOf(task.status.name);
                if (!statuses.has(key)) {
                    statuses.set(key, { name: task.status.name.trim(), category: task.status.category });
                }
            }
            for (const entry of task.labels ?? []) {
                if (!labels.has(entry.label.id)) labels.set(entry.label.id, entry.label.name);
            }
        }
        const statusOptions = [...statuses.entries()]
            .sort(
                (a, b) =>
                    (CATEGORY_RANK[a[1].category] ?? 1) - (CATEGORY_RANK[b[1].category] ?? 1) ||
                    a[1].name.localeCompare(b[1].name),
            )
            .map(([value, status]) => ({
                value,
                label: status.name,
                count: count('status', (task) => (task.status ? columnKeyOf(task.status.name) === value : false)),
            }));

        const dueRange: CreatedRange | null =
            filters.dueFrom || filters.dueTo
                ? { ...(filters.dueFrom ? { from: filters.dueFrom } : {}), ...(filters.dueTo ? { to: filters.dueTo } : {}) }
                : null;
        const updatedRange: CreatedRange | null =
            filters.updatedFrom || filters.updatedTo
                ? {
                      ...(filters.updatedFrom ? { from: filters.updatedFrom } : {}),
                      ...(filters.updatedTo ? { to: filters.updatedTo } : {}),
                  }
                : null;

        const carriedBase = filterSprintTasks(tasks, filters, ctx, 'carried');
        const carriedYes = carriedBase.filter((task) => task.carried_in === true).length;
        const carriedNo = carriedBase.length - carriedYes;

        const filtersForBar: ResolvedListFilter[] = [
            {
                id: 'assignee',
                type: 'multi-select',
                label: copy.assignee,
                options: assigneeOptionsWithMe,
                value: filters.assignee,
                onChange: (assignee) => patch({ assignee }),
            },
            {
                id: 'status',
                type: 'multi-select',
                label: copy.status,
                options: statusOptions,
                value: filters.status,
                onChange: (status) => patch({ status }),
            },
            {
                id: 'hideDone',
                type: 'toggle',
                label: copy.hideDone,
                pressed: filters.hideDone,
                onChange: (hideDone) => patch({ hideDone }),
            },
            {
                id: 'priority',
                type: 'multi-select',
                label: copy.priority,
                options: PRIORITIES.map((value) => ({
                    value,
                    label: t.projects.priority[value],
                    count: count('priority', (task) => task.priority === value),
                })),
                value: filters.priority,
                onChange: (priority) => patch({ priority }),
            },
            {
                id: 'due',
                type: 'multi-select',
                label: copy.due,
                options: DUE_PRESETS.map((value) => ({
                    value,
                    label: { overdue: copy.overdue, today: copy.today, week: copy.thisWeek }[value],
                    count: count('due', (task) => matchesDuePreset(task, value as DuePreset, today)),
                })),
                value: filters.due,
                onChange: (due) =>
                    patch({
                        due: due.filter((value): value is DuePreset => (DUE_PRESETS as readonly string[]).includes(value)),
                    }),
            },
            {
                id: 'dueBetween',
                type: 'date-range',
                label: copy.dueBetween,
                value: dueRange,
                presets: [],
                onChange: (next) => patch({ dueFrom: next?.from ?? '', dueTo: next?.to ?? '' }),
            },
            {
                id: 'time',
                type: 'multi-select',
                label: copy.time,
                more: true,
                options: TIME_FLAGS.map((value) => ({
                    value,
                    label: { over: copy.overEstimate, none: copy.noHours, 'no-estimate': copy.noEstimate }[value],
                    count: count('time', (task) => matchesTimeFlag(task, value as TimeFlag)),
                })),
                value: filters.time,
                onChange: (time) =>
                    patch({
                        time: time.filter((value): value is TimeFlag => (TIME_FLAGS as readonly string[]).includes(value)),
                    }),
            },
            {
                id: 'hours',
                type: 'number',
                label: copy.loggedHours,
                more: true,
                value: filters.hours,
                onChange: (hours: NumberCondition | null) => patch({ hours }),
            },
            {
                id: 'labels',
                type: 'multi-select',
                label: copy.labels,
                more: true,
                options: [...labels.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([value, label]) => ({
                        value,
                        label,
                        count: count('labels', (task) => (task.labels ?? []).some((entry) => entry.label.id === value)),
                    })),
                value: filters.labels,
                onChange: (next) => patch({ labels: next }),
            },
            {
                id: 'carried',
                type: 'select',
                label: copy.carried,
                more: true,
                options: [
                    { value: 'yes', label: `${copy.carriedYes} (${carriedYes})` },
                    { value: 'no', label: `${copy.carriedNo} (${carriedNo})` },
                ],
                value: filters.carried || null,
                onChange: (next) => patch({ carried: next === 'yes' || next === 'no' ? next : '' }),
            },
            {
                id: 'updated',
                type: 'multi-select',
                label: copy.updated,
                more: true,
                options: UPDATED_PRESETS.map((value) => ({
                    value,
                    label: { d2: copy.stale2, d3: copy.stale3, d7: copy.stale7 }[value],
                    count: count('updated', (task) => matchesUpdatedPreset(task, value as UpdatedPreset, today)),
                })),
                value: filters.updated,
                onChange: (updated) =>
                    patch({
                        updated: updated.filter((value): value is UpdatedPreset =>
                            (UPDATED_PRESETS as readonly string[]).includes(value),
                        ),
                    }),
            },
            {
                id: 'updatedBetween',
                type: 'date-range',
                label: copy.updatedBetween,
                more: true,
                value: updatedRange,
                presets: [],
                onChange: (next) => patch({ updatedFrom: next?.from ?? '', updatedTo: next?.to ?? '' }),
            },
        ];
        return filtersForBar;
        // `patch` closes over the latest filters setter. Rebuilding the bar when
        // the tasks or the choices change is the point of this memo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks, filters, ctx, copy, t.projects.priority, today, userId]);

    return (
        <div className="rounded-md border border-gray-200 bg-white p-2" data-testid="sprint-filters">
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
                <div className="relative w-36 shrink-0 sm:w-44 lg:w-56">
                    <Search
                        className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                        aria-hidden
                    />
                    <Input
                        type="search"
                        value={filters.q}
                        onChange={(event) => patch({ q: event.target.value })}
                        placeholder={t.projects.sprint.searchTasks}
                        aria-label={t.projects.sprint.searchTasks}
                        className="w-full ps-8"
                    />
                </div>
                <FilterBar filters={listFilters} compact={false} layout="row" />
                {children ? <div className="ms-auto flex shrink-0 items-center gap-1.5">{children}</div> : null}
            </div>
        </div>
    );
}
