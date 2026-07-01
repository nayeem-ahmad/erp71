import { render, screen } from '@testing-library/react';
import AccountingPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        exportAccountingLedger: jest.fn(),
    },
}));

jest.mock('@/components/HelpTooltip', () => ({
    HelpTooltip: () => null,
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});



describe('AccountingPage — Story 30.1', () => {
    it('renders the accounting landing page with core navigation cards', () => {
        render(<AccountingPage />);

        expect(screen.getByText('Accounting Setup')).toBeInTheDocument();
        expect(screen.getByText('Chart of Accounts')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
        expect(screen.getByText('Voucher Entry')).toBeInTheDocument();
        expect(screen.getByText('Journal')).toBeInTheDocument();
        expect(screen.getByText('Ledger')).toBeInTheDocument();
    });
});