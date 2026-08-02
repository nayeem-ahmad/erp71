import React from 'react';
import { render, screen } from '@testing-library/react';
import AccountingDashboard from './AccountingDashboard';
import { api } from '@/lib/api';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getAccountingDashboardOverview: jest.fn(),
        getFinancialTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const CLEAN_HEALTH = {
    trial_balance: { debit: 100, credit: 100, difference: 0, is_balanced: true },
    pending_vouchers: 0,
    voucher_approval_enabled: false,
    failed_postings: 0,
    recurring_due: 0,
    unlocked_closed_periods: 0,
};

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-03-01', to: '2026-03-31' },
    as_of: '2026-03-31',
    position: {
        cash_and_bank: 338_000,
        accounts_receivable: 70_000,
        accounts_payable: 40_000,
        total_assets: 408_000,
        total_liabilities: 40_000,
        net_worth: 368_000,
    },
    performance: { revenue: 600_000, expenses: 242_000, net_profit: 358_000, net_margin_pct: 59.7 },
    aging: {
        receivable: { current: 60_000, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 10_000 },
        payable: { current: 40_000, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 },
        note: 'Aging is based on voucher date; individual invoice due dates are not tracked.',
    },
    books_health: CLEAN_HEALTH,
    expense_mix: [{ id: 'salaries', name: 'Salaries', code: '5101', amount: 158_000 }],
    expense_mix_other: 84_000,
    recent_vouchers: [],
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Ledger Co', renewalEnd: null };

describe('AccountingDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getFinancialTrends as jest.Mock).mockResolvedValue({ points: [] });
        (api.getAccountingDashboardOverview as jest.Mock).mockResolvedValue(overview());
    });

    it('renders position and performance figures in taka', async () => {
        render(<AccountingDashboard {...identity} />);

        expect(await screen.findByText('Cash & bank')).toBeInTheDocument();
        expect(screen.getByText('Net worth')).toBeInTheDocument();
        expect(screen.getByText('Net margin')).toBeInTheDocument();
        expect(screen.getByText('59.7%')).toBeInTheDocument();
        // Money renders through formatBDT, never a literal dollar sign.
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });

    it('says the books are clean when nothing needs attention', async () => {
        render(<AccountingDashboard {...identity} />);
        expect(await screen.findByText('Your books look clean 🎉')).toBeInTheDocument();
    });

    it('surfaces every books-health problem with a link to fix it', async () => {
        (api.getAccountingDashboardOverview as jest.Mock).mockResolvedValue(overview({
            books_health: {
                trial_balance: { debit: 10_000, credit: 8_760, difference: 1_240, is_balanced: false },
                pending_vouchers: 7,
                voucher_approval_enabled: true,
                failed_postings: 3,
                recurring_due: 2,
                unlocked_closed_periods: 4,
            },
        }));

        render(<AccountingDashboard {...identity} />);

        expect(await screen.findByText(/Trial balance out by/)).toBeInTheDocument();
        expect(screen.getByText('7 vouchers awaiting approval')).toBeInTheDocument();
        expect(screen.getByText('3 postings failed')).toBeInTheDocument();
        expect(screen.getByText('2 recurring vouchers due')).toBeInTheDocument();
        expect(screen.getByText('4 closed months still unlocked')).toBeInTheDocument();

        const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(links).toEqual(expect.arrayContaining([
            '/accounting/reports/trial-balance',
            '/accounting/vouchers?approvalStatus=PENDING',
            '/accounting/reconciliation',
            '/accounting/recurring-vouchers',
            '/accounting/fiscal-periods',
        ]));
    });

    it('keeps the renewal reminder the accounting-only dashboard used to lose', async () => {
        const in12Days = new Date(Date.now() + 12 * 86_400_000).toISOString();
        render(<AccountingDashboard {...identity} renewalEnd={in12Days} />);

        expect(await screen.findByText('Plan renews in 12 days')).toBeInTheDocument();
    });

    it('folds the expense tail into an Other slice', async () => {
        render(<AccountingDashboard {...identity} />);

        // One named account plus the tail the server rolled up.
        expect(await screen.findAllByTestId('donut-arc')).toHaveLength(2);
        expect(screen.getByText('Where the money went')).toBeInTheDocument();
        expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('degrades to an inline message when the overview call fails', async () => {
        (api.getAccountingDashboardOverview as jest.Mock).mockRejectedValue(new Error('Ledger is down'));

        render(<AccountingDashboard {...identity} />);

        expect(await screen.findByText('Ledger is down')).toBeInTheDocument();
        // The shell still renders, so the quick actions remain reachable.
        expect(screen.getByText('Voucher Entry')).toBeInTheDocument();
    });
});
