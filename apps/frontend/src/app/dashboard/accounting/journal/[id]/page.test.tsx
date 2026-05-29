import { render, screen, waitFor } from '@testing-library/react';
import VoucherDetailPage from './page';
import { api } from '../../../../../lib/api';

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'voucher-1' }),
}));

jest.mock('lucide-react', () => ({
    ArrowLeft: () => <span data-testid="icon-arrow-left" />,
    BookText: () => <span data-testid="icon-book-text" />,
}));

jest.mock('../../../../../lib/api', () => ({
    api: {
        getVoucher: jest.fn(),
    },
}));

describe('VoucherDetailPage — Story 30.6', () => {
    it('renders voucher header metadata and debit-credit rows', async () => {
        (api.getVoucher as jest.Mock).mockResolvedValue({
            id: 'voucher-1',
            voucher_number: 'CP-00001',
            voucher_type: 'cash_payment',
            reference_number: 'CP-REF-01',
            description: 'Office expense settlement',
            date: '2026-03-21T00:00:00.000Z',
            total_amount: 125,
            details: [
                {
                    id: 'detail-1',
                    debit_amount: 0,
                    credit_amount: 125,
                    comment: 'Cash paid',
                    account: { name: 'Cash in Hand', group: { name: 'Current Assets' } },
                },
                {
                    id: 'detail-2',
                    debit_amount: 125,
                    credit_amount: 0,
                    comment: 'Expense posted',
                    account: { name: 'General Operating Expense', group: { name: 'Operating Expenses' } },
                },
            ],
        });

        render(<VoucherDetailPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
            expect(screen.getByText('Office expense settlement')).toBeInTheDocument();
            expect(screen.getByText('Cash in Hand')).toBeInTheDocument();
            expect(screen.getByText('General Operating Expense')).toBeInTheDocument();
            expect(screen.getAllByText(/125\.00/).length).toBeGreaterThan(0);
        });
    });
});