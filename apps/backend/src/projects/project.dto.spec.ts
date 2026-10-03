import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
    BulkUpdateTasksDto,
    CreateProjectDto,
    CreateTaskDto,
    UpdateProjectDto,
    UpdateTaskDto,
} from './project.dto';
import { CreateBoardCardDto, MoveBoardCardDto } from './board.dto';

const errorsFor = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateTaskDto, payload) as object).map((e) => e.property);

const UUID = '11111111-1111-4111-8111-111111111111';

/**
 * The ValidateIf spelling, from the field the card actually exposes: PATCH reads
 * `undefined` as "leave alone", so a cleared field has to survive as `''` for
 * the service to null the column. `@IsOptional()` alone skips null and undefined
 * only, so the empty string would reach `@IsUUID()` and 400.
 */
describe('UpdateTaskDto clearing', () => {
    it('lets an unassignment through as an empty string', () => {
        expect(errorsFor({ assigneeId: '' })).toEqual([]);
        expect(plainToInstance(UpdateTaskDto, { assigneeId: '' }).assigneeId).toBe('');
    });

    it('lets a cleared employee assignee through', () => {
        expect(errorsFor({ assigneeEmployeeId: '' })).toEqual([]);
    });

    it('lets a cleared milestone and sprint through', () => {
        expect(errorsFor({ milestoneId: '', sprintId: '' })).toEqual([]);
    });

    it('still takes a real assignee', () => {
        expect(errorsFor({ assigneeId: UUID })).toEqual([]);
    });

    it('still rejects an assignee that is not a uuid', () => {
        expect(errorsFor({ assigneeId: 'karim' })).toEqual(['assigneeId']);
    });

    it('takes an estimate the card can send', () => {
        expect(errorsFor({ estimateHours: 7.5 })).toEqual([]);
    });

    it('rejects a negative estimate', () => {
        expect(errorsFor({ estimateHours: -1 })).toEqual(['estimateHours']);
    });
});

/**
 * Moving a task to another project. The global pipe runs with
 * `forbidNonWhitelisted` (`main.ts`), so a field the DTO does not declare is a
 * 400 rather than something the service quietly never sees.
 */
describe('UpdateTaskDto project', () => {
    const pipeErrors = (payload: Record<string, unknown>) =>
        validateSync(plainToInstance(UpdateTaskDto, payload) as object, {
            whitelist: true,
            forbidNonWhitelisted: true,
        }).map((e) => e.property);

    it('takes a project to move the task to', () => {
        expect(pipeErrors({ projectId: UUID })).toEqual([]);
    });

    it('refuses an empty project — unlike the links around it, a task cannot have none', () => {
        expect(errorsFor({ projectId: '' })).toEqual(['projectId']);
    });
});

const createTaskErrors = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(CreateTaskDto, payload) as object).map((e) => e.property);

const NEW_TASK = { projectId: UUID, title: 'Daily planning' };

/**
 * The New Task dialog sends both assignee columns, `''` for the one the chosen
 * holder does not use — the same shape an inline edit sends, because it is
 * built by the same `assigneeColumns()` helper. POST had the bare `@IsUUID()`
 * spelling, so picking anyone at all 400'd with "assigneeEmployeeId must be a
 * UUID" on the column that was left empty.
 */
describe('CreateTaskDto clearing', () => {
    it('takes a task assigned to a user, with the employee column left empty', () => {
        expect(createTaskErrors({ ...NEW_TASK, assigneeId: UUID, assigneeEmployeeId: '' })).toEqual([]);
    });

    it('takes a task assigned to an employee, with the user column left empty', () => {
        expect(createTaskErrors({ ...NEW_TASK, assigneeId: '', assigneeEmployeeId: UUID })).toEqual([]);
    });

    it('lets the other links the dialog leaves blank through', () => {
        expect(createTaskErrors({ ...NEW_TASK, statusId: '', milestoneId: '', userStoryId: '', sprintId: '' }))
            .toEqual([]);
    });

    it('still rejects an assignee that is not a uuid', () => {
        expect(createTaskErrors({ ...NEW_TASK, assigneeId: 'karim' })).toEqual(['assigneeId']);
    });

    it('still requires a project and a title', () => {
        expect(createTaskErrors({}).sort()).toEqual(['projectId', 'title']);
    });
});

