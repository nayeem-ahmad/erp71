import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardSettingsPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: jest.fn(),
}));

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
        getTenantDashboardSettings: jest.fn(),
        updateTenantDashboardSettings: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('DashboardSettingsPage', () => {
    const { useTenantPlanFeatures } = require('@/lib/use-tenant-plan-features');

    const planState = (features: Record<string, unknown>, dashboardPreference = 'AUTO') => ({
        planCode: 'STANDARD',
        features,
        dashboardPreference,
        permissions: ['VIEW_LEDGER'],
        ready: true,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (api.getTenantDashboardSettings as jest.Mock).mockResolvedValue({ dashboard_preference: 'AUTO' });
        (api.updateTenantDashboardSettings as jest.Mock).mockResolvedValue({ dashboard_preference: 'ACCOUNTING' });
    });

    it('offers all three options to a tenant with the accounting module', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({ premiumAccounting: true }));

        render(<DashboardSettingsPage />);

        const accounting = await screen.findByRole('radio', { name: /Accounting/ });
        expect(screen.getByRole('radio', { name: /Follow my plan/ })).toBeEnabled();
        expect(screen.getByRole('radio', { name: /Retail/ })).toBeEnabled();
        expect(accounting).toBeEnabled();
    });

    it('disables the accounting option and explains why without the module', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({}));

        render(<DashboardSettingsPage />);

        await waitFor(() => {
            expect(screen.getByRole('radio', { name: /Accounting/ })).toBeDisabled();
        });
        expect(
            screen.getByText('The accounting dashboard needs the accounting module. Upgrade your plan to enable it.'),
        ).toBeInTheDocument();
    });

    it('shows which dashboard the saved preference actually resolves to', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({ premiumAccounting: true }));
        (api.getTenantDashboardSettings as jest.Mock).mockResolvedValue({ dashboard_preference: 'ACCOUNTING' });

        render(<DashboardSettingsPage />);

        expect(await screen.findByText('Currently showing: Accounting dashboard')).toBeInTheDocument();
    });

    it('resolves AUTO against the plan default rather than the raw preference', async () => {
        useTenantPlanFeatures.mockReturnValue(planState({ premiumAccounting: true, accountingDashboard: true }));

        render(<DashboardSettingsPage />);

        expect(await screen.findByText('Currently showing: Accounting dashboard')).toBeInTheDocument();
    });
});
