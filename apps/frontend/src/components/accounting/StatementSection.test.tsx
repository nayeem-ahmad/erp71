import { render, screen } from '@testing-library/react';
import StatementSection, { hideZeroGroups, type StatementGroup } from './StatementSection';

const GROUPS: StatementGroup[] = [
    {
        group: { id: 'g-ca', name: 'Current Assets', code: '11' },
        rows: [
            { id: 'a-cash', name: 'Cash in Hand', code: '110101', balance: 500 },
            { id: 'a-bank', name: 'City Bank', code: '110102', balance: 0 },
        ],
        total: 500,
    },
    {
        group: { id: 'g-fa', name: 'Fixed Assets', code: '12' },
        rows: [{ id: 'a-land', name: 'Land', code: '120101', balance: 0 }],
        total: 0,
    },
];

describe('hideZeroGroups', () => {
    it('returns the input untouched when the toggle is off', () => {
        expect(hideZeroGroups(GROUPS, false)).toBe(GROUPS);
    });

    it('drops zero rows and the groups they leave empty', () => {
        const filtered = hideZeroGroups(GROUPS, true);

        expect(filtered).toHaveLength(1);
        expect(filtered[0].rows.map((row) => row.id)).toEqual(['a-cash']);
    });

    it('keeps a group whose rows net to zero but whose total does not', () => {
        const offsetting: StatementGroup[] = [{
            group: { id: 'g-x', name: 'Mixed', code: '13' },
            rows: [{ id: 'a-1', name: 'Empty', code: '130101', balance: 0 }],
            total: 250,
        }];

        const filtered = hideZeroGroups(offsetting, true);

        expect(filtered).toHaveLength(1);
        expect(filtered[0].rows).toEqual([]);
        expect(filtered[0].total).toBe(250);
    });

    it('treats sub-cent balances as zero', () => {
        const dust: StatementGroup[] = [{
            group: { id: 'g-d', name: 'Dust', code: '14' },
            rows: [{ id: 'a-d', name: 'Rounding', code: '140101', balance: 0.001 }],
            total: 0.001,
        }];

        expect(hideZeroGroups(dust, true)).toEqual([]);
    });
});

describe('StatementSection', () => {
    it('prints the code ahead of every group and account name', () => {
        render(<StatementSection groups={GROUPS} label="Assets" colorClass="bg-sky-50" />);

        expect(screen.getByText('11').compareDocumentPosition(screen.getByText('Current Assets')))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(screen.getByText('110101')).toBeInTheDocument();
        expect(screen.getByText('Cash in Hand')).toBeInTheDocument();
    });
});
