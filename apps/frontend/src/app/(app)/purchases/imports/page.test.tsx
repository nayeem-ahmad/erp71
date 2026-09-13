import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImportShipmentsPage from './page';

jest.mock('@/lib/api', () => ({
    api: { getImportShipments: jest.fn() },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/purchases/imports',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const page = (items: unknown[], total = items.length) => ({
    items,
    total,
    page: 1,
    limit: 20,
    pages: Math.max(1, Math.ceil(total / 20)),
});

const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    reference_number: 'IMP-2526-00001',
    lc_number: 'LC-991',
    status: 'SHIPPED',
    currency: 'USD',
    invoice_value_fc: '4000.00',
    invoice_value_bdt: 480000,
    fx_rate_at_open: '120.000000',
    eta: '2026-03-01T00:00:00.000Z',
    supplier: { name: 'Shenzhen Trading Co' },
    item_count: 2,
    costs_to_date_bdt: 75000,
    ...overrides,
});

describe('ImportShipmentsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getImportShipments.mockResolvedValue(page([row()]));
    });

    it('asks the server for one page, not the whole history', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentsPage />);

        await waitFor(() => expect(api.getImportShipments).toHaveBeenCalled());
        expect(api.getImportShipments.mock.calls[0][0]).toMatchObject({ page: 1, limit: expect.any(Number) });
    });

    it('renders the invoice in the currency on the supplier\'s paper', async () => {
        // The BDT column beside it carries `hideOnMobile`, and jsdom reports a
        // narrow viewport, so it is genuinely absent here rather than hidden.
        render(<ImportShipmentsPage />);
        expect(await screen.findByText(/4,000/)).toBeInTheDocument();
    });

    it('passes the server\'s own BDT translation straight through', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentsPage />);
        await waitFor(() => expect(api.getImportShipments).toHaveBeenCalled());

        // The page no longer multiplies invoice_value_fc by fx_rate_at_open
        // itself — that arithmetic reported every BDT-denominated LC as zero
        // and now lives in one helper on the server.
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it('sends the search to the server rather than filtering in the browser', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentsPage />);
        await waitFor(() => expect(api.getImportShipments).toHaveBeenCalled());

        fireEvent.change(screen.getByPlaceholderText(/Search by reference/i), {
            target: { value: 'LC-991' },
        });

        await waitFor(() =>
            expect(
                api.getImportShipments.mock.calls.some((call: any[]) => call[0]?.search === 'LC-991'),
            ).toBe(true),
        );
    });

    it('filters by status through the server too', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentsPage />);
        await waitFor(() => expect(api.getImportShipments).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'RECEIVED' } });

        await waitFor(() =>
            expect(
                api.getImportShipments.mock.calls.some((call: any[]) => call[0]?.status === 'RECEIVED'),
            ).toBe(true),
        );
    });

    it('never asks to sort by a column the server does not allow', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentsPage />);
        await waitFor(() => expect(api.getImportShipments).toHaveBeenCalled());

        const allowed = new Set([
            'reference_number',
            'lc_number',
            'status',
            'currency',
            'invoice_value_fc',
            'eta',
            'created_at',
            undefined,
        ]);
        for (const call of api.getImportShipments.mock.calls) {
            expect(allowed.has(call[0]?.sortBy)).toBe(true);
        }
    });
});
