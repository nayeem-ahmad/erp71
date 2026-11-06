import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ArAgingPage from './page';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getArAging: jest.fn(),
        getAccountingSettings: jest.fn().mockResolvedValue({
            requireVoucherApproval: false,
            autoApproveSystemVouchers: true,
            reportsApprovedOnly: false,
        }),
    },
    fetchWithAuth: jest.fn().mockResolvedValue(null),
}));

const account = (id: string, name: string, buckets: { current: number; overdue_31_60: number; overdue_61_90: number; overdue_90_plus: number }) => ({
    id,
    name,
    code: null,
    type: 'ASSET',
    balance: buckets.current + buckets.overdue_31_60 + buckets.overdue_61_90 + buckets.overdue_90_plus,
    balance_side: 'DEBIT',
    buckets,
});

const RESPONSE = {
    as_of: '2026-11-06',
    accounts: [
        account('a1', 'Rahim Traders', { current: 5000, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 }),
        account('a2', 'Karim Stores', { current: 1000, overdue_31_60: 2000, overdue_61_90: 0, overdue_90_plus: 4000 }),
    ],
    totals: { balance: 12000, current: 6000, overdue_31_60: 2000, overdue_61_90: 0, overdue_90_plus: 4000 },
    note: 'Aged by voucher date.',
};

const taka = (value: number) => formatBDT(value, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function stat(label: string) {
    const strip = screen.getByRole('region', { name: 'Report figures' });
    return within(strip).getByText(label).closest('div') as HTMLElement;
}

describe('AR aging', () => {
    beforeEach(() => {
        (api.getArAging as jest.Mock).mockReset().mockResolvedValue(RESPONSE);
    });

    it('asks for today, and adds up the parties in the strip', async () => {
        render(<ArAgingPage />);

        await screen.findByText('Rahim Traders');
        expect(api.getArAging).toHaveBeenCalledWith(expect.objectContaining({ asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
        expect(within(stat('Parties')).getByText('2')).toBeInTheDocument();
        expect(within(stat('Total due')).getByText(taka(12000))).toBeInTheDocument();
        expect(within(stat('Overdue')).getByText(taka(6000))).toBeInTheDocument();
        expect(within(stat('90+ days')).getByText(taka(4000))).toBeInTheDocument();
    });

    it('narrows to the overdue parties, and the strip follows', async () => {
        render(<ArAgingPage />);
        await screen.findByText('Rahim Traders');

        fireEvent.click(screen.getByRole('button', { name: 'Overdue only' }));

        await waitFor(() => expect(screen.queryByText('Rahim Traders')).not.toBeInTheDocument());
        expect(screen.getByText('Karim Stores')).toBeInTheDocument();
        expect(within(stat('Parties')).getByText('1')).toBeInTheDocument();
        expect(within(stat('Total due')).getByText(taka(7000))).toBeInTheDocument();
    });
});
