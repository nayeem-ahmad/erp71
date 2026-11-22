import { setActiveTimeZone } from '@/lib/format';
import {
    ACTIVITY_LAYOUT_KEY,
    classifyActivity,
    countExtraActivityFilters,
    groupActivities,
    isPlannedActivityOverdue,
    readActivityLayout,
    writeActivityLayout,
} from './crm-activity-layout';

describe('isPlannedActivityOverdue', () => {
    beforeEach(() => setActiveTimeZone('Asia/Dhaka'));
    afterEach(() => setActiveTimeZone(undefined));

    // 14:00 Dhaka on 22 Nov — afternoon, so any morning due instant has already
    // passed if you compare timestamps raw.
    const afternoon = new Date('2026-11-22T08:00:00.000Z');

    it('does not call a plan due this morning overdue once the hour has passed', () => {
        // 09:00 Dhaka = 03:00 UTC. Instant comparison would already be overdue.
        expect(isPlannedActivityOverdue('PLANNED', '2026-11-22T03:00:00.000Z', afternoon)).toBe(false);
    });

    it('does not call a plan stored at local midnight overdue later the same day', () => {
        // Dhaka midnight 22 Nov = 18:00 UTC on the 21st. The instant is in the
        // past all day; the workspace calendar still reads "today".
        expect(isPlannedActivityOverdue('PLANNED', '2026-11-21T18:00:00.000Z', afternoon)).toBe(false);
    });

    it('does not call a plan at UTC midnight overdue while it is still the workspace day', () => {
        // UTC midnight 22 Nov is 06:00 in Dhaka — still today after 06:00.
        expect(isPlannedActivityOverdue('PLANNED', '2026-11-22T00:00:00.000Z', afternoon)).toBe(false);
    });

    it('calls a plan due yesterday overdue', () => {
        expect(isPlannedActivityOverdue('PLANNED', '2026-11-21T03:00:00.000Z', afternoon)).toBe(true);
    });

    it('does not call a plan due tomorrow overdue', () => {
        expect(isPlannedActivityOverdue('PLANNED', '2026-11-23T03:00:00.000Z', afternoon)).toBe(false);
    });

    it('ignores logged work and rows with no due date', () => {
        expect(isPlannedActivityOverdue('DONE', '2026-11-21T03:00:00.000Z', afternoon)).toBe(false);
        expect(isPlannedActivityOverdue('PLANNED', null, afternoon)).toBe(false);
    });

    it('reads the due instant on the workspace clock, not UTC', () => {
        // 17:00 UTC on the 25th is 23:00 in Dhaka: still the 25th at 22:00 local,
        // and yesterday from the 26th. Same cases as the phone's isOverdue test.
        const dueAt = '2026-09-25T17:00:00.000Z';
        expect(isPlannedActivityOverdue('PLANNED', dueAt, new Date('2026-09-25T16:00:00.000Z'))).toBe(false);
        expect(isPlannedActivityOverdue('PLANNED', dueAt, new Date('2026-09-26T03:00:00.000Z'))).toBe(true);
    });
});

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

    it('opens on the list until a layout has been chosen', () => {
        expect(readActivityLayout()).toBe('list');
    });

    it('remembers the layout that was chosen', () => {
        writeActivityLayout('agenda');
        expect(readActivityLayout()).toBe('agenda');
    });

    it('ignores a stored value it does not know', () => {
        localStorage.setItem(ACTIVITY_LAYOUT_KEY, 'dense');
        expect(readActivityLayout()).toBe('list');
    });

    it('reads the old standard and compact layouts as the list', () => {
        localStorage.setItem(ACTIVITY_LAYOUT_KEY, 'compact');
        expect(readActivityLayout()).toBe('list');
        localStorage.setItem(ACTIVITY_LAYOUT_KEY, 'standard');
        expect(readActivityLayout()).toBe('list');
    });
});
