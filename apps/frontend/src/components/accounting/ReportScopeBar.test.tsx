import { fireEvent, render, screen } from '@testing-library/react';
import { ReportScopeBar } from './ReportScopeBar';

const stores = [
    { id: 's1', name: 'Branch A' },
    { id: 's2', name: 'Branch B' },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof ReportScopeBar>> = {}) {
    const props: React.ComponentProps<typeof ReportScopeBar> = {
        compare: false,
        onCompareChange: jest.fn(),
        selectedStoreIds: ['s1', 's2'],
        onSelectedStoreIdsChange: jest.fn(),
        includeCompanyBucket: false,
        onIncludeCompanyBucketChange: jest.fn(),
        stores,
        canConsolidate: true,
        dateMode: 'range',
        from: '2026-01-01',
        to: '2026-06-30',
        asOfDate: '2026-06-30',
        onDateChange: jest.fn(),
        onGenerate: jest.fn(),
        ...overrides,
    };

    return {
        ...render(<ReportScopeBar {...props} />),
        props,
    };
}

describe('ReportScopeBar', () => {
    it('leaves the branch to the page filter: no branch select or scope radios', () => {
        renderBar();

        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'This branch' })).not.toBeInTheDocument();
        expect(screen.queryByText('Company overhead')).not.toBeInTheDocument();
    });

    it('offers Compare branches as a checkbox, and remembers it', () => {
        localStorage.clear();
        const { props } = renderBar();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Compare branches' }));

        expect(props.onCompareChange).toHaveBeenCalledWith(true);
        expect(localStorage.getItem('report_scope')).toBe('compare');
    });

    it('renders compare branch checkboxes when comparing', () => {
        renderBar({ compare: true });

        expect(screen.getByText('Branch A')).toBeInTheDocument();
        expect(screen.getByText('Branch B')).toBeInTheDocument();
        expect(screen.getByText('Company overhead')).toBeInTheDocument();
    });

    it('hides compare when the user cannot consolidate', () => {
        renderBar({ canConsolidate: false, compare: true });

        expect(screen.queryByText('Compare branches')).not.toBeInTheDocument();
        expect(screen.queryByText('Company overhead')).not.toBeInTheDocument();
    });

    it('calls onGenerate when generate is clicked', () => {
        const { props } = renderBar();
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
        expect(props.onGenerate).toHaveBeenCalled();
    });

    describe('detail level', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('is hidden on reports that do not pass a level', () => {
            renderBar();

            expect(screen.queryByRole('radiogroup', { name: 'Detail' })).not.toBeInTheDocument();
        });

        it('offers account, subgroup and group when a level is passed', () => {
            renderBar({ level: 'account', onLevelChange: jest.fn() });

            const group = screen.getByRole('radiogroup', { name: 'Detail' });
            expect(group).toBeInTheDocument();
            expect(screen.getByText('Account')).toBeInTheDocument();
            expect(screen.getByText('Subgroup')).toBeInTheDocument();
            expect(screen.getByText('Group')).toBeInTheDocument();
        });

        it('reports and persists the selected level', () => {
            const onLevelChange = jest.fn();
            renderBar({ level: 'account', onLevelChange });

            fireEvent.click(screen.getByRole('radio', { name: 'Subgroup' }));

            expect(onLevelChange).toHaveBeenCalledWith('subgroup');
            expect(localStorage.getItem('report_level')).toBe('subgroup');
        });

        it('keeps the level radios independent of the compare toggle', () => {
            const onCompareChange = jest.fn();
            const onLevelChange = jest.fn();
            renderBar({ level: 'group', onLevelChange, onCompareChange });

            expect(screen.getByRole('radio', { name: 'Group' })).toBeChecked();

            fireEvent.click(screen.getByRole('radio', { name: 'Account' }));
            expect(onCompareChange).not.toHaveBeenCalled();
        });
    });
});