import { readLegacyBrowserSection } from './legacy';

describe('readLegacyBrowserSection', () => {
    beforeEach(() => window.localStorage.clear());

    it('maps data-table-preferences visibility to hidden and drops widths', () => {
        window.localStorage.setItem(
            'data-table-preferences',
            JSON.stringify({
                orders: {
                    columnVisibility: { total: false, customer: true, notes: false },
                    columnOrder: ['customer', 'total', 'notes'],
                    columnWidths: { total: 120 },
                    pageSize: 25,
                },
                empty: { columnVisibility: {}, columnOrder: [], columnWidths: {}, pageSize: 10 },
            }),
        );

        expect(readLegacyBrowserSection('tableColumns', 'u1')).toEqual({
            orders: { hidden: ['total', 'notes'], order: ['customer', 'total', 'notes'], pageSize: 25 },
            empty: { pageSize: 10 },
        });
    });

    it('maps app-shell-open-groups to the open keys', () => {
        window.localStorage.setItem('app-shell-open-groups', JSON.stringify({ sales: true, stock: false, hr: true }));

        expect(readLegacyBrowserSection('sidebar', 'u1')).toEqual({ appShellOpenGroups: ['sales', 'hr'] });
    });

    it('reads the per-user table look', () => {
        const stored = { global: { density: 'compact' }, tables: { orders: { density: 'comfortable' } } };
        window.localStorage.setItem('erp71:table-view:u1', JSON.stringify(stored));

        expect(readLegacyBrowserSection('tableView', 'u1')).toEqual(stored);
        expect(readLegacyBrowserSection('tableView', 'u2')).toBeUndefined();
    });

    it('returns undefined when nothing is stored', () => {
        expect(readLegacyBrowserSection('tableColumns', 'u1')).toBeUndefined();
        expect(readLegacyBrowserSection('sidebar', 'u1')).toBeUndefined();
    });

    it('returns undefined on bad JSON or blocked storage', () => {
        window.localStorage.setItem('data-table-preferences', '{nope');
        window.localStorage.setItem('app-shell-open-groups', '[1,2]');
        expect(readLegacyBrowserSection('tableColumns', 'u1')).toBeUndefined();
        expect(readLegacyBrowserSection('sidebar', 'u1')).toBeUndefined();

        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        try {
            expect(readLegacyBrowserSection('tableView', 'u1')).toBeUndefined();
            expect(readLegacyBrowserSection('sidebar', 'u1')).toBeUndefined();
        } finally {
            spy.mockRestore();
        }
    });
});
