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
});