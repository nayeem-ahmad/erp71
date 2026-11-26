import 'reflect-metadata';
import { parseStatusIds } from './crm-reports.dto';

describe('parseStatusIds', () => {
    it('splits a comma-separated string and trims each id', () => {
        expect(parseStatusIds('a, b')).toEqual(['a', 'b']);
    });

    it('drops empty entries from an array', () => {
        expect(parseStatusIds(['a', ''])).toEqual(['a']);
    });

    it('treats a missing value as no filter', () => {
        expect(parseStatusIds(undefined)).toEqual([]);
    });
});