const projectErrors = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateProjectDto, payload) as object).map((e) => e.property);

/**
 * The edit form sends `''` for every optional link and date the user left blank,
 * because undefined means "leave alone" to PATCH. Before this, saving an edit on
 * a project with no type and no dates 400'd with
 * "projectTypeId must be a UUID, startDate must be a valid ISO 8601 date string".
 */
describe('UpdateProjectDto clearing', () => {
    it('lets a save with no type and no dates through', () => {
        expect(projectErrors({ name: 'Rooftop solar', projectTypeId: '', startDate: '', targetEndDate: '' }))
            .toEqual([]);
    });

    it('lets the other clearable links through', () => {
        expect(projectErrors({ customerId: '', storeId: '', leadId: '', managerId: '' })).toEqual([]);
    });

    it('lets a cleared actual end date through', () => {
        expect(projectErrors({ actualEndDate: '' })).toEqual([]);
    });

    it('takes a cleared budget as null rather than coercing it to zero', () => {
        expect(projectErrors({ budgetAmount: null })).toEqual([]);
        expect(plainToInstance(UpdateProjectDto, { budgetAmount: null }).budgetAmount).toBeNull();
    });

    it('still takes real values', () => {
        expect(projectErrors({ name: 'Rooftop solar', projectTypeId: UUID, startDate: '2026-08-22' })).toEqual([]);
    });

    it('still rejects a type that is not a uuid, and a date that is not a date', () => {
        expect(projectErrors({ projectTypeId: 'solar', startDate: 'someday' }).sort())
            .toEqual(['projectTypeId', 'startDate']);
    });

    it('applies the same spelling to create, so the two DTOs cannot drift', () => {
        const errors = validateSync(
            plainToInstance(CreateProjectDto, { name: 'Rooftop solar', projectTypeId: '', startDate: '' }) as object,
        );
        expect(errors.map((e) => e.property)).toEqual([]);
    });
});

/**
 * The board composer sends both assignee columns on every card, so that the one
 * the chosen holder does not fill arrives as `''` rather than being omitted —
 * the same shape `assigneeColumns()` produces everywhere else in the module.
 * Without the `@ValidateIf` spelling the empty sibling reaches `@IsUUID()` and
 * 400s, which is exactly the bug the New Task dialog had.
 */
describe('CreateBoardCardDto assignees', () => {
    const cardErrors = (payload: Record<string, unknown>) =>
        validateSync(plainToInstance(CreateBoardCardDto, payload) as object).map((e) => e.property);

    const base = { projectId: UUID, title: 'Write the changelog' };

    it('takes a card with no assignee at all', () => {
        expect(cardErrors(base)).toEqual([]);
    });

    it('takes a user assignee with the employee column left empty', () => {
        expect(cardErrors({ ...base, assigneeId: UUID, assigneeEmployeeId: '' })).toEqual([]);
    });

    it('takes an employee assignee with the user column left empty', () => {
        expect(cardErrors({ ...base, assigneeId: '', assigneeEmployeeId: UUID })).toEqual([]);
    });

    it('takes both columns empty, which is how the composer says "unassigned"', () => {
        expect(cardErrors({ ...base, assigneeId: '', assigneeEmployeeId: '' })).toEqual([]);
    });

    // '' is the only non-UUID that means anything; garbage is still garbage.
    it('still rejects a non-empty value that is not a UUID', () => {
        expect(cardErrors({ ...base, assigneeId: 'not-a-uuid' })).toEqual(['assigneeId']);
        expect(cardErrors({ ...base, assigneeEmployeeId: 'nope' })).toEqual([
            'assigneeEmployeeId',
        ]);
    });
});

/**
 * A card filed through the New Task form carries that form's other fields.
 * The global pipe forbids anything the DTO does not name, so each one has to be
 * declared here or the dialog 400s — and each is checked as `CreateTaskDto`
 * checks it, since it goes on to `tasks.create` unchanged.
 */
