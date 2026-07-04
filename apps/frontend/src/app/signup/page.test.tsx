import { fireEvent, render, screen } from '@testing-library/react';
import SignupPage from './page';

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

    it('submits workspace signup and stores tenant context', async () => {
        const { api } = require('../../lib/api');
        render(<SignupPage />);

        fireEvent.change(screen.getByPlaceholderText(/Nayeem Ahmed/i), { target: { value: 'Nayeem' } });
        fireEvent.change(screen.getByPlaceholderText(/owner@company.com/i), { target: { value: 'owner@example.com' } });
        fireEvent.change(screen.getByPlaceholderText(/At least 8 characters/i), { target: { value: 'password123' } });
        fireEvent.change(screen.getByPlaceholderText(/Dhaka Retail Co./i), { target: { value: 'Tenant One' } });
        fireEvent.change(screen.getByPlaceholderText(/Gulshan Branch/i), { target: { value: 'Main Store' } });

        fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

        expect(api.signup).toHaveBeenCalledWith({
            name: 'Nayeem',
            email: 'owner@example.com',
            password: 'password123',
            tenantName: 'Tenant One',
            storeName: 'Main Store',
            planCode: 'BASIC',
        });
    });
});