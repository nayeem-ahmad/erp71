'use client';

import { render, screen, waitFor } from '@testing-library/react';
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
        getAdminAddonModules: jest.fn(),
        getAdminTenantAddons: jest.fn(),
        grantAdminTenantAddon: jest.fn(),
        revokeAdminTenantAddon: jest.fn(),
        getAdminTenantDemoDataStatus: jest.fn(),
        loadAdminTenantDemoData: jest.fn(),
        importAdminTenantCatalog: jest.fn(),
        setAdminTenantBusinessType: jest.fn(),
        getAdminTenantMessagingIdentity: jest.fn(),
        updateAdminTenantMessagingIdentity: jest.fn(),
        testAdminTenantMessagingEmail: jest.fn(),
        testAdminTenantMessagingWhatsApp: jest.fn(),
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
        api.getAdminAddonModules.mockResolvedValue([]);
        api.getAdminTenantAddons.mockResolvedValue([]);
        api.grantAdminTenantAddon.mockResolvedValue([]);
        api.revokeAdminTenantAddon.mockResolvedValue([]);
        api.getAdminTenantDemoDataStatus.mockResolvedValue({ has_demo_data: false });
        // No identity row: the tenant sends from the platform sender, which is
        // the state every workspace is in until an admin onboards it.
        api.getAdminTenantMessagingIdentity.mockResolvedValue({
            email_enabled: false,
            email_from: '',
            email_from_name: '',
            email_reply_to: '',
            whatsapp_enabled: false,
            whatsapp_phone_number_id: '',
            whatsapp_access_token: '',
            whatsapp_api_version: '',
            notes: '',
            updated_at: null,
            updated_by: null,
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

    it('links each row to the tenant detail page', async () => {
        const { api } = require('@/lib/api');
        api.getAdminTenants.mockResolvedValue(mockTenants);

        render(<AdminTenantsPage />);
        await waitFor(() => screen.getByText('Acme Corp'));

        expect(screen.getByRole('link', { name: /view \/ edit tenant/i }))
            .toHaveAttribute('href', '/admin/tenants/tenant1');
        // The list itself must not fetch tenant detail any more.
        expect(api.getAdminTenant).not.toHaveBeenCalled();
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