import { fireEvent, render, screen } from '@testing-library/react';
import PrintInvoicePrompt from './PrintInvoicePrompt';
import type { PaperSize } from '@/lib/sales-invoice-printer';

function renderPrompt(paperSize: PaperSize) {
    render(
        <PrintInvoicePrompt
            serialNumber="SL-00042"
            total="৳1,200.00"
            paperSize={paperSize}
            onPaperSizeChange={jest.fn()}
            onPrint={jest.fn()}
            onDismiss={jest.fn()}
        />,
    );
}

beforeEach(() => window.localStorage.clear());

describe('PrintInvoicePrompt — compact', () => {
    it('offers compact on a sheet, and remembers the answer for every print', () => {
        renderPrompt('A4');
        const box = screen.getByLabelText(/Compact layout/);
        expect(box).not.toBeChecked();

        fireEvent.click(box);

        expect(box).toBeChecked();
        expect(window.localStorage.getItem('erp71:print:density')).toBe('compact');
    });

    it('does not offer it for a roll, which never compacts', () => {
        renderPrompt('Thermal80');

        expect(screen.queryByLabelText(/Compact layout/)).not.toBeInTheDocument();
    });
});
