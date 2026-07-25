import { fireEvent, render, screen } from '@testing-library/react';
import { ReportScopeBar } from './ReportScopeBar';

const stores = [
    { id: 's1', name: 'Branch A' },
    { id: 's2', name: 'Branch B' },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof ReportScopeBar>> = {}) {
    const props: React.ComponentProps<typeof ReportScopeBar> = {
        scope: 'branch',
        onScopeChange: jest.fn(),
        storeId: 's1',
        onStoreIdChange: jest.fn(),
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
    it('renders branch dropdown when scope is branch', () => {
        renderBar({ scope: 'branch' });

        expect(screen.getByLabelText('Branch')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Branch A' })).toBeInTheDocument();
        expect(screen.queryByText('Company overhead')).not.toBeInTheDocument();
    });

    it('renders compare branch checkboxes when scope is compare', () => {
        renderBar({ scope: 'compare' });

        expect(screen.getByText('Branch A')).toBeInTheDocument();
        expect(screen.getByText('Branch B')).toBeInTheDocument();
        expect(screen.getByText('Company overhead')).toBeInTheDocument();
        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
    });

    it('hides consolidated scopes when user cannot consolidate', () => {
        renderBar({ canConsolidate: false });

        expect(screen.getByText('This branch')).toBeInTheDocument();
        expect(screen.queryByText('All branches')).not.toBeInTheDocument();
        expect(screen.queryByText('Compare branches')).not.toBeInTheDocument();
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

        it('keeps the level radios independent of the scope radios', () => {
            const onScopeChange = jest.fn();
            const onLevelChange = jest.fn();
            renderBar({ level: 'group', onLevelChange, onScopeChange });

            expect(screen.getByRole('radio', { name: 'Group' })).toBeChecked();
            expect(screen.getByRole('radio', { name: 'This branch' })).toBeChecked();

            fireEvent.click(screen.getByRole('radio', { name: 'Account' }));
            expect(onScopeChange).not.toHaveBeenCalled();
        });
    });
});