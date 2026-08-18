import { render, screen, fireEvent } from '@testing-library/react';
import ExportDialog from './ExportDialog';

const columns = [
    { id: 'name', label: 'Name', visible: true },
    { id: 'amount', label: 'Amount', visible: true },
    { id: 'hidden', label: 'Notes', visible: false },
];

const defaultProps = {
    open: true,
    title: 'Leads',
    pageCount: 20,
    totalCount: 1247,
    columns,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
};

describe('ExportDialog', () => {
    beforeEach(() => {
        defaultProps.onClose.mockReset();
        defaultProps.onConfirm.mockReset();
    });

    it('does not render when closed', () => {
        render(<ExportDialog {...defaultProps} open={false} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('defaults to CSV, complete list, and currently visible columns', () => {
        render(<ExportDialog {...defaultProps} />);

        expect(screen.getByRole('radio', { name: /csv/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /complete list \(1,247\)/i })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Name' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Amount' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Notes' })).not.toBeChecked();
    });

    it('selects every column when All is clicked', () => {
        render(<ExportDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
        expect(screen.getByRole('checkbox', { name: 'Notes' })).toBeChecked();
    });

    it('restores visible columns when Visible is clicked', () => {
        render(<ExportDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
        fireEvent.click(screen.getByRole('button', { name: /^visible$/i }));
        expect(screen.getByRole('checkbox', { name: 'Notes' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Name' })).toBeChecked();
    });

    it('sends the chosen format, row scope, and column ids on Download', () => {
        render(<ExportDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('radio', { name: /excel/i }));
        fireEvent.click(screen.getByRole('radio', { name: /current page \(20\)/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Amount' }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));

        expect(defaultProps.onConfirm).toHaveBeenCalledWith({
            format: 'excel',
            rowScope: 'page',
            columnIds: ['name'],
        });
    });

    it('disables Download when no columns are selected', () => {
        render(<ExportDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Name' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Amount' }));
        expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    });

    it('warns when the complete list exceeds the export cap', () => {
        render(<ExportDialog {...defaultProps} totalCount={12_000} />);
        expect(screen.getByText(/only the first 10,000 matching rows will be exported/i)).toBeInTheDocument();
    });

    it('shows fetch progress while busy', () => {
        render(<ExportDialog {...defaultProps} busy progress={{ loaded: 200, total: 1247 }} />);
        expect(screen.getByText(/fetching 200 of 1,247/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    });

    it('closes on cancel', () => {
        render(<ExportDialog {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