describe('CreateBoardCardDto New Task fields', () => {
    const cardErrors = (payload: Record<string, unknown>) =>
        validateSync(plainToInstance(CreateBoardCardDto, payload) as object).map((e) => e.property);

    const base = { projectId: UUID, title: 'Write the changelog' };

    it('takes a description, a priority, a due date and an estimate', () => {
        expect(
            cardErrors({
                ...base,
                description: 'Every change since 4.1',
                priority: 'HIGH',
                dueDate: '2026-10-01',
                estimateHours: 2.5,
            }),
        ).toEqual([]);
    });

    it('reads a due date left empty as none', () => {
        expect(cardErrors({ ...base, dueDate: '' })).toEqual([]);
    });

    it('rejects what CreateTaskDto rejects', () => {
        expect(cardErrors({ ...base, priority: 'SOMEDAY' })).toEqual(['priority']);
        expect(cardErrors({ ...base, dueDate: 'next week' })).toEqual(['dueDate']);
        expect(cardErrors({ ...base, estimateHours: -1 })).toEqual(['estimateHours']);
        expect(cardErrors({ ...base, description: 'x'.repeat(5001) })).toEqual(['description']);
    });
});

describe('MoveBoardCardDto swimlanes', () => {
    const errors = (payload: Record<string, unknown>) =>
        validateSync(
            plainToInstance(MoveBoardCardDto, { columnId: UUID, sortOrder: 0, ...payload }) as object,
        ).map((e) => e.property);

    it('is a plain move without either lane field', () => {
        expect(errors({})).toEqual([]);
    });

    it('takes the keys the page builds', () => {
        expect(errors({ laneBy: 'assignee', laneKey: `user:${UUID}` })).toEqual([]);
        expect(errors({ laneBy: 'assignee', laneKey: `employee:${UUID}` })).toEqual([]);
        expect(errors({ laneBy: 'story', laneKey: `story:${UUID}` })).toEqual([]);
        expect(errors({ laneBy: 'story', laneKey: 'none' })).toEqual([]);
    });

    it('wants both halves — a key means nothing without what it keys', () => {
        expect(errors({ laneKey: 'none' })).toEqual(['laneBy']);
        expect(errors({ laneBy: 'story' })).toEqual(['laneKey']);
    });

    it('refuses anything that is not a lane key', () => {
        expect(errors({ laneBy: 'priority', laneKey: 'none' })).toEqual(['laneBy']);
        expect(errors({ laneBy: 'assignee', laneKey: 'user:not-a-uuid' })).toEqual(['laneKey']);
        expect(errors({ laneBy: 'assignee', laneKey: `user:${UUID};drop` })).toEqual(['laneKey']);
    });
});

describe('BulkUpdateTasksDto', () => {
    const bulkErrors = (payload: Record<string, unknown>) =>
        validateSync(plainToInstance(BulkUpdateTasksDto, { ids: [UUID], ...payload }) as object).map(
            (e) => e.property,
        );

    it('takes null for the fields a bulk edit can clear', () => {
        // `null`, not `''`: this DTO is a change set, so an absent field is
        // "leave alone" and null is "clear" without the PATCH spelling.
        expect(bulkErrors({ sprintId: null, assignee: null, dueDate: null })).toEqual([]);
    });

    it('takes a full change set', () => {
        expect(
            bulkErrors({
                projectId: UUID,
                sprintId: UUID,
                assignee: `user:${UUID}`,
                priority: 'HIGH',
                dueDate: '2026-10-09',
                addLabelIds: [UUID],
                removeLabelIds: [UUID],
            }),
        ).toEqual([]);
    });

    it('rejects ids that are not uuids, and an empty selection', () => {
        expect(bulkErrors({ ids: ['k1'] })).toEqual(['ids']);
        expect(bulkErrors({ ids: [] })).toEqual(['ids']);
    });

    it('rejects a label, sprint or project that is not a uuid', () => {
        expect(bulkErrors({ addLabelIds: ['blocked'], sprintId: 'next', projectId: 'ALP' }).sort()).toEqual([
            'addLabelIds',
            'projectId',
            'sprintId',
        ]);
    });
});
