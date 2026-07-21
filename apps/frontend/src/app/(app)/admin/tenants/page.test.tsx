'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
        getAdminTenantFeatures: jest.fn(),
        updateAdminTenantFeatures: jest.fn(),
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
        api.getAdminTenantFeatures.mockResolvedValue({
            platform_defaults: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: false },
            overrides: {},
            effective: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: false },
        });
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

    it('saves per-tenant feature overrides as a tri-state, clearing on Inherit', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);
        api.getAdminTenantFeatures.mockResolvedValue({
            platform_defaults: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: false },
            overrides: { aiChat: true },
            effective: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: true },
        });
        api.updateAdminTenantFeatures.mockResolvedValue({
            platform_defaults: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: false },
            overrides: { aiChat: true },
            effective: { feedback: false, support: false, help: false, voice: false, manufacturing: true, aiChat: true },
        });

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getByText('Acme Corp'));
        fireEvent.click(screen.getByRole('button', { name: /view \/ edit tenant/i }));

        await waitFor(() => expect(screen.getByText('Feature access')).toBeInTheDocument());

        // The unset features show what Inherit currently resolves to, from the platform defaults.
        expect(screen.getAllByText('Inheriting: On')).toHaveLength(1);   // manufacturing
        expect(screen.getAllByText('Inheriting: Off')).toHaveLength(4);  // feedback/support/help/voice
        expect(screen.getAllByText('Overridden for this tenant.')).toHaveLength(1); // aiChat

        // Pin Voice on for this tenant; every other feature keeps its current state.
        const voiceRow = screen.getByText('Voice').closest('div')!.parentElement!;
        fireEvent.click(within(voiceRow).getByRole('button', { name: 'On' }));
        fireEvent.click(screen.getByRole('button', { name: /save features/i }));

        await waitFor(() => {
            expect(api.updateAdminTenantFeatures).toHaveBeenCalledWith('tenant1', {
                feedback: null,
                support: null,
                help: null,
                voice: true,
                manufacturing: null,
                aiChat: true,
            });
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