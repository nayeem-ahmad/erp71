import { buildLeadDraft, buildTaskDraft, resolveNamed } from './drafts';

const showroom = { id: 'p-show', label: 'Showroom', detail: 'SH' };
const shop = { id: 'p-shop', label: 'Shop fit-out', detail: 'FIT' };
const shopExact = { id: 'p-shop-exact', label: 'Shop', detail: 'S' };

describe('resolveNamed', () => {
    it('prefers one exact name over a longer name that contains it', () => {
        const resolved = resolveNamed('Shop', [shopExact, shop]);
        expect(resolved).toEqual({ status: 'one', match: shopExact });
    });

    it('stays ambiguous when two names match exactly', () => {
        const twin = { id: 'p-2', label: 'Shop', detail: 'S2' };
        const resolved = resolveNamed('shop', [shopExact, twin]);
        expect(resolved.status).toBe('many');
        if (resolved.status === 'many') expect(resolved.matches).toHaveLength(2);
    });

    it('accepts the only partial match', () => {
        expect(resolveNamed('show', [showroom])).toEqual({ status: 'one', match: showroom });
    });

    it('asks when several partial matches exist', () => {
        const resolved = resolveNamed('s', [showroom, shop]);
        expect(resolved.status).toBe('many');
    });
});

describe('buildTaskDraft', () => {
    it('is ready when the title and one project are clear, and leaves the assignee empty', () => {
        const draft = buildTaskDraft({
            title: 'Call the supplier',
            description: 'About the rice order',
            projectQuery: 'Showroom',
            projectMatches: [showroom],
            visibleProjects: [showroom, shop],
            assigneeMatches: [],
            dueDate: '2026-11-15',
        });

        expect(draft.status).toBe('ready');
        expect(draft.missing).toEqual([]);
        expect(draft.fields).toMatchObject({
            title: 'Call the supplier',
            description: 'About the rice order',
            projectId: 'p-show',
            projectName: 'Showroom',
            dueDate: '2026-11-15',
            priority: 'MEDIUM',
        });
        expect(draft.fields.assigneeId).toBeUndefined();
        expect(draft.fields.assigneeEmployeeId).toBeUndefined();
    });

    it('does not pick the only visible project when none was named', () => {
        const draft = buildTaskDraft({
            projectMatches: [],
            visibleProjects: [showroom],
            assigneeMatches: [],
            title: 'Call',
        });

        expect(draft.status).toBe('needs_input');
        expect(draft.missing).toContain('project');
        expect(draft.fields.projectId).toBeUndefined();
        expect(draft.fields.projectChoices).toEqual([
            { id: 'p-show', label: 'Showroom', detail: 'SH' },
        ]);
    });

    it('asks instead of guessing when two projects match', () => {
        const draft = buildTaskDraft({
            title: 'Call',
            projectQuery: 'fit-out',
            projectMatches: [shop, { id: 'p-3', label: 'Fitness hall', detail: 'FH' }],
            visibleProjects: [],
            assigneeMatches: [],
        });

        expect(draft.status).toBe('needs_input');
        expect(draft.fields.projectId).toBeUndefined();
        expect(draft.fields.projectChoices?.map((choice) => choice.id)).toEqual(['p-shop', 'p-3']);
        expect(draft.warnings.join(' ')).toMatch(/More than one project/);
    });

    it('asks when the named person matches a login and an employee', () => {
        const draft = buildTaskDraft({
            title: 'Call',
            projectQuery: 'Showroom',
            projectMatches: [showroom],
            visibleProjects: [showroom],
            assigneeQuery: 'Karim',
            assigneeMatches: [
                { id: 'user-1', label: 'Karim', detail: 'karim@shop.test', kind: 'user' },
                { id: 'emp-1', label: 'Karim', detail: 'E-1', kind: 'employee' },
            ],
        });

        expect(draft.missing).toContain('assignee');
        expect(draft.fields.assigneeUnresolved).toBe(true);
        expect(draft.fields.assigneeId).toBeUndefined();
        expect(draft.fields.assigneeEmployeeId).toBeUndefined();
        expect(draft.fields.assigneeChoices).toHaveLength(2);
    });

    it('assigns the speaker only when they asked for themselves', () => {
        const draft = buildTaskDraft({
            title: 'Call',
            projectQuery: 'Showroom',
            projectMatches: [showroom],
            visibleProjects: [showroom],
            assignToSpeaker: true,
            speakerId: 'user-7',
            assigneeMatches: [],
        });

        expect(draft.status).toBe('ready');
        expect(draft.fields.assigneeId).toBe('user-7');
        expect(draft.fields.assigneeName).toBe('You');
    });

    it('drops a due date that is not a calendar date', () => {
        const draft = buildTaskDraft({
            title: 'Call',
            projectQuery: 'Showroom',
            projectMatches: [showroom],
            visibleProjects: [showroom],
            assigneeMatches: [],
            dueDate: 'tomorrow',
        });

        expect(draft.fields.dueDate).toBeUndefined();
        expect(draft.warnings.join(' ')).toMatch(/due date/i);
        expect(draft.status).toBe('ready');
    });

    it('marks a missing title', () => {
        const draft = buildTaskDraft({
            projectQuery: 'Showroom',
            projectMatches: [showroom],
            visibleProjects: [showroom],
            assigneeMatches: [],
        });
        expect(draft.missing).toContain('title');
        expect(draft.status).toBe('needs_input');
    });
});

describe('buildLeadDraft', () => {
    it('puts a spoken company into the note and does not set an owner', () => {
        const draft = buildLeadDraft({
            name: 'Rahim',
            mobile: '01711111111',
            company: 'Karim Traders',
            remarks: 'Asked about rice',
        });

        expect(draft.status).toBe('ready');
        expect(draft.fields).toMatchObject({
            name: 'Rahim',
            mobile: '01711111111',
            remarks: 'Company: Karim Traders\nAsked about rice',
        });
        expect(draft.fields).not.toHaveProperty('assigned_to');
        expect(draft.warnings.join(' ')).toMatch(/No company record/);
    });

    it('does not repeat the company when the note already contains it', () => {
        const draft = buildLeadDraft({
            name: 'Rahim',
            company: 'Karim Traders',
            remarks: 'Works at Karim Traders',
        });
        expect(draft.fields.remarks).toBe('Works at Karim Traders');
    });

    it('asks for a name and rejects an email that cannot be saved', () => {
        const draft = buildLeadDraft({ email: 'not-an-email', company: 'Acme' });
        expect(draft.status).toBe('needs_input');
        expect(draft.missing).toEqual(expect.arrayContaining(['name', 'email']));
        expect(draft.fields.remarks).toBe('Company: Acme');
    });
});
