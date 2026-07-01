'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminTenantsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAdminTenants: jest.fn(),
        getAdminTenant: jest.fn(),
        updateAdminTenantSubscription: jest.fn(),
        suspendTenant: jest.fn(),
        impersonateTenant: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    formatDate: (d: string) => d,
    formatBDT: (n: number) => `৳${n}`,
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/admin/tenants',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockTenants = [
    {
        id: 'tenant1',
        name: 'Acme Corp',
        created_at: '2024-01-01T00:00:00Z',
        owner: { id: 'u1', email: 'owner@acme.com', name: 'John Doe' },
        stores: [{ id: 'store1', name: 'Main Store', address: '123 Main St' }],
        users: [{ id: 'u1', email: 'owner@acme.com', name: 'John Doe', role: 'OWNER' }],
        store_count: 1,
        user_count: 1,
        subscription: {
            status: 'ACTIVE' as const,
            current_period_start: '2024-01-01T00:00:00Z',
            current_period_end: '2024-02-01T00:00:00Z',
            cancel_at_period_end: false,
            provider_name: 'manual',
            plan: { code: 'BASIC' as const, name: 'Basic Plan', monthly_price: 500, description: null, yearly_price: null },
        },
    },
    {
        id: 'tenant2',
        name: 'Beta Ltd',
        created_at: '2024-02-01T00:00:00Z',
        owner: { id: 'u2', email: 'owner@beta.com', name: 'Jane Smith' },
        stores: [],
        users: [],
        store_count: 0,
        user_count: 0,
        subscription: null,
    },
];

const mockTenantDetail = mockTenants[0];

describe('AdminTenantsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue([]);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);
        api.updateAdminTenantSubscription.mockResolvedValue({});
        api.suspendTenant.mockResolvedValue({});
        api.impersonateTenant.mockResolvedValue({
            access_token: 'fake-token',
            impersonated_user: { email: 'owner@acme.com' },
        });
    });

    it('renders the page heading', async () => {
        render(<AdminTenantsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Tenant Management' })).toBeInTheDocument();
        });
    });

    it('shows loading state while fetching tenants', () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockReturnValue(new Promise(() => {}));

        render(<AdminTenantsPage />);
        expect(screen.getByText('Loading tenants...')).toBeInTheDocument();
    });

    it('shows empty state when no tenants match filters', async () => {
        render(<AdminTenantsPage />);
        await waitFor(() => {
            expect(screen.getByText('No tenants matched these filters.')).toBeInTheDocument();
        });
    });

    it('displays tenant list after loading', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Beta Ltd').length).toBeGreaterThan(0);
        });
    });

    it('displays tenant owner email in the list', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getAllByText('owner@acme.com').length).toBeGreaterThan(0);
        });
    });

    it('renders search, plan, and status filter controls', async () => {
        render(<AdminTenantsPage />);
        await waitFor(() => {
            expect(screen.queryByText('Loading tenants...')).not.toBeInTheDocument();
        });

        expect(screen.getByPlaceholderText('Search by tenant or owner')).toBeInTheDocument();
        expect(screen.getByText('All plans')).toBeInTheDocument();
        expect(screen.getByText('All statuses')).toBeInTheDocument();
    });

    it('calls API with search term when user types in search box', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue([]);

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getByPlaceholderText('Search by tenant or owner'));

        fireEvent.change(screen.getByPlaceholderText('Search by tenant or owner'), {
            target: { value: 'Acme' },
        });

        await waitFor(() => {
            expect(api.getAdminTenants).toHaveBeenCalledWith(
                expect.objectContaining({ search: 'Acme' })
            );
        });
    });

    it('calls API with planCode filter when plan is selected', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue([]);

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getByText('All plans'));

        const planSelect = screen.getAllByRole('combobox')[0];
        fireEvent.change(planSelect, { target: { value: 'PREMIUM' } });

        await waitFor(() => {
            expect(api.getAdminTenants).toHaveBeenCalledWith(
                expect.objectContaining({ planCode: 'PREMIUM' })
            );
        });
    });

    it('shows selected tenant detail panel when a tenant is clicked', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getAllByText('Acme Corp'));

        const tenantButton = screen.getAllByRole('button').find(
            (b) => b.textContent?.includes('Acme Corp'),
        );
        if (tenantButton) fireEvent.click(tenantButton);

        await waitFor(() => {
            expect(api.getAdminTenant).toHaveBeenCalledWith('tenant1');
        });
    });

    it('shows Impersonate Owner button in the detail panel', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /impersonate owner/i })).toBeInTheDocument();
        });
    });

    it('shows Suspend Tenant button in the detail panel', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /suspend tenant/i })).toBeInTheDocument();
        });
    });

    it('shows Save Subscription button in the detail panel', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /save subscription/i })).toBeInTheDocument();
        });
    });

    it('calls updateAdminTenantSubscription when Save Subscription is clicked', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);
        api.updateAdminTenantSubscription.mockResolvedValue({});

        render(<AdminTenantsPage />);

        await waitFor(() => screen.getByRole('button', { name: /save subscription/i }));
        fireEvent.click(screen.getByRole('button', { name: /save subscription/i }));

        await waitFor(() => {
            expect(api.updateAdminTenantSubscription).toHaveBeenCalledWith(
                'tenant1',
                expect.any(Object)
            );
        });
    });

    it('shows error message when tenant loading fails', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockRejectedValue(new Error('Server error'));

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });
    });

    it('shows the store and user counts in the tenant list', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByText('1 stores')).toBeInTheDocument();
            expect(screen.getByText('1 users')).toBeInTheDocument();
        });
    });
});
