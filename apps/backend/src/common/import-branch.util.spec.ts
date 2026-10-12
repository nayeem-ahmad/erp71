import { BadRequestException } from '@nestjs/common';
import { makeImportBranchResolver } from './import-branch.util';

describe('makeImportBranchResolver', () => {
    const db = {
        store: {
            findMany: jest.fn().mockResolvedValue([
                { id: 's-dhk', name: 'Dhaka Branch', code: 'DHK' },
                { id: 's-ctg', name: 'Chattogram', code: 'CTG' },
                { id: 's-web', name: 'Online Store', code: null },
            ]),
        },
    };

    it('finds a branch by code or by name, in any case and spacing', async () => {
        const resolve = await makeImportBranchResolver(db, 't1', null);

        expect(resolve('dhk')).toBe('s-dhk');
        expect(resolve('  Chattogram ')).toBe('s-ctg');
        expect(resolve('online store')).toBe('s-web');
    });

    it('leaves a blank cell to the file\'s branch', async () => {
        const resolve = await makeImportBranchResolver(db, 't1', null);

        expect(resolve('')).toBeNull();
        expect(resolve(undefined)).toBeNull();
    });

    it('fails the row on an unknown branch', async () => {
        const resolve = await makeImportBranchResolver(db, 't1', null);

        expect(() => resolve('Sylhet')).toThrow(new BadRequestException('unknown branch "Sylhet"'));
    });

    it('fails the row on a branch the importer may not use', async () => {
        const resolve = await makeImportBranchResolver(db, 't1', ['s-dhk']);

        expect(resolve('DHK')).toBe('s-dhk');
        expect(() => resolve('CTG')).toThrow('branch "CTG" is not one you can add to');
    });
});
