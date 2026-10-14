import {
    ACTIVITY_LAYOUT_KEY,
    classifyActivity,
    countExtraActivityFilters,
    groupActivities,
    readActivityLayout,
    writeActivityLayout,
} from './crm-activity-layout';

describe('classifyActivity', () => {
    const today = '2026-10-14';

    it('puts a plan due before today under overdue', () => {
        expect(classifyActivity('PLANNED', '2026-10-13', today)).toBe('overdue');
    });

    it('puts anything due today under today, logged or not', () => {
        expect(classifyActivity('PLANNED', today, today)).toBe('today');
        expect(classifyActivity('DONE', today, today)).toBe('today');
    });

    it('puts a future due date under later', () => {
        expect(classifyActivity('PLANNED', '2026-10-16', today)).toBe('later');
    });

    it('puts a logged past activity under earlier, not overdue', () => {
        expect(classifyActivity('DONE', '2026-10-12', today)).toBe('earlier');
        expect(classifyActivity('CANCELLED', '2026-10-12', today)).toBe('earlier');
    });

    it('puts a row with no due date on its own', () => {
        expect(classifyActivity('PLANNED', null, today)).toBe('undated');
    });
});

describe('groupActivities', () => {
    const today = '2026-10-14';
    const day = (dueAt: string) => dueAt;

    it('drops empty groups and orders the rest overdue, today, later, earlier, undated', () => {
        const rows = [
            { id: 'later', status: 'PLANNED', due_at: '2026-10-20' },
            { id: 'soon', status: 'PLANNED', due_at: '2026-10-15' },
            { id: 'over', status: 'PLANNED', due_at: '2026-10-10' },
            { id: 'today', status: 'PLANNED', due_at: today },
            { id: 'none', status: 'PLANNED', due_at: null },
        ];

        expect(groupActivities(rows, today, day).map((group) => group.id)).toEqual([
            'overdue', 'today', 'later', 'undated',
        ]);
    });

    it('sorts a group by due day, earliest first', () => {
        const rows = [
            { id: 'far', status: 'PLANNED', due_at: '2026-10-20' },
            { id: 'near', status: 'PLANNED', due_at: '2026-10-15' },
        ];

        expect(groupActivities(rows, today, day)[0].rows.map((row) => row.id)).toEqual(['near', 'far']);
    });
});

describe('countExtraActivityFilters', () => {
    const clear = {
        approval: '',
        target: '',
        purposeId: '',
        channelId: '',
        leadOwner: '',
        assignee: '',
        createdRange: null,
    };

    it('counts only the filters that live behind More filters', () => {
        expect(countExtraActivityFilters(clear)).toBe(0);
        expect(countExtraActivityFilters({
            ...clear,
            approval: 'pending',
            createdRange: { from: '2026-10-01' },
        })).toBe(2);
    });
});

describe('activity layout preference', () => {
    beforeEach(() => localStorage.removeItem(ACTIVITY_LAYOUT_KEY));

    it('opens on standard until a layout has been chosen', () => {
        expect(readActivityLayout()).toBe('standard');
    });

    it('remembers the layout that was chosen', () => {
        writeActivityLayout('agenda');
        expect(readActivityLayout()).toBe('agenda');
    });

    it('ignores a stored value it does not know', () => {
        localStorage.setItem(ACTIVITY_LAYOUT_KEY, 'dense');
        expect(readActivityLayout()).toBe('standard');
    });
});
