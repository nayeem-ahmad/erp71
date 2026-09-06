import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupPage from './page';
import { api } from '../../lib/api';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';

const pushMock = jest.fn();
// A stable object reference (like the real next/navigation ReadonlyURLSearchParams)
// so effects with `[searchParams]` deps don't re-fire on every render.
let currentSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => currentSearchParams,
}));

jest.mock('../../lib/api', () => ({
    api: {
        getSubscriptionPlans: jest.fn().mockResolvedValue([
            { code: 'BASIC', name: 'Basic', description: 'Core operations', monthly_price: 499 },
            { code: 'STANDARD', name: 'Standard', description: 'Growth plan', monthly_price: 999 },
        ]),
        getSignupDefaults: jest.fn().mockResolvedValue({ defaultPlanCode: 'STANDARD' }),
        signup: jest.fn().mockResolvedValue({
            access_token: 'token-1',
            tenants: [{ id: 'tenant-1', stores: [{ id: 'store-1' }], subscription: { plan: { code: 'BASIC' } } }],
        }),
        // Google sign-up stays off in these tests; the button renders nothing.
        getGoogleAuthConfig: jest.fn().mockResolvedValue({ enabled: false, client_id: null }),
        googleSignIn: jest.fn(),
    },
}));

describe('SignupPage', () => {
    beforeEach(() => {
        localStorage.clear();
        pushMock.mockReset();
        currentSearchParams = new URLSearchParams();
        (api.signup as jest.Mock).mockClear();
        (api.getSignupDefaults as jest.Mock).mockClear().mockResolvedValue({ defaultPlanCode: 'STANDARD' });
        (api.getSubscriptionPlans as jest.Mock).mockClear();
    });

    it('submits with org name, email and password only', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.tenantName).toBe('Dhaka Retail Co.');
    });

    it('pre-selects the fetched default plan when no ?plan= param is present', async () => {
        render(<SignupPage />);

        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.planCode).toBe('STANDARD');
    });

    it('refuses to submit until the terms checkbox is ticked', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        expect(await screen.findByText(/accept the terms of service/i)).toBeInTheDocument();
        expect(api.signup).not.toHaveBeenCalled();
    });

    it('sends the version of the terms that was on screen', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.acceptedTermsVersion).toBe(CURRENT_TERMS_VERSION);
    });

    it('points the terms link at the addendum for the selected tier', async () => {
        currentSearchParams = new URLSearchParams({ plan: 'basic' });
        render(<SignupPage />);

        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        const link = screen.getByRole('link', { name: /terms of service/i });
        expect(link).toHaveAttribute('href', '/terms?plan=starter#plan-terms-starter');
    });

    it('keeps the ?plan= override and does not let the async default overwrite it', async () => {
        currentSearchParams = new URLSearchParams({ plan: 'basic' });
        render(<SignupPage />);

        // Wait for the async default-plan effect to resolve so the race is actually exercised.
        await waitFor(() => expect(api.getSignupDefaults).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.planCode).toBe('BASIC');
    });
});
