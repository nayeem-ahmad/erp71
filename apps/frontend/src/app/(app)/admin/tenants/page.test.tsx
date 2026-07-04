'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminTenantsPage from './page';

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, emptyMessage, columns }: { data: any[]; emptyMessage?: string; columns: any[] }) => (
        <div data-testid="data-table">
            {data.length === 0 ? <span>{emptyMessage}</span> : data.map((row) => (
                <div key={row.id}>
                    <span>{row.name}</span>
                    {columns.find((col) => col.id === 'actions')?.cell?.({ row: { original: row } })}
                </div>
            ))}
        </div>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAdminTenants: jest.fn(),
        getAdminTenant: jest.fn(),
        getAdminTenantNavOverride: jest.fn(),
        updateAdminTenantSubscription: jest.fn(),
        updateAdminTenantLocalization: jest.fn(),
        suspendTenant: jest.fn(),
        impersonateTenant: jest.fn(),
        deleteAdminTenant: jest.fn(),
        createAdminTenant: jest.fn(),
        lookupAdminUser: jest.fn(),
        resetAdminTenantNavLayout: jest.fn(),
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
];

const mockTenantDetail = mockTenants[0];

describe('AdminTenantsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue([]);
        api.getAdminTenant.mockResolvedValue(mockTenantDetail);
        api.getAdminTenantNavOverride.mockResolvedValue(null);
        api.updateAdminTenantSubscription.mockResolvedValue({});
        api.suspendTenant.mockResolvedValue({});
        api.impersonateTenant.mockResolvedValue({
            access_token: 'fake-token',
            impersonated_user: { email: 'owner@acme.com' },
        });
    });

    it('renders the tenants list heading', async () => {
        render(<AdminTenantsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Tenants' })).toBeInTheDocument();
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

        render(<AdminTenantsPage />);

        await waitFor(() => {
            expect(screen.getByText('Acme Corp')).toBeInTheDocument();
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

    it('opens tenant detail modal from actions column', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getByText('Acme Corp'));

        fireEvent.click(screen.getByRole('button', { name: /view \/ edit tenant/i }));

        await waitFor(() => {
            expect(api.getAdminTenant).toHaveBeenCalledWith('tenant1');
            expect(screen.getByRole('button', { name: /impersonate owner/i })).toBeInTheDocument();
        });
    });

    it('shows New Tenant button in header', async () => {
        render(<AdminTenantsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /new tenant/i })).toBeInTheDocument();
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
});