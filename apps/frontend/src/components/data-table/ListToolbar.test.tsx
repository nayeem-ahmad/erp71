import { fireEvent, render, screen, within } from '@testing-library/react';
import ListToolbar from './ListToolbar';
import type { ResolvedListFilter } from './FilterBar';
import type { TableViewLayout } from '@/components/table';

let mockMdUp = true;
jest.mock('@/hooks/useMediaQuery', () => ({
    ...jest.requireActual('@/hooks/useMediaQuery'),
    useIsMdUp: () => mockMdUp,
}));

const filters: ResolvedListFilter[] = [
    { id: 'status', type: 'multi-select', label: 'Status', value: [], onChange: jest.fn(), options: [{ value: 'OPEN', label: 'Open' }] },
    { id: 'approved', type: 'toggle', label: 'Approved only', pressed: false, onChange: jest.fn(), more: true },
];

const layout: TableViewLayout = {
    label: 'Show as',
    options: [
        { key: 'days', label: 'Days' },
        { key: 'table', label: 'Table' },
    ],
    value: 'days',
    onChange: jest.fn(),
};

beforeEach(() => {
    mockMdUp = true;
});

describe('ListToolbar — one row', () => {
    it('keeps the `more` chips behind More, with the buttons as icons', () => {
        render(<ListToolbar tableId="toolbar-test" filters={filters} filterLayout="row" layout={layout} onExport={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approved only' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        expect(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Approved only' })).toBeInTheDocument();
        expect(screen.getByText('Export')).toHaveClass('sr-only');
    });

    it('wraps every chip into the row without the row layout', () => {
        render(<ListToolbar tableId="toolbar-test" filters={filters} />);
        expect(screen.getByRole('button', { name: 'Approved only' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    });

    it('keeps the Filters sheet on a phone', () => {
        mockMdUp = false;
        render(<ListToolbar tableId="toolbar-test" filters={filters} filterLayout="row" />);
        expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    });
});

describe('ListToolbar — View options', () => {
    it('offers the layout switch in View options', () => {
        render(<ListToolbar tableId="toolbar-test" filters={filters} layout={layout} />);
        fireEvent.click(screen.getByRole('button', { name: 'View options' }));
        expect(within(screen.getByRole('dialog', { name: 'View options' })).getByText('Show as')).toBeInTheDocument();
    });

    it('leaves View options out with `viewOptions={false}`', () => {
        render(<ListToolbar tableId="toolbar-test" filters={filters} layout={layout} viewOptions={false} />);
        expect(screen.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
    });

    it('leaves out a View options that would open empty, with no layout to choose', () => {
        render(<ListToolbar tableId="toolbar-test" filters={filters} />);
        expect(screen.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
    });
});
