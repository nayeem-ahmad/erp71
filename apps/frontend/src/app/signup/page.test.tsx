import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupPage from './page';
import { api } from '../../lib/api';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => ({ get: () => null }),
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
    },
}));

describe('SignupPage', () => {
    beforeEach(() => {
        localStorage.clear();
        pushMock.mockReset();
    });

    it('submits with org name, email and password only', async () => {
        render(<SignupPage />);
        fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
        await waitFor(() => expect(api.signup).toHaveBeenCalled());
        const payload = (api.signup as jest.Mock).mock.calls[0][0];
        expect(payload.tenantName).toBe('Dhaka Retail Co.');
    });
});
