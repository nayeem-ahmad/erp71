import { render, screen, waitFor } from '@testing-library/react';
import DemoPage from './page';
import { getWorkspaceItem } from '@/lib/session-store';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
}));

// `ApiError` has to be a real class: the page narrows on `instanceof` to tell a
// demo the platform admin switched off from one that simply failed.
jest.mock('../../lib/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(
            message: string,
            public readonly status: number,
            public readonly code?: string,
        ) {
            super(message);
            this.name = 'ApiError';
        }
    },
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
        api.getMe.mockResolvedValue({
            is_demo: true,
            tenants: [{
                id: 'tenant-demo',
                stores: [{ id: 'store-demo' }],
                subscription: { plan: { code: 'STANDARD' } },
            }],
        });
    });

    it('logs in and redirects to onboarding', async () => {
        render(<DemoPage />);

        await waitFor(() => {
            expect(replaceMock).toHaveBeenCalledWith('/dashboard/onboarding');
        });

        expect(localStorage.getItem('access_token')).toBe('demo-token');
        expect(localStorage.getItem('demo_session')).toBe('1');
        expect(getWorkspaceItem('tenant_id')).toBe('tenant-demo');
    });

    it('shows an error state when demo login fails', async () => {
        const { api } = require('../../lib/api');
        api.demoLogin.mockRejectedValueOnce(new Error('Demo account not available'));

        render(<DemoPage />);

        expect(await screen.findByText('Demo unavailable')).toBeInTheDocument();
        expect(screen.getByText('Demo account not available')).toBeInTheDocument();
    });

    it('says the demo is switched off rather than repeating the backend sentence', async () => {
        const { api, ApiError } = require('../../lib/api');
        api.demoLogin.mockRejectedValueOnce(
            new ApiError('The demo is not available on this platform.', 403, 'DEMO_DISABLED'),
        );

        render(<DemoPage />);

        expect(await screen.findByText('Demo unavailable')).toBeInTheDocument();
        expect(screen.getByText(/currently switched off/i)).toBeInTheDocument();
    });
});