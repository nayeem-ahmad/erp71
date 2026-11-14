import { buildTaskListWhere, parseAssigneeList } from './task-list-filters';

const TENANT = 'tenant-1';
const NOW = new Date('2026-11-14T06:00:00.000Z');

describe('buildTaskListWhere', () => {
    it('keeps a single priority, assignee and project as equality', () => {
        const where = buildTaskListWhere(
            TENANT,
            { priority: 'URGENT' as never, assigneeId: 'user-9', projectId: 'project-1', unassigned: 'false' },
            'Asia/Dhaka',
            null,
            undefined,
            NOW,
        );
        expect(where).toMatchObject({
            tenant_id: TENANT,
            priority: 'URGENT',
            assignee_id: 'user-9',
            project_id: 'project-1',
        });
        expect(where).not.toHaveProperty('AND');
        expect(where.assignee_id).not.toBeNull();
    });

    it('lets unassigned win over an assignee sent the old way', () => {
        const where = buildTaskListWhere(
            TENANT,
            { assigneeId: 'user-9', unassigned: 'true' },
            'UTC',
            null,
            undefined,
            NOW,
        );
        expect(where).toMatchObject({ assignee_id: null, assignee_employee_id: null });
    });

    it('ORs several assignees, including nobody', () => {
        const where = buildTaskListWhere(
            TENANT,
            { assignees: 'user:11111111-1111-1111-1111-111111111111,unassigned' },
            'UTC',
            null,
            undefined,
            NOW,
        );
        expect(where.AND).toEqual([
            {
                OR: [
                    { assignee_id: '11111111-1111-1111-1111-111111111111' },
                    { assignee_id: null, assignee_employee_id: null },
                ],
            },
        ]);
    });

    it('hides done and keeps a sprint membership clause', () => {
        const where = buildTaskListWhere(
            TENANT,
            { hideDone: 'true', sprintId: 'sprint-7' },
            'UTC',
            null,
            undefined,
            NOW,
        );
        expect(where.AND).toEqual(
            expect.arrayContaining([
                { status: { category: { not: 'DONE' } } },
                expect.objectContaining({ OR: expect.any(Array) }),
            ]),
        );
    });

    it('drops the dimension a count is ignoring', () => {
        const where = buildTaskListWhere(
            TENANT,
            { priorities: 'LOW,HIGH', hideDone: 'true' },
            'UTC',
            null,
            'priority',
            NOW,
        );
        expect(where).not.toHaveProperty('priority');
        expect(where.AND).toEqual([{ status: { category: { not: 'DONE' } } }]);
    });
});

describe('parseAssigneeList', () => {
    it('ignores a token that is not a person or unassigned', () => {
        expect(parseAssigneeList('me,user:not-a-uuid,employee:22222222-2222-2222-2222-222222222222')).toEqual({
            users: [],
            employees: ['22222222-2222-2222-2222-222222222222'],
            unassigned: false,
        });
    });
});
