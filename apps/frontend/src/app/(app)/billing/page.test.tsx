import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillingPage from './page';
import { api } from '@/lib/api';
import { redirectTo } from '@/lib/browser';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
    useSearchParams: () => new URLSearchParams('paymentStatus=success&message=Payment%20verified%20successfully.'),
}));

jest.mock('@/lib/browser', () => ({
    redirectTo: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getBillingSummary: jest.fn(),
        createBillingCheckoutSession: jest.fn(),
        confirmBillingCheckout: jest.fn(),
        cancelBillingAtPeriodEnd: jest.fn(),
        getAddonCatalog: jest.fn(),
        getMyAddonSubscriptions: jest.fn(),
        cancelAddonAtPeriodEnd: jest.fn(),
    },
}));

describe('BillingPage', () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (api.getBillingSummary as jest.Mock).mockResolvedValue({
            tenant: { id: 'tenant-1', name: 'Tenant One' },
            role: 'OWNER',
            can_manage_billing: true,
            provider_name: 'ssl-wireless',
            subscription: {
                status: 'TRIALING',
                current_period_start: '2026-03-21T00:00:00.000Z',
                current_period_end: '2026-04-20T00:00:00.000Z',
                cancel_at_period_end: false,
                provider_name: 'ssl-wireless',
                plan: {
                    code: 'BASIC',
                    name: 'Basic',
                    description: 'Core operations',
                    monthly_price: 1499,
                    yearly_price: 14990,
                },
            },
            available_plans: [
                { code: 'BASIC', name: 'Basic', description: 'Core operations', monthly_price: 1499, yearly_price: 14990 },
                { code: 'STANDARD', name: 'Standard', description: 'Growth features', monthly_price: 2999, yearly_price: 29990 },
            ],
            billing_history: [
                { id: 'event-1', event_type: 'CHECKOUT_CREATED', status: 'PENDING', created_at: '2026-03-21T00:00:00.000Z' },
            ],
        });
        (api.getAddonCatalog as jest.Mock).mockResolvedValue([
            { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', description: 'BOM & production jobs', monthly_price: 500, yearly_price: 5000 },
        ]);
        (api.getMyAddonSubscriptions as jest.Mock).mockResolvedValue([]);
    });

    it('renders callback success messaging and billing history', async () => {
        render(<BillingPage />);

        await waitFor(() => {
            expect(screen.getByText(/Payment verified successfully./i)).toBeInTheDocument();
            expect(screen.getByText('Recent Billing Events')).toBeInTheDocument();
            expect(screen.getByText('CHECKOUT_CREATED')).toBeInTheDocument();
        });
    });

    it('redirects to hosted checkout when SSL Wireless is active', async () => {
        (api.createBillingCheckoutSession as jest.Mock).mockResolvedValue({
            provider_name: 'ssl-wireless',
            checkout_url: 'https://sandbox.sslcommerz.com/gateway',
            requires_confirmation: false,
            reference: 'sslw_tenant_1',
            billing_cycle: 'MONTHLY',
            plan: { code: 'BASIC' },
        });

        render(<BillingPage />);

        await waitFor(() => {
            expect(screen.getByText(/Continue to SSL Wireless/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /continue to ssl wireless/i }));

        await waitFor(() => {
            expect(api.createBillingCheckoutSession).toHaveBeenCalled();
            expect(redirectTo).toHaveBeenCalledWith('https://sandbox.sslcommerz.com/gateway');
        });
    });

    it('lists available add-ons and includes selected codes in the checkout request', async () => {
        (api.createBillingCheckoutSession as jest.Mock).mockResolvedValue({
            provider_name: 'ssl-wireless',
            checkout_url: 'https://sandbox.sslcommerz.com/gateway',
            requires_confirmation: false,
            reference: 'sslw_tenant_1',
            billing_cycle: 'MONTHLY',
            plan: { code: 'BASIC' },
        });

        render(<BillingPage />);

        await waitFor(() => {
            expect(screen.getByText('Manufacturing')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /continue to ssl wireless/i }));

        await waitFor(() => {
            expect(api.createBillingCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ addonCodes: ['MANUFACTURING'] }),
            );
        });
    });

    it('shows active add-ons with a cancel action', async () => {
        (api.getMyAddonSubscriptions as jest.Mock).mockResolvedValue([
            {
                addon: { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500 },
                status: 'ACTIVE',
                current_period_start: '2026-03-21T00:00:00.000Z',
                current_period_end: '2026-04-20T00:00:00.000Z',
                cancel_at_period_end: false,
            },
        ]);
        (api.cancelAddonAtPeriodEnd as jest.Mock).mockResolvedValue({});

        render(<BillingPage />);

        await waitFor(() => {
            expect(screen.getByText('Your Add-ons')).toBeInTheDocument();
        });

        // Purchased add-ons shouldn't also appear in the purchasable catalog grid
        expect(screen.queryByText('Available Add-ons')).not.toBeInTheDocument();

        // The add-on's own cancel button renders before the base-plan's (same label) further down the page.
        const [addonCancelButton] = screen.getAllByRole('button', { name: /cancel at period end/i });
        fireEvent.click(addonCancelButton);

        await waitFor(() => {
            expect(api.cancelAddonAtPeriodEnd).toHaveBeenCalledWith('MANUFACTURING');
        });
    });
});