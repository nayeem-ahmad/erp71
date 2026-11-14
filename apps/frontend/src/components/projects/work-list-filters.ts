/**
 * Query-string and in-memory filters for the project lists that already hold
 * every row (stories, epics, boards) and the Tasks page's shareable view.
 *
 * Counts ignore one dimension, the same way the sprint page does, so a tick
 * shows how many rows it would add.
 */

import type { CreatedRange } from '@/lib/created-range';
import { numberConditionParam, type NumberCondition } from '@/lib/number-condition';
import { dueDay, updatedDay, type DuePreset, type UpdatedPreset } from './sprint-filters';

export function asList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (typeof value === 'string' && value) return [value];
    return [];
}

function readList(params: URLSearchParams, key: string): string[] {
    return params
        .getAll(key)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
}

function readDay(params: URLSearchParams, key: string): string {
    const value = params.get(key)?.slice(0, 10) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function appendAll(params: URLSearchParams, key: string, values: readonly string[]) {
    for (const value of values) params.append(key, value);
}

function keepUnknown(current: URLSearchParams, owned: readonly string[]): URLSearchParams {
    const next = new URLSearchParams();
    const names = new Set(owned);
    for (const [key, value] of current.entries()) {
        if (!names.has(key)) next.append(key, value);
    }
    return next;
}

export function inDayRange(value: string | null | undefined, from: string, to: string, timestamp: boolean): boolean {
    if (!from && !to) return true;
    const day = timestamp ? updatedDay(value) : dueDay(value ?? null);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
}

export function matchesNumber(value: number | null | undefined, condition: NumberCondition | null): boolean {
    if (!condition) return true;
    if (value == null || Number.isNaN(value)) return false;
    if (condition.op === 'gt') return value > condition.value;
    if (condition.op === 'lt') return value < condition.value;
    if (condition.op === 'eq') return value === condition.value;
    const upper = condition.to ?? condition.value;
    return value >= Math.min(condition.value, upper) && value <= Math.max(condition.value, upper);
}

function matchesOwner(selected: readonly string[], owner: string | null, userId: string | null): boolean {
    if (selected.length === 0) return true;
    const ids = selected.flatMap((id) => (id === 'me' ? (userId ? [userId] : []) : [id]));
    // "Me" before we know who that is matches nobody, rather than everybody.
    if (selected.includes('me') && !userId && ids.length === 0) return false;
    return anyOf(ids, owner, !owner);
}

function anyOf(selected: readonly string[], value: string | null | undefined, none: boolean): boolean {
    if (selected.length === 0) return true;
    return selected.some((item) => (item === 'none' ? none : item === value));
}

export interface StoryFilterState {
    search: string;
    projectIds: string[];
    statuses: string[];
    priorities: string[];
    epicIds: string[];
    ownerIds: string[];
    createdFrom: string;
    createdTo: string;
    updatedFrom: string;
    updatedTo: string;
    points: NumberCondition | null;
}

export const EMPTY_STORY_FILTERS: StoryFilterState = {
    search: '',
    projectIds: [],
    statuses: [],
    priorities: [],
    epicIds: [],
    ownerIds: [],
    createdFrom: '',
    createdTo: '',
    updatedFrom: '',
    updatedTo: '',
    points: null,
};

export interface StoryLike {
    code?: string | null;
    title?: string | null;
    i_want?: string | null;
    status?: string | null;
    priority?: string | null;
    story_points?: number | null;
    project?: { id: string } | null;
    epic?: { id: string } | null;
    creator?: { id: string } | null;
    created_by?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export type StoryFilterDimension = 'search' | 'project' | 'status' | 'priority' | 'epic' | 'owner' | 'created' | 'updated' | 'points';

export function storyMatches(story: StoryLike, filters: StoryFilterState, userId: string | null, omit?: StoryFilterDimension): boolean {
    if (omit !== 'search') {
        const term = filters.search.trim().toLowerCase();
        if (term) {
            const hay = `${story.code ?? ''} ${story.title ?? ''} ${story.i_want ?? ''}`.toLowerCase();
            if (!hay.includes(term)) return false;
        }
    }
    if (omit !== 'project' && !anyOf(filters.projectIds, story.project?.id, false)) return false;
    if (omit !== 'status' && filters.statuses.length && !filters.statuses.includes(story.status ?? '')) return false;
    if (omit !== 'priority' && filters.priorities.length && !filters.priorities.includes(story.priority ?? '')) return false;
    if (omit !== 'epic' && !anyOf(filters.epicIds, story.epic?.id ?? null, !story.epic?.id)) return false;
    if (omit !== 'owner' && !matchesOwner(filters.ownerIds, story.creator?.id ?? story.created_by ?? null, userId)) return false;
    if (omit !== 'created' && !inDayRange(story.created_at, filters.createdFrom, filters.createdTo, true)) return false;
    if (omit !== 'updated' && !inDayRange(story.updated_at, filters.updatedFrom, filters.updatedTo, true)) return false;
    if (omit !== 'points' && !matchesNumber(story.story_points, filters.points)) return false;
    return true;
}

export function filterStories<T extends StoryLike>(stories: readonly T[], filters: StoryFilterState, userId: string | null, omit?: StoryFilterDimension): T[] {
    return stories.filter((story) => storyMatches(story, filters, userId, omit));
}

export interface EpicFilterState {
    search: string;
    projectIds: string[];
    statuses: string[];
    priorities: string[];
    ownerIds: string[];
    startFrom: string;
    startTo: string;
    targetFrom: string;
    targetTo: string;
    createdFrom: string;
    createdTo: string;
}

export const EMPTY_EPIC_FILTERS: EpicFilterState = {
    search: '',
    projectIds: [],
    statuses: [],
    priorities: [],
    ownerIds: [],
    startFrom: '',
    startTo: '',
    targetFrom: '',
    targetTo: '',
    createdFrom: '',
    createdTo: '',
};

export interface EpicLike {
    code?: string | null;
    title?: string | null;
    status?: string | null;
    priority?: string | null;
    project?: { id: string } | null;
    creator?: { id: string } | null;
    created_by?: string | null;
    start_date?: string | null;
    target_date?: string | null;
    created_at?: string | null;
}

export type EpicFilterDimension = 'search' | 'project' | 'status' | 'priority' | 'owner' | 'start' | 'target' | 'created';

export function epicMatches(epic: EpicLike, filters: EpicFilterState, userId: string | null, omit?: EpicFilterDimension): boolean {
    if (omit !== 'search') {
        const term = filters.search.trim().toLowerCase();
        if (term && !`${epic.code ?? ''} ${epic.title ?? ''}`.toLowerCase().includes(term)) return false;
    }
    if (omit !== 'project' && !anyOf(filters.projectIds, epic.project?.id, false)) return false;
    if (omit !== 'status' && filters.statuses.length && !filters.statuses.includes(epic.status ?? '')) return false;
    if (omit !== 'priority' && filters.priorities.length && !filters.priorities.includes(epic.priority ?? '')) return false;
    if (omit !== 'owner' && !matchesOwner(filters.ownerIds, epic.creator?.id ?? epic.created_by ?? null, userId)) return false;
    if (omit !== 'start' && !inDayRange(epic.start_date, filters.startFrom, filters.startTo, false)) return false;
    if (omit !== 'target' && !inDayRange(epic.target_date, filters.targetFrom, filters.targetTo, false)) return false;
    if (omit !== 'created' && !inDayRange(epic.created_at, filters.createdFrom, filters.createdTo, true)) return false;
    return true;
}

export function filterEpics<T extends EpicLike>(epics: readonly T[], filters: EpicFilterState, userId: string | null, omit?: EpicFilterDimension): T[] {
    return epics.filter((epic) => epicMatches(epic, filters, userId, omit));
}

export interface BoardFilterState {
    search: string;
    cards: '' | 'with' | 'empty';
    projectIds: string[];
    ownerIds: string[];
    createdFrom: string;
    createdTo: string;
    updatedFrom: string;
    updatedTo: string;
}

export const EMPTY_BOARD_FILTERS: BoardFilterState = {
    search: '',
    cards: '',
    projectIds: [],
    ownerIds: [],
    createdFrom: '',
    createdTo: '',
    updatedFrom: '',
    updatedTo: '',
};

export interface BoardLike {
    name?: string | null;
    description?: string | null;
    card_count?: number | null;
    project_ids?: string[] | null;
    created_by?: string | null;
    creator?: { id: string } | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export type BoardFilterDimension = 'search' | 'cards' | 'project' | 'owner' | 'created' | 'updated';

export function boardMatches(board: BoardLike, filters: BoardFilterState, userId: string | null, omit?: BoardFilterDimension): boolean {
    if (omit !== 'search') {
        const term = filters.search.trim().toLowerCase();
        if (term && !`${board.name ?? ''} ${board.description ?? ''}`.toLowerCase().includes(term)) return false;
    }
    if (omit !== 'cards') {
        if (filters.cards === 'with' && (board.card_count ?? 0) === 0) return false;
        if (filters.cards === 'empty' && (board.card_count ?? 0) > 0) return false;
    }
    if (omit !== 'project' && filters.projectIds.length) {
        const ids = new Set(board.project_ids ?? []);
        if (!filters.projectIds.some((id) => ids.has(id))) return false;
    }
    if (omit !== 'owner' && !matchesOwner(filters.ownerIds, board.creator?.id ?? board.created_by ?? null, userId)) return false;
    if (omit !== 'created' && !inDayRange(board.created_at, filters.createdFrom, filters.createdTo, true)) return false;
    if (omit !== 'updated' && !inDayRange(board.updated_at, filters.updatedFrom, filters.updatedTo, true)) return false;
    return true;
}

export function filterBoards<T extends BoardLike>(boards: readonly T[], filters: BoardFilterState, userId: string | null, omit?: BoardFilterDimension): T[] {
    return boards.filter((board) => boardMatches(board, filters, userId, omit));
}

function rangeOf(from: string, to: string): CreatedRange | null {
    if (!from && !to) return null;
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function storyRange(filters: StoryFilterState, which: 'created' | 'updated'): CreatedRange | null {
    return which === 'created' ? rangeOf(filters.createdFrom, filters.createdTo) : rangeOf(filters.updatedFrom, filters.updatedTo);
}

export function epicRange(filters: EpicFilterState, which: 'start' | 'target' | 'created'): CreatedRange | null {
    if (which === 'start') return rangeOf(filters.startFrom, filters.startTo);
    if (which === 'target') return rangeOf(filters.targetFrom, filters.targetTo);
    return rangeOf(filters.createdFrom, filters.createdTo);
}

export function boardRange(filters: BoardFilterState, which: 'created' | 'updated'): CreatedRange | null {
    return which === 'created' ? rangeOf(filters.createdFrom, filters.createdTo) : rangeOf(filters.updatedFrom, filters.updatedTo);
}

const STORY_URL = ['q', 'projectId', 'status', 'priority', 'epic', 'owner', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo', 'points'] as const;

export function storyFiltersToQuery(current: URLSearchParams, filters: StoryFilterState): string {
    const next = keepUnknown(current, STORY_URL);
    const q = filters.search.trim();
    if (q) next.set('q', q);
    appendAll(next, 'projectId', filters.projectIds);
    appendAll(next, 'status', filters.statuses);
    appendAll(next, 'priority', filters.priorities);
    appendAll(next, 'epic', filters.epicIds);
    appendAll(next, 'owner', filters.ownerIds);
    if (filters.createdFrom) next.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) next.set('createdTo', filters.createdTo);
    if (filters.updatedFrom) next.set('updatedFrom', filters.updatedFrom);
    if (filters.updatedTo) next.set('updatedTo', filters.updatedTo);
    const points = numberConditionParam(filters.points);
    if (points) next.set('points', points);
    return next.toString();
}

export function parseStoryFilters(params: URLSearchParams): { filters: StoryFilterState; owned: (keyof StoryFilterState)[] } {
    const owned: (keyof StoryFilterState)[] = [];
    const filters = { ...EMPTY_STORY_FILTERS };
    if (params.has('q')) {
        filters.search = (params.get('q') ?? '').slice(0, 200);
        owned.push('search');
    }
    const take = (key: keyof StoryFilterState, param: string) => {
        if (!params.has(param)) return;
        const values = readList(params, param);
        (filters as unknown as Record<string, string[]>)[key] = values;
        owned.push(key);
    };
    take('projectIds', 'projectId');
    take('statuses', 'status');
    take('priorities', 'priority');
    take('epicIds', 'epic');
    take('ownerIds', 'owner');
    if (params.has('createdFrom') || params.has('createdTo')) {
        filters.createdFrom = readDay(params, 'createdFrom');
        filters.createdTo = readDay(params, 'createdTo');
        owned.push('createdFrom', 'createdTo');
    }
    if (params.has('updatedFrom') || params.has('updatedTo')) {
        filters.updatedFrom = readDay(params, 'updatedFrom');
        filters.updatedTo = readDay(params, 'updatedTo');
        owned.push('updatedFrom', 'updatedTo');
    }
    if (params.has('points')) {
        filters.points = parsePoints(params.get('points'));
        owned.push('points');
    }
    return { filters, owned };
}

function parsePoints(raw: string | null): NumberCondition | null {
    if (!raw) return null;
    const between = /^between:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (between) return { op: 'between', value: Number(between[1]), to: Number(between[2]) };
    const simple = /^(gt|lt|eq):(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (!simple) return null;
    return { op: simple[1] as NumberCondition['op'], value: Number(simple[2]) };
}

const EPIC_URL = ['q', 'projectId', 'status', 'priority', 'owner', 'startFrom', 'startTo', 'targetFrom', 'targetTo', 'createdFrom', 'createdTo'];

export function epicFiltersToQuery(current: URLSearchParams, filters: EpicFilterState): string {
    const next = keepUnknown(current, EPIC_URL);
    const q = filters.search.trim();
    if (q) next.set('q', q);
    appendAll(next, 'projectId', filters.projectIds);
    appendAll(next, 'status', filters.statuses);
    appendAll(next, 'priority', filters.priorities);
    appendAll(next, 'owner', filters.ownerIds);
    if (filters.startFrom) next.set('startFrom', filters.startFrom);
    if (filters.startTo) next.set('startTo', filters.startTo);
    if (filters.targetFrom) next.set('targetFrom', filters.targetFrom);
    if (filters.targetTo) next.set('targetTo', filters.targetTo);
    if (filters.createdFrom) next.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) next.set('createdTo', filters.createdTo);
    return next.toString();
}

export function parseEpicFilters(params: URLSearchParams): { filters: EpicFilterState; owned: (keyof EpicFilterState)[] } {
    const owned: (keyof EpicFilterState)[] = [];
    const filters = { ...EMPTY_EPIC_FILTERS };
    if (params.has('q')) {
        filters.search = (params.get('q') ?? '').slice(0, 200);
        owned.push('search');
    }
    const take = (key: keyof EpicFilterState, param: string) => {
        if (!params.has(param)) return;
        (filters as unknown as Record<string, string[]>)[key] = readList(params, param);
        owned.push(key);
    };
    take('projectIds', 'projectId');
    take('statuses', 'status');
    take('priorities', 'priority');
    take('ownerIds', 'owner');
    const days = (fromKey: keyof EpicFilterState, toKey: keyof EpicFilterState, from: string, to: string) => {
        if (!params.has(from) && !params.has(to)) return;
        (filters as unknown as Record<string, string>)[fromKey] = readDay(params, from);
        (filters as unknown as Record<string, string>)[toKey] = readDay(params, to);
        owned.push(fromKey, toKey);
    };
    days('startFrom', 'startTo', 'startFrom', 'startTo');
    days('targetFrom', 'targetTo', 'targetFrom', 'targetTo');
    days('createdFrom', 'createdTo', 'createdFrom', 'createdTo');
    return { filters, owned };
}

const BOARD_URL = ['q', 'cards', 'projectId', 'owner', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'];

export function boardFiltersToQuery(current: URLSearchParams, filters: BoardFilterState): string {
    const next = keepUnknown(current, BOARD_URL);
    const q = filters.search.trim();
    if (q) next.set('q', q);
    if (filters.cards) next.set('cards', filters.cards);
    appendAll(next, 'projectId', filters.projectIds);
    appendAll(next, 'owner', filters.ownerIds);
    if (filters.createdFrom) next.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) next.set('createdTo', filters.createdTo);
    if (filters.updatedFrom) next.set('updatedFrom', filters.updatedFrom);
    if (filters.updatedTo) next.set('updatedTo', filters.updatedTo);
    return next.toString();
}

export function parseBoardFilters(params: URLSearchParams): { filters: BoardFilterState; owned: (keyof BoardFilterState)[] } {
    const owned: (keyof BoardFilterState)[] = [];
    const filters = { ...EMPTY_BOARD_FILTERS };
    if (params.has('q')) {
        filters.search = (params.get('q') ?? '').slice(0, 200);
        owned.push('search');
    }
    const cards = params.get('cards');
    if (cards === 'with' || cards === 'empty') {
        filters.cards = cards;
        owned.push('cards');
    }
    if (params.has('projectId')) {
        filters.projectIds = readList(params, 'projectId');
        owned.push('projectIds');
    }
    if (params.has('owner')) {
        filters.ownerIds = readList(params, 'owner');
        owned.push('ownerIds');
    }
    if (params.has('createdFrom') || params.has('createdTo')) {
        filters.createdFrom = readDay(params, 'createdFrom');
        filters.createdTo = readDay(params, 'createdTo');
        owned.push('createdFrom', 'createdTo');
    }
    if (params.has('updatedFrom') || params.has('updatedTo')) {
        filters.updatedFrom = readDay(params, 'updatedFrom');
        filters.updatedTo = readDay(params, 'updatedTo');
        owned.push('updatedFrom', 'updatedTo');
    }
    return { filters, owned };
}

export interface TaskFilterState {
    search: string;
    /** `me`, `unassigned`, `user:<id>`, `employee:<id>`. Empty is anyone. */
    assignees: string[];
    projectIds: string[];
    statusCategories: string[];
    priorities: string[];
    hideDone: boolean;
    due: DuePreset[];
    dueFrom: string;
    dueTo: string;
    time: string[];
    hours: NumberCondition | null;
    labelIds: string[];
    /** Sprint ids, plus `none`. */
    sprintIds: string[];
    epicIds: string[];
    storyIds: string[];
    updated: UpdatedPreset[];
    updatedFrom: string;
    updatedTo: string;
    createdFrom: string;
    createdTo: string;
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
    search: '',
    assignees: ['me'],
    projectIds: [],
    statusCategories: [],
    priorities: [],
    hideDone: false,
    due: [],
    dueFrom: '',
    dueTo: '',
    time: [],
    hours: null,
    labelIds: [],
    sprintIds: [],
    epicIds: [],
    storyIds: [],
    updated: [],
    updatedFrom: '',
    updatedTo: '',
    createdFrom: '',
    createdTo: '',
};

const TASK_URL = [
    'q', 'assignee', 'projectId', 'status', 'priority', 'hideDone', 'due', 'dueFrom', 'dueTo',
    'time', 'hours', 'label', 'sprint', 'epic', 'story', 'updated', 'updatedFrom', 'updatedTo',
    'createdFrom', 'createdTo',
];

const DUE: readonly DuePreset[] = ['overdue', 'today', 'week'];
const UPDATED: readonly UpdatedPreset[] = ['d2', 'd3', 'd7'];
const ASSIGNEE = /^(?:me|unassigned|anyone|user:\S+|employee:\S+)$/;

export function parseTaskFilters(params: URLSearchParams): { filters: TaskFilterState; owned: (keyof TaskFilterState)[] } {
    const owned: (keyof TaskFilterState)[] = [];
    const filters: TaskFilterState = { ...EMPTY_TASK_FILTERS, assignees: ['me'] };
    if (params.has('q')) {
        filters.search = (params.get('q') ?? '').slice(0, 200);
        owned.push('search');
    }
    if (params.has('assignee')) {
        const values = readList(params, 'assignee').filter((value) => ASSIGNEE.test(value) && value !== 'anyone');
        filters.assignees = values;
        owned.push('assignees');
    }
    if (params.has('projectId')) {
        filters.projectIds = readList(params, 'projectId');
        owned.push('projectIds');
    }
    const lists: [keyof TaskFilterState, string][] = [
        ['statusCategories', 'status'],
        ['priorities', 'priority'],
        ['labelIds', 'label'],
        ['sprintIds', 'sprint'],
        ['epicIds', 'epic'],
        ['storyIds', 'story'],
    ];
    for (const [key, param] of lists) {
        if (!params.has(param)) continue;
        (filters as unknown as Record<string, string[]>)[key] = readList(params, param);
        owned.push(key);
    }
    if (params.has('due')) {
        filters.due = readList(params, 'due').filter((value): value is DuePreset => (DUE as readonly string[]).includes(value));
        owned.push('due');
    }
    if (params.has('updated')) {
        filters.updated = readList(params, 'updated').filter((value): value is UpdatedPreset => (UPDATED as readonly string[]).includes(value));
        owned.push('updated');
    }
    if (params.has('time')) {
        filters.time = readList(params, 'time');
        owned.push('time');
    }
    if (params.has('hideDone')) {
        const hide = params.get('hideDone');
        filters.hideDone = hide === '1' || hide === 'true';
        owned.push('hideDone');
    }
    if (params.has('hours')) {
        filters.hours = parsePoints(params.get('hours'));
        owned.push('hours');
    }
    const days = (fromKey: 'dueFrom' | 'dueTo' | 'updatedFrom' | 'updatedTo' | 'createdFrom' | 'createdTo', param: string) => {
        if (!params.has(param)) return;
        filters[fromKey] = readDay(params, param);
        owned.push(fromKey);
    };
    days('dueFrom', 'dueFrom');
    days('dueTo', 'dueTo');
    days('updatedFrom', 'updatedFrom');
    days('updatedTo', 'updatedTo');
    days('createdFrom', 'createdFrom');
    days('createdTo', 'createdTo');
    return { filters, owned };
}

export function taskFiltersToQuery(current: URLSearchParams, filters: TaskFilterState): string {
    const next = keepUnknown(current, TASK_URL);
    const q = filters.search.trim();
    if (q) next.set('q', q);
    // `me` is the page's own default, and still belongs in the link so the
    // view that opens is the one being looked at. Anyone is an empty list.
    appendAll(next, 'assignee', filters.assignees);
    appendAll(next, 'projectId', filters.projectIds);
    appendAll(next, 'status', filters.statusCategories);
    appendAll(next, 'priority', filters.priorities);
    if (filters.hideDone) next.set('hideDone', '1');
    appendAll(next, 'due', filters.due);
    if (filters.dueFrom) next.set('dueFrom', filters.dueFrom);
    if (filters.dueTo) next.set('dueTo', filters.dueTo);
    appendAll(next, 'time', filters.time);
    const hours = numberConditionParam(filters.hours);
    if (hours) next.set('hours', hours);
    appendAll(next, 'label', filters.labelIds);
    appendAll(next, 'sprint', filters.sprintIds);
    appendAll(next, 'epic', filters.epicIds);
    appendAll(next, 'story', filters.storyIds);
    appendAll(next, 'updated', filters.updated);
    if (filters.updatedFrom) next.set('updatedFrom', filters.updatedFrom);
    if (filters.updatedTo) next.set('updatedTo', filters.updatedTo);
    if (filters.createdFrom) next.set('createdFrom', filters.createdFrom);
    if (filters.createdTo) next.set('createdTo', filters.createdTo);
    return next.toString();
}

/**
 * What the Tasks page sends. One person, one project, one priority and one
 * status stay on the scalar params every caller already understands. More
 * than one uses the comma lists.
 */
export function taskListParams(
    filters: TaskFilterState,
    userId: string | null,
): Record<string, string | undefined> {
    const keys = filters.assignees
        .map((key) => (key === 'me' ? (userId ? `user:${userId}` : '') : key))
        .filter(Boolean);
    const assignee: Record<string, string | undefined> = {};
    if (keys.length === 1 && keys[0] === 'unassigned') assignee.unassigned = 'true';
    else if (keys.length === 1 && keys[0].startsWith('user:')) assignee.assigneeId = keys[0].slice('user:'.length);
    else if (keys.length === 1 && keys[0].startsWith('employee:')) assignee.assigneeEmployeeId = keys[0].slice('employee:'.length);
    else if (keys.length > 1) assignee.assignees = keys.join(',');

    return {
        search: filters.search.trim() || undefined,
        ...assignee,
        ...(filters.projectIds.length === 1
            ? { projectId: filters.projectIds[0] }
            : filters.projectIds.length > 1
              ? { projectIds: filters.projectIds.join(',') }
              : {}),
        ...(filters.statusCategories.length === 1
            ? { statusCategory: filters.statusCategories[0] }
            : filters.statusCategories.length > 1
              ? { statusCategories: filters.statusCategories.join(',') }
              : {}),
        ...(filters.priorities.length === 1
            ? { priority: filters.priorities[0] }
            : filters.priorities.length > 1
              ? { priorities: filters.priorities.join(',') }
              : {}),
        hideDone: filters.hideDone ? 'true' : undefined,
        due: filters.due.join(',') || undefined,
        dueFrom: filters.dueFrom || undefined,
        dueTo: filters.dueTo || undefined,
        time: filters.time.join(',') || undefined,
        hours: numberConditionParam(filters.hours),
        labelIds: filters.labelIds.join(',') || undefined,
        sprintIds: filters.sprintIds.join(',') || undefined,
        epicIds: filters.epicIds.join(',') || undefined,
        storyIds: filters.storyIds.join(',') || undefined,
        updated: filters.updated.join(',') || undefined,
        updatedFrom: filters.updatedFrom || undefined,
        updatedTo: filters.updatedTo || undefined,
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        counts: 'true',
    };
}

/** Coerce a remembered tasks slice, including the older single-value shape. */
export function coerceTaskFilters(stored: Record<string, unknown> | null, seeded: TaskFilterState): TaskFilterState {
    const next = { ...seeded };
    if (!stored) return next;
    const list = (key: keyof TaskFilterState, legacy?: string) => {
        if (key in stored) (next as unknown as Record<string, unknown>)[key] = asList(stored[key]);
        else if (legacy && typeof stored[legacy] === 'string' && stored[legacy]) {
            (next as unknown as Record<string, unknown>)[key] = asList(stored[legacy]);
        }
    };
    if (!('assignees' in stored) && stored.assignee === 'anyone') next.assignees = [];
    else if ('assignees' in stored) next.assignees = asList(stored.assignees);
    else if (typeof stored.assignee === 'string' && stored.assignee && stored.assignee !== 'anyone') next.assignees = [stored.assignee];
    list('projectIds', 'projectId');
    list('statusCategories', 'statusCategory');
    list('priorities', 'priority');
    list('labelIds');
    list('sprintIds');
    list('epicIds');
    list('storyIds');
    list('due');
    list('time');
    list('updated');
    if (typeof stored.search === 'string') next.search = stored.search;
    if (typeof stored.hideDone === 'boolean') next.hideDone = stored.hideDone;
    if (stored.hours && typeof stored.hours === 'object') next.hours = stored.hours as NumberCondition;
    for (const key of ['dueFrom', 'dueTo', 'updatedFrom', 'updatedTo', 'createdFrom', 'createdTo'] as const) {
        if (typeof stored[key] === 'string') next[key] = stored[key] as string;
    }
    const created = stored.createdRange as CreatedRange | null | undefined;
    if (created && typeof created === 'object') {
        if (!next.createdFrom && created.from) next.createdFrom = created.from;
        if (!next.createdTo && created.to) next.createdTo = created.to;
    }
    return next;
}
