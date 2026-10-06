import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TaxSettingsPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/settings/tax',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

jest.mock('@/lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

import { fetchWithAuth } from '@/lib/api';
const mockFetch = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

function settings(overrides: Record<string, unknown> = {}) {
    return { default_vat_rate: '15.00', prices_include_vat: true, mushak_readiness: { missing: [] }, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation((_url: string, options?: any) =>
        Promise.resolve(options?.method === 'PATCH' ? settings(JSON.parse(options.body)) : settings()),
    );
});

describe('TaxSettingsPage — how prices are entered', () => {
    it('defaults to prices that include VAT, with no POS warning', async () => {
        render(<TaxSettingsPage />);

        const select = (await screen.findByLabelText('How prices are entered')) as HTMLSelectElement;
        expect(select.value).toBe('included');
        expect(screen.queryByText(/POS counter still treats prices/)).not.toBeInTheDocument();
    });

    it('shows a shop that adds VAT on top, and warns that POS does not follow yet', async () => {
        mockFetch.mockResolvedValue(settings({ prices_include_vat: false }));
        render(<TaxSettingsPage />);

        const select = (await screen.findByLabelText('How prices are entered')) as HTMLSelectElement;
        expect(select.value).toBe('added');
        expect(screen.getByText(/POS counter still treats prices/)).toBeInTheDocument();
    });

    it('saves the choice with the other tax settings', async () => {
        render(<TaxSettingsPage />);
        const select = await screen.findByLabelText('How prices are entered');

        fireEvent.change(select, { target: { value: 'added' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Tax Settings' }));
        });

        await waitFor(() =>
            expect(mockFetch).toHaveBeenCalledWith(
                '/tenants/tax-settings',
                expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"prices_include_vat":false') }),
            ),
        );
    });
});
