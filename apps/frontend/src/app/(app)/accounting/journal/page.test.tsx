import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountingJournalPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span />,
    ChevronRight: () => <span />,
    ClipboardList: () => <span />,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getVouchers: jest.fn(),
    },
}));

describe('AccountingJournalPage', () => {
    it('loads compact journal rows with filters and pagination controls', async () => {
        const getVouchers = api.getVouchers as jest.Mock;
        getVouchers.mockResolvedValue({
            data: [
                {
                    id: 'voucher-1',
                    voucher_number: 'CP-00001',
                    voucher_type: 'cash_payment',
                    description: 'Office expense',
                    date: '2026-03-21T00:00:00.000Z',
                    total_amount: 125,
                },
            ],
            meta: { page: 1, limit: 30, total: 2, totalPages: 2 },
        });

        render(<AccountingJournalPage />);

        await waitFor(() => {
            expect(screen.getByText('CP-00001')).toBeInTheDocument();
            expect(screen.getByText('Office expense')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Journal voucher type'), {
            target: { value: 'cash_payment' },
        });

        await waitFor(() => {
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ voucherType: 'cash_payment' }));
        });

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        await waitFor(() => {
            expect(getVouchers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
        });
    });
});