import type { AiCreateDraft, AiCreateDraftFields, AiDraftChoice } from '@erp71/shared-types';

/** Pull a draft off a tool result. Anything else is a lookup and has no card. */
export function draftFromToolOutput(output: unknown): AiCreateDraft | undefined {
    if (!output || typeof output !== 'object' || !('draft' in output)) return undefined;
    const draft = (output as { draft?: Partial<AiCreateDraft> }).draft;
    if (!draft || (draft.kind !== 'task' && draft.kind !== 'lead')) return undefined;
    if (!draft.fields || typeof draft.fields !== 'object') return undefined;
    return draft as AiCreateDraft;
}

/** A name the database already narrowed to this tenant (and, for projects, to what the caller can see). */
export interface DraftMatch {
    id: string;
    label: string;
    detail?: string | null;
    kind?: 'user' | 'employee';
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type Priority = (typeof PRIORITIES)[number];

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 5000;
const NAME_MAX = 200;
const REMARKS_MAX = 5000;
const PHONE_MAX = 40;
/** How many options a card will offer before it becomes a wall of names. */
const CHOICE_CAP = 20;

export interface TaskDraftInput {
    title?: string;
    description?: string;
    /** Spoken project name or code. Omitted when the user did not name one. */
    projectQuery?: string;
    /** Contains-matches for `projectQuery`. Empty when nothing was named. */
    projectMatches: DraftMatch[];
    /** Projects the caller can see, for the picker when the name is missing or unknown. */
    visibleProjects: DraftMatch[];
    assigneeQuery?: string;
    /** True only when they said to assign the task to themselves. */
    assignToSpeaker?: boolean;
    speakerId?: string;
    assigneeMatches: DraftMatch[];
    dueDate?: string;
    priority?: string;
}

export interface LeadDraftInput {
    name?: string;
    mobile?: string;
    email?: string;
    remarks?: string;
    /** Spoken company. Folded into the note. Never creates a contact or a company. */
    company?: string;
}

function text(value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): { value: string; clipped: boolean } {
    if (value.length <= max) return { value, clipped: false };
    return { value: value.slice(0, max).trim(), clipped: true };
}

function choice(match: DraftMatch): AiDraftChoice {
    return {
        id: match.id,
        label: match.label,
        ...(match.detail ? { detail: match.detail } : {}),
        ...(match.kind ? { kind: match.kind } : {}),
    };
}

/**
 * One clear match, several that the user has to pick between, or none.
 *
 * An exact name or code beats a longer name that merely contains the words.
 * Two exact matches stay ambiguous — the same name twice is not a reason to
 * pick the first row.
 */
export function resolveNamed(
    query: string,
    matches: DraftMatch[],
): { status: 'one'; match: DraftMatch } | { status: 'many'; matches: DraftMatch[] } | { status: 'none' } {
    const q = text(query).toLowerCase();
    if (!q) return { status: 'none' };

    const exact = matches.filter((match) => {
        const label = text(match.label).toLowerCase();
        const detail = text(match.detail ?? '').toLowerCase();
        return label === q || (detail !== '' && detail === q);
    });
    if (exact.length === 1) return { status: 'one', match: exact[0] };
    if (exact.length > 1) return { status: 'many', matches: exact };
    if (matches.length === 1) return { status: 'one', match: matches[0] };
    if (matches.length > 1) return { status: 'many', matches };
    return { status: 'none' };
}

function asIsoDate(value: string | undefined): string | undefined {
    const trimmed = text(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function asPriority(value: string | undefined): Priority | undefined {
    const upper = text(value).toUpperCase();
    return (PRIORITIES as readonly string[]).includes(upper) ? (upper as Priority) : undefined;
}

function emailOk(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Company is not a field on a lead. Keep the spoken name in the note so the
 * person can still see it, without creating a contact or an organisation.
 */
export function foldCompanyIntoRemarks(remarks: string | undefined, company: string | undefined): string | undefined {
    const note = text(remarks);
    const spoken = text(company);
    if (!spoken) return note || undefined;
    const line = `Company: ${spoken}`;
    if (!note) return line;
    if (note.toLowerCase().includes(spoken.toLowerCase())) return note;
    return `${line}\n${note}`;
}

function finish(kind: AiCreateDraft['kind'], fields: AiCreateDraftFields, missing: string[], warnings: string[]): AiCreateDraft {
    return {
        kind,
        status: missing.length > 0 ? 'needs_input' : 'ready',
        missing,
        warnings,
        fields,
    };
}

/**
 * Turn what the model heard, plus the rows the database matched, into a card.
 * This never writes. A missing project is left blank even when the caller can
 * see only one — they confirm which project, the assistant does not decide.
 */
export function buildTaskDraft(input: TaskDraftInput): AiCreateDraft {
    const missing: string[] = [];
    const warnings: string[] = [];
    const fields: AiCreateDraftFields = {};

    const title = text(input.title);
    if (!title) {
        missing.push('title');
    } else {
        const clipped = clip(title, TITLE_MAX);
        fields.title = clipped.value;
        if (clipped.clipped) warnings.push('The title was shortened to 300 characters.');
    }

    const description = text(input.description);
    if (description) {
        const clipped = clip(description, DESCRIPTION_MAX);
        fields.description = clipped.value;
        if (clipped.clipped) warnings.push('The description was shortened to 5000 characters.');
    }

    const projectQuery = text(input.projectQuery);
    if (!projectQuery) {
        missing.push('project');
        fields.projectChoices = input.visibleProjects.slice(0, CHOICE_CAP).map(choice);
        if (input.visibleProjects.length === 0) {
            warnings.push('No project you can use was found.');
        } else if (input.visibleProjects.length > CHOICE_CAP) {
            warnings.push(`Showing the first ${CHOICE_CAP} projects you can use.`);
        }
    } else {
        const resolved = resolveNamed(projectQuery, input.projectMatches);
        if (resolved.status === 'one') {
            fields.projectId = resolved.match.id;
            fields.projectName = resolved.match.label;
            fields.projectChoices = [choice(resolved.match)];
        } else if (resolved.status === 'many') {
            missing.push('project');
            fields.projectChoices = resolved.matches.slice(0, CHOICE_CAP).map(choice);
            warnings.push(`More than one project matches "${projectQuery}". Pick one.`);
        } else {
            missing.push('project');
            fields.projectChoices = input.visibleProjects.slice(0, CHOICE_CAP).map(choice);
            warnings.push(`No project matches "${projectQuery}".`);
        }
    }

    const assigneeQuery = text(input.assigneeQuery);
    if (input.assignToSpeaker && input.speakerId && !assigneeQuery) {
        fields.assigneeId = input.speakerId;
        fields.assigneeName = 'You';
    } else if (assigneeQuery) {
        const resolved = resolveNamed(assigneeQuery, input.assigneeMatches);
        if (resolved.status === 'one') {
            const match = resolved.match;
            if (match.kind === 'employee') fields.assigneeEmployeeId = match.id;
            else fields.assigneeId = match.id;
            fields.assigneeName = match.label;
            fields.assigneeChoices = [choice(match)];
        } else if (resolved.status === 'many') {
            missing.push('assignee');
            fields.assigneeUnresolved = true;
            fields.assigneeChoices = resolved.matches.slice(0, CHOICE_CAP).map(choice);
            warnings.push(`More than one person matches "${assigneeQuery}". Pick one, or leave it unassigned.`);
        } else {
            missing.push('assignee');
            fields.assigneeUnresolved = true;
            warnings.push(`No person matches "${assigneeQuery}". Pick someone, or leave it unassigned.`);
        }
    }

    const due = asIsoDate(input.dueDate);
    if (text(input.dueDate) && !due) {
        warnings.push('The due date was not a calendar date (YYYY-MM-DD), so it was left blank.');
    } else if (due) {
        fields.dueDate = due;
    }

    const priority = asPriority(input.priority);
    if (text(input.priority) && !priority) {
        warnings.push('The priority was not recognised, so it was left at Medium.');
    }
    fields.priority = priority ?? 'MEDIUM';

    return finish('task', fields, missing, warnings);
}

/** A lead needs a name. The owner is whoever saves it — this draft does not set one. */
export function buildLeadDraft(input: LeadDraftInput): AiCreateDraft {
    const missing: string[] = [];
    const warnings: string[] = [];
    const fields: AiCreateDraftFields = {};

    const name = text(input.name);
    if (!name) {
        missing.push('name');
    } else {
        const clipped = clip(name, NAME_MAX);
        fields.name = clipped.value;
        if (clipped.clipped) warnings.push('The name was shortened to 200 characters.');
    }

    const mobile = text(input.mobile);
    if (mobile) fields.mobile = clip(mobile, PHONE_MAX).value;

    const email = text(input.email);
    if (email) {
        fields.email = email;
        if (!emailOk(email)) {
            missing.push('email');
            warnings.push('That email address does not look valid.');
        }
    }

    const remarks = foldCompanyIntoRemarks(input.remarks, input.company);
    if (remarks) {
        const clipped = clip(remarks, REMARKS_MAX);
        fields.remarks = clipped.value;
        if (clipped.clipped) warnings.push('The note was shortened to 5000 characters.');
    }
    if (text(input.company)) {
        warnings.push('The company name is in the note. No company record was created.');
    }

    return finish('lead', fields, missing, warnings);
}
