import {
    assigneeColumns,
    assigneeKeyOf,
    assigneeLabelOf,
    defaultAssigneeFor,
} from './task-assignee';

describe('defaultAssigneeFor', () => {
    it('puts a new task on the signed-in user by default', () => {
        expect(defaultAssigneeFor('me', 'u1')).toEqual({ assigneeId: 'u1' });
        expect(defaultAssigneeFor('anyone', 'u1')).toEqual({ assigneeId: 'u1' });
    });

    // Composing a run of tasks while filtered to somebody means they are for them.
    it('lets the filtered person win over the signed-in user', () => {
        expect(defaultAssigneeFor('user:u2', 'u1')).toEqual({ assigneeId: 'u2' });
        expect(defaultAssigneeFor('employee:e1', 'u1')).toEqual({ assigneeEmployeeId: 'e1' });
    });

    // Looking at nobody's work is a deliberate choice, not an accident to correct.
    it('leaves a task unheld when the list is filtered to unassigned', () => {
        expect(defaultAssigneeFor('unassigned', 'u1')).toEqual({});
    });

    it('leaves it unheld when nobody is signed in yet', () => {
        expect(defaultAssigneeFor('me', null)).toEqual({});
    });
});

describe('assigneeColumns', () => {
    /**
     * Both columns every time: PATCH reads `undefined` as "leave alone", so
     * sending only the one that gained a value leaves a task held twice.
     */
    it('always clears the column it is not setting', () => {
        expect(assigneeColumns('user:u1')).toEqual({ assigneeId: 'u1', assigneeEmployeeId: '' });
        expect(assigneeColumns('employee:e1')).toEqual({
            assigneeId: '',
            assigneeEmployeeId: 'e1',
        });
    });

    it('clears both for nobody', () => {
        expect(assigneeColumns('')).toEqual({ assigneeId: '', assigneeEmployeeId: '' });
    });
});

describe('assigneeKeyOf', () => {
    it('reads whichever column holds the task', () => {
        expect(assigneeKeyOf({ assignee: { id: 'u1', email: 'a@b.c' } })).toBe('user:u1');
        expect(assigneeKeyOf({ assigneeEmployee: { id: 'e1', name: 'Shanto' } })).toBe(
            'employee:e1',
        );
        expect(assigneeKeyOf({})).toBe('');
    });

    it('prefers the user column when a row somehow carries both', () => {
        expect(
            assigneeKeyOf({
                assignee: { id: 'u1', email: 'a@b.c' },
                assigneeEmployee: { id: 'e1', name: 'Shanto' },
            }),
        ).toBe('user:u1');
    });
});

describe('assigneeLabelOf', () => {
    it('falls back to the address when a user has no name', () => {
        expect(assigneeLabelOf({ assignee: { id: 'u1', name: null, email: 'a@b.c' } })).toBe(
            'a@b.c',
        );
    });

    it('names an employee without a login', () => {
        expect(assigneeLabelOf({ assigneeEmployee: { id: 'e1', name: 'Shanto' } })).toBe('Shanto');
    });

    it('says nobody with a dash', () => {
        expect(assigneeLabelOf({})).toBe('—');
    });
});
