import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SettingsHubPage from './page';

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: jest.fn(),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return {
        useI18n: () => ({
            t: enMessages,
        }),
    };
});

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('SettingsHubPage', () => {
    const { useTenantPlanFeatures } = require('@/lib/use-tenant-plan-features');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the settings hub heading', () => {
        useTenantPlanFeatures.mockReturnValue({ planCode: 'STANDARD', features: {}, ready: true });

        render(<SettingsHubPage />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    });

    it('renders category link cards for a standard plan', async () => {
        useTenantPlanFeatures.mockReturnValue({ planCode: 'STANDARD', features: {}, ready: true });

        render(<SettingsHubPage />);

        await waitFor(() => {
            expect(screen.getByRole('link', { name: 'Branding' })).toHaveAttribute('href', '/settings/branding');
            expect(screen.getByRole('link', { name: 'Tax / VAT' })).toHaveAttribute('href', '/settings/tax');
            expect(screen.getByRole('link', { name: 'Loyalty Program' })).toHaveAttribute('href', '/settings/loyalty');
        });
    });

    it('does not render anything until plan features are ready', () => {
        useTenantPlanFeatures.mockReturnValue({ planCode: null, features: {}, ready: false });

        render(<SettingsHubPage />);
        expect(screen.queryByRole('link', { name: 'Tax / VAT' })).not.toBeInTheDocument();
    });

    it('hides retail-only cards for an accounting-only plan while keeping accounting-relevant ones', async () => {
        useTenantPlanFeatures.mockReturnValue({
            planCode: 'STANDARD',
            features: { accountingOnly: true },
            ready: true,
        });

        render(<SettingsHubPage />);

        await waitFor(() => {
            expect(screen.getByRole('link', { name: 'Tax / VAT' })).toHaveAttribute('href', '/settings/tax');
        });
        expect(screen.queryByRole('link', { name: 'Loyalty Program' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'POS Counters' })).not.toBeInTheDocument();
    });

    it('offers the URL Shortener card on a plan that includes it', async () => {
        useTenantPlanFeatures.mockReturnValue({ planCode: 'PREMIUM', features: { urlShortener: true }, ready: true });

        render(<SettingsHubPage />);

        expect(await screen.findByRole('link', { name: 'URL Shortener' })).toHaveAttribute(
            'href',
            '/settings/url-shortener',
        );
    });

    it('leaves the URL Shortener card out below Business', async () => {
        useTenantPlanFeatures.mockReturnValue({ planCode: 'STANDARD', features: { urlShortener: false }, ready: true });

        render(<SettingsHubPage />);

        // Audit logs shares the card's section, so the section itself did render.
        expect(await screen.findByRole('link', { name: /audit logs/i })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'URL Shortener' })).not.toBeInTheDocument();
    });
});
