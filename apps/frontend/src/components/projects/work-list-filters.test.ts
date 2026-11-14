import { boardMatches, parseTaskFilters, storyMatches, taskFiltersToQuery, taskListParams, type StoryFilterState, type TaskFilterState } from './work-list-filters';
import { EMPTY_STORY_FILTERS, EMPTY_TASK_FILTERS } from './work-list-filters';

describe('project list filters', () => {
    it('keeps a staffing deep link on the scalar task params', () => {
        const { filters, owned } = parseTaskFilters(new URLSearchParams('assignee=user:rina&projectId=p1'));
        expect(owned).toEqual(expect.arrayContaining(['assignees', 'projectIds']));
        expect(taskListParams(filters, 'user-me')).toMatchObject({ assigneeId: 'rina', projectId: 'p1', counts: 'true' });
    });

    it('sends one signed-in user as assigneeId and several people as a list', () => {
        const mine: TaskFilterState = { ...EMPTY_TASK_FILTERS, assignees: ['me'] };
        expect(taskListParams(mine, 'user-me')).toMatchObject({ assigneeId: 'user-me' });
        const both: TaskFilterState = { ...EMPTY_TASK_FILTERS, assignees: ['me', 'unassigned'] };
        expect(taskListParams(both, 'user-me').assignees).toBe('user:user-me,unassigned');
    });

    it('writes the task view back without dropping a param it does not own', () => {
        const filters: TaskFilterState = { ...EMPTY_TASK_FILTERS, assignees: [], priorities: ['HIGH'] };
        const query = taskFiltersToQuery(new URLSearchParams('task=abc'), filters);
        const params = new URLSearchParams(query);
        expect(params.get('task')).toBe('abc');
        expect(params.get('priority')).toBe('HIGH');
        expect(params.getAll('assignee')).toEqual([]);
    });

    it('counts a story option without the dimension it is offering', () => {
        const filters: StoryFilterState = { ...EMPTY_STORY_FILTERS, statuses: ['DONE'] };
        const done = { status: 'DONE', title: 'Pay', code: 'OTB-1', project: { id: 'p1' } };
        const open = { status: 'READY', title: 'Pay', code: 'OTB-2', project: { id: 'p1' } };
        expect(storyMatches(done, filters, null)).toBe(true);
        expect(storyMatches(open, filters, null)).toBe(false);
        expect(storyMatches(open, filters, null, 'status')).toBe(true);
    });

    it('matches a board by a project its cards belong to', () => {
        const board = { name: 'Release', card_count: 2, project_ids: ['p1'], created_by: 'u1' };
        expect(boardMatches(board, { ...{ search: '', cards: '' as const, projectIds: ['p1'], ownerIds: [], createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '' } }, 'u1')).toBe(true);
        expect(boardMatches(board, { search: '', cards: '', projectIds: ['p2'], ownerIds: [], createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '' }, 'u1')).toBe(false);
    });
});
