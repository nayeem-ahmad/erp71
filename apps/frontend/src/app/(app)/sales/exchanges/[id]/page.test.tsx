jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number> = {}) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
}, { virtual: true });

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'ex-1' }),
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
}));

const plan = { permissions: [] as string[], role: 'CASHIER' as string | null };
jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: () => ({ ...plan, ready: true, features: {}, planCode: null, dashboardPreference: 'AUTO' }),
}));

jest.mock('@/lib/print/use-print-header', () => ({
    usePrintHeader: () => ({ resolve: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({
    api: { getExchange: jest.fn(), cancelExchange: jest.fn() },
}));

import { render, screen, waitFor } from '@testing-library/react';
import ExchangeDetailPage from './page';
import { api } from '@/lib/api';

const EXCHANGE = {
    id: 'ex-1',
    exchange_number: 'EXC-1',
    status: 'COMPLETED',
    created_at: '2026-10-13T10:00:00.000Z',
    returned_total: 100,
    replacement_total: 100,
    difference: 0,
    due_delta: 0,
    cash_delta: 0,
    settlement_mode: 'cash',
    posting_status: 'skipped',
    reason: null,
    sale: { id: 'sale-1', serial_number: 'S-00001', customer: { name: 'Rina' } },
    items: [
        {
            id: 'line-1',
            returned_quantity: 1,
            returned_unit_price: 100,
            replacement_quantity: 1,
            replacement_unit_price: 100,
            returnedProduct: { name: 'Shirt M' },
            replacementProduct: { name: 'Shirt L' },
        },
    ],
};

describe('ExchangeDetailPage cancel', () => {
    beforeEach(() => {
        plan.permissions = [];
        plan.role = 'CASHIER';
        (api.getExchange as jest.Mock).mockResolvedValue(EXCHANGE);
    });

    it('hides Cancel without CANCEL_ENTRY', async () => {
        render(<ExchangeDetailPage />);
        expect(await screen.findByRole('heading', { name: 'EXC-1' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel exchange' })).not.toBeInTheDocument();
    });

    it('shows Cancel for a member who holds CANCEL_ENTRY', async () => {
        plan.permissions = ['CANCEL_ENTRY'];
        render(<ExchangeDetailPage />);
        expect(await screen.findByRole('button', { name: 'Cancel exchange' })).toBeInTheDocument();
    });

    it('hides Cancel once the exchange is cancelled', async () => {
        plan.role = 'OWNER';
        (api.getExchange as jest.Mock).mockResolvedValue({ ...EXCHANGE, status: 'CANCELLED' });
        render(<ExchangeDetailPage />);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'EXC-1' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Cancel exchange' })).not.toBeInTheDocument();
    });
});
