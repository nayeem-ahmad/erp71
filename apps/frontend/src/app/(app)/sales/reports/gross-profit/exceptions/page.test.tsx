'use client';
jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MarginExceptionsPage from './page';
import { mockBranchScope } from '@/test-utils/branch-scope';

jest.mock('@/lib/api', () => ({ api: { getMarginExceptions: jest.fn() } }));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/gross-profit/exceptions',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));

const line = (overrides: Record<string, unknown>) => ({
    saleId: 'sale-1',
    saleDate: '2026-10-01T06:00:00.000Z',
    productId: 'p1',
    productName: 'Soybean Oil 1L',
    quantity: 2,
    revenue: 300,
    cogs: 340,
    grossProfit: -40,
    grossMarginPct: -13.3,
    soldBelowCost: true,
    ...overrides,
});

function api() {
    return require('@/lib/api').api;
}

function tile(label: string) {
    return within(screen.getByRole('region', { name: 'Report figures' })).getByText(label).nextElementSibling;
}

describe('MarginExceptionsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockBranchScope();
        api().getMarginExceptions.mockResolvedValue({
            summary: {
                marginFloorPct: 0,
                exceptionCount: 250,
                belowCostCount: 40,
                exceptionRevenue: 90000,
                marginForgone: 4000,
                uncostedLines: 0,
                truncated: true,
            },
            rows: [
                line({}),
                line({ saleId: 'sale-2', productId: 'p2', productName: 'Miniket Rice 5kg', revenue: 600, cogs: 590, grossProfit: 10, grossMarginPct: 1.7, soldBelowCost: false }),
            ],
            byUser: [{ userId: 'u1', userName: 'Rafiq', lines: 2, marginForgone: 30 }],
        });
    });

    it('opens on a zero floor and asks again when the floor chip changes', async () => {
        render(<MarginExceptionsPage />);
        await waitFor(() => expect(api().getMarginExceptions).toHaveBeenCalledWith(expect.objectContaining({ marginFloorPct: 0 })));

        fireEvent.change(screen.getByRole('combobox', { name: 'Margin floor %' }), { target: { value: '10' } });

        await waitFor(() => expect(api().getMarginExceptions).toHaveBeenLastCalledWith(expect.objectContaining({ marginFloorPct: 10 })));
    });

    it('counts every line under the floor in the strip, past the worst the server sent', async () => {
        render(<MarginExceptionsPage />);
        await screen.findByRole('cell', { name: 'Soybean Oil 1L' });

        expect(tile('Lines below floor')).toHaveTextContent('250');
        expect(tile('Margin forgone')).toHaveTextContent('৳ 4,000');
        // Each line opens the sale it was rung up on.
        const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
        expect(links).toContain('/sales/sale-1');
    });

    it('narrows to lines sold below cost, and the strip counts what is left', async () => {
        render(<MarginExceptionsPage />);
        await screen.findByRole('cell', { name: 'Miniket Rice 5kg' });

        fireEvent.click(screen.getByRole('button', { name: 'Sold below cost' }));

        await waitFor(() => expect(screen.queryByRole('cell', { name: 'Miniket Rice 5kg' })).not.toBeInTheDocument());
        expect(tile('Lines below floor')).toHaveTextContent('1');
        // Floor 0: forgone is how far under cost the line went.
        expect(tile('Margin forgone')).toHaveTextContent('৳ 40');
    });
});
