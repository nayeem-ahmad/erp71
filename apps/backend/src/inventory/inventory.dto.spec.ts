import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateInventoryReasonDto } from './inventory.dto';

const errorsFor = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(CreateInventoryReasonDto, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });

const propertiesOf = (payload: Record<string, unknown>) => errorsFor(payload).map((error) => error.property);

describe('CreateInventoryReasonDto', () => {
    const valid = { type: 'SHRINKAGE', code: 'THEFT', label: 'Theft' };

    it('accepts a Product Lost reason', () => {
        expect(propertiesOf(valid)).toEqual([]);
    });

    it('accepts Product Found and stock-take types', () => {
        expect(propertiesOf({ ...valid, type: 'FOUND' })).toEqual([]);
        expect(propertiesOf({ ...valid, type: 'DISCREPANCY' })).toEqual([]);
    });

    it('rejects an unknown type', () => {
        expect(propertiesOf({ ...valid, type: 'DAMAGE' })).toEqual(['type']);
    });

    it('rejects a blank code or label', () => {
        expect(propertiesOf({ ...valid, code: '' })).toEqual(['code']);
        expect(propertiesOf({ ...valid, label: '' })).toEqual(['label']);
    });

    it('rejects whitespace-only code or label after trim', () => {
        expect(propertiesOf({ ...valid, code: '   ' })).toEqual(['code']);
        expect(propertiesOf({ ...valid, label: '   ' })).toEqual(['label']);
    });

    it('trims code and label', () => {
        const dto = plainToInstance(CreateInventoryReasonDto, {
            type: 'SHRINKAGE',
            code: '  THEFT  ',
            label: '  Theft  ',
        });
        expect(dto.code).toBe('THEFT');
        expect(dto.label).toBe('Theft');
        expect(validateSync(dto)).toEqual([]);
    });
});
