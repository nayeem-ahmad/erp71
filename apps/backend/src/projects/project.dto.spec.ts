import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTaskDto } from './project.dto';

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
