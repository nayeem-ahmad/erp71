'use client';

import { render, screen, waitFor } from '@testing-library/react';
import LoyaltySettingsPage from './page';

jest.mock('../../../../lib/api', () => ({
    fetchWithAuth: jest.fn(),
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/settings/loyalty',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('LoyaltySettingsPage', () => {
    beforeEach(() => {
        const { fetchWithAuth } = require('../../../../lib/api');
        fetchWithAuth.mockResolvedValue({
            loyalty_points_enabled: false,
            loyalty_earn_rate: null,
            loyalty_redeem_rate: null,
            loyalty_min_redeem: null,
        });
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { fetchWithAuth } = require('../../../../lib/api');
        fetchWithAuth.mockResolvedValue({
            loyalty_points_enabled: false,
            loyalty_earn_rate: null,
            loyalty_redeem_rate: null,
            loyalty_min_redeem: null,
        });
        render(<LoyaltySettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Loyalty Program')).toBeInTheDocument();
        });
    });

    it('renders the Save Settings button after loading', async () => {
        const { fetchWithAuth } = require('../../../../lib/api');
        fetchWithAuth.mockResolvedValue({
            loyalty_points_enabled: true,
            loyalty_earn_rate: '1.0',
            loyalty_redeem_rate: '0.01',
            loyalty_min_redeem: 100,
        });
        render(<LoyaltySettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Save Settings')).toBeInTheDocument();
        });
    });

    it('shows Enable Loyalty Program toggle label', async () => {
        const { fetchWithAuth } = require('../../../../lib/api');
        fetchWithAuth.mockResolvedValue({
            loyalty_points_enabled: false,
            loyalty_earn_rate: null,
            loyalty_redeem_rate: null,
            loyalty_min_redeem: null,
        });
        render(<LoyaltySettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Enable Loyalty Program')).toBeInTheDocument();
        });
    });

    it('shows Settings breadcrumb link', async () => {
        const { fetchWithAuth } = require('../../../../lib/api');
        fetchWithAuth.mockResolvedValue({
            loyalty_points_enabled: false,
            loyalty_earn_rate: null,
            loyalty_redeem_rate: null,
            loyalty_min_redeem: null,
        });
        render(<LoyaltySettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Settings')).toBeInTheDocument();
        });
    });
});
