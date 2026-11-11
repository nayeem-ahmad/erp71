import {
    OVERLOAD_THRESHOLD,
    mergeStaffing,
    parseStaffingStatuses,
    personKey,
    type MergeStaffingInput,
} from './staffing.util';

describe('personKey', () => {
    it('keys a user and an employee the way the Tasks filter does', () => {
        expect(personKey('user', 'u1')).toBe('user:u1');
        expect(personKey('employee', 'e1')).toBe('employee:e1');
    });
});

describe('parseStaffingStatuses', () => {
    it('defaults status to ACTIVE and ON_HOLD, and ALL keeps every ProjectStatus', () => {
        expect(parseStaffingStatuses(undefined)).toEqual(['ACTIVE', 'ON_HOLD']);
        expect(parseStaffingStatuses('')).toEqual(['ACTIVE', 'ON_HOLD']);
        expect(parseStaffingStatuses('ALL')).toEqual(
            ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
        );
        expect(parseStaffingStatuses('ACTIVE,NOPE,COMPLETED')).toEqual(['ACTIVE', 'COMPLETED']);
    });
});

describe('mergeStaffing', () => {
    it('paints a manager with no member row, a member with 0 remaining, assigned-not-on-team, and unassigned', () => {
        const out = mergeStaffing(fixture()); // one project, four people as in the spec
        expect(out.people.map((p) => p.key)).toEqual(['employee:e1', 'user:karim', 'user:rina', 'unassigned']);
        expect(out.people.find((p) => p.key === 'user:rina')!.cells['p1']).toMatchObject({
            role: 'MANAGER', isManager: true, remainingHours: 12, assignedNotOnTeam: false,
        });
        expect(out.people.find((p) => p.key === 'user:karim')!.cells['p1'].remainingHours).toBe(0);
        expect(out.people.find((p) => p.key === 'employee:e1')!.cells['p1'].assignedNotOnTeam).toBe(true);
        expect(out.people.find((p) => p.key === 'unassigned')!.cells['p1']).toMatchObject({
            remainingHours: 8, assignedNotOnTeam: false,
        });
        expect(out.summary).toMatchObject({ people: 3, overloaded: 0, unassignedRemainingHours: 8 });
    });

    it('collapses a linked employee onto the user and adds hours from both columns', () => {
        const out = mergeStaffing(linkedFixture()); // member as user u1, hours on assignee_employee_id e1, employee.user_id = u1
        expect(out.people.filter((p) => p.kind !== 'unassigned')).toHaveLength(1);
        expect(out.people[0].key).toBe('user:u1');
        expect(out.people[0].totals.remainingHours).toBe(10);
    });

    it('counts overload at 3+ projects', () => {
        expect(OVERLOAD_THRESHOLD).toBe(3);
        const out = mergeStaffing(threeProjectFixture());
        expect(out.summary.overloaded).toBe(1);
    });
});

/** One project: Amina (hours only), Karim (idle member), Rina (manager, no member row), Unassigned. */
function fixture(): MergeStaffingInput {
    return {
        projects: [
            { id: 'p1', code: 'ERP', shortName: 'ERP', name: 'ERP Rebuild', status: 'ACTIVE' },
        ],
        members: [
            {
                projectId: 'p1',
                userId: 'karim',
                role: 'MEMBER',
                user: { id: 'karim', name: 'Karim', email: 'karim@example.com' },
            },
        ],
        managers: [
            { projectId: 'p1', userId: 'rina', name: 'Rina', email: 'rina@example.com' },
        ],
        hours: [
            { projectId: 'p1', userId: 'rina', remainingHours: 12, openTasks: 2 },
            { projectId: 'p1', userId: 'karim', remainingHours: 0, openTasks: 0 },
            {
                projectId: 'p1',
                employeeId: 'e1',
                remainingHours: 4,
                openTasks: 1,
                employee: { id: 'e1', name: 'Amina', employee_code: 'E-1' },
            },
            { projectId: 'p1', remainingHours: 8, openTasks: 1 },
        ],
        linkedEmployees: [],
    };
}

/** Member is user u1; remaining hours sit on linked employee e1 as well as the user column. */
function linkedFixture(): MergeStaffingInput {
    return {
        projects: [
            { id: 'p1', code: 'ERP', shortName: 'ERP', name: 'ERP Rebuild', status: 'ACTIVE' },
        ],
        members: [
            {
                projectId: 'p1',
                userId: 'u1',
                role: 'MEMBER',
                user: { id: 'u1', name: 'Nadia', email: 'nadia@example.com' },
            },
        ],
        managers: [],
        hours: [
            { projectId: 'p1', userId: 'u1', remainingHours: 4, openTasks: 1 },
            { projectId: 'p1', employeeId: 'e1', remainingHours: 6, openTasks: 2 },
        ],
        linkedEmployees: [{ employeeId: 'e1', userId: 'u1' }],
    };
}

/** One person is a member of three projects — the overload threshold. */
function threeProjectFixture(): MergeStaffingInput {
    const projects = [
        { id: 'p1', code: 'A', shortName: 'A', name: 'Alpha', status: 'ACTIVE' },
        { id: 'p2', code: 'B', shortName: 'B', name: 'Beta', status: 'ACTIVE' },
        { id: 'p3', code: 'C', shortName: 'C', name: 'Gamma', status: 'ACTIVE' },
    ];
    return {
        projects,
        members: projects.map((project) => ({
            projectId: project.id,
            userId: 'busy',
            role: 'MEMBER' as const,
            user: { id: 'busy', name: 'Busy', email: 'busy@example.com' },
        })),
        managers: [],
        hours: [],
        linkedEmployees: [],
    };
}
