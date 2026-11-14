import { StorePermission } from '@erp71/shared-types';
import { CRM_WRITE } from '../../auth/permission-sets';
import { buildLeadDraft, buildTaskDraft, type DraftMatch } from '../drafts';
import type { ChatTool, ChatToolContext } from './types';
import type { ProjectViewer } from '../../projects/project-access.service';

/**
 * What the model is told after every draft. The card is the only save path,
 * and saying so here is what stops "Done, I created it" when nothing was written.
 */
const DRAFT_INSTRUCTION =
    'Nothing was saved. A confirmation card is shown to the user. Tell them to review it and press Save. ' +
    'If status is needs_input, say what is still missing in one sentence. Never invent an id and never claim the record exists.';

function str(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function viewerOf(ctx: ChatToolContext): ProjectViewer {
    return {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userRole: ctx.userRole,
        storeId: ctx.storeId,
        timezone: ctx.timezone,
        recordScope: ctx.recordScope,
    };
}

function asMatches(rows: Array<{ id: string; label: string; detail?: string | null; kind?: 'user' | 'employee' }>): DraftMatch[] {
    return rows.map((row) => ({
        id: row.id,
        label: row.label,
        detail: row.detail,
        kind: row.kind,
    }));
}

export const DRAFT_TOOLS: ChatTool[] = [
    {
        name: 'propose_create_task',
        effect: 'draft',
        permission: StorePermission.MANAGE_PROJECT_TASKS,
        description:
            'Prepare a task for the user to confirm. Call this when they ask to create, add, or remind themselves of a task, ' +
            'in English, Bangla, or a mix. This NEVER saves. Pass the words they said, not ids. ' +
            'Omit project when they did not name one — the card asks. Omit assignee unless they named a person. ' +
            'Set assignToMe only when they said to assign it to themselves. ' +
            'dueDate must be YYYY-MM-DD in the business timezone (resolve "tomorrow", "Friday", "আগামীকাল" yourself from today\'s date). ' +
            'priority is LOW, MEDIUM, HIGH, or URGENT.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title, as spoken. Omit if they did not give one.' },
                description: { type: 'string', description: 'Longer description, if they gave one.' },
                project: { type: 'string', description: 'Project name or code they said. Not an id. Omit if they named none.' },
                assignee: { type: 'string', description: 'Person\'s name, if they named one. Not an id. Omit to leave unassigned.' },
                assignToMe: { type: 'boolean', description: 'True only when they said to assign the task to themselves.' },
                dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD, already resolved in the business timezone.' },
                priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            },
        },
        handler: async (ctx, args, deps) => {
            const projectQuery = str(args.project);
            const assigneeQuery = str(args.assignee);
            const viewer = viewerOf(ctx);
            const [projectMatches, visibleProjects, assigneeMatches] = await Promise.all([
                projectQuery
                    ? deps.data.resolveEntity(ctx.tenantId, 'project', projectQuery, 10, viewer)
                    : Promise.resolve([]),
                deps.data.listVisibleProjects(viewer, 20),
                assigneeQuery ? deps.data.resolveAssignees(ctx.tenantId, assigneeQuery, 10) : Promise.resolve([]),
            ]);

            const draft = buildTaskDraft({
                title: str(args.title),
                description: str(args.description),
                projectQuery,
                projectMatches: asMatches(projectMatches),
                visibleProjects: asMatches(visibleProjects),
                assigneeQuery,
                assignToSpeaker: args.assignToMe === true,
                speakerId: ctx.userId,
                assigneeMatches: asMatches(assigneeMatches),
                dueDate: str(args.dueDate),
                priority: str(args.priority),
            });

            return { saved: false, draft, instruction: DRAFT_INSTRUCTION };
        },
    },
    {
        name: 'propose_create_lead',
        effect: 'draft',
        permission: StorePermission.MANAGE_LEADS,
        anyPermissions: [...CRM_WRITE],
        modules: ['crm'],
        description:
            'Prepare a CRM lead for the user to confirm. Call this when they ask to create or add a lead, ' +
            'in English, Bangla, or a mix. This NEVER saves and NEVER creates a contact or a company. ' +
            'The lead owner becomes the person who presses Save. Pass company as company — it is stored in the note. ' +
            'name is the person. mobile is their phone. remarks is any other note.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The person\'s name. Omit if they did not say one.' },
                mobile: { type: 'string', description: 'Phone number, as spoken.' },
                email: { type: 'string', description: 'Email address, if they said one.' },
                remarks: { type: 'string', description: 'Any note that is not the company name.' },
                company: { type: 'string', description: 'Company they mentioned. Stored in the note only.' },
            },
        },
        handler: async (_ctx, args) => {
            const draft = buildLeadDraft({
                name: str(args.name),
                mobile: str(args.mobile),
                email: str(args.email),
                remarks: str(args.remarks),
                company: str(args.company),
            });
            return { saved: false, draft, instruction: DRAFT_INSTRUCTION };
        },
    },
];
