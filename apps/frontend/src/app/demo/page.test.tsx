import { render, screen, waitFor } from '@testing-library/react';
import DemoPage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
}));

jest.mock('../../lib/api', () => ({
    api: {
        demoLogin: jest.fn(),
        getMe: jest.fn(),
    },
}));

describe('DemoPage', () => {
    beforeEach(() => {
        localStorage.clear();
        replaceMock.mockReset();
        const { api } = require('../../lib/api');
        const demoTenant = {
            id: 'tenant-demo',
            stores: [{ id: 'store-demo' }],
            subscription: { plan: { code: 'STANDARD' } },
        };
        api.demoLogin.mockResolvedValue({
            access_token: 'demo-token',
            is_demo: true,
            tenants: [demoTenant],
        });
        // storeAuthResponse always reloads the full session profile after login.
        api.getMe.mockResolvedValue({
            is_demo: true,
            tenants: [demoTenant],
        });
    });

    it('logs in and redirects to onboarding', async () => {
        render(<DemoPage />);

        await waitFor(() => {
            expect(replaceMock).toHaveBeenCalledWith('/dashboard/onboarding');
        });

        expect(localStorage.getItem('access_token')).toBe('demo-token');
        expect(localStorage.getItem('demo_session')).toBe('1');
        expect(localStorage.getItem('tenant_id')).toBe('tenant-demo');
    });

    it('shows an error state when demo login fails', async () => {
        const { api } = require('../../lib/api');
        api.demoLogin.mockRejectedValueOnce(new Error('Demo account not available'));

        render(<DemoPage />);

        expect(await screen.findByText('Demo unavailable')).toBeInTheDocument();
        expect(screen.getByText('Demo account not available')).toBeInTheDocument();
    });
});