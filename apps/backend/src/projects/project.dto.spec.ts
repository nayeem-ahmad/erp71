import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProjectDto, UpdateProjectDto, UpdateTaskDto } from './project.dto';

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
