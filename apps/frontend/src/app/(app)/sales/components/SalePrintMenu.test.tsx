import { fireEvent, render, screen } from '@testing-library/react';
import SalePrintMenu from './SalePrintMenu';

jest.mock('next/link', () => {
    // Keeps `role="menuitem"` and the rest, or the menu's links are unfindable.
    const MockLink = ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

function openMenu() {
    const props = {
        saleId: 'sale-1',
        paperSize: 'A4' as const,
        onPaperSizeChange: jest.fn(),
        onPrintInvoice: jest.fn(),
        onPrintChallan: jest.fn(),
        onPrintReceipt: jest.fn(),
    };
    render(<SalePrintMenu {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print options' }));
    return props;
}

const compactItem = () => screen.getByRole('menuitemcheckbox', { name: 'Compact layout' });

beforeEach(() => window.localStorage.clear());

describe('SalePrintMenu — compact', () => {
    it('switches compact on without printing and without closing the menu', () => {
        const props = openMenu();
        expect(compactItem()).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(compactItem());

        expect(compactItem()).toHaveAttribute('aria-checked', 'true');
        expect(window.localStorage.getItem('erp71:print:density')).toBe('compact');
        // A setting, not a print: the operator picks a size next.
        expect(props.onPrintInvoice).not.toHaveBeenCalled();
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('shows the answer the counter already chose, and switches it back off', () => {
        window.localStorage.setItem('erp71:print:density', 'compact');
        openMenu();
        expect(compactItem()).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(compactItem());

        expect(compactItem()).toHaveAttribute('aria-checked', 'false');
        expect(window.localStorage.getItem('erp71:print:density')).toBe('normal');
    });

    it('still prints the invoice when a size is picked', () => {
        const props = openMenu();
        fireEvent.click(compactItem());

        fireEvent.click(screen.getByRole('menuitem', { name: 'A5' }));

        expect(props.onPaperSizeChange).toHaveBeenCalledWith('A5');
        expect(props.onPrintInvoice).toHaveBeenCalledWith('A5');
    });
});
